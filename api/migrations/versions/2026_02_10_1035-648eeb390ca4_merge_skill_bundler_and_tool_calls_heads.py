"""merge_skill_bundler_and_tool_calls_heads

Revision ID: 648eeb390ca4
Revises: 201d71cc4f34, 1e106b23897d
Create Date: 2026-02-10 10:35:17.941556

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '648eeb390ca4'
down_revision = ('201d71cc4f34', '1e106b23897d')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
