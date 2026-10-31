"""Create the indexed workflow debug reservation ledger.

Revision ID: a4f6c8d2e901
Revises: e7b2a9c4d601
Create Date: 2026-10-06 12:00:00
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "a4f6c8d2e901"
down_revision = "e7b2a9c4d601"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "workflow_debug_reservations",
        sa.Column("workflow_run_id", StringUUID(), primary_key=True, nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["workflow_run_id"], ["workflow_runs.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "workflow_debug_reservation_due_idx", "workflow_debug_reservations", ["expires_at", "workflow_run_id"]
    )


def downgrade():
    op.drop_table("workflow_debug_reservations")
