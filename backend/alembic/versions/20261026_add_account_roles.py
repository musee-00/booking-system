"""add roles to staff accounts (owner / barber)

Revision ID: 20261026_add_account_roles
Revises: 20261025_add_barber_services
Create Date: 2026-10-26 00:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "20261026_add_account_roles"
down_revision = "20261025_add_barber_services"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing accounts (the admin) become owners.
    op.add_column("admin_users", sa.Column("role", sa.String(length=20), nullable=False, server_default="owner"))
    op.add_column(
        "admin_users",
        sa.Column("barber_id", sa.Integer(), sa.ForeignKey("barbers.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_unique_constraint("uq_admin_users_barber_id", "admin_users", ["barber_id"])
    op.create_check_constraint("ck_admin_users_role", "admin_users", "role IN ('owner', 'barber')")
    op.create_check_constraint(
        "ck_admin_users_barber_link", "admin_users", "(role = 'barber') = (barber_id IS NOT NULL)"
    )


def downgrade() -> None:
    op.drop_constraint("ck_admin_users_barber_link", "admin_users", type_="check")
    op.drop_constraint("ck_admin_users_role", "admin_users", type_="check")
    op.drop_constraint("uq_admin_users_barber_id", "admin_users", type_="unique")
    op.drop_column("admin_users", "barber_id")
    op.drop_column("admin_users", "role")
