from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Booking System API"
    app_env: str = "development"
    database_url: str = "postgresql+psycopg://booking_user:booking_password@localhost:5432/booking_db"
    admin_username: str = "admin"
    admin_password: str = "admin123"
    jwt_secret: str = "change-this-to-a-long-random-secret"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
