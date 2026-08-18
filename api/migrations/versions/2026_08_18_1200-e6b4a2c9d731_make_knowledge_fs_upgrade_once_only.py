"""make KnowledgeFS legacy Dataset upgrades once-only

Revision ID: e6b4a2c9d731
Revises: f3a8c1d7e920
Create Date: 2026-08-18 12:00:00.000000

"""

from alembic import op

revision = "e6b4a2c9d731"
down_revision = "f3a8c1d7e920"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "kfs_upgrade_job_dataset_uq",
        "knowledge_fs_upgrade_jobs",
        ["tenant_id", "old_dataset_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "kfs_upgrade_job_dataset_uq",
        "knowledge_fs_upgrade_jobs",
        type_="unique",
    )
