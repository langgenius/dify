"""Add generative_ui column to app_model_configs.

Revision ID: 3a9f7d1c4e20
Revises: f8b6e2c4a901
Create Date: 2026-11-23 14:10:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import LongText

revision = "3a9f7d1c4e20"
down_revision = "f8b6e2c4a901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add nullable generative_ui JSON text column for Chatbot feature persistence."""
    with op.batch_alter_table("app_model_configs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("generative_ui", LongText(), nullable=True))


def downgrade() -> None:
    """Remove generative_ui column from app_model_configs."""
    with op.batch_alter_table("app_model_configs", schema=None) as batch_op:
        batch_op.drop_column("generative_ui")
