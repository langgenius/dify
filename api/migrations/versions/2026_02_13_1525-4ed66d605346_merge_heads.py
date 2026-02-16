"""merge_heads

Revision ID: 4ed66d605346
Revises: 1e106b23897d, fce013ca180e
Create Date: 2026-02-13 15:25:55.987725

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '4ed66d605346'
down_revision = ('1e106b23897d', 'fce013ca180e')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
