"""add barber profiles

Revision ID: 20261021_add_barber_profiles
Revises: 20261020_add_admin_users
Create Date: 2026-10-21 00:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "20261021_add_barber_profiles"
down_revision = "20261020_add_admin_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("barbers", sa.Column("role", sa.String(length=80), nullable=True))
    op.add_column("barbers", sa.Column("bio", sa.Text(), nullable=True))
    op.add_column("barbers", sa.Column("photo_url", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("barbers", "photo_url")
    op.drop_column("barbers", "bio")
    op.drop_column("barbers", "role")
