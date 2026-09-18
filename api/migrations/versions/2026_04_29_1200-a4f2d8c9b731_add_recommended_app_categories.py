"""add recommended app categories

Revision ID: a4f2d8c9b731
Revises: 227822d22895
Create Date: 2026-04-29 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a4f2d8c9b731"
down_revision = "227822d22895"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("recommended_apps", schema=None) as batch_op:
        batch_op.add_column(sa.Column("categories", sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table("recommended_apps", schema=None) as batch_op:
        batch_op.drop_column("categories")
