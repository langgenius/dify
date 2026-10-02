"""add default_user_icon fields for site

Revision ID: f1a2b3c4d5e6
Revises: c3f1a9b2e6d4
Create Date: 2026-10-01 12:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f1a2b3c4d5e6"
down_revision = "c3f1a9b2e6d4"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("sites", schema=None) as batch_op:
        batch_op.add_column(sa.Column("default_user_icon_type", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("default_user_icon", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("default_user_icon_background", sa.String(length=255), nullable=True))


def downgrade():
    with op.batch_alter_table("sites", schema=None) as batch_op:
        batch_op.drop_column("default_user_icon_background")
        batch_op.drop_column("default_user_icon")
        batch_op.drop_column("default_user_icon_type")
