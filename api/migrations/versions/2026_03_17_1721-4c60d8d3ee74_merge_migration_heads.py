"""merge migration heads

Revision ID: 4c60d8d3ee74
Revises: fce013ca180e, a1b2c3d4e5f6
Create Date: 2026-03-17 17:21:12.105536

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '4c60d8d3ee74'
down_revision = ('fce013ca180e', 'a1b2c3d4e5f6')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
