"""add workflow comments tables

Revision ID: add_workflow_comments_tables
Revises: 1c9ba48be8e4
Create Date: 2025-08-22 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_workflow_comments_tables'
down_revision = '1c9ba48be8e4'
branch_labels: None = None
depends_on: None = None


def upgrade():
    # Create workflow_comments table
    op.create_table(
        'workflow_comments',
        sa.Column('id', postgresql.UUID(), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(), nullable=False),
        sa.Column('app_id', postgresql.UUID(), nullable=False),
        sa.Column('node_id', sa.String(length=255), nullable=True),
        sa.Column('position_x', sa.Float(), nullable=True),
        sa.Column('position_y', sa.Float(), nullable=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_by', postgresql.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('resolved', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.Column('resolved_by', postgresql.UUID(), nullable=True),
        sa.PrimaryKeyConstraint('id', name='workflow_comments_pkey')
    )
    
    # Create indexes for workflow_comments
    op.create_index('workflow_comments_app_idx', 'workflow_comments', ['tenant_id', 'app_id'])
    op.create_index('workflow_comments_node_idx', 'workflow_comments', ['tenant_id', 'node_id'])
    op.create_index('workflow_comments_created_at_idx', 'workflow_comments', ['created_at'])
    
    # Create workflow_comment_replies table
    op.create_table(
        'workflow_comment_replies',
        sa.Column('id', postgresql.UUID(), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('comment_id', postgresql.UUID(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_by', postgresql.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['comment_id'], ['workflow_comments.id'], name='workflow_comment_replies_comment_id_fkey', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name='workflow_comment_replies_pkey')
    )
    
    # Create indexes for workflow_comment_replies
    op.create_index('comment_replies_comment_idx', 'workflow_comment_replies', ['comment_id'])
    op.create_index('comment_replies_created_at_idx', 'workflow_comment_replies', ['created_at'])
    
    # Create workflow_comment_mentions table
    op.create_table(
        'workflow_comment_mentions',
        sa.Column('id', postgresql.UUID(), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('comment_id', postgresql.UUID(), nullable=False),
        sa.Column('mentioned_user_id', postgresql.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['comment_id'], ['workflow_comments.id'], name='workflow_comment_mentions_comment_id_fkey', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name='workflow_comment_mentions_pkey')
    )
    
    # Create indexes for workflow_comment_mentions
    op.create_index('comment_mentions_comment_idx', 'workflow_comment_mentions', ['comment_id'])
    op.create_index('comment_mentions_user_idx', 'workflow_comment_mentions', ['mentioned_user_id'])


def downgrade():
    # Drop tables in reverse order due to foreign key constraints
    op.drop_table('workflow_comment_mentions')
    op.drop_table('workflow_comment_replies')
    op.drop_table('workflow_comments')