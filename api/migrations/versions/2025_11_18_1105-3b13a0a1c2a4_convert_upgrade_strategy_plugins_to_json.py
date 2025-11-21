"""convert tenant plugin auto-upgrade plugin lists to json

Revision ID: 3b13a0a1c2a4
Revises: 09cfdda155d1
Create Date: 2025-11-18 11:05:00.000000

"""
from alembic import op
import models as models  # noqa: F401  (kept for Alembic's autogenerate)
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


def _is_pg(conn) -> bool:
    return conn.dialect.name == "postgresql"


# revision identifiers, used by Alembic.
revision = '3b13a0a1c2a4'
down_revision = '09cfdda155d1'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    if not _is_pg(conn):
        return

    with op.batch_alter_table('tenant_plugin_auto_upgrade_strategies', schema=None) as batch_op:
        batch_op.alter_column(
            'exclude_plugins',
            existing_type=postgresql.ARRAY(sa.String(length=255)),
            type_=sa.JSON(),
            existing_nullable=False,
            postgresql_using='to_jsonb(exclude_plugins)::json',
        )
        batch_op.alter_column(
            'include_plugins',
            existing_type=postgresql.ARRAY(sa.String(length=255)),
            type_=sa.JSON(),
            existing_nullable=False,
            postgresql_using='to_jsonb(include_plugins)::json',
        )


def downgrade():
    conn = op.get_bind()
    if not _is_pg(conn):
        return

    with op.batch_alter_table('tenant_plugin_auto_upgrade_strategies', schema=None) as batch_op:
        batch_op.alter_column(
            'exclude_plugins',
            existing_type=sa.JSON(),
            type_=postgresql.ARRAY(sa.String(length=255)),
            existing_nullable=False,
        )
        batch_op.alter_column(
            'include_plugins',
            existing_type=sa.JSON(),
            type_=postgresql.ARRAY(sa.String(length=255)),
            existing_nullable=False,
        )
