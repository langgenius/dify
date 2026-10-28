"""Persist complete agent model messages.

Revision ID: e9c48a2701bd
Revises: b9d3f7a5c102
"""

import sqlalchemy as sa
from alembic import op

import models.types

revision = "e9c48a2701bd"
down_revision = "b9d3f7a5c102"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("message_agent_thoughts", sa.Column("model_messages", models.types.LongText(), nullable=True))


def downgrade():
    op.drop_column("message_agent_thoughts", "model_messages")
