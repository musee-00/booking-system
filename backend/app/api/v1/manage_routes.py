"""Customer self-service through the secret link in the confirmation email.

No login: the long random token in the URL is the key. The database only has
its SHA-256 hash, so we look the booking up by hashing what the customer sent.
A wrong token, or a booking made before links existed, gets 404.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.booking_emails import send_booking_cancelled_email
from app.booking_tokens import hash_manage_token
from app.core.config import settings
from app.db.database import get_db
from app.models import Appointment
from app.schedule import STOCKHOLM_TZ
from app.schemas import ManagedBookingRead

router = APIRouter(prefix="/api/v1/manage", tags=["customer self-service"])

NOT_FOUND = "This booking link is not valid."


def get_booking_by_token(db: Session, token: str) -> Appointment:
    appointment = db.scalars(
        select(Appointment).where(Appointment.manage_token_hash == hash_manage_token(token))
    ).first()
    if appointment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return appointment


def cancel_deadline(appointment: Appointment) -> datetime:
    return appointment.starts_at - timedelta(hours=settings.customer_cancel_cutoff_hours)


def why_not_cancellable(appointment: Appointment) -> str | None:
    """None if the customer may cancel now, otherwise the reason."""
    if appointment.status == "cancelled":
        return "This booking is already cancelled."
    if datetime.now(STOCKHOLM_TZ) >= cancel_deadline(appointment):
        return (
            f"Bookings can be cancelled online until {settings.customer_cancel_cutoff_hours} hours before. "
            "Please contact us directly."
        )
    return None


def to_read(appointment: Appointment) -> ManagedBookingRead:
    reason = why_not_cancellable(appointment)
    return ManagedBookingRead(
        id=appointment.id,
        customer_name=appointment.customer_name,
        service_name=appointment.service.name,
        barber_name=appointment.barber.name,
        price=appointment.service.price,
        starts_at=appointment.starts_at,
        ends_at=appointment.ends_at,
        status=appointment.status,
        can_cancel=reason is None,
        cancel_blocked_reason=reason,
        cancel_deadline=cancel_deadline(appointment),
    )


@router.get("/{token}", response_model=ManagedBookingRead)
def read_booking(token: str, db: Session = Depends(get_db)) -> ManagedBookingRead:
    return to_read(get_booking_by_token(db, token))


@router.post("/{token}/cancel", response_model=ManagedBookingRead)
def cancel_booking(token: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)) -> ManagedBookingRead:
    appointment = get_booking_by_token(db, token)
    reason = why_not_cancellable(appointment)
    if reason:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=reason)

    # Cancelled bookings are excluded from the overlap checks and the database
    # constraint, so the time is bookable again immediately.
    appointment.status = "cancelled"
    db.commit()
    db.refresh(appointment)

    background_tasks.add_task(
        send_booking_cancelled_email,
        booking_id=appointment.id,
        customer_email=appointment.customer_email,
        barber_name=appointment.barber.name,
        service_name=appointment.service.name,
        starts_at=appointment.starts_at,
        ends_at=appointment.ends_at,
    )
    return to_read(appointment)
