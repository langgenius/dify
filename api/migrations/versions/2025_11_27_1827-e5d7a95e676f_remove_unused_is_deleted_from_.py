"""remove unused is_deleted from conversations

Revision ID: e5d7a95e676f
Revises: 7bb281b7a422
Create Date: 2025-11-27 18:27:09.006691

"""
import sqlalchemy as sa
from alembic import op

revision = "e5d7a95e676f"
down_revision = "7bb281b7a422"
branch_labels = None
depends_on = None


def upgrade():
    conversations = sa.table("conversations", sa.column("is_deleted", sa.Boolean))
    op.execute(sa.delete(conversations).where(conversations.c.is_deleted == sa.true()))

    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.drop_column("is_deleted")


def downgrade():
    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("is_deleted", sa.BOOLEAN(), server_default=sa.text("false"), autoincrement=False, nullable=False)
        )
