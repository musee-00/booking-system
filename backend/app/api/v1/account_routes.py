"""Owner-only management of staff logins (one login per barber)."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import hash_password, require_owner
from app.db.database import get_db
from app.models import ROLE_BARBER, ROLE_OWNER, AdminUser, Barber
from app.schemas import AccountCreate, AccountRead, PasswordReset

# Everything here is owner-only, set once on the router.
router = APIRouter(prefix="/api/v1/accounts", tags=["accounts"], dependencies=[Depends(require_owner)])


def get_account_or_404(db: Session, account_id: int) -> AdminUser:
    account = db.get(AdminUser, account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    return account


@router.get("", response_model=list[AccountRead])
def list_accounts(db: Session = Depends(get_db)) -> list[AdminUser]:
    return db.scalars(select(AdminUser).order_by(AdminUser.role.desc(), AdminUser.username)).all()


@router.post("", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
def create_barber_account(payload: AccountCreate, db: Session = Depends(get_db)) -> AdminUser:
    if db.get(Barber, payload.barber_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Barber not found.")

    account = AdminUser(
        username=payload.username,
        password_hash=hash_password(payload.password),  # only the bcrypt hash is stored
        role=ROLE_BARBER,
        barber_id=payload.barber_id,
    )
    db.add(account)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # Unique constraints: username, and one login per barber.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That username is taken, or this barber already has a login.",
        ) from exc
    db.refresh(account)
    return account


@router.put("/{account_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(account_id: int, payload: PasswordReset, db: Session = Depends(get_db)) -> Response:
    """The owner sets a new password, e.g. when a barber forgot theirs."""
    account = get_account_or_404(db, account_id)
    account.password_hash = hash_password(payload.password)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, db: Session = Depends(get_db)) -> Response:
    account = get_account_or_404(db, account_id)
    if account.role == ROLE_OWNER:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The owner account can't be deleted.")
    db.delete(account)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
