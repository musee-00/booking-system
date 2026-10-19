from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


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
