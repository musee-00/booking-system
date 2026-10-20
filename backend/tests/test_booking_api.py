from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4
from zoneinfo import ZoneInfo

import jwt
import pytest
from fastapi.testclient import TestClient

from app.api.v1.router import send_booking_confirmation_email  # imported before any test patches it
from app.core.config import settings
from app.main import app


client = TestClient(app)
STOCKHOLM_TZ = ZoneInfo("Europe/Stockholm")


# ---------------------------------------------------------------- helpers ---


@pytest.fixture(autouse=True)
def mock_email_sending():
    with patch("app.api.v1.router.send_booking_confirmation_email") as mock_send:
        yield mock_send


@pytest.fixture
def admin_headers() -> dict[str, str]:
    response = client.post(
        "/api/v1/admin/login",
        json={"username": settings.admin_username, "password": settings.admin_password},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


def future_business_day(days_ahead: int = 7) -> date:
    """A Tuesday-Saturday date in the future, so tests never go stale."""
    day = datetime.now(STOCKHOLM_TZ).date() + timedelta(days=days_ahead)
    while day.weekday() not in {1, 2, 3, 4, 5}:
        day += timedelta(days=1)
    return day


def at(day: date, hh_mm: str) -> str:
    """Naive ISO timestamp; the API interprets it as Stockholm time."""
    return f"{day.isoformat()}T{hh_mm}:00"


def stockholm(day: date, hh_mm: str) -> datetime:
    hour, minute = map(int, hh_mm.split(":"))
    return datetime.combine(day, time(hour, minute), tzinfo=STOCKHOLM_TZ)


def create_barber(headers: dict[str, str], **overrides) -> dict:
    payload = {
        "name": f"Barber {uuid4().hex[:8]}",
        "email": f"barber-{uuid4().hex[:8]}@example.com",
        "phone": "+46700000000",
        **overrides,
    }
    response = client.post("/api/v1/barbers", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def create_service(headers: dict[str, str], duration_minutes: int = 30, **overrides) -> dict:
    payload = {
        "name": f"Service {uuid4().hex[:8]}",
        "duration_minutes": duration_minutes,
        "price": "200.00",
        "description": "Test service",
        **overrides,
    }
    response = client.post("/api/v1/services", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def book(barber_id: int, service_id: int, starts_at: str, ends_at: str, **overrides):
    payload = {
        "barber_id": barber_id,
        "service_id": service_id,
        "customer_name": "Alice Andersson",
        "customer_phone": "+46700000000",
        "customer_email": "alice@example.com",
        "starts_at": starts_at,
        "ends_at": ends_at,
        **overrides,
    }
    return client.post("/api/v1/appointments", json=payload)


def availability(barber_id: int, service_id: int, day: date) -> list[datetime]:
    response = client.get(
        "/api/v1/availability",
        params={"barber_id": barber_id, "service_id": service_id, "date": day.isoformat()},
    )
    assert response.status_code == 200, response.text
    return [datetime.fromisoformat(slot["start"]) for slot in response.json()]


# ------------------------------------------------------- services/barbers ---


def test_create_and_list_services(admin_headers) -> None:
    service = create_service(admin_headers, name=f"Classic Beard Trim {uuid4().hex[:8]}", price="180.00")
    assert service["price"] == "180.00"

    list_response = client.get("/api/v1/services")
    assert list_response.status_code == 200, list_response.text
    assert any(item["name"] == service["name"] for item in list_response.json())


def test_create_barber_with_profile_details(admin_headers) -> None:
    profile = {
        "role": "Owner",
        "bio": "Custom cuts and classic finishing details.",
        "photo_url": "https://example.com/barber.jpg",
        "color": "#8B5E3C",
    }
    barber = create_barber(admin_headers, **profile)
    for key, value in profile.items():
        assert barber[key] == value


# ----------------------------------------------------------- appointments ---


def test_create_and_list_appointments(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=60)
    day = future_business_day()

    create_response = book(barber["id"], service["id"], at(day, "10:00"), at(day, "11:00"), customer_name="Alice Andersson")
    assert create_response.status_code == 200, create_response.text
    assert create_response.json()["service_id"] == service["id"]

    list_response = client.get("/api/v1/appointments", headers=admin_headers)
    assert list_response.status_code == 200, list_response.text
    assert any(item["id"] == create_response.json()["id"] for item in list_response.json())


def test_send_booking_confirmation_email_to_customer(admin_headers, mock_email_sending) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=60)
    day = future_business_day()

    response = book(barber["id"], service["id"], at(day, "10:00"), at(day, "11:00"), customer_email="dana@example.com")

    assert response.status_code == 200, response.text
    assert mock_email_sending.call_count == 1
    assert mock_email_sending.call_args.kwargs["customer_email"] == "dana@example.com"
    assert mock_email_sending.call_args.kwargs["booking_id"] == response.json()["id"]


def test_confirmation_email_contains_booking_reference() -> None:
    """Renders the real email (SMTP mocked) and checks the reference is in subject and body."""
    start = stockholm(future_business_day(), "10:00")
    with patch("app.api.v1.router.smtplib.SMTP") as mock_smtp:
        send_booking_confirmation_email(
            booking_id=42,
            customer_email="dana@example.com",
            barber_name="Mika",
            service_name="Classic Cut",
            starts_at=start,
            ends_at=start + timedelta(minutes=45),
            price="290.00",
        )

    message = mock_smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
    assert message["Subject"] == "Booking confirmed — Classic Cut (#42)"
    assert "Booking reference: #42" in message.get_body(("plain",)).get_content()
    assert "#42" in message.get_body(("html",)).get_content()


def test_rejects_bookings_in_the_past(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers)
    past_start = datetime.now(timezone.utc) - timedelta(hours=2)
    past_end = past_start + timedelta(minutes=30)

    response = book(barber["id"], service["id"], past_start.isoformat(), past_end.isoformat())

    assert response.status_code == 400, response.text
    assert "past" in response.json()["detail"].lower()


# ------------------------------------------------- double-booking rules ---


def test_rejects_overlapping_appointments_for_same_barber(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=45)
    day = future_business_day()

    first = book(barber["id"], service["id"], at(day, "09:00"), at(day, "09:45"))
    assert first.status_code == 200, first.text

    overlapping = book(barber["id"], service["id"], at(day, "09:30"), at(day, "10:15"), customer_name="Bob Berman")
    assert overlapping.status_code == 409, overlapping.text
    assert "overlapping" in overlapping.json()["detail"].lower()


def test_allows_back_to_back_appointments(admin_headers) -> None:
    """[10:00, 10:30) and [10:30, 11:00) share only an end point, so both are allowed."""
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=30)
    day = future_business_day()

    first = book(barber["id"], service["id"], at(day, "10:00"), at(day, "10:30"))
    assert first.status_code == 200, first.text

    slot_starts = availability(barber["id"], service["id"], day)
    assert stockholm(day, "10:00") not in slot_starts
    assert stockholm(day, "09:30") in slot_starts  # ends exactly when the booking starts
    assert stockholm(day, "10:30") in slot_starts  # starts exactly when the booking ends

    after = book(barber["id"], service["id"], at(day, "10:30"), at(day, "11:00"), customer_name="Bob Berman")
    assert after.status_code == 200, after.text

    before = book(barber["id"], service["id"], at(day, "09:30"), at(day, "10:00"), customer_name="Carol Carlson")
    assert before.status_code == 200, before.text


def test_rejects_partial_overlap_and_releases_slot_after_cancellation(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=30)
    day = future_business_day()

    first = book(barber["id"], service["id"], at(day, "09:00"), at(day, "09:30"))
    assert first.status_code == 200, first.text

    overlap = book(barber["id"], service["id"], at(day, "09:15"), at(day, "10:00"), customer_name="Bob Berman")
    assert overlap.status_code == 409, overlap.text
    assert "overlapping" in overlap.json()["detail"].lower()

    cancel = client.patch(f"/api/v1/appointments/{first.json()['id']}/cancel", headers=admin_headers)
    assert cancel.status_code == 200, cancel.text

    reopened = book(barber["id"], service["id"], at(day, "09:15"), at(day, "10:00"), customer_name="Carol Carlson")
    assert reopened.status_code == 200, reopened.text


# ----------------------------------------------------------- availability ---


def test_availability_excludes_past_slots_today(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers)

    slot_starts = availability(barber["id"], service["id"], datetime.now(STOCKHOLM_TZ).date())

    now = datetime.now(STOCKHOLM_TZ)
    assert all(start >= now for start in slot_starts)


def test_availability_excludes_overlapping_existing_bookings(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=60)
    day = future_business_day()

    response = book(barber["id"], service["id"], at(day, "10:00"), at(day, "11:00"))
    assert response.status_code == 200, response.text

    slot_starts = availability(barber["id"], service["id"], day)
    # A 60-minute slot starting at 09:30, 10:00 or 10:30 would overlap 10:00-11:00.
    for blocked in ("09:30", "10:00", "10:30"):
        assert stockholm(day, blocked) not in slot_starts
    # 09:00-10:00 and 11:00-12:00 only touch the booking, so they stay open.
    assert stockholm(day, "09:00") in slot_starts
    assert stockholm(day, "11:00") in slot_starts


def test_availability_releases_slot_after_cancellation(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers)
    day = future_business_day()

    response = book(barber["id"], service["id"], at(day, "11:00"), at(day, "11:30"))
    assert response.status_code == 200, response.text
    assert stockholm(day, "11:00") not in availability(barber["id"], service["id"], day)

    cancel = client.patch(f"/api/v1/appointments/{response.json()['id']}/cancel", headers=admin_headers)
    assert cancel.status_code == 200, cancel.text

    assert stockholm(day, "11:00") in availability(barber["id"], service["id"], day)


# ------------------------------------------------------- admin and auth ---


def test_admin_login_with_wrong_password_fails() -> None:
    response = client.post(
        "/api/v1/admin/login",
        json={"username": settings.admin_username, "password": "wrong-password"},
    )
    assert response.status_code == 401, response.text


def test_admin_can_login_and_cancel_appointment(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=90)
    day = future_business_day()

    appointment = book(barber["id"], service["id"], at(day, "15:00"), at(day, "16:30"))
    assert appointment.status_code == 200, appointment.text

    cancel = client.patch(f"/api/v1/appointments/{appointment.json()['id']}/cancel", headers=admin_headers)
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["status"] == "cancelled"


def make_protected_request(endpoint: str, headers: dict[str, str], admin_headers: dict[str, str]):
    """Call one admin-only endpoint with `headers`. Uses `admin_headers` only for setup."""
    if endpoint == "list appointments":
        return client.get("/api/v1/appointments", headers=headers)
    if endpoint == "create barber":
        return client.post(
            "/api/v1/barbers",
            json={"name": "Protected Barber", "email": f"protected-{uuid4().hex[:8]}@example.com"},
            headers=headers,
        )
    if endpoint == "create service":
        return client.post(
            "/api/v1/services",
            json={"name": f"Protected {uuid4().hex[:8]}", "duration_minutes": 30, "price": "100.00"},
            headers=headers,
        )
    if endpoint == "cancel appointment":
        barber = create_barber(admin_headers)
        service = create_service(admin_headers)
        day = future_business_day()
        appointment = book(barber["id"], service["id"], at(day, "12:00"), at(day, "12:30"))
        assert appointment.status_code == 200, appointment.text
        return client.patch(f"/api/v1/appointments/{appointment.json()['id']}/cancel", headers=headers)
    raise ValueError(endpoint)


PROTECTED_ENDPOINTS = ["list appointments", "create barber", "create service", "cancel appointment"]


def expired_token() -> str:
    payload = {"sub": settings.admin_username, "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def forged_token() -> str:
    """Correct shape, but signed with a secret the server doesn't know."""
    payload = {"sub": settings.admin_username, "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}
    return jwt.encode(payload, "not-the-server-secret-but-long-enough-for-hs256", algorithm=settings.jwt_algorithm)


@pytest.mark.parametrize("endpoint", PROTECTED_ENDPOINTS)
def test_protected_endpoint_rejects_missing_token(endpoint, admin_headers) -> None:
    response = make_protected_request(endpoint, {}, admin_headers)
    assert response.status_code == 401, response.text
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("endpoint", PROTECTED_ENDPOINTS)
@pytest.mark.parametrize("bad_token", ["garbage", "expired", "forged"])
def test_protected_endpoint_rejects_invalid_token(endpoint, bad_token, admin_headers) -> None:
    token = {"garbage": "not-a-jwt", "expired": expired_token(), "forged": forged_token()}[bad_token]
    response = make_protected_request(endpoint, {"Authorization": f"Bearer {token}"}, admin_headers)
    assert response.status_code == 401, response.text


@pytest.mark.parametrize("endpoint", PROTECTED_ENDPOINTS)
def test_protected_endpoint_works_with_valid_token(endpoint, admin_headers) -> None:
    response = make_protected_request(endpoint, admin_headers, admin_headers)
    assert response.status_code == 200, response.text


def test_public_endpoints_do_not_expose_customer_data(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers)
    day = future_business_day()
    secret_name = f"Private Person {uuid4().hex[:8]}"
    secret_email = f"private-{uuid4().hex[:8]}@example.com"
    secret_phone = "+46799999999"

    response = book(
        barber["id"], service["id"], at(day, "13:00"), at(day, "13:30"),
        customer_name=secret_name, customer_email=secret_email, customer_phone=secret_phone,
    )
    assert response.status_code == 200, response.text

    public_responses = [
        client.get("/api/v1/barbers"),
        client.get("/api/v1/services"),
        client.get(
            "/api/v1/availability",
            params={"barber_id": barber["id"], "service_id": service["id"], "date": day.isoformat()},
        ),
    ]
    for public_response in public_responses:
        assert public_response.status_code == 200, public_response.text
        for secret in (secret_name, secret_email, secret_phone):
            assert secret not in public_response.text


# ------------------------------------------------------- input validation ---


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("customer_email", "abc"),
        ("customer_email", "a@b"),
        ("customer_email", ""),
        ("customer_name", ""),
        ("customer_name", "   "),
        ("customer_name", "x" * 151),
        ("customer_phone", "12"),
        ("customer_phone", "call me"),
        ("customer_phone", "1" * 31),
    ],
)
def test_rejects_invalid_customer_details(field, value, admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers)
    day = future_business_day()

    response = book(barber["id"], service["id"], at(day, "10:00"), at(day, "10:30"), **{field: value})

    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"][-1] == field


@pytest.mark.parametrize("phone", ["+46 70 123 45 67", "070-123 45 67", "(070) 1234567", "0701234567"])
def test_accepts_common_phone_formats(phone, admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers)
    day = future_business_day()

    response = book(barber["id"], service["id"], at(day, "10:00"), at(day, "10:30"), customer_phone=phone)

    assert response.status_code == 200, response.text


def test_trims_whitespace_and_normalises_email(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers)
    day = future_business_day()

    response = book(
        barber["id"], service["id"], at(day, "10:00"), at(day, "10:30"),
        customer_name="  Alice Andersson ", customer_email=" Alice@Example.COM ",
    )

    assert response.status_code == 200, response.text
    assert response.json()["customer_name"] == "Alice Andersson"
    assert response.json()["customer_email"] == "Alice@example.com"


# ------------------------------------------------- race condition (layer 2) ---


def test_database_constraint_returns_409_when_api_check_is_bypassed(admin_headers, mock_email_sending) -> None:
    """Simulates the race: the API check says "free" but another booking was saved first."""
    barber = create_barber(admin_headers)
    service = create_service(admin_headers)
    day = future_business_day()

    first = book(barber["id"], service["id"], at(day, "10:00"), at(day, "10:30"))
    assert first.status_code == 200, first.text

    with patch("app.api.v1.router.has_overlapping_appointment", return_value=False):
        second = book(barber["id"], service["id"], at(day, "10:15"), at(day, "10:45"), customer_name="Bob Berman")

    assert second.status_code == 409, second.text
    assert "overlapping" in second.json()["detail"].lower()
    assert mock_email_sending.call_count == 1  # no confirmation for the rejected booking

    appointments = client.get("/api/v1/appointments", headers=admin_headers).json()
    assert [a["id"] for a in appointments if a["barber_id"] == barber["id"]] == [first.json()["id"]]


def test_concurrent_bookings_for_same_slot_only_one_succeeds(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers)
    day = future_business_day()
    attempts = 10

    def attempt(index: int) -> int:
        # One client per thread, so requests really run in parallel.
        response = TestClient(app).post(
            "/api/v1/appointments",
            json={
                "barber_id": barber["id"],
                "service_id": service["id"],
                "customer_name": f"Customer {index}",
                "customer_phone": "+46700000000",
                "customer_email": f"customer{index}@example.com",
                "starts_at": at(day, "14:00"),
                "ends_at": at(day, "14:30"),
            },
        )
        return response.status_code

    with ThreadPoolExecutor(max_workers=attempts) as pool:
        status_codes = sorted(pool.map(attempt, range(attempts)))

    assert status_codes == [200] + [409] * (attempts - 1)
