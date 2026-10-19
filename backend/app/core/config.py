from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Booking System API"
    app_env: str = "development"
    database_url: str = "postgresql+psycopg://booking_user:booking_password@localhost:5432/booking_db"
    admin_username: str = "admin"
    admin_password: str = "admin123"
    admin_token_secret: str = "booking-system-secret"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
