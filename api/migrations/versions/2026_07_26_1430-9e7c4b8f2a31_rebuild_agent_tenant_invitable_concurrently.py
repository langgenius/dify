"""rebuild agent_tenant_invitable_idx concurrently

Revision ID: 9e7c4b8f2a31
Revises: d2825e7b9c10
Create Date: 2026-07-26 14:30:00.000000

"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "9e7c4b8f2a31"
down_revision = "d2825e7b9c10"
branch_labels = None
depends_on = None


_INDEX_NAME = "agent_tenant_invitable_idx"
_INDEX_TABLE = "agents"
_INDEX_COLUMNS = [
    "tenant_id",
    "scope",
    "status",
    "active_config_has_model",
    "updated_at",
]


def _is_pg(conn) -> bool:
    return conn.dialect.name == "postgresql"


def upgrade():
    # Migration `9f4b7c2d1a80` created `agent_tenant_invitable_idx` with a
    # non-concurrent `op.create_index`, so the build takes a SHARE lock on the
    # `agents` table for the full index-build duration. The `agents` table is
    # written to on every Agent v2 chat turn, so the lock stalls the entire
    # Agent v2 surface area while the index is being built.
    #
    # We can't edit `9f4b7c2d1a80` (alembic anti-pattern: production databases
    # that already ran it would not be re-fixed), so this follow-up migration
    # drops the existing index and recreates it concurrently.
    #
    # `DROP INDEX CONCURRENTLY` and `CREATE INDEX CONCURRENTLY` cannot run inside
    # a transaction; both are wrapped in `autocommit_block` on PostgreSQL.
    conn = op.get_bind()
    if _is_pg(conn):
        with op.get_context().autocommit_block():
            op.drop_index(
                _INDEX_NAME,
                table_name=_INDEX_TABLE,
                postgresql_concurrently=True,
            )
            op.create_index(
                _INDEX_NAME,
                _INDEX_TABLE,
                _INDEX_COLUMNS,
                postgresql_concurrently=True,
            )
    else:
        op.drop_index(_INDEX_NAME, table_name=_INDEX_TABLE)
        op.create_index(_INDEX_NAME, _INDEX_TABLE, _INDEX_COLUMNS)


def downgrade():
    # Drop the index built by this migration. Going past this downgrade leaves
    # the index defined again by `9f4b7c2d1a80`'s own downgrade step, so the
    # final post-downgrade state is "no index" between the two migrations.
    conn = op.get_bind()
    if _is_pg(conn):
        with op.get_context().autocommit_block():
            op.drop_index(_INDEX_NAME, postgresql_concurrently=True)
    else:
        op.drop_index(_INDEX_NAME, table_name=_INDEX_TABLE)
