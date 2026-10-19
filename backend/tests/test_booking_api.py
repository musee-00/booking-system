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

    overlapping_response = client.post(
        "/api/v1/appointments",
        json={
            **payload,
            "customer_name": "Bob Berman",
            "customer_email": "bob@example.com",
            "starts_at": "2026-10-20T10:30:00",
            "ends_at": "2026-10-20T11:30:00",
        },
    )
    assert overlapping_response.status_code == 409, overlapping_response.text
