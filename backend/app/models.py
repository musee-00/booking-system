from __future__ import annotations

from datetime import datetime, time
from decimal import Decimal

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, Numeric, String, Table, Text, Time, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


ROLE_OWNER = "owner"
ROLE_BARBER = "barber"


class AdminUser(Base):
    """A staff login. Like Setmore's access levels:

    - owner:  everything (services, hours, accounts, all bookings)  ~ Setmore "Admin"
    - barber: only their own calendar (their own bookings)           ~ Setmore "Standard"
    """

    __tablename__ = "admin_users"
    __table_args__ = (
        CheckConstraint("role IN ('owner', 'barber')", name="ck_admin_users_role"),
        # A barber account must belong to a barber; an owner account must not.
        CheckConstraint("(role = 'barber') = (barber_id IS NOT NULL)", name="ck_admin_users_barber_link"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default=ROLE_OWNER, server_default=ROLE_OWNER, nullable=False)
    # unique: at most one login per barber.
    barber_id: Mapped[int | None] = mapped_column(
        ForeignKey("barbers.id", ondelete="CASCADE"), unique=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    barber: Mapped["Barber | None"] = relationship()


# Which barber offers which service (many-to-many). Like Setmore: the shop has
# one service menu, and each service is assigned to the barbers who provide it.
barber_services = Table(
    "barber_services",
    Base.metadata,
    Column("barber_id", ForeignKey("barbers.id", ondelete="CASCADE"), primary_key=True),
    Column("service_id", ForeignKey("services.id", ondelete="CASCADE"), primary_key=True),
)


class Barber(Base):
    __tablename__ = "barbers"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(30))
    role: Mapped[str | None] = mapped_column(String(80), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True, default="#d9b57f")
    active: Mapped[bool] = mapped_column(default=True, server_default=text("true"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    appointments: Mapped[list["Appointment"]] = relationship(back_populates="barber")
    services: Mapped[list["Service"]] = relationship(secondary=barber_services, back_populates="barbers")
    working_hours: Mapped[list["BarberWorkingHours"]] = relationship(
        back_populates="barber", cascade="all, delete-orphan", order_by="(BarberWorkingHours.weekday, BarberWorkingHours.start_time)"
    )
    time_off: Mapped[list["BarberTimeOff"]] = relationship(
        back_populates="barber", cascade="all, delete-orphan", order_by="BarberTimeOff.starts_at"
    )

    @property
    def service_ids(self) -> list[int]:
        return sorted(service.id for service in self.services)


class BarberWorkingHours(Base):
    """One block of working time on a weekday, e.g. Tuesday 09:00-12:00.

    A lunch break is two blocks on the same day (09:00-12:00 and 13:00-18:00).
    A weekday with no rows is a day off every week.
    """

    __tablename__ = "barber_working_hours"
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_working_hours_weekday"),
        CheckConstraint("end_time > start_time", name="ck_working_hours_time_order"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    barber_id: Mapped[int] = mapped_column(ForeignKey("barbers.id", ondelete="CASCADE"), nullable=False, index=True)
    # Python's convention: 0 = Monday ... 6 = Sunday (date.weekday()).
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)

    barber: Mapped[Barber] = relationship(back_populates="working_hours")


class BarberTimeOff(Base):
    """A one-off absence: holiday, sick day, a long lunch on one date..."""

    __tablename__ = "barber_time_off"
    __table_args__ = (CheckConstraint("ends_at > starts_at", name="ck_time_off_time_order"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    barber_id: Mapped[int] = mapped_column(ForeignKey("barbers.id", ondelete="CASCADE"), nullable=False, index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    barber: Mapped[Barber] = relationship(back_populates="time_off")


class Service(Base):
    __tablename__ = "services"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    appointments: Mapped[list["Appointment"]] = relationship(back_populates="service")
    barbers: Mapped[list[Barber]] = relationship(secondary=barber_services, back_populates="services")

    @property
    def barber_ids(self) -> list[int]:
        return sorted(barber.id for barber in self.barbers)


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="ck_appointments_time_order"),
        CheckConstraint("status IN ('pending', 'confirmed', 'cancelled')", name="ck_appointments_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    barber_id: Mapped[int] = mapped_column(ForeignKey("barbers.id"), nullable=False, index=True)
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id"), nullable=False, index=True)
    customer_name: Mapped[str] = mapped_column(String(150), nullable=False)
    customer_phone: Mapped[str] = mapped_column(String(30), nullable=False)
    customer_email: Mapped[str | None] = mapped_column(String(255))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    barber: Mapped[Barber] = relationship(back_populates="appointments")
    service: Mapped[Service] = relationship(back_populates="appointments")
