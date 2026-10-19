from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import AdminUser


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_admin_user_record(db: Session, username: str, password: str) -> AdminUser:
    user = db.query(AdminUser).filter(AdminUser.username == username).first()
    if user is not None:
        return user

    user = AdminUser(username=username, password_hash=hash_password(password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_access_token(username: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload = {"sub": username, "exp": expires_at}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def get_admin_user_from_token(db: Session, token: str) -> AdminUser:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:  # type: ignore[attr-defined]
        raise ValueError("Invalid or expired token") from exc

    username = payload.get("sub")
    if not username:
        raise ValueError("Token missing subject")

    user = db.query(AdminUser).filter(AdminUser.username == username).first()
    if user is None:
        raise ValueError("Admin user not found")

    return user
