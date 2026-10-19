from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


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


class AppointmentCreate(AppointmentBase):
    pass


class AppointmentRead(AppointmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    created_at: datetime
