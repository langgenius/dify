"""merge workflow output schema and workflow pause model

Revision ID: 290e199c7678
Revises: 
Create Date: 2025-11-06 10:05:15.772142

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '290e199c7678'
down_revision = ('528502a5e3c8', '03f8dcbc611e')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
