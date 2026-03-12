"""merge alembic heads after upstream sync

Revision ID: 9fb5117d4acc
Revises: 4ed66d605346, e288952f2994
Create Date: 2026-03-12 23:18:12.891006

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9fb5117d4acc'
down_revision = ('4ed66d605346', 'e288952f2994')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
