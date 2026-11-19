"""add archive bundle deletion status

Revision ID: f1d3c5b7a902
Revises: a8c9e2f1b704
Create Date: 2026-10-12 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "f1d3c5b7a902"
down_revision = "a8c9e2f1b704"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workflow_run_archive_bundles", sa.Column("deletion_status", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("workflow_run_archive_bundles", "deletion_status")
