"""Add the Loro epoch and snapshot to workflow drafts.

Revision ID: d64d9c5d1d55
Revises: f8b6e2c4a901
Create Date: 2026-11-25 13:04:28.624529

"""

import sqlalchemy as sa
from alembic import op

from models.types import BinaryData, StringUUID

revision = "d64d9c5d1d55"
down_revision = "f8b6e2c4a901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Leave existing drafts ready to initialize their Loro history on first sync."""
    with op.batch_alter_table("workflows", schema=None) as batch_op:
        batch_op.add_column(sa.Column("loro_draft_epoch", StringUUID(), nullable=True))
        batch_op.add_column(sa.Column("loro_draft_snapshot", BinaryData(), nullable=True))


def downgrade() -> None:
    """Keep the saved workflow graph when removing the Loro fields."""
    with op.batch_alter_table("workflows", schema=None) as batch_op:
        batch_op.drop_column("loro_draft_snapshot")
        batch_op.drop_column("loro_draft_epoch")
