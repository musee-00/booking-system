from __future__ import annotations

from datetime import datetime
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
    created_at: datetime


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
