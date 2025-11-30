"""Merge multiple heads: unify workflow migrations

Revision ID: merge_20241128_01
Revises: a1b2c3d4e5f6, a91b476a53de
Create Date: 2024-11-28 10:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'merge_20241128_01'
down_revision = ('a1b2c3d4e5f6', 'a91b476a53de')
branch_labels = None
depends_on = None


def upgrade():
    # Merge-only revision: no DB operations needed.
    pass


def downgrade():
    # No-op: downgrading would re-create the separate heads pre-merge.
    pass
