"""Keep one end user row per app, session, and type

Revision ID: a9f07c7f10cf
Revises: 8c2f5d7a1e30
Create Date: 2026-11-13 12:00:00.000000

Concurrent first requests can insert duplicate end_users rows for one
(tenant, app, session, type) identity, and later reads then pick one
arbitrarily. The earliest created row wins; the unique index keeps the
identity unique from now on.
"""

import sqlalchemy as sa
from alembic import op

revision = "a9f07c7f10cf"
down_revision = "8c2f5d7a1e30"
branch_labels = None
depends_on = None

_TABLE = "end_users"
_INDEX = "uq_end_user_tenant_app_session_type"

# MySQL cannot read the table a DELETE targets except through a derived table.
_DELETE_SUPERSEDED = sa.text(
    """
    DELETE FROM end_users
    WHERE id IN (
        SELECT id FROM (
            SELECT older.id
            FROM end_users older
            JOIN end_users newer
              ON newer.tenant_id = older.tenant_id
             AND newer.app_id = older.app_id
             AND newer.session_id = older.session_id
             AND newer.type = older.type
             AND (
                newer.created_at < older.created_at
                OR (newer.created_at = older.created_at AND newer.id < older.id)
             )
        ) superseded
    )
    """
)


def upgrade() -> None:
    op.execute(_DELETE_SUPERSEDED)
    op.create_index(_INDEX, _TABLE, ["tenant_id", "app_id", "session_id", "type"], unique=True)


def downgrade() -> None:
    op.drop_index(_INDEX, table_name=_TABLE)
