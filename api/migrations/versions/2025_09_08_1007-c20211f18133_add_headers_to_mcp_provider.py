"""add_headers_to_mcp_provider

Revision ID: c20211f18133
Revises: 8d289573e1da
Create Date: 2025-08-29 10:07:54.163626

"""
from alembic import op
import models as models


def _is_pg(conn):
    return conn.dialect.name == "postgresql"
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c20211f18133'
down_revision = 'b95962a3885c'
branch_labels = None
depends_on = None


def upgrade():
    # Add encrypted_headers column to tool_mcp_providers table
    conn = op.get_bind()
    
    if _is_pg(conn):
        op.add_column('tool_mcp_providers', sa.Column('encrypted_headers', sa.Text(), nullable=True))
    else:
        op.add_column('tool_mcp_providers', sa.Column('encrypted_headers', models.types.LongText(), nullable=True))
    

def downgrade():
    # Remove encrypted_headers column from tool_mcp_providers table
    op.drop_column('tool_mcp_providers', 'encrypted_headers')
