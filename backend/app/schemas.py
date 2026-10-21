from __future__ import annotations

from datetime import datetime, time
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints


class ServiceBase(BaseModel):
    name: str
    duration_minutes: int = Field(..., gt=0)
    price: Decimal
    description: str | None = None


class ServiceCreate(ServiceBase):
    pass


class ServiceRead(ServiceBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    active: bool
    created_at: datetime


# PATCH schemas: every field is optional, and only the fields actually sent are
# changed (the endpoint uses model_dump(exclude_unset=True)). Required columns are
# typed without `| None`, so sending e.g. {"name": null} is rejected with 422.
# (Pydantic doesn't validate defaults, so leaving a field out is still allowed.)
class ServiceUpdate(BaseModel):
    name: str = Field(default=None, min_length=1, max_length=150)
    duration_minutes: int = Field(default=None, gt=0)
    price: Decimal = Field(default=None, ge=0)
    description: str | None = None
    active: bool = None


class BarberBase(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    role: str | None = None
    bio: str | None = None
    photo_url: str | None = None
    color: str | None = None


class BarberCreate(BarberBase):
    pass


class BarberRead(BarberBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    active: bool
    created_at: datetime


class BarberUpdate(BaseModel):
    name: str = Field(default=None, min_length=1, max_length=150)
    email: str | None = None
    phone: str | None = None
    role: str | None = None
    bio: str | None = None
    photo_url: str | None = None
    color: str | None = None
    active: bool = None


class AppointmentBase(BaseModel):
    barber_id: int
    service_id: int
    customer_name: str
    customer_phone: str
    customer_email: str | None = None
    starts_at: datetime
    ends_at: datetime
    notes: str | None = None


# Strict validation only on input. Max lengths match the database columns, so
# too-long values get a clear 422 instead of a database error (500).
CustomerName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]
# Digits plus the usual separators, e.g. "+46 70-123 45 67" or "(070) 123 45 67".
CustomerPhone = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=6, max_length=30, pattern=r"^\+?[0-9(][0-9 ()-]*[0-9]$"),
]


class AppointmentCreate(AppointmentBase):
    customer_name: CustomerName
    customer_phone: CustomerPhone
    customer_email: EmailStr
    notes: str | None = Field(default=None, max_length=1000)


class AppointmentRead(AppointmentBase):
    """Response model: plain strings, so older rows never fail to serialise."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    created_at: datetime


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminLoginResponse(BaseModel):
    token: str


class WorkingHoursBlock(BaseModel):
    """One weekly working block. weekday uses Python's convention: 0 = Monday ... 6 = Sunday."""

    model_config = ConfigDict(from_attributes=True)

    weekday: int = Field(..., ge=0, le=6)
    start_time: time
    end_time: time


class TimeOffCreate(BaseModel):
    starts_at: datetime
    ends_at: datetime
    reason: str | None = Field(default=None, max_length=200)


class TimeOffRead(TimeOffCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    barber_id: int
    created_at: datetime


class ConflictingAppointment(BaseModel):
    """An existing booking that falls inside newly added time off."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_name: str
    customer_phone: str
    starts_at: datetime
    ends_at: datetime


class TimeOffCreated(BaseModel):
    time_off: TimeOffRead
    # Time off doesn't cancel bookings automatically; the admin decides what to do.
    conflicting_appointments: list[ConflictingAppointment]
