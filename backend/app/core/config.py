from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_JWT_SECRET = "change-this-to-a-long-random-secret"
DEFAULT_ADMIN_PASSWORD = "admin123"


class Settings(BaseSettings):
    app_name: str = "Booking System API"
    app_env: str = "development"
    database_url: str = "postgresql+psycopg://booking_user:booking_password@localhost:5432/booking_db"
    test_database_url: str = "postgresql+psycopg://booking_user:booking_password@localhost:5432/booking_test_db"
    admin_username: str = "admin"
    admin_password: str = DEFAULT_ADMIN_PASSWORD
    jwt_secret: str = DEFAULT_JWT_SECRET
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
    # Comma-separated list of frontend URLs allowed to call the API from a browser,
    # e.g. "https://north-street.vercel.app,http://localhost:5173".
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("database_url", "test_database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str) -> str:
        """Hosts like Render give "postgresql://..." (or the old "postgres://...").
        SQLAlchemy would then look for the psycopg2 driver; we use psycopg 3."""
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix):]
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    def check_production_safety(self) -> None:
        """Fail fast: refuse to start in production with development defaults."""
        if not self.is_production:
            return

        problems = []
        if self.jwt_secret == DEFAULT_JWT_SECRET or len(self.jwt_secret) < 32:
            problems.append("JWT_SECRET must be set to a random value of at least 32 characters")
        if self.admin_password == DEFAULT_ADMIN_PASSWORD or len(self.admin_password) < 12:
            problems.append("ADMIN_PASSWORD must be changed from the default and be at least 12 characters")
        if any("localhost" in origin or "127.0.0.1" in origin for origin in self.cors_origin_list):
            problems.append("CORS_ORIGINS must list the deployed frontend URL, not localhost")

        if problems:
            raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))


settings = Settings()
