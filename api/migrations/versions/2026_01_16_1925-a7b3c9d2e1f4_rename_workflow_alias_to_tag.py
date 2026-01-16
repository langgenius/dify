"""rename_workflow_alias_to_tag

Revision ID: a7b3c9d2e1f4
Revises: 398394623b7b
Create Date: 2026-01-16 19:25:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'a7b3c9d2e1f4'
down_revision = '398394623b7b'
branch_labels = None
depends_on = None


def upgrade():
    # Rename table from workflow_name_aliases to workflow_name_tags
    op.rename_table('workflow_name_aliases', 'workflow_name_tags')

    # Rename unique constraint from unique_workflow_alias_app_name to unique_workflow_tag_app_name
    op.execute('ALTER TABLE workflow_name_tags RENAME CONSTRAINT unique_workflow_alias_app_name TO unique_workflow_tag_app_name')


def downgrade():
    # Rename unique constraint back to original name
    op.execute('ALTER TABLE workflow_name_tags RENAME CONSTRAINT unique_workflow_tag_app_name TO unique_workflow_alias_app_name')

    # Rename table back to workflow_name_aliases
    op.rename_table('workflow_name_tags', 'workflow_name_aliases')