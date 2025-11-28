"""merge workflow performance and main branches

Revision ID: merge_workflow_perf
Revises: cf8f4fc45278, a91b476a53de
Create Date: 2024-11-28 09:00:00.000000

Merges the workflow performance analytics feature branch with main.
- cf8f4fc45278: exceptions_count field (from main)
- a91b476a53de: workflow_runs total_tokens changes (from feature branch)
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
