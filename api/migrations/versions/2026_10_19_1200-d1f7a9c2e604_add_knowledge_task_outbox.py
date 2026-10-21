"""add knowledge task outbox

Revision ID: d1f7a9c2e604
Revises: f1d3c5b7a902
Create Date: 2026-10-19 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models.types

revision = "d1f7a9c2e604"
down_revision = "f1d3c5b7a902"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "knowledge_task_outbox",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("dataset_id", models.types.StringUUID(), nullable=False),
        sa.Column("task_kind", sa.String(length=64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("document_id", models.types.StringUUID(), nullable=True),
        sa.Column("resource_id", models.types.StringUUID(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("execution_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("available_at", sa.DateTime(), nullable=False),
        sa.Column("claim_id", models.types.StringUUID(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="knowledge_task_outbox_pkey"),
    )
    op.create_index(
        "knowledge_task_outbox_dispatch_idx",
        "knowledge_task_outbox",
        ["status", "available_at", "created_at"],
        unique=False,
    )
    op.create_index(
        "knowledge_task_outbox_dataset_idx",
        "knowledge_task_outbox",
        ["tenant_id", "dataset_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("knowledge_task_outbox_dataset_idx", table_name="knowledge_task_outbox")
    op.drop_index("knowledge_task_outbox_dispatch_idx", table_name="knowledge_task_outbox")
    op.drop_table("knowledge_task_outbox")
