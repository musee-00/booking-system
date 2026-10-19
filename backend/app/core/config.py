from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "Booking System API"
    app_env: str = "development"
    database_url: str = "postgresql+psycopg://booking_user:booking_password@localhost:5432/booking_db"
    test_database_url: str = "postgresql+psycopg://booking_user:booking_password@localhost:5432/booking_test_db"
    admin_username: str = "admin"
    admin_password: str = "admin123"
    jwt_secret: str = "change-this-to-a-long-random-secret"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = "no-reply@northstreetstudio.se"
    smtp_use_tls: bool = False
    shop_name: str = "North Street Studio"
    shop_address: str = "27 North Street, Gothenburg"

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
