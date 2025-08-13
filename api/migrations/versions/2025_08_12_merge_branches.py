"""merge branches

Revision ID: merge_branches_2025_08_12
Revises: 398394623b7b, fa8b0fa6f407
Create Date: 2025-08-12 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'merge_branches_2025_08_12'
down_revision = ('398394623b7b', 'fa8b0fa6f407')
branch_labels = None
depends_on = None


def upgrade():
    # This is a merge migration - no changes needed
    pass


def downgrade():
    # This is a merge migration - no changes needed
    pass
