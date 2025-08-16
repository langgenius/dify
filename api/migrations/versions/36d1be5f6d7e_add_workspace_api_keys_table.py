"""add workspace api keys table

Revision ID: 36d1be5f6d7e
Revises: 532b3f888abf
Create Date: 2025-08-06 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '36d1be5f6d7e'
down_revision = '532b3f888abf'
branch_labels = None
depends_on = None


def upgrade():
    # Create workspace_api_keys table
    op.create_table(
        'workspace_api_keys',
        sa.Column('id', postgresql.UUID(as_uuid=False), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('token', sa.String(255), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('scopes', sa.Text, nullable=False),
        sa.Column('expires_at', sa.DateTime, nullable=True),
        sa.Column('last_used_at', sa.DateTime, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.current_timestamp()),
        sa.PrimaryKeyConstraint('id', name='workspace_api_key_pkey')
    )
    
    # Create indexes
    op.create_index('workspace_api_key_token_idx', 'workspace_api_keys', ['token'])
    op.create_index('workspace_api_key_tenant_idx', 'workspace_api_keys', ['tenant_id'])


def downgrade():
    # Drop indexes
    op.drop_index('workspace_api_key_token_idx', table_name='workspace_api_keys')
    op.drop_index('workspace_api_key_tenant_idx', table_name='workspace_api_keys')
    
    # Drop table
    op.drop_table('workspace_api_keys')
