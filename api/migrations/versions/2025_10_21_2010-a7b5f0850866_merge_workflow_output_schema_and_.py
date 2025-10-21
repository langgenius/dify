"""merge workflow output schema and builtin template user removal

Revision ID: a7b5f0850866
Revises: 
Create Date: 2025-10-21 20:10:03.928853

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a7b5f0850866'
down_revision = ('528502a5e3c8', 'ae662b25d9bc')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
