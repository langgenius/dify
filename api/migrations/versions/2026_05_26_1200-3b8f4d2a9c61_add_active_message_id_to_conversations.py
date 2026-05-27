"""add active_message_id to conversations

Revision ID: 3b8f4d2a9c61
Revises: d4a5e1f3c9b7
Create Date: 2026-05-26 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "3b8f4d2a9c61"
down_revision = "d4a5e1f3c9b7"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.add_column(sa.Column("active_message_id", models.types.StringUUID(), nullable=True))
        batch_op.create_index("conversation_active_message_idx", ["active_message_id"], unique=False)


def downgrade():
    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.drop_index("conversation_active_message_idx")
        batch_op.drop_column("active_message_id")
