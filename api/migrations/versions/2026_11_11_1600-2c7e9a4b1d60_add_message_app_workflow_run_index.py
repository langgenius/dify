"""Index app-scoped message lookups for workflow run ownership.

Revision ID: 2c7e9a4b1d60
Revises: 8e1a5c7b9d24
Create Date: 2026-11-11 16:00:00.000000

PostgreSQL builds the index concurrently to avoid blocking message writes.
If a failed build leaves an invalid index, inspect its definition and ensure no
build is still running before dropping that invalid index concurrently outside
a transaction and retrying. Existing names fail rather than silently accepting
an invalid or conflicting index. Do not drop a healthy index during recovery.
"""

from alembic import op

revision = "2c7e9a4b1d60"
down_revision = "8e1a5c7b9d24"
branch_labels = None
depends_on = None

_INDEX_NAME = "message_app_workflow_run_idx"
_TABLE_NAME = "messages"
_COLUMNS = ["app_id", "workflow_run_id", "conversation_id"]


def upgrade() -> None:
    """Require the parent schema and an unused index name; add a non-unique index without changing rows.

    DDL errors propagate without stamping the revision. PostgreSQL concurrent
    DDL commits independently and may leave an invalid index on failure.
    """
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.create_index(_INDEX_NAME, _TABLE_NAME, _COLUMNS, unique=False, postgresql_concurrently=True)
    else:
        op.create_index(_INDEX_NAME, _TABLE_NAME, _COLUMNS, unique=False)


def downgrade() -> None:
    """Require the upgraded schema; remove only this index and preserve all rows and other indexes.

    DDL errors propagate without stamping the revision. PostgreSQL drops the
    index concurrently outside the revision transaction.
    """
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.drop_index(_INDEX_NAME, table_name=_TABLE_NAME, postgresql_concurrently=True)
    else:
        op.drop_index(_INDEX_NAME, table_name=_TABLE_NAME)
