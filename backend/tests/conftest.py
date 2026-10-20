from __future__ import annotations

import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

TEST_DB_NAME = "booking_test_db"
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", f"postgresql+psycopg://booking_user:booking_password@localhost:5432/{TEST_DB_NAME}")
TEST_DATABASE_ADMIN_URL = os.getenv("TEST_DATABASE_ADMIN_URL", "postgresql+psycopg://localhost/postgres")
os.environ["DATABASE_URL"] = TEST_DATABASE_URL


@pytest.fixture(scope="session", autouse=True)
def reset_test_database() -> None:
    test_url = make_url(TEST_DATABASE_URL)
    admin_url = make_url(TEST_DATABASE_ADMIN_URL)
    # Pass the URL object, not str(url): SQLAlchemy 2 renders the password as "***"
    # in str(), so a password-protected admin URL would fail to log in.
    engine = create_engine(admin_url, pool_pre_ping=True, isolation_level="AUTOCOMMIT")

    with engine.connect() as connection:
        connection.execute(text(f'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = \'{test_url.database}\' AND pid <> pg_backend_pid();'))
        connection.execute(text(f'DROP DATABASE IF EXISTS "{test_url.database}"'))
        connection.execute(text(f'CREATE DATABASE "{test_url.database}" OWNER booking_user'))
        connection.execute(text(f'GRANT ALL PRIVILEGES ON DATABASE "{test_url.database}" TO booking_user'))

    alembic_cfg = Config(str(ROOT / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(ROOT / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.upgrade(alembic_cfg, "head")

    yield

    with engine.connect() as connection:
        connection.execute(text(f'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = \'{test_url.database}\' AND pid <> pg_backend_pid();'))
        connection.execute(text(f'DROP DATABASE IF EXISTS "{test_url.database}"'))
