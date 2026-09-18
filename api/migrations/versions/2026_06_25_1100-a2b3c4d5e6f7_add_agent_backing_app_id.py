"""add agent backing app id

Revision ID: a2b3c4d5e6f7
Revises: e4f5a6b7c8d9
Create Date: 2026-06-25 11:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "a2b3c4d5e6f7"
down_revision = "e4f5a6b7c8d9"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.add_column(sa.Column("backing_app_id", models.types.StringUUID(), nullable=True))
    op.create_index("agent_tenant_backing_app_id_idx", "agents", ["tenant_id", "backing_app_id"])


def downgrade():
    op.drop_index("agent_tenant_backing_app_id_idx", table_name="agents")
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.drop_column("backing_app_id")
