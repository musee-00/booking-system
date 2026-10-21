"""add barber working hours and time off

Revision ID: 20261024_add_barber_schedules
Revises: 20261023_add_barber_active
Create Date: 2026-10-24 00:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "20261024_add_barber_schedules"
down_revision = "20261023_add_barber_active"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "barber_working_hours",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("barber_id", sa.Integer(), sa.ForeignKey("barbers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_working_hours_weekday"),
        sa.CheckConstraint("end_time > start_time", name="ck_working_hours_time_order"),
    )
    op.create_index("ix_barber_working_hours_barber_id", "barber_working_hours", ["barber_id"])

    op.create_table(
        "barber_time_off",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("barber_id", sa.Integer(), sa.ForeignKey("barbers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="ck_time_off_time_order"),
    )
    op.create_index("ix_barber_time_off_barber_id", "barber_time_off", ["barber_id"])

    # Existing barbers keep today's behaviour: Tuesday-Saturday (weekday 1-5), 09:00-18:00.
    op.execute(
        """
        INSERT INTO barber_working_hours (barber_id, weekday, start_time, end_time)
        SELECT barbers.id, days.weekday, TIME '09:00', TIME '18:00'
        FROM barbers CROSS JOIN generate_series(1, 5) AS days(weekday)
        """
    )


def downgrade() -> None:
    op.drop_index("ix_barber_time_off_barber_id", table_name="barber_time_off")
    op.drop_table("barber_time_off")
    op.drop_index("ix_barber_working_hours_barber_id", table_name="barber_working_hours")
    op.drop_table("barber_working_hours")
