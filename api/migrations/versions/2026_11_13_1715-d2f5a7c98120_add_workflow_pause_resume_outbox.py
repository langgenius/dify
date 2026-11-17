"""Persist timeout-triggered workflow resume delivery requests.

Revision ID: d2f5a7c98120
Revises: 8c2f5d7a1e30
Create Date: 2026-11-13 17:15:00

"""

import sqlalchemy as sa
from alembic import op

revision = "d2f5a7c98120"
down_revision = "8c2f5d7a1e30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workflow_pauses", sa.Column("resume_requested_at", sa.DateTime(), nullable=True))
    op.add_column("workflow_pauses", sa.Column("resume_dispatch_lease_expires_at", sa.DateTime(), nullable=True))
    op.create_index(
        "workflow_pause_resume_dispatch_idx",
        "workflow_pauses",
        ["resumed_at", "resume_requested_at", "resume_dispatch_lease_expires_at"],
    )


def downgrade() -> None:
    op.drop_index("workflow_pause_resume_dispatch_idx", table_name="workflow_pauses")
    op.drop_column("workflow_pauses", "resume_dispatch_lease_expires_at")
    op.drop_column("workflow_pauses", "resume_requested_at")
