"""add KnowledgeFS icon background

Revision ID: 4f8b2c7d9e10
Revises: 9d4e6f8a1b2c, 56124e050600
Create Date: 2026-08-17 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "4f8b2c7d9e10"
down_revision = ("9d4e6f8a1b2c", "56124e050600")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "knowledge_fs_control_spaces",
        sa.Column(
            "icon_background",
            sa.String(length=7),
            server_default=sa.text("'#F0F9FF'"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("knowledge_fs_control_spaces", "icon_background")
