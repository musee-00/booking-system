"""add barber active flag

Revision ID: 20261023_add_barber_active
Revises: 20261022_add_barber_colors
Create Date: 2026-10-23 00:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "20261023_add_barber_active"
down_revision = "20261022_add_barber_colors"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Soft delete: an inactive barber is hidden from customers and can't be
    # booked, but stays in the table so existing appointments keep their barber.
    # server_default fills in true for barbers that already exist.
    op.add_column(
        "barbers",
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("barbers", "active")
