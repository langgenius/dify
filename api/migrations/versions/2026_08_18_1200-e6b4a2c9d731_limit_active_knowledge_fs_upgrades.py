"""limit active KnowledgeFS legacy Dataset upgrades

Revision ID: e6b4a2c9d731
Revises: f3a8c1d7e920
Create Date: 2026-08-18 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "e6b4a2c9d731"
down_revision = "f3a8c1d7e920"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "kfs_upgrade_job_active_dataset_uq",
        "knowledge_fs_upgrade_jobs",
        ["tenant_id", "old_dataset_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )


def downgrade() -> None:
    op.drop_index(
        "kfs_upgrade_job_active_dataset_uq",
        table_name="knowledge_fs_upgrade_jobs",
    )
