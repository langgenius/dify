"""add qdrant_endpoint to tidb_auth_bindings

Revision ID: 8574b23a38fd
Revises: 6b5f9f8b1a2c
Create Date: 2026-04-14 15:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "8574b23a38fd"
down_revision = "6b5f9f8b1a2c"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("tidb_auth_bindings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("qdrant_endpoint", sa.String(length=512), nullable=True))


def downgrade():
    with op.batch_alter_table("tidb_auth_bindings", schema=None) as batch_op:
        batch_op.drop_column("qdrant_endpoint")
