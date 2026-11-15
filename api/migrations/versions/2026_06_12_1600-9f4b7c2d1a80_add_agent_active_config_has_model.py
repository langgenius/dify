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

    op.create_index(
        "agent_tenant_invitable_idx",
        "agents",
        ["tenant_id", "scope", "status", "active_config_has_model", "updated_at"],
    )


def downgrade():
    op.drop_index("agent_tenant_invitable_idx", table_name="agents")
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.drop_column("active_config_has_model")
