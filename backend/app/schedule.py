"""Opening hours, barber working hours and time off.

The shop is open Tuesday-Saturday 09:00-18:00 (Stockholm time). Inside that,
each barber has their own weekly working blocks (BarberWorkingHours) and
one-off absences (BarberTimeOff). A time can be booked only if it lies inside
one of the barber's working blocks and doesn't overlap any time off.
"""

from __future__ import annotations

from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BarberTimeOff, BarberWorkingHours

STOCKHOLM_TZ = ZoneInfo("Europe/Stockholm")
SHOP_OPENS = time(9, 0)
SHOP_CLOSES = time(18, 0)
SHOP_OPEN_WEEKDAYS = {1, 2, 3, 4, 5}  # date.weekday(): Monday = 0, so Tue-Sat


def ensure_stockholm_datetime(value: datetime) -> datetime:
    """Naive datetimes from the client are Stockholm time; aware ones are converted."""
    if value.tzinfo is None:
        return value.replace(tzinfo=STOCKHOLM_TZ)
    return value.astimezone(STOCKHOLM_TZ)


def is_shop_open_day(day: date) -> bool:
    return day.weekday() in SHOP_OPEN_WEEKDAYS


def default_working_hours() -> list[BarberWorkingHours]:
    """New barbers work the shop's full opening hours until the admin changes it."""
    return [
        BarberWorkingHours(weekday=weekday, start_time=SHOP_OPENS, end_time=SHOP_CLOSES)
        for weekday in sorted(SHOP_OPEN_WEEKDAYS)
    ]


def get_working_blocks(db: Session, barber_id: int, day: date) -> list[tuple[datetime, datetime]]:
    """The barber's working blocks on `day` as Stockholm datetimes, earliest first.

    Empty if the shop is closed that day or the barber doesn't work that weekday.
    Blocks are clipped to the shop's opening hours.
    """
    if not is_shop_open_day(day):
        return []

    rows = db.scalars(
        select(BarberWorkingHours)
        .where(BarberWorkingHours.barber_id == barber_id, BarberWorkingHours.weekday == day.weekday())
        .order_by(BarberWorkingHours.start_time)
    ).all()

    blocks = []
    for row in rows:
        start = max(row.start_time, SHOP_OPENS)
        end = min(row.end_time, SHOP_CLOSES)
        if start < end:
            blocks.append(
                (datetime.combine(day, start, tzinfo=STOCKHOLM_TZ), datetime.combine(day, end, tzinfo=STOCKHOLM_TZ))
            )
    return blocks


def is_within_working_hours(db: Session, barber_id: int, starts_at: datetime, ends_at: datetime) -> bool:
    """True if [starts_at, ends_at) fits completely inside one working block.

    A booking may not span a break: 11:30-12:30 is rejected if the barber
    works 09:00-12:00 and 13:00-18:00.
    """
    blocks = get_working_blocks(db, barber_id, starts_at.astimezone(STOCKHOLM_TZ).date())
    return any(block_start <= starts_at and ends_at <= block_end for block_start, block_end in blocks)


def has_time_off(db: Session, barber_id: int, starts_at: datetime, ends_at: datetime) -> bool:
    """True if any time off overlaps [starts_at, ends_at) (same half-open rule as bookings)."""
    overlap = db.execute(
        select(BarberTimeOff.id).where(
            BarberTimeOff.barber_id == barber_id,
            BarberTimeOff.starts_at < ends_at,
            BarberTimeOff.ends_at > starts_at,
        )
    ).first()
    return overlap is not None


WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def validate_working_hours(blocks: list[tuple[int, time, time]]) -> list[str]:
    """Check a whole weekly schedule. Returns a list of problems (empty = valid).

    Rules: only on shop open days, inside shop hours, on :00 or :30 (slots are
    offered every 30 minutes), end after start, and no overlapping blocks.
    """
    problems = []
    for weekday, start, end in blocks:
        day = WEEKDAY_NAMES[weekday]
        if weekday not in SHOP_OPEN_WEEKDAYS:
            problems.append(f"The shop is closed on {day}s.")
        if end <= start:
            problems.append(f"{day}: the end time must be after the start time.")
        if start < SHOP_OPENS or end > SHOP_CLOSES:
            problems.append(f"{day}: hours must be within opening hours (09:00-18:00).")
        for value in (start, end):
            if value.minute not in (0, 30) or value.second or value.microsecond:
                problems.append(f"{day}: times must be on the hour or half hour ({value.strftime('%H:%M')}).")

    by_day: dict[int, list[tuple[time, time]]] = {}
    for weekday, start, end in blocks:
        by_day.setdefault(weekday, []).append((start, end))
    for weekday, day_blocks in by_day.items():
        day_blocks.sort()
        for (_, previous_end), (next_start, _) in zip(day_blocks, day_blocks[1:]):
            if next_start < previous_end:
                problems.append(f"{WEEKDAY_NAMES[weekday]}: working blocks overlap.")

    # Keep the order but drop duplicates (e.g. one closed day sent twice).
    return list(dict.fromkeys(problems))
