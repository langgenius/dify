"""update workspace api keys token field to text

Revision ID: af12b34cd567
Revises: 0fa22947e65b
Create Date: 2025-08-07 09:15:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'af12b34cd567'
down_revision = '0fa22947e65b'
branch_labels = None
depends_on = None


def upgrade():
    # Change token column from VARCHAR(255) to TEXT to support encrypted tokens
    op.alter_column(
        'workspace_api_keys',
        'token',
        existing_type=sa.String(255),
        type_=sa.Text,
        nullable=False
    )


def downgrade():
    # Revert back to VARCHAR(255)
    # Warning: This may cause data truncation if encrypted tokens are longer than 255 characters
    op.alter_column(
        'workspace_api_keys',
        'token',
        existing_type=sa.Text,
        type_=sa.String(255),
        nullable=False
    )
