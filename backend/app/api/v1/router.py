from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import create_access_token, create_admin_user_record, get_admin_user_from_token, verify_password
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


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "Booking System API is running"}


@router.get("/barbers", response_model=list[BarberRead])
def list_barbers(db: Session = Depends(get_db)) -> list[Barber]:
    return db.scalars(select(Barber).order_by(Barber.created_at.desc())).all()


@router.post("/barbers", response_model=BarberRead)
def create_barber(barber: BarberCreate, db: Session = Depends(get_db)) -> Barber:
    db_barber = Barber(**barber.model_dump())
    db.add(db_barber)
    db.commit()
    db.refresh(db_barber)
    return db_barber


@router.get("/services", response_model=list[ServiceRead])
def list_services(db: Session = Depends(get_db)) -> list[Service]:
    return db.scalars(select(Service).order_by(Service.created_at.desc())).all()


@router.post("/services", response_model=ServiceRead)
def create_service(service: ServiceCreate, db: Session = Depends(get_db)) -> Service:
    db_service = Service(**service.model_dump())
    db.add(db_service)
    db.commit()
    db.refresh(db_service)
    return db_service


@router.get("/appointments", response_model=list[AppointmentRead])
def list_appointments(db: Session = Depends(get_db)) -> list[Appointment]:
    return db.scalars(select(Appointment).order_by(Appointment.starts_at.asc())).all()


@router.post("/appointments", response_model=AppointmentRead)
def create_appointment(appointment: AppointmentCreate, db: Session = Depends(get_db)) -> Appointment:
    if appointment.ends_at <= appointment.starts_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Appointment end time must be after the start time.",
        )

    service = db.get(Service, appointment.service_id)
    if service is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found.")

    barber = db.get(Barber, appointment.barber_id)
    if barber is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Barber not found.")

    overlap = db.execute(
        select(Appointment.id).where(
            Appointment.barber_id == appointment.barber_id,
            Appointment.status != "cancelled",
            Appointment.starts_at < appointment.ends_at,
            Appointment.ends_at > appointment.starts_at,
        )
    ).first()

    if overlap is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This barber already has an appointment overlapping the requested time.",
        )

    db_appointment = Appointment(**appointment.model_dump())
    db.add(db_appointment)
    db.commit()
    db.refresh(db_appointment)
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


@router.patch("/appointments/{appointment_id}/cancel", response_model=AppointmentRead)
def cancel_appointment(
    appointment_id: int,
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> Appointment:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")

    token = authorization.split(" ", 1)[1].strip()
    try:
        admin_user = get_admin_user_from_token(db, token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired admin token.") from exc

    if admin_user.username != settings.admin_username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized admin account.")

    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Appointment not found.")

    if appointment.status == "cancelled":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Appointment is already cancelled.")

    appointment.status = "cancelled"
    db.commit()
    db.refresh(appointment)
    return appointment
