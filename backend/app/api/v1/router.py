import logging
from datetime import date as date_type, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.auth import create_access_token, create_admin_user_record, get_current_user, require_owner, verify_password
from app.core.config import settings
from app.mailer import EmailDeliveryError, OutgoingEmail, email_backend, send_email
from app.db.database import get_db
from app.models import ROLE_BARBER, AdminUser, Appointment, Barber, Service, barber_services
from app.schedule import (
    SHOP_CLOSES,
    SHOP_OPENS,
    STOCKHOLM_TZ,
    default_working_hours,
    ensure_stockholm_datetime,
    get_working_blocks,
    has_time_off,
    is_shop_open_day,
    is_within_working_hours,
)
from app.schemas import (
    AdminLoginRequest,
    AdminLoginResponse,
    AppointmentCreate,
    AppointmentRead,
    CurrentUserRead,
    BarberCreate,
    BarberRead,
    BarberUpdate,
    ServiceCreate,
    ServiceRead,
    ServiceUpdate,
)

router = APIRouter(prefix="/api/v1")
logger = logging.getLogger(__name__)
SLOT_STEP = timedelta(minutes=30)


def format_price_kr(value: str | int | float | Decimal) -> str:
    price = Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return f"{int(price)} kr"


def format_booking_time_range(starts_at: datetime, ends_at: datetime) -> str:
    stockholm_start = starts_at.astimezone(STOCKHOLM_TZ)
    stockholm_end = ends_at.astimezone(STOCKHOLM_TZ)
    return f"{stockholm_start.strftime('%H:%M')}–{stockholm_end.strftime('%H:%M')}"


def send_booking_confirmation_email(
    booking_id: int,
    customer_email: str,
    barber_name: str,
    service_name: str,
    starts_at: datetime,
    ends_at: datetime,
    price: str,
) -> None:
    # Email is optional: with no email backend configured, bookings work without it.
    if not customer_email or email_backend() == "none":
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
            f"Booking reference: #{booking_id}",
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
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb;"><strong>Address</strong></td>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb; text-align:right;">{settings.shop_address}</td>
                      </tr>
                      <tr>
                        <td style="padding:10px 0;"><strong>Booking reference</strong></td>
                        <td style="padding:10px 0; text-align:right;">#{booking_id}</td>
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

    email = OutgoingEmail(
        to=customer_email,
        subject=f"Booking confirmed — {service_name} (#{booking_id})",
        text=plain_text,
        html=html,
    )
    try:
        backend = send_email(email)
        logger.info("Sent booking confirmation #%s via %s", booking_id, backend)
    except EmailDeliveryError:
        # The booking is already saved; a failed email must not undo it.
        logger.exception("Failed to send booking confirmation #%s to %s", booking_id, customer_email)


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


def commit_or_conflict(db: Session, detail: str) -> None:
    """Commit, turning a unique-constraint violation (duplicate name/email) into 409."""
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc


def apply_update(record: Barber | Service, changes: BarberUpdate | ServiceUpdate) -> None:
    """PATCH semantics: only fields the client actually sent are changed."""
    for field, value in changes.model_dump(exclude_unset=True, exclude={"barber_ids"}).items():
        setattr(record, field, value)


def load_barbers(db: Session, barber_ids: list[int]) -> list[Barber]:
    """The barbers with these ids; 422 if any id doesn't exist."""
    barbers = db.scalars(select(Barber).where(Barber.id.in_(barber_ids))).all()
    missing = set(barber_ids) - {barber.id for barber in barbers}
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown barber id(s): {', '.join(map(str, sorted(missing)))}.",
        )
    return list(barbers)


def offers_service(db: Session, barber_id: int, service_id: int) -> bool:
    return db.execute(
        select(barber_services.c.barber_id).where(
            barber_services.c.barber_id == barber_id, barber_services.c.service_id == service_id,
        )
    ).first() is not None


def is_overlap_violation(exc: IntegrityError) -> bool:
    """True if the database rejected the row because of appointments_no_overlap."""
    diag = getattr(exc.orig, "diag", None)
    return getattr(diag, "constraint_name", None) == OVERLAP_CONSTRAINT


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "Booking System API is running"}


# Public lists only show active barbers/services: inactive ones are "soft deleted".
@router.get("/barbers", response_model=list[BarberRead])
def list_barbers(db: Session = Depends(get_db)) -> list[Barber]:
    return db.scalars(
        select(Barber).where(Barber.active.is_(True)).options(selectinload(Barber.services)).order_by(Barber.created_at.desc())
    ).all()


@router.post("/barbers", response_model=BarberRead, dependencies=[Depends(require_owner)])
def create_barber(barber: BarberCreate, db: Session = Depends(get_db)) -> Barber:
    db_barber = Barber(
        **barber.model_dump(),
        working_hours=default_working_hours(),
        services=list(db.scalars(select(Service)).all()),  # offers everything until the owner says otherwise
    )
    db.add(db_barber)
    commit_or_conflict(db, "A barber with this email already exists.")
    db.refresh(db_barber)
    return db_barber


@router.patch("/barbers/{barber_id}", response_model=BarberRead, dependencies=[Depends(require_owner)])
def update_barber(barber_id: int, changes: BarberUpdate, db: Session = Depends(get_db)) -> Barber:
    barber = db.get(Barber, barber_id)
    if barber is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Barber not found.")

    apply_update(barber, changes)
    commit_or_conflict(db, "A barber with this email already exists.")
    db.refresh(barber)
    return barber


@router.get("/services", response_model=list[ServiceRead])
def list_services(db: Session = Depends(get_db)) -> list[Service]:
    return db.scalars(
        select(Service).where(Service.active.is_(True)).options(selectinload(Service.barbers)).order_by(Service.created_at.desc())
    ).all()


@router.post("/services", response_model=ServiceRead, dependencies=[Depends(require_owner)])
def create_service(service: ServiceCreate, db: Session = Depends(get_db)) -> Service:
    if service.barber_ids is None:
        offered_by = list(db.scalars(select(Barber).where(Barber.active.is_(True))).all())
    else:
        offered_by = load_barbers(db, service.barber_ids)
    db_service = Service(**service.model_dump(exclude={"barber_ids"}), barbers=offered_by)
    db.add(db_service)
    commit_or_conflict(db, "A service with this name already exists.")
    db.refresh(db_service)
    return db_service


@router.patch("/services/{service_id}", response_model=ServiceRead, dependencies=[Depends(require_owner)])
def update_service(service_id: int, changes: ServiceUpdate, db: Session = Depends(get_db)) -> Service:
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found.")

    apply_update(service, changes)
    if "barber_ids" in changes.model_fields_set:
        service.barbers = load_barbers(db, changes.barber_ids)
    commit_or_conflict(db, "A service with this name already exists.")
    db.refresh(service)
    return service


# Admin lists include inactive barbers/services, so they can be managed and
# old appointments can still show the right name.
@router.get("/admin/barbers", response_model=list[BarberRead], dependencies=[Depends(get_current_user)])
def list_all_barbers(db: Session = Depends(get_db)) -> list[Barber]:
    return db.scalars(select(Barber).options(selectinload(Barber.services)).order_by(Barber.created_at.desc())).all()


@router.get("/admin/services", response_model=list[ServiceRead], dependencies=[Depends(get_current_user)])
def list_all_services(db: Session = Depends(get_db)) -> list[Service]:
    return db.scalars(select(Service).options(selectinload(Service.barbers)).order_by(Service.created_at.desc())).all()


@router.get("/appointments", response_model=list[AppointmentRead])
def list_appointments(
    user: AdminUser = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[Appointment]:
    """The owner sees every booking; a barber only their own (Setmore's "Standard" level)."""
    query = select(Appointment).order_by(Appointment.starts_at.asc())
    if user.role == ROLE_BARBER:
        query = query.where(Appointment.barber_id == user.barber_id)
    return db.scalars(query).all()


@router.get("/availability")
def list_availability(
    barber_id: int = Query(...),
    service_id: int = Query(...),
    date: date_type = Query(...),
    db: Session = Depends(get_db),
) -> list[dict[str, str | int]]:
    service = db.get(Service, service_id)
    if service is None or not service.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found.")

    barber = db.get(Barber, barber_id)
    if barber is None or not barber.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Barber not found.")

    if not offers_service(db, barber_id, service_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{barber.name} doesn't offer this service.")

    slot_duration = timedelta(minutes=service.duration_minutes)
    now_stockholm = datetime.now(STOCKHOLM_TZ)
    slots: list[dict[str, str | int]] = []

    # Candidate start times every 30 minutes inside each working block. A slot
    # must end before the block ends, so it never runs into a break.
    for block_start, block_end in get_working_blocks(db, barber_id, date):
        candidate_start = block_start
        while candidate_start + slot_duration <= block_end:
            candidate_end = candidate_start + slot_duration
            is_free = (
                candidate_start >= now_stockholm
                and not has_overlapping_appointment(db, barber_id, candidate_start, candidate_end)
                and not has_time_off(db, barber_id, candidate_start, candidate_end)
            )
            if is_free:
                slots.append(
                    {
                        "barber_id": barber.id,
                        "barber_name": barber.name,
                        "start": candidate_start.isoformat(),
                        "end": candidate_end.isoformat(),
                    }
                )
            candidate_start += SLOT_STEP

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

    if not is_shop_open_day(starts_at.date()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Appointments are only available on Tuesday to Saturday.",
        )

    if starts_at.time() < SHOP_OPENS or ends_at > datetime.combine(starts_at.date(), SHOP_CLOSES, tzinfo=STOCKHOLM_TZ):
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

    if not service.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This service is no longer available.")
    if not barber.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This barber is no longer taking bookings.")
    if not offers_service(db, barber.id, service.id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{barber.name} doesn't offer {service.name}.")

    # The barber's own schedule: inside one working block, not during time off.
    if not is_within_working_hours(db, barber.id, starts_at, ends_at):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{barber.name} isn't working at the requested time.",
        )
    if has_time_off(db, barber.id, starts_at, ends_at):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{barber.name} is away at the requested time.",
        )

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
        booking_id=db_appointment.id,
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

    if admin_user.role == ROLE_BARBER and (admin_user.barber is None or not admin_user.barber.active):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="This account is disabled.")

    token = create_access_token(admin_user.username)
    return AdminLoginResponse(token=token, role=admin_user.role, barber_id=admin_user.barber_id)


@router.get("/auth/me", response_model=CurrentUserRead)
def read_current_user(user: AdminUser = Depends(get_current_user)) -> AdminUser:
    return user


@router.patch("/appointments/{appointment_id}/cancel", response_model=AppointmentRead)
def cancel_appointment(
    appointment_id: int, user: AdminUser = Depends(get_current_user), db: Session = Depends(get_db)
) -> Appointment:
    appointment = db.get(Appointment, appointment_id)
    # A barber asking for someone else's booking gets the same 404 as for a
    # booking that doesn't exist, so they can't even learn that it exists.
    if appointment is None or (user.role == ROLE_BARBER and appointment.barber_id != user.barber_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Appointment not found.")

    if appointment.status == "cancelled":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Appointment is already cancelled.")

    appointment.status = "cancelled"
    db.commit()
    db.refresh(appointment)
    return appointment
