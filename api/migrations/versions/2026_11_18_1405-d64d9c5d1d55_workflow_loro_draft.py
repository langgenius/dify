"""Persist a collaborative draft's Loro history alongside its graph.

Revision ID: d64d9c5d1d55
Revises: f8b6e2c4a901
Create Date: 2026-11-18 14:05:22
"""

import sqlalchemy as sa
from alembic import op

from models.types import BinaryData, StringUUID

revision = "d64d9c5d1d55"
down_revision = "f8b6e2c4a901"
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
