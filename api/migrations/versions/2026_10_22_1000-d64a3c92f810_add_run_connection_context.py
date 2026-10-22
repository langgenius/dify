"""Persist secret-free Connection selections on workflow runs.

Revision ID: d64a3c92f810
Revises: c91e4a7b2d60
Create Date: 2026-10-22 10:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import LongText

revision = "d64a3c92f810"
down_revision = "c91e4a7b2d60"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workflow_runs", sa.Column("connection_context", LongText(), nullable=True))


def downgrade() -> None:
    op.drop_column("workflow_runs", "connection_context")
