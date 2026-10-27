"""keep one tracing configuration per app and provider

Revision ID: 53c10126d551
Revises: b9d3f7a5c102
Create Date: 2026-10-23 12:00:00.000000

Configuration writes lock the app row, but rows written before that lock existed can
duplicate an (app, provider) pair, and reads then pick one arbitrarily. The most
recently updated row wins; the unique index keeps the pair unique from now on.
"""

import sqlalchemy as sa
from alembic import op

revision = "53c10126d551"
down_revision = "b9d3f7a5c102"
branch_labels = None
depends_on = None

_TABLE = "trace_app_config"
_INDEX = "trace_app_config_app_provider_uq"

# MySQL cannot read the table a DELETE targets except through a derived table.
_DELETE_SUPERSEDED = sa.text(
    """
    DELETE FROM trace_app_config
    WHERE id IN (
        SELECT id FROM (
            SELECT older.id
            FROM trace_app_config older
            JOIN trace_app_config newer
              ON newer.app_id = older.app_id
             AND newer.tracing_provider = older.tracing_provider
             AND (
                newer.updated_at > older.updated_at
                OR (newer.updated_at = older.updated_at AND newer.id > older.id)
             )
        ) superseded
    )
    """
)


def upgrade() -> None:
    op.execute(_DELETE_SUPERSEDED)
    op.create_index(_INDEX, _TABLE, ["app_id", "tracing_provider"], unique=True)


def downgrade() -> None:
    op.drop_index(_INDEX, table_name=_TABLE)
