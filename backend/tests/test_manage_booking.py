"""Customers manage their own booking through the secret link in the confirmation email."""

import hashlib
from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest

from app.booking_emails import send_booking_cancelled_email, send_booking_confirmation_email
from app.core.config import settings
from app.db.database import SessionLocal
from app.models import Appointment
from tests.test_booking_api import (  # noqa: F401  (admin_headers and mock_email_sending are fixtures)
    admin_headers,
    at,
    availability,
    book,
    client,
    create_barber,
    create_service,
    future_business_day,
    mock_email_sending,
    stockholm,
)


@pytest.fixture(autouse=True)
def mock_cancellation_email():
    with patch("app.api.v1.manage_routes.send_booking_cancelled_email") as mock_send:
        yield mock_send


def book_and_get_token(admin_headers, mock_email_sending, start: str = "10:00", end: str = "10:30"):
    """Make a booking and return (booking, day, token from the confirmation email)."""
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=30)
    day = future_business_day()
    response = book(barber["id"], service["id"], at(day, start), at(day, end))
    assert response.status_code == 200, response.text
    manage_url = mock_email_sending.call_args.kwargs["manage_url"]
    return response.json(), day, manage_url.rsplit("/", 1)[1], (barber, service)


# --------------------------------------------------------- the secret link ---


def test_booking_email_contains_a_link_with_a_long_random_token(admin_headers, mock_email_sending) -> None:
    booking, _, token, _ = book_and_get_token(admin_headers, mock_email_sending)

    manage_url = mock_email_sending.call_args.kwargs["manage_url"]
    assert manage_url == f"{settings.public_site_url}/booking/{token}"
    assert len(token) >= 40
    assert str(booking["id"]) not in token


def test_only_the_hash_of_the_token_is_stored(admin_headers, mock_email_sending) -> None:
    booking, _, token, _ = book_and_get_token(admin_headers, mock_email_sending)

    with SessionLocal() as db:
        stored = db.get(Appointment, booking["id"]).manage_token_hash

    assert stored == hashlib.sha256(token.encode()).hexdigest()
    assert token not in stored


def test_token_is_never_returned_by_the_api(admin_headers, mock_email_sending) -> None:
    booking, _, token, _ = book_and_get_token(admin_headers, mock_email_sending)

    admin_list = client.get("/api/v1/appointments", headers=admin_headers).text

    assert token not in admin_list and "manage_token" not in admin_list
    assert "manage_token" not in str(booking)


def test_each_booking_gets_a_different_token(admin_headers, mock_email_sending) -> None:
    _, _, first, _ = book_and_get_token(admin_headers, mock_email_sending)
    _, _, second, _ = book_and_get_token(admin_headers, mock_email_sending)
    assert first != second


# ------------------------------------------------------ viewing a booking ---


def test_customer_sees_their_booking_through_the_link(admin_headers, mock_email_sending) -> None:
    booking, day, token, (barber, service) = book_and_get_token(admin_headers, mock_email_sending)

    response = client.get(f"/api/v1/manage/{token}")

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["id"] == booking["id"]
    assert data["service_name"] == service["name"]
    assert data["barber_name"] == barber["name"]
    assert data["status"] == "pending"
    assert data["can_cancel"] is True
    assert datetime.fromisoformat(data["starts_at"]) == stockholm(day, "10:00")
    assert "customer_email" not in data and "customer_phone" not in data


@pytest.mark.parametrize("token", ["not-a-real-token", "x" * 43, ""])
def test_wrong_token_gets_404(token) -> None:
    response = client.get(f"/api/v1/manage/{token}")
    assert response.status_code in (404, 405), response.text  # "" hits the bare prefix


# ------------------------------------------------------- cancelling ---


def test_customer_cancels_and_the_time_is_free_again(admin_headers, mock_email_sending, mock_cancellation_email) -> None:
    booking, day, token, (barber, service) = book_and_get_token(admin_headers, mock_email_sending)
    assert stockholm(day, "10:00") not in availability(barber["id"], service["id"], day)

    response = client.post(f"/api/v1/manage/{token}/cancel")

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    assert response.json()["can_cancel"] is False
    assert stockholm(day, "10:00") in availability(barber["id"], service["id"], day)
    assert mock_cancellation_email.call_args.kwargs["booking_id"] == booking["id"]


def test_cancelling_twice_is_refused(admin_headers, mock_email_sending, mock_cancellation_email) -> None:
    _, _, token, _ = book_and_get_token(admin_headers, mock_email_sending)
    client.post(f"/api/v1/manage/{token}/cancel")

    again = client.post(f"/api/v1/manage/{token}/cancel")

    assert again.status_code == 400, again.text
    assert "already cancelled" in again.json()["detail"]
    assert mock_cancellation_email.call_count == 1


def test_cancelling_is_refused_after_the_cutoff(admin_headers, mock_email_sending, mock_cancellation_email, monkeypatch) -> None:
    _, _, token, _ = book_and_get_token(admin_headers, mock_email_sending)
    # The booking is about a week away; a 30-day cutoff puts us past the deadline.
    monkeypatch.setattr(settings, "customer_cancel_cutoff_hours", 24 * 30)

    view = client.get(f"/api/v1/manage/{token}").json()
    response = client.post(f"/api/v1/manage/{token}/cancel")

    assert view["can_cancel"] is False
    assert "contact us" in view["cancel_blocked_reason"]
    assert response.status_code == 400, response.text
    assert client.get(f"/api/v1/manage/{token}").json()["status"] == "pending"
    mock_cancellation_email.assert_not_called()


def test_a_token_only_cancels_its_own_booking(admin_headers, mock_email_sending, mock_cancellation_email) -> None:
    first, _, first_token, _ = book_and_get_token(admin_headers, mock_email_sending)
    second, _, _, _ = book_and_get_token(admin_headers, mock_email_sending)

    client.post(f"/api/v1/manage/{first_token}/cancel")

    statuses = {a["id"]: a["status"] for a in client.get("/api/v1/appointments", headers=admin_headers).json()}
    assert statuses[first["id"]] == "cancelled"
    assert statuses[second["id"]] != "cancelled"


# --------------------------------------------------------- email content ---


def sent_email(send_function, **kwargs):
    with patch("app.booking_emails.email_backend", return_value="smtp"), patch("app.booking_emails.send_email") as send:
        send_function(**kwargs)
    return send.call_args.args[0]


BOOKING = {
    "booking_id": 7,
    "customer_email": "dana@example.com",
    "barber_name": "Mika",
    "service_name": "Classic Cut",
    "starts_at": datetime(2030, 1, 8, 10, 0, tzinfo=ZoneInfo("Europe/Stockholm")),
    "ends_at": datetime(2030, 1, 8, 10, 45, tzinfo=ZoneInfo("Europe/Stockholm")),
}


def test_confirmation_email_has_the_manage_button_and_link() -> None:
    email = sent_email(send_booking_confirmation_email, **BOOKING, price="290.00", manage_url="https://site.test/booking/abc")

    assert 'href="https://site.test/booking/abc"' in email.html
    assert "Manage or cancel booking" in email.html
    assert "https://site.test/booking/abc" in email.text


def test_cancellation_email_content() -> None:
    email = sent_email(send_booking_cancelled_email, **BOOKING)

    assert email.subject == "Booking cancelled — Classic Cut (#7)"
    assert "has been cancelled" in email.text
    assert "10:00–10:45" in email.html
    assert settings.public_site_url in email.html


def test_names_are_html_escaped_in_emails() -> None:
    email = sent_email(send_booking_confirmation_email, **{**BOOKING, "service_name": "<b>Cut & Style</b>"}, price="1")

    assert "<b>Cut & Style</b>" not in email.html
    assert "&lt;b&gt;Cut &amp; Style&lt;/b&gt;" in email.html
