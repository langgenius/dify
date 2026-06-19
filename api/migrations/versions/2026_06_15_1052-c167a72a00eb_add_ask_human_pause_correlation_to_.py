"""add ask_human pause correlation to agent_runtime_sessions

Revision ID: c167a72a00eb
Revises: c4d5e6f7a8b9
Create Date: 2026-06-15 10:52:15.736666

"""
from alembic import op
import models as models
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c167a72a00eb'
down_revision = 'c4d5e6f7a8b9'
branch_labels = None
depends_on = None


def upgrade():
    # ENG-637: correlate a paused dify.ask_human session to its awaiting HITL
    # form and the deferred tool_call id, so the resumed Agent node can rebuild
    # deferred_tool_results from the submitted form. Both columns are nullable
    # and NULL whenever the session is not paused on human input.
    with op.batch_alter_table('agent_runtime_sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('pending_form_id', models.types.StringUUID(), nullable=True))
        batch_op.add_column(sa.Column('pending_tool_call_id', sa.String(length=255), nullable=True))


def downgrade():
    with op.batch_alter_table('agent_runtime_sessions', schema=None) as batch_op:
        batch_op.drop_column('pending_tool_call_id')
        batch_op.drop_column('pending_form_id')
