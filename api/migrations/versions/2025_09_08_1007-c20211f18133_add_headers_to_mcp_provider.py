"""add_headers_to_mcp_provider

Revision ID: c20211f18133
Revises: 8d289573e1da
Create Date: 2025-08-29 10:07:54.163626

"""
from alembic import op
import models as models
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c20211f18133'
down_revision = 'b95962a3885c'
branch_labels = None
depends_on = None


def upgrade():
    # Add encrypted_headers column to tool_mcp_providers table
    op.add_column('tool_mcp_providers', sa.Column('encrypted_headers', sa.Text(), nullable=True))
    

def downgrade():
    # Remove encrypted_headers column from tool_mcp_providers table
    op.drop_column('tool_mcp_providers', 'encrypted_headers')
