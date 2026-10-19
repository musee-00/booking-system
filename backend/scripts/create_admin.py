#!/usr/bin/env python3

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.auth import create_admin_user_record
from app.db.database import SessionLocal

load_dotenv(ROOT / ".env")


def main() -> None:
    username = os.getenv("ADMIN_USERNAME", "admin")
    password = os.getenv("ADMIN_PASSWORD", "admin123")

    db = SessionLocal()
    try:
        admin_user = create_admin_user_record(db, username, password)
        print(f"Admin user ready: {admin_user.username}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
