"""add barber_services (which barber offers which service)

Revision ID: 20261025_add_barber_services
Revises: 20261024_add_barber_schedules
Create Date: 2026-10-25 00:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "20261025_add_barber_services"
down_revision = "20261024_add_barber_schedules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "barber_services",
        sa.Column("barber_id", sa.Integer(), sa.ForeignKey("barbers.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("service_id", sa.Integer(), sa.ForeignKey("services.id", ondelete="CASCADE"), primary_key=True),
    )
    # Keep today's behaviour: every existing barber offers every existing service.
    op.execute(
        """
        INSERT INTO barber_services (barber_id, service_id)
        SELECT barbers.id, services.id FROM barbers CROSS JOIN services
        """
    )


def downgrade() -> None:
    op.drop_table("barber_services")
