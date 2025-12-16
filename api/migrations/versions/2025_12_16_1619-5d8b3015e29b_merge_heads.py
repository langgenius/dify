"""merge heads

Revision ID: 5d8b3015e29b
Revises: d57accd375ae, 2536f83803a8
Create Date: 2025-12-16 16:19:09.076002

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '5d8b3015e29b'
down_revision = ('d57accd375ae', '2536f83803a8')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
