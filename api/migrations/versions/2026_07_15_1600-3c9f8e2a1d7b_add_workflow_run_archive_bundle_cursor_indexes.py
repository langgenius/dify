"""add workflow-run archive bundle cursor indexes

Revision ID: 3c9f8e2a1d7b
Revises: 7a1c2d9e4b60
Create Date: 2026-07-15 16:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "3c9f8e2a1d7b"
down_revision = "7a1c2d9e4b60"
branch_labels = None
depends_on = None

_TABLE_NAME = "workflow_run_archive_bundles"
_INDEXES = (
    ("workflow_run_archive_bundle_month_id_idx", ("year", "month", "id")),
    ("workflow_run_archive_bundle_month_shard_id_idx", ("year", "month", "shard", "id")),
)


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    if _is_postgresql():
        with op.get_context().autocommit_block():
            for index_name, columns in _INDEXES:
                op.create_index(index_name, _TABLE_NAME, columns, postgresql_concurrently=True)
        return
    for index_name, columns in _INDEXES:
        op.create_index(index_name, _TABLE_NAME, columns)


def downgrade() -> None:
    if _is_postgresql():
        with op.get_context().autocommit_block():
            for index_name, _ in reversed(_INDEXES):
                op.drop_index(index_name, table_name=_TABLE_NAME, postgresql_concurrently=True)
        return
    for index_name, _ in reversed(_INDEXES):
        op.drop_index(index_name, table_name=_TABLE_NAME)
