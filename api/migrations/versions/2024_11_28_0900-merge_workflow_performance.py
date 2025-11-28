"""merge workflow performance and exceptions count branches

Revision ID: merge_workflow_perf
Revises: cf8f4fc45278, a91b476a53de
Create Date: 2024-11-28 09:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'merge_workflow_perf'
down_revision = ('cf8f4fc45278', 'a91b476a53de')
branch_labels = None
depends_on = None


def upgrade():
    # This is a merge migration, no changes needed
    pass


def downgrade():
    # This is a merge migration, no changes needed
    pass
