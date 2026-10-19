"""add barber colors

Revision ID: 20261022_add_barber_colors
Revises: 20261021_add_barber_profiles
Create Date: 2026-10-22 00:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "20261022_add_barber_colors"
down_revision = "20261021_add_barber_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "barbers",
        sa.Column("color", sa.String(length=20), nullable=True, server_default="#d9b57f"),
    )
    op.execute("UPDATE barbers SET color = '#d9b57f' WHERE color IS NULL")
    op.alter_column("barbers", "color", server_default=None)


def downgrade() -> None:
    op.drop_column("barbers", "color")
