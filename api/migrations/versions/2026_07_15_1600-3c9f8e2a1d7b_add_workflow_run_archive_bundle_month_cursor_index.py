"""add workflow-run archive bundle monthly cursor index

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

_INDEX_NAME = "workflow_run_archive_bundle_month_id_idx"
_TABLE_NAME = "workflow_run_archive_bundles"


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    if _is_postgresql():
        with op.get_context().autocommit_block():
            op.create_index(
                _INDEX_NAME,
                _TABLE_NAME,
                ["year", "month", "id"],
                postgresql_concurrently=True,
            )
        return
    op.create_index(_INDEX_NAME, _TABLE_NAME, ["year", "month", "id"])


def downgrade() -> None:
    if _is_postgresql():
        with op.get_context().autocommit_block():
            op.drop_index(_INDEX_NAME, table_name=_TABLE_NAME, postgresql_concurrently=True)
        return
    op.drop_index(_INDEX_NAME, table_name=_TABLE_NAME)
