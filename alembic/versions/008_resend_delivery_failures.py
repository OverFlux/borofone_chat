"""Track terminal outbox delivery failures.

Revision ID: 008_resend_delivery_failures
Revises: 007_vps_access_and_turn
"""

from alembic import op
import sqlalchemy as sa


revision = "008_resend_delivery_failures"
down_revision = "007_vps_access_and_turn"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notification_outbox",
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_notification_outbox_failed_at",
        "notification_outbox",
        ["failed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_notification_outbox_failed_at", table_name="notification_outbox")
    op.drop_column("notification_outbox", "failed_at")
