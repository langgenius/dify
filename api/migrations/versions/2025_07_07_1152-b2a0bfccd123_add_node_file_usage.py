"""add node_file_usage table

Revision ID: b2a0bfccd123
Revises: 0ab65e1cc7fa
Create Date: 2025-07-07 11:52:00

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'b2a0bfccd123'
down_revision = '1c9ba48be8e4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "node_file_usage",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("node_id", sa.String(length=255), nullable=False, index=True),
        sa.Column("upload_file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"],),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"],),
        sa.ForeignKeyConstraint(["upload_file_id"], ["upload_files.id"],),
    )


def downgrade() -> None:
    op.drop_table("node_file_usage")

