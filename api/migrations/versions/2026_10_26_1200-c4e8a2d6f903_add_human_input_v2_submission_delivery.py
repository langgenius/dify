"""Record the authenticated delivery for Human Input v2 submissions.

Revision ID: c4e8a2d6f903
Revises: f4a6c8e0b2d5
Create Date: 2026-10-26 12:00:00
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "c4e8a2d6f903"
down_revision = "f4a6c8e0b2d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hitlv2_forms", sa.Column("submitted_by_delivery_id", StringUUID(), nullable=True))


def downgrade() -> None:
    op.drop_column("hitlv2_forms", "submitted_by_delivery_id")
