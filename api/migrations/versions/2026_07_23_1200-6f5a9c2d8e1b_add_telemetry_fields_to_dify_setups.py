"""add telemetry fields to dify_setups

Revision ID: 6f5a9c2d8e1b
Revises: d2825e7b9c10
Create Date: 2026-07-23 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "6f5a9c2d8e1b"
down_revision = "d2825e7b9c10"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("dify_setups", schema=None) as batch_op:
        batch_op.add_column(sa.Column("instance_id", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("install_reported_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("last_heartbeat_at", sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table("dify_setups", schema=None) as batch_op:
        batch_op.drop_column("last_heartbeat_at")
        batch_op.drop_column("install_reported_at")
        batch_op.drop_column("instance_id")
