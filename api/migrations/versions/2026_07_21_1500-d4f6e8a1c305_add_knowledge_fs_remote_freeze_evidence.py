"""add durable KnowledgeFS remote freeze evidence

Revision ID: d4f6e8a1c305
Revises: c8e31b7d52a4
Create Date: 2026-07-21 15:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "d4f6e8a1c305"
down_revision = "c8e31b7d52a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("knowledge_fs_workspace_cutover_ledgers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("remote_freeze_id", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("remote_freeze_revision", sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column("remote_freeze_digest", sa.String(length=71), nullable=True))
        batch_op.add_column(sa.Column("remote_freeze_task_watermark", sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column("remote_freeze_control_space_id", models.types.StringUUID(), nullable=True))
        batch_op.add_column(sa.Column("remote_freeze_frozen_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("remote_freeze_updated_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("remote_freeze_acknowledged_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("remote_freeze_applied", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("remote_freeze_replayed", sa.Boolean(), nullable=True))
        batch_op.create_check_constraint(
            "kfs_workspace_cutover_remote_freeze_fields_ck",
            "(remote_freeze_id IS NULL AND remote_freeze_revision IS NULL "
            "AND remote_freeze_digest IS NULL AND remote_freeze_task_watermark IS NULL "
            "AND remote_freeze_control_space_id IS NULL AND remote_freeze_frozen_at IS NULL "
            "AND remote_freeze_updated_at IS NULL AND remote_freeze_acknowledged_at IS NULL "
            "AND remote_freeze_applied IS NULL AND remote_freeze_replayed IS NULL) OR "
            "(remote_freeze_id IS NOT NULL AND remote_freeze_revision BETWEEN 1 AND 9007199254740991 "
            "AND remote_freeze_digest IS NOT NULL AND remote_freeze_task_watermark >= 0 "
            "AND remote_freeze_control_space_id IS NOT NULL AND remote_freeze_frozen_at IS NOT NULL "
            "AND remote_freeze_updated_at IS NOT NULL AND remote_freeze_acknowledged_at IS NOT NULL "
            "AND ((remote_freeze_applied = true AND remote_freeze_replayed = false) "
            "OR (remote_freeze_applied = false AND remote_freeze_replayed = true)))",
        )
        batch_op.create_check_constraint(
            "kfs_workspace_cutover_remote_freeze_time_ck",
            "remote_freeze_updated_at IS NULL OR remote_freeze_updated_at >= remote_freeze_frozen_at",
        )


def downgrade() -> None:
    with op.batch_alter_table("knowledge_fs_workspace_cutover_ledgers", schema=None) as batch_op:
        batch_op.drop_constraint("kfs_workspace_cutover_remote_freeze_time_ck", type_="check")
        batch_op.drop_constraint("kfs_workspace_cutover_remote_freeze_fields_ck", type_="check")
        batch_op.drop_column("remote_freeze_replayed")
        batch_op.drop_column("remote_freeze_applied")
        batch_op.drop_column("remote_freeze_acknowledged_at")
        batch_op.drop_column("remote_freeze_updated_at")
        batch_op.drop_column("remote_freeze_frozen_at")
        batch_op.drop_column("remote_freeze_control_space_id")
        batch_op.drop_column("remote_freeze_task_watermark")
        batch_op.drop_column("remote_freeze_digest")
        batch_op.drop_column("remote_freeze_revision")
        batch_op.drop_column("remote_freeze_id")
