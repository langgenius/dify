"""Persist delivery and execution leases for upgrade document reconciliation.

Revision ID: b9d3f7a5c102
Revises: a8c2e6f4b901
Create Date: 2026-10-21 15:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "b9d3f7a5c102"
down_revision = "a8c2e6f4b901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NULL leases make previously stranded successful jobs eligible for the recovery sweep.
    op.add_column("knowledge_fs_upgrade_jobs", sa.Column("reconciliation_task_id", sa.String(255), nullable=True))
    op.add_column("knowledge_fs_upgrade_jobs", sa.Column("reconciliation_started_at", sa.DateTime(), nullable=True))
    op.add_column(
        "knowledge_fs_upgrade_jobs", sa.Column("reconciliation_lease_expires_at", sa.DateTime(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("knowledge_fs_upgrade_jobs", "reconciliation_lease_expires_at")
    op.drop_column("knowledge_fs_upgrade_jobs", "reconciliation_started_at")
    op.drop_column("knowledge_fs_upgrade_jobs", "reconciliation_task_id")
