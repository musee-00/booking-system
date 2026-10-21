from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_db
from app.models import ROLE_BARBER, ROLE_OWNER, AdminUser

# auto_error=False so we can return our own 401 message instead of FastAPI's 403.
bearer_scheme = HTTPBearer(auto_error=False)


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


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AdminUser:
    """Authentication: who is calling? Any valid staff login passes, otherwise 401.

    The role is read from the database on every request (not from the token),
    so deactivating a barber or deleting their account takes effect immediately.
    """
    unauthorized_headers = {"WWW-Authenticate": "Bearer"}

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
            headers=unauthorized_headers,
        )

    try:
        user = get_admin_user_from_token(db, credentials.credentials)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired admin token.",
            headers=unauthorized_headers,
        ) from exc

    if user.role == ROLE_BARBER and (user.barber is None or not user.barber.active):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account is disabled.",
            headers=unauthorized_headers,
        )
    return user


def require_owner(user: AdminUser = Depends(get_current_user)) -> AdminUser:
    """Authorization: may this user do it? Owner-only actions, otherwise 403.

    401 = "I don't know who you are"; 403 = "I know who you are, but no".
    """
    if user.role != ROLE_OWNER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can do this.")
    return user
