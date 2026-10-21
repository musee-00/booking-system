from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.account_routes import router as account_router
from app.api.v1.router import router as v1_router
from app.api.v1.schedule_routes import router as schedule_router
from app.core.config import settings

settings.check_production_safety()

app = FastAPI(
    title="Booking System API",
    version="0.1.0",
    description="Backend API for a barber booking system",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    # Admin auth uses an Authorization header, not cookies, so no credentials needed.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router)
app.include_router(schedule_router)
app.include_router(account_router)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "Welcome to the Booking System API"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
