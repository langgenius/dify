"""add agent active config has model

Revision ID: 9f4b7c2d1a80
Revises: 0b2f2c8a9d1e
Create Date: 2026-06-12 16:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "9f4b7c2d1a80"
down_revision = "0b2f2c8a9d1e"
branch_labels = None
depends_on = None


def _is_pg(conn) -> bool:
    return conn.dialect.name == "postgresql"


def upgrade():
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "active_config_has_model",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
            )
        )

    # `CREATE INDEX CONCURRENTLY` cannot run within a transaction; wrap it in
    # `autocommit_block` on PostgreSQL so the composite index is built without
    # blocking concurrent INSERT/UPDATE/DELETE on the hot `agents` table.
    # The `agents` table is written to on every Agent v2 chat turn, so a SHARE
    # lock here would stall the entire Agent v2 surface area for the full
    # index-build duration. See migration 4474872b0ee6 for the established
    # pattern in this codebase.
    conn = op.get_bind()
    if _is_pg(conn):
        with op.get_context().autocommit_block():
            op.create_index(
                "agent_tenant_invitable_idx",
                "agents",
                ["tenant_id", "scope", "status", "active_config_has_model", "updated_at"],
                postgresql_concurrently=True,
            )
    else:
        op.create_index(
            "agent_tenant_invitable_idx",
            "agents",
            ["tenant_id", "scope", "status", "active_config_has_model", "updated_at"],
        )


def downgrade():
    conn = op.get_bind()
    if _is_pg(conn):
        with op.get_context().autocommit_block():
            op.drop_index("agent_tenant_invitable_idx", postgresql_concurrently=True)
    else:
        op.drop_index("agent_tenant_invitable_idx", table_name="agents")

    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.drop_column("active_config_has_model")
