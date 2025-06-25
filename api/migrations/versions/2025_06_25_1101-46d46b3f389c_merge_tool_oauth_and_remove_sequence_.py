"""merge tool oauth and remove sequence number branches

Revision ID: 46d46b3f389c
Revises: 0ab65e1cc7fa, 71f5020c6470
Create Date: 2025-06-25 11:01:55.215896

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '46d46b3f389c'
down_revision = ('0ab65e1cc7fa', '71f5020c6470')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
