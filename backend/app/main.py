from fastapi import FastAPI

from app.api.v1.router import router as v1_router

app = FastAPI(
    title="Booking System API",
    version="0.1.0",
    description="Backend API for a barber booking system",
)

app.include_router(v1_router)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "Welcome to the Booking System API"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
