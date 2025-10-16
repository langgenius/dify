"""
add encrypted_proxy column to tool_mcp_providers

Revision ID: a1b2c3d4e5f6
Revises: cf7c38a32b2d
Create Date: 2025-10-15 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = 'd98acf217d43'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add encrypted_proxy as nullable TEXT column
    op.add_column('tool_mcp_providers', sa.Column('encrypted_proxy', sa.Text(), nullable=True))


def downgrade() -> None:
    # Drop encrypted_proxy column
    with op.batch_alter_table('tool_mcp_providers') as batch_op:
        batch_op.drop_column('encrypted_proxy')


