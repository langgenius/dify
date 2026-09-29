"""Record the latest committed full-draft replacement on workflows.

Revision ID: b5d4e6f70a21
Revises: e7b2a9c4d601
Create Date: 2026-09-28 12:00:00
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "b5d4e6f70a21"
down_revision = "e7b2a9c4d601"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("workflows", sa.Column("last_replacement_id", StringUUID(), nullable=True))


def downgrade():
    op.drop_column("workflows", "last_replacement_id")
