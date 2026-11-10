"""Persist a collaborative draft's Loro history alongside its graph."""

import sqlalchemy as sa
from alembic import op

from models.types import BinaryData, StringUUID

revision = "c6d2d8bc881f"
down_revision = "6b7e2a9c4d10"
branch_labels = None
depends_on = None


def upgrade():
    """Add nullable draft columns; existing workflows require no backfill."""
    with op.batch_alter_table("workflows") as batch:
        batch.add_column(sa.Column("loro_draft_epoch", StringUUID(), nullable=True))
        batch.add_column(sa.Column("loro_draft_snapshot", BinaryData(), nullable=True))


def downgrade():
    """Remove Loro history; retain the committed JSON graph."""
    with op.batch_alter_table("workflows") as batch:
        batch.drop_column("loro_draft_snapshot")
        batch.drop_column("loro_draft_epoch")
