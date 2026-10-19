#!/usr/bin/env python3

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alembic import command
from alembic.config import Config
from app.auth import create_admin_user_record
from app.db.database import SessionLocal, engine
from app.models import Appointment, Barber, Service

load_dotenv(ROOT / ".env")


def reset_database() -> None:
    alembic_cfg = Config(str(ROOT / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(ROOT / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", os.getenv("DATABASE_URL"))
    command.upgrade(alembic_cfg, "head")

    with engine.begin() as connection:
        connection.execute(text("TRUNCATE TABLE appointments RESTART IDENTITY CASCADE"))
        connection.execute(text("TRUNCATE TABLE barbers RESTART IDENTITY CASCADE"))
        connection.execute(text("TRUNCATE TABLE services RESTART IDENTITY CASCADE"))


def seed_data() -> None:
    db = SessionLocal()
    try:
        barbers = [
            Barber(
                name="Mika Lindberg",
                email="mika@northstreetstudio.se",
                phone="+46700000001",
                role="Owner",
                bio="Mika blends precision cuts with a relaxed Scandinavian style and a sharp eye for modern fades.",
                photo_url="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=900&q=80",
                color="#8B5E3C",
            ),
            Barber(
                name="Noah Hassan",
                email="noah@northstreetstudio.se",
                phone="+46700000002",
                role="Barber",
                bio="Noah is known for clean lines, textured finishes, and easy-going consultations for every client.",
                photo_url="https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=900&q=80",
                color="#2F6F7A",
            ),
            Barber(
                name="Alicia Sundström",
                email="alicia@northstreetstudio.se",
                phone="+46700000003",
                role="Barber",
                bio="Alicia specializes in soft styling, beard shaping, and premium finishing touches that hold their look all week.",
                photo_url="https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=900&q=80",
                color="#4C6F3A",
            ),
        ]
        db.add_all(barbers)
        db.flush()

        services = [
            Service(name="Classic Cut", duration_minutes=45, price="290.00", description="Precision cut and finish"),
            Service(name="Beard Sculpt", duration_minutes=30, price="180.00", description="Shape and line up your beard"),
            Service(name="Premium Fade", duration_minutes=60, price="420.00", description="Modern fade with styling"),
            Service(name="Kids Cut", duration_minutes=30, price="170.00", description="Comfortable cut for children"),
            Service(name="Luxury Shave", duration_minutes=40, price="240.00", description="Traditional hot towel shave"),
        ]
        db.add_all(services)
        db.flush()

        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        appointment_slots = [
            (
                barbers[0].id,
                services[0].id,
                "Liam Eriksson",
                "+46700000100",
                "liam@example.com",
                today + timedelta(days=1, hours=10),
                today + timedelta(days=1, hours=10, minutes=45),
                "pending",
            ),
            (
                barbers[1].id,
                services[2].id,
                "Sara Berg",
                "+46700000101",
                "sara@example.com",
                today + timedelta(days=2, hours=12),
                today + timedelta(days=2, hours=13),
                "confirmed",
            ),
            (
                barbers[2].id,
                services[3].id,
                "Oskar Nordin",
                "+46700000102",
                "oskar@example.com",
                today + timedelta(days=3, hours=15),
                today + timedelta(days=3, hours=15, minutes=30),
                "cancelled",
            ),
        ]

        for barber_id, service_id, customer_name, phone, email, starts_at, ends_at, status in appointment_slots:
            db.add(
                Appointment(
                    barber_id=barber_id,
                    service_id=service_id,
                    customer_name=customer_name,
                    customer_phone=phone,
                    customer_email=email,
                    starts_at=starts_at,
                    ends_at=ends_at,
                    status=status,
                    notes="Seeded sample appointment",
                )
            )

        create_admin_user_record(db, os.getenv("ADMIN_USERNAME", "admin"), os.getenv("ADMIN_PASSWORD", "admin123"))
        db.commit()
        print("Development database seeded with realistic sample data.")
    finally:
        db.close()


if __name__ == "__main__":
    reset_database()
    seed_data()
