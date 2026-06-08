"""add tenant account join last opened at

Revision ID: b7c2d9e8a1f4
Revises: 2b3c4d5e6f70
Create Date: 2026-06-05 11:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b7c2d9e8a1f4"
down_revision = "2b3c4d5e6f70"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("tenant_account_joins", schema=None) as batch_op:
        batch_op.add_column(sa.Column("last_opened_at", sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table("tenant_account_joins", schema=None) as batch_op:
        batch_op.drop_column("last_opened_at")
