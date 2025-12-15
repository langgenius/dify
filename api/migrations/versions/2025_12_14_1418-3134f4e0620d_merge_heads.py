"""merge_heads

Revision ID: 3134f4e0620d
Revises: d57accd375ae, a7b4e8f2c9d1
Create Date: 2025-12-14 14:18:19.393720

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '3134f4e0620d'
down_revision = ('d57accd375ae', 'a7b4e8f2c9d1')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
