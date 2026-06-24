"""add input placeholder to sites

Revision ID: e4b5c6d7a8f9
Revises: c8f4a6b2d3e1
Create Date: 2026-06-24 17:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e4b5c6d7a8f9"
down_revision = "c8f4a6b2d3e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sites", schema=None) as batch_op:
        batch_op.add_column(sa.Column("input_placeholder", sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sites", schema=None) as batch_op:
        batch_op.drop_column("input_placeholder")
