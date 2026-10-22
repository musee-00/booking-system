"""add manage_token_hash to appointments (customer self-service links)

Revision ID: 20261027_add_manage_token
Revises: 20261026_add_account_roles
Create Date: 2026-10-27 00:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "20261027_add_manage_token"
down_revision = "20261026_add_account_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable: existing bookings have no link (their emails were already sent).
    op.add_column("appointments", sa.Column("manage_token_hash", sa.String(length=64), nullable=True))
    op.create_unique_constraint("uq_appointments_manage_token_hash", "appointments", ["manage_token_hash"])


def downgrade() -> None:
    op.drop_constraint("uq_appointments_manage_token_hash", "appointments", type_="unique")
    op.drop_column("appointments", "manage_token_hash")
