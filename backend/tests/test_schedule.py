"""Barber working hours and time off: availability and booking follow each barber's schedule."""

from datetime import time

import pytest
from sqlalchemy import delete, select

from app.db.database import SessionLocal
from app.models import BarberTimeOff, BarberWorkingHours
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


def set_hours(barber_id: int, weekday: int, blocks: list[tuple[str, str]]) -> None:
    """Replace the barber's working blocks on one weekday, e.g. [("10:00", "12:00")]."""
    with SessionLocal() as db:
        db.execute(
            delete(BarberWorkingHours).where(
                BarberWorkingHours.barber_id == barber_id, BarberWorkingHours.weekday == weekday,
            )
        )
        for start, end in blocks:
            db.add(
                BarberWorkingHours(
                    barber_id=barber_id, weekday=weekday,
                    start_time=time.fromisoformat(start), end_time=time.fromisoformat(end),
                )
            )
        db.commit()


def add_time_off(barber_id: int, starts_at, ends_at) -> None:
    with SessionLocal() as db:
        db.add(BarberTimeOff(barber_id=barber_id, starts_at=starts_at, ends_at=ends_at, reason="Test"))
        db.commit()


def hh_mm(starts) -> list[str]:
    return [start.strftime("%H:%M") for start in starts]


def test_new_barber_gets_shop_opening_hours(admin_headers) -> None:
    barber = create_barber(admin_headers)

    with SessionLocal() as db:
        rows = db.scalars(
            select(BarberWorkingHours).where(BarberWorkingHours.barber_id == barber["id"]).order_by(BarberWorkingHours.weekday)
        ).all()

    assert [(r.weekday, r.start_time, r.end_time) for r in rows] == [
        (weekday, time(9), time(18)) for weekday in (1, 2, 3, 4, 5)
    ]


def test_availability_follows_working_blocks_with_lunch_break(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=30)
    day = future_business_day()
    set_hours(barber["id"], day.weekday(), [("10:00", "12:00"), ("13:00", "15:00")])

    starts = availability(barber["id"], service["id"], day)

    assert hh_mm(starts) == ["10:00", "10:30", "11:00", "11:30", "13:00", "13:30", "14:00", "14:30"]


def test_slots_never_run_into_a_break(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=60)
    day = future_business_day()
    set_hours(barber["id"], day.weekday(), [("10:00", "12:00"), ("13:00", "15:00")])

    starts = hh_mm(availability(barber["id"], service["id"], day))

    assert "11:00" in starts      # 11:00-12:00 ends exactly at the break
    assert "11:30" not in starts  # 11:30-12:30 would run into the break
    assert "14:30" not in starts  # 14:30-15:30 would run past the end of the day


def test_working_hours_are_clipped_to_shop_hours(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=30)
    day = future_business_day()
    set_hours(barber["id"], day.weekday(), [("07:00", "20:00")])

    starts = hh_mm(availability(barber["id"], service["id"], day))

    assert starts[0] == "09:00"
    assert starts[-1] == "17:30"


def test_day_without_working_hours_has_no_slots_and_rejects_bookings(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=30)
    day = future_business_day()
    set_hours(barber["id"], day.weekday(), [])

    assert availability(barber["id"], service["id"], day) == []

    response = book(barber["id"], service["id"], at(day, "10:00"), at(day, "10:30"))
    assert response.status_code == 400, response.text
    assert "isn't working" in response.json()["detail"]


def test_booking_must_fit_inside_one_working_block(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=60)
    day = future_business_day()
    set_hours(barber["id"], day.weekday(), [("10:00", "12:00"), ("13:00", "15:00")])

    across_lunch = book(barber["id"], service["id"], at(day, "11:30"), at(day, "12:30"))
    before_lunch = book(barber["id"], service["id"], at(day, "11:00"), at(day, "12:00"), customer_name="Bob Berman")

    assert across_lunch.status_code == 400, across_lunch.text
    assert before_lunch.status_code == 200, before_lunch.text


def test_time_off_removes_slots_and_rejects_bookings(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=30)
    day = future_business_day()
    add_time_off(barber["id"], stockholm(day, "13:00"), stockholm(day, "15:00"))

    starts = hh_mm(availability(barber["id"], service["id"], day))
    assert "12:30" in starts  # ends exactly when the time off starts
    assert not {"13:00", "13:30", "14:00", "14:30"} & set(starts)
    assert "15:00" in starts  # starts exactly when the time off ends

    during = book(barber["id"], service["id"], at(day, "13:30"), at(day, "14:00"))
    assert during.status_code == 400, during.text
    assert "away" in during.json()["detail"]

    after = book(barber["id"], service["id"], at(day, "15:00"), at(day, "15:30"), customer_name="Bob Berman")
    assert after.status_code == 200, after.text


def test_full_day_time_off_leaves_no_slots(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=30)
    day = future_business_day()
    add_time_off(barber["id"], stockholm(day, "00:00"), stockholm(day, "23:59"))

    assert availability(barber["id"], service["id"], day) == []


def test_time_off_for_one_barber_does_not_affect_another(admin_headers) -> None:
    away = create_barber(admin_headers)
    working = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=30)
    day = future_business_day()
    add_time_off(away["id"], stockholm(day, "00:00"), stockholm(day, "23:59"))

    assert availability(away["id"], service["id"], day) == []
    assert len(availability(working["id"], service["id"], day)) == 18


# ------------------------------------------------------------ admin API ---


def hours_url(barber_id: int) -> str:
    return f"/api/v1/barbers/{barber_id}/working-hours"


def time_off_url(barber_id: int) -> str:
    return f"/api/v1/barbers/{barber_id}/time-off"


def test_get_working_hours_returns_the_default_schedule(admin_headers) -> None:
    barber = create_barber(admin_headers)

    response = client.get(hours_url(barber["id"]), headers=admin_headers)

    assert response.status_code == 200, response.text
    assert response.json() == [
        {"weekday": weekday, "start_time": "09:00:00", "end_time": "18:00:00"} for weekday in (1, 2, 3, 4, 5)
    ]


def test_replacing_working_hours_changes_availability(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=30)
    day = future_business_day()
    new_schedule = [
        {"weekday": day.weekday(), "start_time": "10:00", "end_time": "11:00"},
        {"weekday": day.weekday(), "start_time": "14:00", "end_time": "15:00"},
    ]

    response = client.put(hours_url(barber["id"]), json=new_schedule, headers=admin_headers)

    assert response.status_code == 200, response.text
    assert len(response.json()) == 2
    assert hh_mm(availability(barber["id"], service["id"], day)) == ["10:00", "10:30", "14:00", "14:30"]
    # Every other weekday was removed by the replace.
    other_day = future_business_day(days_ahead=8)
    assert other_day.weekday() != day.weekday()
    assert availability(barber["id"], service["id"], other_day) == []


def test_empty_schedule_means_not_working_any_day(admin_headers) -> None:
    barber = create_barber(admin_headers)

    response = client.put(hours_url(barber["id"]), json=[], headers=admin_headers)

    assert response.status_code == 200, response.text
    assert client.get(hours_url(barber["id"]), headers=admin_headers).json() == []


@pytest.mark.parametrize(
    ("block", "message"),
    [
        ({"weekday": 0, "start_time": "09:00", "end_time": "12:00"}, "closed on Mondays"),
        ({"weekday": 2, "start_time": "08:00", "end_time": "12:00"}, "within opening hours"),
        ({"weekday": 2, "start_time": "12:00", "end_time": "18:30"}, "within opening hours"),
        ({"weekday": 2, "start_time": "10:15", "end_time": "12:00"}, "half hour"),
        ({"weekday": 2, "start_time": "12:00", "end_time": "10:00"}, "after the start"),
    ],
)
def test_invalid_working_hours_are_rejected(block, message, admin_headers) -> None:
    barber = create_barber(admin_headers)

    response = client.put(hours_url(barber["id"]), json=[block], headers=admin_headers)

    assert response.status_code == 422, response.text
    assert message in response.json()["detail"]
    # The old schedule is untouched.
    assert len(client.get(hours_url(barber["id"]), headers=admin_headers).json()) == 5


def test_overlapping_blocks_are_rejected(admin_headers) -> None:
    barber = create_barber(admin_headers)
    blocks = [
        {"weekday": 3, "start_time": "09:00", "end_time": "13:00"},
        {"weekday": 3, "start_time": "12:00", "end_time": "15:00"},
    ]

    response = client.put(hours_url(barber["id"]), json=blocks, headers=admin_headers)

    assert response.status_code == 422, response.text
    assert "overlap" in response.json()["detail"]


def test_schedule_endpoints_return_404_for_unknown_barber(admin_headers) -> None:
    assert client.get(hours_url(999999), headers=admin_headers).status_code == 404
    assert client.put(hours_url(999999), json=[], headers=admin_headers).status_code == 404
    assert client.get(time_off_url(999999), headers=admin_headers).status_code == 404


def test_time_off_lifecycle_and_conflicting_bookings(admin_headers) -> None:
    barber = create_barber(admin_headers)
    service = create_service(admin_headers, duration_minutes=30)
    day = future_business_day()
    existing = book(barber["id"], service["id"], at(day, "10:00"), at(day, "10:30"), customer_name="Already Booked")
    assert existing.status_code == 200, existing.text

    created = client.post(
        time_off_url(barber["id"]),
        json={"starts_at": at(day, "09:00"), "ends_at": at(day, "12:00"), "reason": "Dentist"},
        headers=admin_headers,
    )

    # Created, and the existing booking inside the period is reported, not cancelled.
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["time_off"]["reason"] == "Dentist"
    assert [a["customer_name"] for a in body["conflicting_appointments"]] == ["Already Booked"]
    appointments = client.get("/api/v1/appointments", headers=admin_headers).json()
    assert next(a for a in appointments if a["id"] == existing.json()["id"])["status"] != "cancelled"

    # It shows in the list and blocks those times.
    listed = client.get(time_off_url(barber["id"]), headers=admin_headers).json()
    assert [t["id"] for t in listed] == [body["time_off"]["id"]]
    assert "11:00" not in hh_mm(availability(barber["id"], service["id"], day))

    # Deleting it frees the times again.
    deleted = client.delete(f"{time_off_url(barber['id'])}/{body['time_off']['id']}", headers=admin_headers)
    assert deleted.status_code == 204, deleted.text
    assert client.get(time_off_url(barber["id"]), headers=admin_headers).json() == []
    assert "11:00" in hh_mm(availability(barber["id"], service["id"], day))


def test_past_time_off_is_hidden_unless_requested(admin_headers) -> None:
    barber = create_barber(admin_headers)
    last_year = future_business_day().replace(year=2020)
    add_time_off(barber["id"], stockholm(last_year, "09:00"), stockholm(last_year, "12:00"))

    assert client.get(time_off_url(barber["id"]), headers=admin_headers).json() == []
    assert len(client.get(f"{time_off_url(barber['id'])}?include_past=true", headers=admin_headers).json()) == 1


@pytest.mark.parametrize(
    ("starts", "ends", "message"),
    [
        ("12:00", "09:00", "after the start"),
        ("12:00", "12:00", "after the start"),
    ],
)
def test_invalid_time_off_is_rejected(starts, ends, message, admin_headers) -> None:
    barber = create_barber(admin_headers)
    day = future_business_day()

    response = client.post(
        time_off_url(barber["id"]), json={"starts_at": at(day, starts), "ends_at": at(day, ends)}, headers=admin_headers,
    )

    assert response.status_code == 422, response.text
    assert message in response.json()["detail"]


def test_time_off_longer_than_a_year_is_rejected(admin_headers) -> None:
    barber = create_barber(admin_headers)
    day = future_business_day()

    response = client.post(
        time_off_url(barber["id"]),
        json={"starts_at": at(day, "09:00"), "ends_at": at(day.replace(year=day.year + 2), "09:00")},
        headers=admin_headers,
    )

    assert response.status_code == 422, response.text


def test_cannot_delete_another_barbers_time_off(admin_headers) -> None:
    owner = create_barber(admin_headers)
    other = create_barber(admin_headers)
    day = future_business_day()
    created = client.post(
        time_off_url(owner["id"]), json={"starts_at": at(day, "09:00"), "ends_at": at(day, "12:00")}, headers=admin_headers,
    ).json()

    response = client.delete(f"{time_off_url(other['id'])}/{created['time_off']['id']}", headers=admin_headers)

    assert response.status_code == 404, response.text
    assert len(client.get(time_off_url(owner["id"]), headers=admin_headers).json()) == 1
