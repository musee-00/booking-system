"""Barber working hours and time off: availability and booking follow each barber's schedule."""

from datetime import time

from sqlalchemy import delete, select

from app.db.database import SessionLocal
from app.models import BarberTimeOff, BarberWorkingHours
from tests.test_booking_api import (  # noqa: F401  (admin_headers and mock_email_sending are fixtures)
    admin_headers,
    at,
    availability,
    book,
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
