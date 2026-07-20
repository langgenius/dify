"""add conversation_id to human_input_forms for agent v2 chat hitl

Revision ID: d2f1a4b8c3e0
Revises: c167a72a00eb
Create Date: 2026-06-15 11:10:00.000000

"""
from alembic import op
import models as models
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd2f1a4b8c3e0'
down_revision = 'c167a72a00eb'
branch_labels = None
depends_on = None


def upgrade():
    # ENG-635: Agent v2 chat ask_human forms are owned by a conversation turn
    # instead of a workflow run (the new Agent App has no workflow_run_id).
    # Nullable; existing workflow-owned forms keep conversation_id NULL.
    with op.batch_alter_table('human_input_forms', schema=None) as batch_op:
        batch_op.add_column(sa.Column('conversation_id', models.types.StringUUID(), nullable=True))


def downgrade():
    with op.batch_alter_table('human_input_forms', schema=None) as batch_op:
        batch_op.drop_column('conversation_id')
