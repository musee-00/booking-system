"""Admin endpoints for barbers' weekly working hours and time off."""

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_owner
from app.db.database import get_db
from app.models import ROLE_BARBER, AdminUser, Appointment, Barber, BarberTimeOff, BarberWorkingHours
from app.schedule import STOCKHOLM_TZ, ensure_stockholm_datetime, is_within_working_hours, validate_working_hours
from app.schemas import (
    BarberScheduleRead,
    TimeOffCreate,
    TimeOffCreated,
    TimeOffRead,
    WorkingHoursBlock,
    WorkingHoursSaved,
)

# Every route here needs a staff login (set once on the router, so nothing can
# accidentally be public). Changing schedules additionally needs the owner
# role (OWNER_ONLY on each route); a barber can only read their own schedule.
router = APIRouter(prefix="/api/v1/barbers", tags=["schedules"], dependencies=[Depends(get_current_user)])
OWNER_ONLY = [Depends(require_owner)]

MAX_TIME_OFF = timedelta(days=366)
MAX_SCHEDULE_RANGE = timedelta(days=62)


def get_barber_or_404(db: Session, barber_id: int) -> Barber:
    barber = db.get(Barber, barber_id)
    if barber is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Barber not found.")
    return barber


@router.get("/schedules", response_model=list[BarberScheduleRead])
def list_schedules(
    start: date = Query(..., description="First day, e.g. 2026-10-19"),
    end: date = Query(..., description="Last day (inclusive)"),
    user: AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[BarberScheduleRead]:
    """Every barber's weekly hours and their time off between start and end.

    One request for the admin calendar instead of two per barber.
    """
    if end < start:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="end must not be before start.")
    if end - start > MAX_SCHEDULE_RANGE:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The range can be at most 62 days.")

    range_start = datetime.combine(start, time(0), tzinfo=STOCKHOLM_TZ)
    range_end = datetime.combine(end + timedelta(days=1), time(0), tzinfo=STOCKHOLM_TZ)

    barber_query = select(Barber).order_by(Barber.id)
    if user.role == ROLE_BARBER:
        barber_query = barber_query.where(Barber.id == user.barber_id)  # only their own schedule
    barbers = db.scalars(barber_query).all()
    time_off = db.scalars(
        select(BarberTimeOff)
        .where(BarberTimeOff.starts_at < range_end, BarberTimeOff.ends_at > range_start)
        .order_by(BarberTimeOff.starts_at)
    ).all()

    return [
        BarberScheduleRead(
            barber_id=barber.id,
            working_hours=barber.working_hours,
            time_off=[item for item in time_off if item.barber_id == barber.id],
        )
        for barber in barbers
    ]


@router.get("/{barber_id}/working-hours", response_model=list[WorkingHoursBlock], dependencies=OWNER_ONLY)
def get_working_hours(barber_id: int, db: Session = Depends(get_db)) -> list[BarberWorkingHours]:
    return get_barber_or_404(db, barber_id).working_hours


@router.put("/{barber_id}/working-hours", response_model=WorkingHoursSaved, dependencies=OWNER_ONLY)
def replace_working_hours(
    barber_id: int, blocks: list[WorkingHoursBlock], db: Session = Depends(get_db)
) -> WorkingHoursSaved:
    """Replace the whole weekly schedule. An empty list means the barber doesn't work any day.

    Existing bookings are kept even if they now fall outside the new hours;
    they're returned as conflicting_appointments so the admin can act on them.
    """
    barber = get_barber_or_404(db, barber_id)

    problems = validate_working_hours([(b.weekday, b.start_time, b.end_time) for b in blocks])
    if problems:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=" ".join(problems))

    # Delete and insert in one transaction: either the whole new schedule is
    # saved, or (on any error) the old one stays untouched.
    db.execute(delete(BarberWorkingHours).where(BarberWorkingHours.barber_id == barber.id))
    db.add_all(
        BarberWorkingHours(barber_id=barber.id, weekday=b.weekday, start_time=b.start_time, end_time=b.end_time)
        for b in blocks
    )
    db.commit()
    db.refresh(barber)

    upcoming = db.scalars(
        select(Appointment)
        .where(
            Appointment.barber_id == barber.id,
            Appointment.status != "cancelled",
            Appointment.starts_at >= datetime.now(STOCKHOLM_TZ),
        )
        .order_by(Appointment.starts_at)
    ).all()
    outside_new_hours = [
        appointment for appointment in upcoming
        if not is_within_working_hours(db, barber.id, appointment.starts_at, appointment.ends_at)
    ]

    return WorkingHoursSaved(working_hours=barber.working_hours, conflicting_appointments=outside_new_hours)


@router.get("/{barber_id}/time-off", response_model=list[TimeOffRead], dependencies=OWNER_ONLY)
def list_time_off(
    barber_id: int,
    include_past: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[BarberTimeOff]:
    """Upcoming and ongoing time off (or all of it with include_past=true), earliest first."""
    get_barber_or_404(db, barber_id)
    query = select(BarberTimeOff).where(BarberTimeOff.barber_id == barber_id)
    if not include_past:
        query = query.where(BarberTimeOff.ends_at > datetime.now(STOCKHOLM_TZ))
    return db.scalars(query.order_by(BarberTimeOff.starts_at)).all()


@router.post(
    "/{barber_id}/time-off", response_model=TimeOffCreated, status_code=status.HTTP_201_CREATED, dependencies=OWNER_ONLY
)
def create_time_off(barber_id: int, payload: TimeOffCreate, db: Session = Depends(get_db)) -> TimeOffCreated:
    barber = get_barber_or_404(db, barber_id)
    starts_at = ensure_stockholm_datetime(payload.starts_at)
    ends_at = ensure_stockholm_datetime(payload.ends_at)

    if ends_at <= starts_at:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The end must be after the start.")
    if ends_at - starts_at > MAX_TIME_OFF:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Time off can be at most one year.")

    time_off = BarberTimeOff(barber_id=barber.id, starts_at=starts_at, ends_at=ends_at, reason=payload.reason)
    db.add(time_off)
    db.commit()
    db.refresh(time_off)

    # Bookings already made for this period are not cancelled automatically:
    # the admin sees them and decides (call the customer, move, or cancel).
    conflicts = db.scalars(
        select(Appointment)
        .where(
            Appointment.barber_id == barber.id,
            Appointment.status != "cancelled",
            Appointment.starts_at < ends_at,
            Appointment.ends_at > starts_at,
        )
        .order_by(Appointment.starts_at)
    ).all()

    return TimeOffCreated(
        time_off=TimeOffRead.model_validate(time_off),
        conflicting_appointments=conflicts,
    )


@router.delete("/{barber_id}/time-off/{time_off_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=OWNER_ONLY)
def delete_time_off(barber_id: int, time_off_id: int, db: Session = Depends(get_db)) -> Response:
    time_off = db.get(BarberTimeOff, time_off_id)
    # Also 404 if it belongs to another barber, so ids can't be mixed up.
    if time_off is None or time_off.barber_id != barber_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Time off not found.")

    db.delete(time_off)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
