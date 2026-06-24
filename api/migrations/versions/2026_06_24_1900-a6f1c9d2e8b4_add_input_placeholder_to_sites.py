"""add input placeholder to sites

Revision ID: a6f1c9d2e8b4
Revises: d9e8f7a6b5c4
Create Date: 2026-06-24 19:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a6f1c9d2e8b4"
down_revision = "d9e8f7a6b5c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sites", schema=None) as batch_op:
        batch_op.add_column(sa.Column("input_placeholder", sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sites", schema=None) as batch_op:
        batch_op.drop_column("input_placeholder")
