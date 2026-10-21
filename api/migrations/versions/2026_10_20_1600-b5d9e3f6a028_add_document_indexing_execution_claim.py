"""add durable document indexing execution claim

Revision ID: b5d9e3f6a028
Revises: a4c8d2e5f917
Create Date: 2026-10-20 16:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models.types

revision = "b5d9e3f6a028"
down_revision = "a4c8d2e5f917"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("documents", schema=None) as batch_op:
        batch_op.add_column(sa.Column("indexing_execution_id", models.types.StringUUID(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("documents", schema=None) as batch_op:
        batch_op.drop_column("indexing_execution_id")
