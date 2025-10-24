"""merge multiple heads

Revision ID: 323032355f31
Revises: 68519ad5cd18, 2a3aebbbf4bb, b69ca54b9208
Create Date: 2025-10-23 12:36:27.703402

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '323032355f31'
down_revision = ('68519ad5cd18', '2a3aebbbf4bb', 'b69ca54b9208')
branch_labels = None
depends_on = None


def upgrade():
    # This is a merge migration, no actual schema changes
    pass


def downgrade():
    # This is a merge migration, no actual schema changes
    pass
