"""merge workspace_api_key and other branch

Revision ID: 0fa22947e65b
Revises: 36d1be5f6d7e, 532b3f888abf
Create Date: 2025-08-06 20:43:09.590526

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0fa22947e65b'
down_revision = ('36d1be5f6d7e', '532b3f888abf')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
