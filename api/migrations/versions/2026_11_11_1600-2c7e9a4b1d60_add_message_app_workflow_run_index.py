"""Index app-scoped message lookups for workflow run ownership.

Revision ID: 2c7e9a4b1d60
Revises: 8e1a5c7b9d24
Create Date: 2026-11-11 16:00:00.000000

PostgreSQL builds the index concurrently to avoid blocking message writes.
Online retries reuse a matching healthy index and accept a completed drop.
Inspect and remove an invalid index only after confirming its build is abandoned;
never drop a healthy index as routine recovery.
"""

from alembic import op

from migrations.postgresql_online_v1 import IndexSpec, create_indexes, drop_indexes

revision = "2c7e9a4b1d60"
down_revision = "8e1a5c7b9d24"
branch_labels = None
depends_on = None

_INDEX = IndexSpec("messages", "message_app_workflow_run_idx", ("app_id", "workflow_run_id", "conversation_id"))


def upgrade() -> None:
    """Add the lookup index to messages without changing rows or rebuilding a healthy index."""
    if op.get_bind().dialect.name == "postgresql":
        create_indexes(op, _INDEX)
    else:
        op.create_index(_INDEX.name, _INDEX.table, list(_INDEX.columns), unique=False)


def downgrade() -> None:
    """Remove only the lookup index; PostgreSQL retries accept an already completed drop."""
    if op.get_bind().dialect.name == "postgresql":
        drop_indexes(op, _INDEX)
    else:
        op.drop_index(_INDEX.name, table_name=_INDEX.table)
