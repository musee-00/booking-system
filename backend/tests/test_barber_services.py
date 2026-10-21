"""Which barber offers which service (assigned by the owner, like Setmore)."""

from tests.test_booking_api import (  # noqa: F401  (admin_headers and mock_email_sending are fixtures)
    admin_headers,
    at,
    book,
    client,
    create_barber,
    create_service,
    future_business_day,
    mock_email_sending,
)


def availability_status(barber_id: int, service_id: int) -> int:
    day = future_business_day()
    return client.get(
        "/api/v1/availability", params={"barber_id": barber_id, "service_id": service_id, "date": day.isoformat()},
    ).status_code


def test_new_service_is_offered_by_every_active_barber(admin_headers) -> None:
    first = create_barber(admin_headers)
    second = create_barber(admin_headers)

    service = create_service(admin_headers)

    assert {first["id"], second["id"]} <= set(service["barber_ids"])


def test_new_barber_offers_every_existing_service(admin_headers) -> None:
    service = create_service(admin_headers)

    barber = create_barber(admin_headers)

    assert service["id"] in barber["service_ids"]


def test_service_can_be_limited_to_some_barbers(admin_headers) -> None:
    offers = create_barber(admin_headers)
    does_not = create_barber(admin_headers)

    service = create_service(admin_headers, barber_ids=[offers["id"]])

    assert service["barber_ids"] == [offers["id"]]
    assert availability_status(offers["id"], service["id"]) == 200
    assert availability_status(does_not["id"], service["id"]) == 404

    day = future_business_day()
    rejected = book(does_not["id"], service["id"], at(day, "10:00"), at(day, "10:30"))
    assert rejected.status_code == 400, rejected.text
    assert "doesn't offer" in rejected.json()["detail"]
    accepted = book(offers["id"], service["id"], at(day, "10:00"), at(day, "10:30"))
    assert accepted.status_code == 200, accepted.text


def test_owner_can_change_who_offers_a_service(admin_headers) -> None:
    first = create_barber(admin_headers)
    second = create_barber(admin_headers)
    service = create_service(admin_headers, barber_ids=[first["id"]])

    response = client.patch(
        f"/api/v1/services/{service['id']}", json={"barber_ids": [second["id"]]}, headers=admin_headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["barber_ids"] == [second["id"]]
    assert availability_status(first["id"], service["id"]) == 404
    assert availability_status(second["id"], service["id"]) == 200


def test_patch_without_barber_ids_keeps_the_assignment(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, barber_ids=[barber["id"]])

    response = client.patch(f"/api/v1/services/{service['id']}", json={"price": "999.00"}, headers=admin_headers)

    assert response.json()["barber_ids"] == [barber["id"]]


def test_service_with_no_barbers_cannot_be_booked(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, barber_ids=[])

    assert service["barber_ids"] == []
    assert availability_status(barber["id"], service["id"]) == 404


def test_unknown_barber_ids_are_rejected(admin_headers) -> None:
    create = client.post(
        "/api/v1/services",
        json={"name": "Ghost service", "duration_minutes": 30, "price": "100.00", "barber_ids": [999999]},
        headers=admin_headers,
    )
    service = create_service(admin_headers)
    update = client.patch(f"/api/v1/services/{service['id']}", json={"barber_ids": [999999]}, headers=admin_headers)

    assert create.status_code == 422, create.text
    assert "999999" in create.json()["detail"]
    assert update.status_code == 422, update.text


def test_public_lists_show_who_offers_what(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, barber_ids=[barber["id"]])

    public_barber = next(b for b in client.get("/api/v1/barbers").json() if b["id"] == barber["id"])
    public_service = next(s for s in client.get("/api/v1/services").json() if s["id"] == service["id"])

    assert service["id"] in public_barber["service_ids"]
    assert public_service["barber_ids"] == [barber["id"]]
