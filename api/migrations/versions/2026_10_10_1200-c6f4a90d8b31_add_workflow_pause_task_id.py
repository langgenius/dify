"""Persist workflow task ownership and cancellation intent.

Revision ID: c6f4a90d8b31
Revises: f1d3c5b7a902
Create Date: 2026-10-10 12:00:00
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "c6f4a90d8b31"
down_revision = "f1d3c5b7a902"
branch_labels = None
depends_on = None


def upgrade():
    postgresql = op.get_bind().dialect.name == "postgresql"
    inspector = sa.inspect(op.get_bind()) if not postgresql and not op.get_context().as_sql else None
    existing_columns = {column["name"] for column in inspector.get_columns("workflow_runs")} if inspector else set()
    # The index build can fail after committing columns but before recording this revision.
    with op.batch_alter_table("workflow_runs") as batch_op:
        if "task_id" not in existing_columns:
            batch_op.add_column(sa.Column("task_id", StringUUID(), nullable=True), if_not_exists=postgresql)
        if "stop_requested_at" not in existing_columns:
            batch_op.add_column(sa.Column("stop_requested_at", sa.DateTime(), nullable=True), if_not_exists=postgresql)

    if postgresql:
        with op.get_context().autocommit_block():
            # An interrupted concurrent build can leave an invalid index behind.
            op.drop_index(
                "workflow_run_task_id_idx", table_name="workflow_runs", postgresql_concurrently=True, if_exists=True
            )
            op.create_index(
                "workflow_run_task_id_idx",
                "workflow_runs",
                ["task_id"],
                postgresql_concurrently=True,
                postgresql_where=sa.text("task_id IS NOT NULL"),
            )
    elif inspector is None or not any(
        index["name"] == "workflow_run_task_id_idx" for index in inspector.get_indexes("workflow_runs")
    ):
        op.create_index("workflow_run_task_id_idx", "workflow_runs", ["task_id"])


def downgrade():
    postgresql = op.get_bind().dialect.name == "postgresql"
    inspector = sa.inspect(op.get_bind()) if not postgresql and not op.get_context().as_sql else None
    existing_columns = {column["name"] for column in inspector.get_columns("workflow_runs")} if inspector else set()
    if postgresql:
        with op.get_context().autocommit_block():
            op.drop_index(
                "workflow_run_task_id_idx", table_name="workflow_runs", postgresql_concurrently=True, if_exists=True
            )
    elif inspector is None or any(
        index["name"] == "workflow_run_task_id_idx" for index in inspector.get_indexes("workflow_runs")
    ):
        op.drop_index("workflow_run_task_id_idx", table_name="workflow_runs")

    with op.batch_alter_table("workflow_runs") as batch_op:
        if inspector is None or "stop_requested_at" in existing_columns:
            batch_op.drop_column("stop_requested_at")
        if inspector is None or "task_id" in existing_columns:
            batch_op.drop_column("task_id")
