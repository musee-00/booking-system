import logging
import smtplib
from datetime import date as date_type, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from email.message import EmailMessage
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import create_access_token, create_admin_user_record, require_admin, verify_password
from app.core.config import settings
from app.db.database import get_db
from app.models import AdminUser, Appointment, Barber, Service
from app.schemas import (
    AdminLoginRequest,
    AdminLoginResponse,
    AppointmentCreate,
    AppointmentRead,
    BarberCreate,
    BarberRead,
    ServiceCreate,
    ServiceRead,
)

router = APIRouter(prefix="/api/v1")
logger = logging.getLogger(__name__)
STOCKHOLM_TZ = ZoneInfo("Europe/Stockholm")
DAY_START_HOUR = 9
DAY_END_HOUR = 18


def format_price_kr(value: str | int | float | Decimal) -> str:
    price = Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return f"{int(price)} kr"


def format_booking_time_range(starts_at: datetime, ends_at: datetime) -> str:
    stockholm_start = starts_at.astimezone(STOCKHOLM_TZ)
    stockholm_end = ends_at.astimezone(STOCKHOLM_TZ)
    return f"{stockholm_start.strftime('%H:%M')}–{stockholm_end.strftime('%H:%M')}"


def send_booking_confirmation_email(
    customer_email: str,
    barber_name: str,
    service_name: str,
    starts_at: datetime,
    ends_at: datetime,
    price: str,
) -> None:
    if not customer_email:
        return

    starts_at_stockholm = starts_at.astimezone(STOCKHOLM_TZ)
    ends_at_stockholm = ends_at.astimezone(STOCKHOLM_TZ)
    date_label = starts_at_stockholm.strftime("%A %d %B %Y")
    time_range = format_booking_time_range(starts_at, ends_at)
    formatted_price = format_price_kr(price)

    plain_text = "\n".join(
        [
            f"Hi there,",
            "",
            f"Your booking at {settings.shop_name} has been confirmed.",
            "",
            f"Service: {service_name}",
            f"Barber: {barber_name}",
            f"Date: {date_label}",
            f"Time: {time_range}",
            f"Price: {formatted_price}",
            f"Address: {settings.shop_address}",
            "",
            "We look forward to seeing you.",
            settings.shop_name,
        ]
    )

    html = f"""
    <html>
      <body style="margin:0; padding:0; background-color:#f5f1eb; font-family:Arial, sans-serif; color:#1f2937;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f1eb; padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; background-color:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e5e7eb;">
                <tr>
                  <td style="background-color:#1f2937; padding:24px 32px; color:#ffffff;">
                    <div style="font-size:28px; font-weight:bold; letter-spacing:0.04em;">{settings.shop_name}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px;">
                    <p style="margin:0 0 16px; font-size:16px;">Hi there,</p>
                    <p style="margin:0 0 24px; font-size:16px; line-height:1.6;">Your booking has been confirmed. We’re looking forward to welcoming you.</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin:0 0 24px;">
                      <tr>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb;"><strong>Service</strong></td>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb; text-align:right;">{service_name}</td>
                      </tr>
                      <tr>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb;"><strong>Barber</strong></td>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb; text-align:right;">{barber_name}</td>
                      </tr>
                      <tr>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb;"><strong>Date</strong></td>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb; text-align:right;">{date_label}</td>
                      </tr>
                      <tr>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb;"><strong>Time</strong></td>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb; text-align:right;">{time_range}</td>
                      </tr>
                      <tr>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb;"><strong>Price</strong></td>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb; text-align:right;">{formatted_price}</td>
                      </tr>
                      <tr>
                        <td style="padding:10px 0;"><strong>Address</strong></td>
                        <td style="padding:10px 0; text-align:right;">{settings.shop_address}</td>
                      </tr>
                    </table>
                    <p style="margin:0; font-size:14px; color:#4b5563;">If you need to change your booking, please contact us directly.</p>
                  </td>
                </tr>
                <tr>
                  <td style="background-color:#faf7f4; padding:20px 32px; color:#374151; font-size:14px; border-top:1px solid #e5e7eb;">
                    {settings.shop_name} • {settings.shop_address}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
    """

    message = EmailMessage()
    message["Subject"] = f"Booking confirmed — {service_name}"
    message["From"] = settings.smtp_from_email
    message["To"] = customer_email
    message.set_content(plain_text)
    message.add_alternative(html, subtype="html")

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
                if settings.smtp_username and settings.smtp_password:
                    smtp.login(settings.smtp_username, settings.smtp_password)
            elif settings.smtp_username and settings.smtp_password:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    except Exception:
        logger.exception("Failed to send booking confirmation email to %s", customer_email)


def ensure_stockholm_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=STOCKHOLM_TZ)
    return value.astimezone(STOCKHOLM_TZ)


def is_business_day(value: date_type) -> bool:
    return value.weekday() in {1, 2, 3, 4, 5}


OVERLAP_CONSTRAINT = "appointments_no_overlap"
OVERLAP_DETAIL = "This barber already has an appointment overlapping the requested time."


def has_overlapping_appointment(db: Session, barber_id: int, starts_at: datetime, ends_at: datetime) -> bool:
    """True if the barber has an active booking overlapping [starts_at, ends_at).

    Strict < and > so back-to-back bookings (10:00-10:30, 10:30-11:00) are
    allowed. Same rule as the '[)' range in the appointments_no_overlap constraint.
    """
    overlap = db.execute(
        select(Appointment.id).where(
            Appointment.barber_id == barber_id,
            Appointment.status != "cancelled",
            Appointment.starts_at < ends_at,
            Appointment.ends_at > starts_at,
        )
    ).first()
    return overlap is not None


def is_overlap_violation(exc: IntegrityError) -> bool:
    """True if the database rejected the row because of appointments_no_overlap."""
    diag = getattr(exc.orig, "diag", None)
    return getattr(diag, "constraint_name", None) == OVERLAP_CONSTRAINT


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "Booking System API is running"}


@router.get("/barbers", response_model=list[BarberRead])
def list_barbers(db: Session = Depends(get_db)) -> list[Barber]:
    return db.scalars(select(Barber).order_by(Barber.created_at.desc())).all()


@router.post("/barbers", response_model=BarberRead, dependencies=[Depends(require_admin)])
def create_barber(barber: BarberCreate, db: Session = Depends(get_db)) -> Barber:
    db_barber = Barber(**barber.model_dump())
    db.add(db_barber)
    db.commit()
    db.refresh(db_barber)
    return db_barber


@router.get("/services", response_model=list[ServiceRead])
def list_services(db: Session = Depends(get_db)) -> list[Service]:
    return db.scalars(select(Service).order_by(Service.created_at.desc())).all()


@router.post("/services", response_model=ServiceRead, dependencies=[Depends(require_admin)])
def create_service(service: ServiceCreate, db: Session = Depends(get_db)) -> Service:
    db_service = Service(**service.model_dump())
    db.add(db_service)
    db.commit()
    db.refresh(db_service)
    return db_service


@router.get("/appointments", response_model=list[AppointmentRead], dependencies=[Depends(require_admin)])
def list_appointments(db: Session = Depends(get_db)) -> list[Appointment]:
    return db.scalars(select(Appointment).order_by(Appointment.starts_at.asc())).all()


@router.get("/availability")
def list_availability(
    barber_id: int = Query(...),
    service_id: int = Query(...),
    date: date_type = Query(...),
    db: Session = Depends(get_db),
) -> list[dict[str, str | int]]:
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found.")

    barber = db.get(Barber, barber_id)
    if barber is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Barber not found.")

    if not is_business_day(date):
        return []

    slot_duration = timedelta(minutes=service.duration_minutes)
    day_start = datetime.combine(date, time(DAY_START_HOUR, 0), tzinfo=STOCKHOLM_TZ)
    day_end = datetime.combine(date, time(DAY_END_HOUR, 0), tzinfo=STOCKHOLM_TZ)
    now_stockholm = datetime.now(STOCKHOLM_TZ)

    slots: list[dict[str, str | int]] = []
    candidate_start = day_start

    while candidate_start + slot_duration <= day_end:
        candidate_end = candidate_start + slot_duration

        if candidate_start < now_stockholm:
            candidate_start += timedelta(minutes=30)
            continue

        if not has_overlapping_appointment(db, barber_id, candidate_start, candidate_end):
            slots.append(
                {
                    "barber_id": barber.id,
                    "barber_name": barber.name,
                    "start": candidate_start.isoformat(),
                    "end": candidate_end.isoformat(),
                }
            )

        candidate_start += timedelta(minutes=30)

    return slots


@router.post("/appointments", response_model=AppointmentRead)
def create_appointment(
    appointment: AppointmentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> Appointment:
    if appointment.ends_at <= appointment.starts_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Appointment end time must be after the start time.",
        )

    starts_at = ensure_stockholm_datetime(appointment.starts_at)
    ends_at = ensure_stockholm_datetime(appointment.ends_at)
    now_stockholm = datetime.now(STOCKHOLM_TZ)

    if starts_at < now_stockholm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Appointments cannot be scheduled in the past.",
        )

    if not is_business_day(starts_at.date()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Appointments are only available on Tuesday to Saturday.",
        )

    day_start = datetime.combine(starts_at.date(), time(DAY_START_HOUR, 0), tzinfo=STOCKHOLM_TZ)
    day_end = datetime.combine(starts_at.date(), time(DAY_END_HOUR, 0), tzinfo=STOCKHOLM_TZ)
    if starts_at < day_start or ends_at > day_end:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Appointments must be scheduled within business hours (09:00-18:00).",
        )

    service = db.get(Service, appointment.service_id)
    if service is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found.")

    barber = db.get(Barber, appointment.barber_id)
    if barber is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Barber not found.")

    # Layer 1: check first, so the normal case gets a clear 409 message.
    if has_overlapping_appointment(db, appointment.barber_id, starts_at, ends_at):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=OVERLAP_DETAIL)

    db_appointment = Appointment(
        barber_id=appointment.barber_id,
        service_id=appointment.service_id,
        customer_name=appointment.customer_name,
        customer_phone=appointment.customer_phone,
        customer_email=appointment.customer_email,
        starts_at=starts_at,
        ends_at=ends_at,
        status="pending",
        notes=appointment.notes,
    )
    db.add(db_appointment)
    # Layer 2: two requests can both pass the check above before either is saved
    # (a race condition). The exclusion constraint then rejects the second
    # INSERT; turn that into the same 409 instead of a 500.
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if is_overlap_violation(exc):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=OVERLAP_DETAIL) from exc
        raise
    db.refresh(db_appointment)

    background_tasks.add_task(
        send_booking_confirmation_email,
        customer_email=db_appointment.customer_email,
        barber_name=barber.name,
        service_name=service.name,
        starts_at=db_appointment.starts_at,
        ends_at=db_appointment.ends_at,
        price=service.price,
    )
    return db_appointment


@router.post("/admin/login", response_model=AdminLoginResponse)
def admin_login(payload: AdminLoginRequest, db: Session = Depends(get_db)) -> AdminLoginResponse:
    admin_user = db.query(AdminUser).filter(AdminUser.username == payload.username).first()
    if admin_user is None:
        create_admin_user_record(db, settings.admin_username, settings.admin_password)
        admin_user = db.query(AdminUser).filter(AdminUser.username == payload.username).first()

    if admin_user is None or not verify_password(payload.password, admin_user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin credentials.")

    token = create_access_token(admin_user.username)
    return AdminLoginResponse(token=token)


@router.patch(
    "/appointments/{appointment_id}/cancel",
    response_model=AppointmentRead,
    dependencies=[Depends(require_admin)],
)
def cancel_appointment(appointment_id: int, db: Session = Depends(get_db)) -> Appointment:
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Appointment not found.")

    if appointment.status == "cancelled":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Appointment is already cancelled.")

    appointment.status = "cancelled"
    db.commit()
    db.refresh(appointment)
    return appointment
