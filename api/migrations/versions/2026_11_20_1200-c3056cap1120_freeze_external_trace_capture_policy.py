"""Freeze per-gate external trace capture policy without backfilling history.

Revision ID: c3056cap1120
Revises: c3025dflt1112
Create Date: 2026-11-20
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON

revision = "c3056cap1120"
down_revision = "c3025dflt1112"
branch_labels = None
depends_on = None


def upgrade():
    """Add nullable portable evidence; old targets and payloads remain untouched."""
    op.add_column("external_agent_trace_targets", sa.Column("capture_policy", AdjustedJSON(), nullable=True))


def downgrade():
    """Remove only this evidence column; preserve existing target permissions."""
    op.drop_column("external_agent_trace_targets", "capture_policy")
