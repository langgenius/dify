"""add agent debug conversation id

Revision ID: c8f4a6b2d3e1
Revises: b2515f9d4c2a
Create Date: 2026-06-22 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "c8f4a6b2d3e1"
down_revision = "b2515f9d4c2a"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.add_column(sa.Column("debug_conversation_id", models.types.StringUUID(), nullable=True))
        batch_op.create_index("agent_debug_conversation_id_idx", ["debug_conversation_id"], unique=False)


def downgrade():
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.drop_index("agent_debug_conversation_id_idx")
        batch_op.drop_column("debug_conversation_id")
