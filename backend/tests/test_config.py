import pytest

from app.core.config import DEFAULT_ADMIN_PASSWORD, DEFAULT_JWT_SECRET, Settings

STRONG_SECRET = "x" * 48
STRONG_PASSWORD = "a-long-admin-password"
FRONTEND = "https://north-street.vercel.app"


def make_settings(**overrides) -> Settings:
    # _env_file=None: ignore the developer's local .env so tests are predictable.
    return Settings(_env_file=None, **overrides)


@pytest.mark.parametrize(
    "url",
    [
        "postgres://user:pw@host:5432/db",
        "postgresql://user:pw@host:5432/db",
        "postgresql+psycopg://user:pw@host:5432/db",
    ],
)
def test_database_url_always_uses_psycopg_driver(url) -> None:
    assert make_settings(database_url=url).database_url == "postgresql+psycopg://user:pw@host:5432/db"


def test_cors_origins_are_split_and_trimmed() -> None:
    settings = make_settings(cors_origins=f" {FRONTEND}/ , http://localhost:5173 ,")
    assert settings.cors_origin_list == [FRONTEND, "http://localhost:5173"]


def test_development_allows_defaults() -> None:
    make_settings(app_env="development").check_production_safety()  # no error


def test_production_accepts_safe_config() -> None:
    make_settings(
        app_env="production", jwt_secret=STRONG_SECRET, admin_password=STRONG_PASSWORD, cors_origins=FRONTEND,
    ).check_production_safety()  # no error


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"jwt_secret": DEFAULT_JWT_SECRET}, "JWT_SECRET"),
        ({"jwt_secret": "too-short"}, "JWT_SECRET"),
        ({"admin_password": DEFAULT_ADMIN_PASSWORD}, "ADMIN_PASSWORD"),
        ({"admin_password": "short"}, "ADMIN_PASSWORD"),
        ({"cors_origins": "http://localhost:5173"}, "CORS_ORIGINS"),
    ],
)
def test_production_refuses_unsafe_config(overrides, expected) -> None:
    safe = {"jwt_secret": STRONG_SECRET, "admin_password": STRONG_PASSWORD, "cors_origins": FRONTEND}
    settings = make_settings(app_env="production", **{**safe, **overrides})

    with pytest.raises(RuntimeError, match=expected):
        settings.check_production_safety()
