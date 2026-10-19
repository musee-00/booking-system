# Booking System Backend

This is the FastAPI backend for the booking system.

## Setup

1. Create a virtual environment:
   ```bash
   cd backend
   python3 -m venv .venv
   source .venv/bin/activate
   ```
2. Install dependencies:
   ```bash
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   ```
3. Copy environment variables:
   ```bash
   cp .env.example .env
   ```
4. Start PostgreSQL and create the database.
5. Run the API:
   ```bash
   uvicorn app.main:app --reload
   ```

## Development

- API docs: http://localhost:8000/docs
- Health endpoint: http://localhost:8000/api/v1/health

## Double-booking protection

“Double bookings are prevented on two levels: the API checks for overlapping time ranges and returns 409 Conflict, and a PostgreSQL exclusion constraint guarantees it at the data level. The database constraint also handles race conditions when two bookings arrive at the same time.”
