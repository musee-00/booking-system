from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


@pytest.fixture(autouse=True)
def mock_email_sending():
    with patch("app.api.v1.router.send_booking_confirmation_email") as mock_send:
        yield mock_send


def test_create_and_list_services() -> None:
    unique = uuid4().hex[:8]
    payload = {
        "name": f"Classic Beard Trim {unique}",
        "duration_minutes": 30,
        "price": "180.00",
        "description": "Trim, shape and styling",
    }

    create_response = client.post("/api/v1/services", json=payload)
    assert create_response.status_code == 200, create_response.text
    service = create_response.json()
    assert service["name"] == payload["name"]
    assert service["price"] == payload["price"]

    list_response = client.get("/api/v1/services")
    assert list_response.status_code == 200, list_response.text
    services = list_response.json()
    assert any(item["name"] == payload["name"] for item in services)


def test_create_barber_with_profile_details() -> None:
    payload = {
        "name": f"Barber {uuid4().hex[:8]}",
        "email": f"barber-profile-{uuid4().hex[:8]}@example.com",
        "phone": "+46700000022",
        "role": "Owner",
        "bio": "Custom cuts and classic finishing details.",
        "photo_url": "https://example.com/barber.jpg",
        "color": "#8B5E3C",
    }

    response = client.post("/api/v1/barbers", json=payload)
    assert response.status_code == 200, response.text
    barber = response.json()
    assert barber["role"] == payload["role"]
    assert barber["bio"] == payload["bio"]
    assert barber["photo_url"] == payload["photo_url"]
    assert barber["color"] == payload["color"]


def test_create_and_list_appointments() -> None:
    barber_response = client.post(
        "/api/v1/barbers",
        json={
            "name": f"Barber {uuid4().hex[:8]}",
            "email": f"barber-{uuid4().hex[:8]}@example.com",
            "phone": "+46700000000",
        },
    )
    barber_id = barber_response.json()["id"]

    service_response = client.post(
        "/api/v1/services",
        json={
            "name": f"Haircut & Wash {uuid4().hex[:8]}",
            "duration_minutes": 60,
            "price": "320.00",
            "description": "Classic haircut with wash",
        },
    )
    service_id = service_response.json()["id"]

    payload = {
        "barber_id": barber_id,
        "service_id": service_id,
        "customer_name": "Alice Andersson",
        "customer_phone": "+46700000000",
        "customer_email": "alice@example.com",
        "starts_at": "2026-10-20T10:00:00",
        "ends_at": "2026-10-20T11:00:00",
        "notes": "Prefers a quiet chair",
    }

    create_response = client.post("/api/v1/appointments", json=payload)
    assert create_response.status_code == 200, create_response.text
    appointment = create_response.json()
    assert appointment["service_id"] == service_id
    assert appointment["customer_name"] == payload["customer_name"]

    list_response = client.get("/api/v1/appointments")
    assert list_response.status_code == 200, list_response.text
    appointments = list_response.json()
    assert any(item["customer_name"] == payload["customer_name"] for item in appointments)


def test_send_booking_confirmation_email_to_customer(mock_email_sending) -> None:
    barber_response = client.post(
        "/api/v1/barbers",
        json={
            "name": f"Barber {uuid4().hex[:8]}",
            "email": f"barber-email-{uuid4().hex[:8]}@example.com",
            "phone": "+46700000011",
        },
    )
    barber_id = barber_response.json()["id"]

    service_response = client.post(
        "/api/v1/services",
        json={
            "name": f"Confirmation Email Test {uuid4().hex[:8]}",
            "duration_minutes": 60,
            "price": "250.00",
            "description": "Optional description",
        },
    )
    service_id = service_response.json()["id"]

    payload = {
        "barber_id": barber_id,
        "service_id": service_id,
        "customer_name": "Dana Eriksson",
        "customer_phone": "+46700000012",
        "customer_email": "dana@example.com",
        "starts_at": "2026-10-22T10:00:00",
        "ends_at": "2026-10-22T11:00:00",
        "notes": "Needs a clean fade",
    }

    response = client.post("/api/v1/appointments", json=payload)

    assert response.status_code == 200, response.text
    assert mock_email_sending.call_count == 1
    assert mock_email_sending.call_args.kwargs["customer_email"] == "dana@example.com"


def test_rejects_overlapping_appointments_for_same_barber() -> None:
    barber_response = client.post(
        "/api/v1/barbers",
        json={
            "name": f"Barber {uuid4().hex[:8]}",
            "email": f"barber-overlap-{uuid4().hex[:8]}@example.com",
            "phone": "+46700000000",
        },
    )
    barber_id = barber_response.json()["id"]

    service_response = client.post(
        "/api/v1/services",
        json={
            "name": f"Beard Styling {uuid4().hex[:8]}",
            "duration_minutes": 45,
            "price": "220.00",
            "description": "Precision beard styling",
        },
    )
    service_id = service_response.json()["id"]

    first_payload = {
        "barber_id": barber_id,
        "service_id": service_id,
        "customer_name": "Alice Andersson",
        "customer_phone": "+46700000000",
        "customer_email": "alice@example.com",
        "starts_at": "2026-10-21T09:00:00",
        "ends_at": "2026-10-21T09:45:00",
    }

    first_response = client.post("/api/v1/appointments", json=first_payload)
    assert first_response.status_code == 200, first_response.text

    overlapping_response = client.post(
        "/api/v1/appointments",
        json={
            **first_payload,
            "customer_name": "Bob Berman",
            "customer_email": "bob@example.com",
            "starts_at": "2026-10-21T09:30:00",
            "ends_at": "2026-10-21T10:15:00",
        },
    )

    assert overlapping_response.status_code == 409, overlapping_response.text
    assert "overlapping" in overlapping_response.json()["detail"].lower()


def test_rejects_partial_overlap_and_releases_slot_after_cancellation() -> None:
    barber_response = client.post(
        "/api/v1/barbers",
        json={
            "name": f"Barber {uuid4().hex[:8]}",
            "email": f"barber-partial-overlap-{uuid4().hex[:8]}@example.com",
            "phone": "+46700000007",
        },
    )
    barber_id = barber_response.json()["id"]

    service_response = client.post(
        "/api/v1/services",
        json={
            "name": f"Partial Overlap {uuid4().hex[:8]}",
            "duration_minutes": 30,
            "price": "200.00",
            "description": "Used for partial overlap checks",
        },
    )
    service_id = service_response.json()["id"]

    booked_payload = {
        "barber_id": barber_id,
        "service_id": service_id,
        "customer_name": "Alice Andersson",
        "customer_phone": "+46700000000",
        "customer_email": "alice@example.com",
        "starts_at": "2026-10-24T09:00:00",
        "ends_at": "2026-10-24T09:30:00",
    }

    first_response = client.post("/api/v1/appointments", json=booked_payload)
    assert first_response.status_code == 200, first_response.text

    overlap_response = client.post(
        "/api/v1/appointments",
        json={
            **booked_payload,
            "customer_name": "Bob Berman",
            "customer_email": "bob@example.com",
            "starts_at": "2026-10-24T09:15:00",
            "ends_at": "2026-10-24T10:00:00",
        },
    )

    assert overlap_response.status_code == 409, overlap_response.text
    assert "overlapping" in overlap_response.json()["detail"].lower()

    login_response = client.post(
        "/api/v1/admin/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert login_response.status_code == 200, login_response.text
    token = login_response.json()["token"]

    cancel_response = client.patch(
        f"/api/v1/appointments/{first_response.json()['id']}/cancel",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert cancel_response.status_code == 200, cancel_response.text

    reopened_response = client.post(
        "/api/v1/appointments",
        json={
            **booked_payload,
            "customer_name": "Carol Carlson",
            "customer_email": "carol@example.com",
            "starts_at": "2026-10-24T09:15:00",
            "ends_at": "2026-10-24T10:00:00",
        },
    )
    assert reopened_response.status_code == 200, reopened_response.text


def test_rejects_bookings_in_the_past() -> None:
    barber_response = client.post(
        "/api/v1/barbers",
        json={
            "name": f"Barber {uuid4().hex[:8]}",
            "email": f"barber-past-{uuid4().hex[:8]}@example.com",
            "phone": "+46700000007",
        },
    )
    barber_id = barber_response.json()["id"]

    service_response = client.post(
        "/api/v1/services",
        json={
            "name": f"Past Booking {uuid4().hex[:8]}",
            "duration_minutes": 30,
            "price": "150.00",
            "description": "Should be rejected because it is in the past",
        },
    )
    service_id = service_response.json()["id"]

    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    past_start = now - __import__("datetime").timedelta(hours=2)
    past_end = past_start + __import__("datetime").timedelta(minutes=30)

    response = client.post(
        "/api/v1/appointments",
        json={
            "barber_id": barber_id,
            "service_id": service_id,
            "customer_name": "Old Customer",
            "customer_phone": "+46700000099",
            "customer_email": "old@example.com",
            "starts_at": past_start.isoformat(),
            "ends_at": past_end.isoformat(),
        },
    )

    assert response.status_code == 400, response.text
    assert "past" in response.json()["detail"].lower()


def test_availability_excludes_past_slots_today() -> None:
    barber_response = client.post(
        "/api/v1/barbers",
        json={
            "name": f"Barber {uuid4().hex[:8]}",
            "email": f"barber-availability-{uuid4().hex[:8]}@example.com",
            "phone": "+46700000010",
        },
    )
    barber_id = barber_response.json()["id"]

    service_response = client.post(
        "/api/v1/services",
        json={
            "name": f"Availability Slot {uuid4().hex[:8]}",
            "duration_minutes": 30,
            "price": "180.00",
            "description": "Used for availability checks",
        },
    )
    service_id = service_response.json()["id"]

    stockholm_tz = ZoneInfo("Europe/Stockholm")
    today = date.today()
    response = client.get(
        "/api/v1/availability",
        params={
            "barber_id": barber_id,
            "service_id": service_id,
            "date": today.isoformat(),
        },
    )

    assert response.status_code == 200, response.text
    slots = response.json()
    now = datetime.now(stockholm_tz)
    assert all(datetime.fromisoformat(slot["start"]).astimezone(stockholm_tz) >= now for slot in slots)


def test_availability_excludes_overlapping_existing_bookings() -> None:
    barber_response = client.post(
        "/api/v1/barbers",
        json={
            "name": f"Barber {uuid4().hex[:8]}",
            "email": f"barber-overlap-availability-{uuid4().hex[:8]}@example.com",
            "phone": "+46700000011",
        },
    )
    barber_id = barber_response.json()["id"]

    service_response = client.post(
        "/api/v1/services",
        json={
            "name": f"Overlap Availability {uuid4().hex[:8]}",
            "duration_minutes": 30,
            "price": "220.00",
            "description": "Used for overlap availability checks",
        },
    )
    service_id = service_response.json()["id"]

    target_date = "2026-10-22"
    appointment_payload = {
        "barber_id": barber_id,
        "service_id": service_id,
        "customer_name": "Overlap Customer",
        "customer_phone": "+46700000012",
        "customer_email": "overlap@example.com",
        "starts_at": f"{target_date}T10:00:00+02:00",
        "ends_at": f"{target_date}T10:30:00+02:00",
    }

    create_response = client.post("/api/v1/appointments", json=appointment_payload)
    assert create_response.status_code == 200, create_response.text

    availability_response = client.get(
        "/api/v1/availability",
        params={"barber_id": barber_id, "service_id": service_id, "date": target_date},
    )

    assert availability_response.status_code == 200, availability_response.text
    slot_starts = [slot["start"] for slot in availability_response.json()]
    assert all("2026-10-22T10:00:00+02:00" != slot_start for slot_start in slot_starts)
    assert all("2026-10-22T10:30:00+02:00" != slot_start for slot_start in slot_starts)


def test_availability_releases_slot_after_cancellation() -> None:
    barber_response = client.post(
        "/api/v1/barbers",
        json={
            "name": f"Barber {uuid4().hex[:8]}",
            "email": f"barber-cancel-availability-{uuid4().hex[:8]}@example.com",
            "phone": "+46700000013",
        },
    )
    barber_id = barber_response.json()["id"]

    service_response = client.post(
        "/api/v1/services",
        json={
            "name": f"Cancelled Slot {uuid4().hex[:8]}",
            "duration_minutes": 30,
            "price": "250.00",
            "description": "Slot should reopen after cancellation",
        },
    )
    service_id = service_response.json()["id"]

    target_date = "2026-10-23"
    appointment_payload = {
        "barber_id": barber_id,
        "service_id": service_id,
        "customer_name": "Cancelled Customer",
        "customer_phone": "+46700000014",
        "customer_email": "cancelled@example.com",
        "starts_at": f"{target_date}T11:00:00+02:00",
        "ends_at": f"{target_date}T11:30:00+02:00",
    }

    create_response = client.post("/api/v1/appointments", json=appointment_payload)
    assert create_response.status_code == 200, create_response.text

    login_response = client.post(
        "/api/v1/admin/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert login_response.status_code == 200, login_response.text
    token = login_response.json()["token"]

    cancel_response = client.patch(
        f"/api/v1/appointments/{create_response.json()['id']}/cancel",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert cancel_response.status_code == 200, cancel_response.text

    availability_response = client.get(
        "/api/v1/availability",
        params={"barber_id": barber_id, "service_id": service_id, "date": target_date},
    )

    assert availability_response.status_code == 200, availability_response.text
    slot_starts = [slot["start"] for slot in availability_response.json()]
    assert f"{target_date}T11:00:00+02:00" in slot_starts


def test_admin_login_with_wrong_password_fails() -> None:
    login_response = client.post(
        "/api/v1/admin/login",
        json={"username": "admin", "password": "wrong-password"},
    )
    assert login_response.status_code == 401, login_response.text


def test_cancel_appointment_requires_token() -> None:
    barber_response = client.post(
        "/api/v1/barbers",
        json={
            "name": f"Barber {uuid4().hex[:8]}",
            "email": f"barber-no-token-{uuid4().hex[:8]}@example.com",
            "phone": "+46711111112",
        },
    )
    barber_id = barber_response.json()["id"]

    service_response = client.post(
        "/api/v1/services",
        json={
            "name": f"Classic Beard Trim {uuid4().hex[:8]}",
            "duration_minutes": 30,
            "price": "180.00",
            "description": "Trim and shape",
        },
    )
    service_id = service_response.json()["id"]

    appointment_response = client.post(
        "/api/v1/appointments",
        json={
            "barber_id": barber_id,
            "service_id": service_id,
            "customer_name": "Diana Lane",
            "customer_phone": "+46700000012",
            "customer_email": "diana@example.com",
            "starts_at": "2026-10-23T09:00:00",
            "ends_at": "2026-10-23T09:30:00",
        },
    )
    appointment_id = appointment_response.json()["id"]

    cancel_response = client.patch(f"/api/v1/appointments/{appointment_id}/cancel")
    assert cancel_response.status_code == 401, cancel_response.text


def test_admin_can_login_and_cancel_appointment() -> None:
    barber_response = client.post(
        "/api/v1/barbers",
        json={
            "name": f"Barber {uuid4().hex[:8]}",
            "email": f"barber-admin-{uuid4().hex[:8]}@example.com",
            "phone": "+46711111111",
        },
    )
    barber_id = barber_response.json()["id"]

    service_response = client.post(
        "/api/v1/services",
        json={
            "name": f"Premium Fade {uuid4().hex[:8]}",
            "duration_minutes": 90,
            "price": "420.00",
            "description": "Modern fade and finish",
        },
    )
    service_id = service_response.json()["id"]

    appointment_payload = {
        "barber_id": barber_id,
        "service_id": service_id,
        "customer_name": "Charlotte Holm",
        "customer_phone": "+46700000011",
        "customer_email": "charlotte@example.com",
        "starts_at": "2026-10-22T15:00:00",
        "ends_at": "2026-10-22T16:30:00",
    }

    appointment_response = client.post("/api/v1/appointments", json=appointment_payload)
    assert appointment_response.status_code == 200, appointment_response.text
    appointment_id = appointment_response.json()["id"]

    login_response = client.post(
        "/api/v1/admin/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert login_response.status_code == 200, login_response.text
    token = login_response.json()["token"]

    cancel_response = client.patch(
        f"/api/v1/appointments/{appointment_id}/cancel",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert cancel_response.status_code == 200, cancel_response.text
    assert cancel_response.json()["status"] == "cancelled"
