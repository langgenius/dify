"""merge workflow output schema and message app mode migrations

Revision ID: a7595d22aae0
Revises: 
Create Date: 2025-10-21 14:26:01.054802

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a7595d22aae0'
down_revision = ('528502a5e3c8', 'd98acf217d43')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
