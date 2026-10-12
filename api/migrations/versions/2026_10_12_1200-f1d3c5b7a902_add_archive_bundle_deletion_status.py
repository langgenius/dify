"""add archive bundle deletion status

Revision ID: f1d3c5b7a902
Revises: e7b2a9c4d601
Create Date: 2026-10-12 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "f1d3c5b7a902"
down_revision = "e7b2a9c4d601"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workflow_run_archive_bundles",
        sa.Column("deletion_status", sa.String(16), nullable=True),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_column("workflow_run_archive_bundles", "deletion_status")
