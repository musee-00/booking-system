# Booking System – Backend

FastAPI + PostgreSQL API for the barber booking system. For the project overview, the double-booking design and the endpoint list, see the [main README](../README.md).

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # edit values, see the main README → Configuration
alembic upgrade head          # create tables and the appointments_no_overlap constraint
uvicorn app.main:app --reload
```

- API docs (Swagger UI): http://localhost:8000/docs. Use **Authorize** with a token from `/api/v1/admin/login` to call admin endpoints.
- Health check: http://localhost:8000/api/v1/health

## Scripts

| Command | What it does |
|---|---|
| `python scripts/seed_dev_data.py` | Runs migrations and **wipes** barbers, services and appointments, then inserts demo data and the admin user |
| `python scripts/create_admin.py` | Creates the admin user from `ADMIN_USERNAME` / `ADMIN_PASSWORD` if it doesn't exist |

## Tests

```bash
python -m pytest -v
```

`tests/conftest.py` creates a fresh `booking_test_db` using `TEST_DATABASE_ADMIN_URL`, runs all migrations on it and drops it when the session ends. Tests use dates relative to today, so they don't go stale.

## Code layout

| Path | Contents |
|---|---|
| `app/main.py` | FastAPI app and CORS |
| `app/api/v1/router.py` | All endpoints, the availability calculation and the confirmation email |
| `app/auth.py` | Password hashing, JWT creation and the `require_admin` dependency |
| `app/models.py` | SQLAlchemy models |
| `app/schemas.py` | Pydantic request and response schemas |
| `app/core/config.py` | Settings loaded from `.env` |
| `alembic/versions/` | Database migrations, including the exclusion constraint |

## Adding an admin-only endpoint

Attach the dependency to the route. Requests without a valid token get `401` before your handler runs:

```python
from app.auth import require_admin

@router.delete("/services/{service_id}", dependencies=[Depends(require_admin)])
def delete_service(service_id: int, db: Session = Depends(get_db)): ...
```

Then add the endpoint to `PROTECTED_ENDPOINTS` in `tests/test_booking_api.py`, so the missing, invalid and valid token tests cover it automatically.
