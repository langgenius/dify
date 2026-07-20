"""add workflow-run archive bundle shard cursor index

Revision ID: 9b2d7e4f6a81
Revises: 3c9f8e2a1d7b
Create Date: 2026-07-20 12:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "9b2d7e4f6a81"
down_revision = "3c9f8e2a1d7b"
branch_labels = None
depends_on = None

_INDEX_NAME = "workflow_run_archive_bundle_month_shard_id_idx"
_TABLE_NAME = "workflow_run_archive_bundles"


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    if _is_postgresql():
        with op.get_context().autocommit_block():
            op.create_index(
                _INDEX_NAME,
                _TABLE_NAME,
                ["year", "month", "shard", "id"],
                postgresql_concurrently=True,
            )
        return
    op.create_index(_INDEX_NAME, _TABLE_NAME, ["year", "month", "shard", "id"])


def downgrade() -> None:
    if _is_postgresql():
        with op.get_context().autocommit_block():
            op.drop_index(_INDEX_NAME, table_name=_TABLE_NAME, postgresql_concurrently=True)
        return
    op.drop_index(_INDEX_NAME, table_name=_TABLE_NAME)
