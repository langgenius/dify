"""add chat_theme_mode field for site

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-10-06 12:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a7b8c9d0e1f2"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("sites", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("chat_theme_mode", sa.String(length=10), server_default=sa.text("'auto'"), nullable=False)
        )


def downgrade():
    with op.batch_alter_table("sites", schema=None) as batch_op:
        batch_op.drop_column("chat_theme_mode")
