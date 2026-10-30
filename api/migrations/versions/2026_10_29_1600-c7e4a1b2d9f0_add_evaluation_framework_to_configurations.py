"""Store the selected evaluation framework on target configurations.

Revision ID: c7e4a1b2d9f0
Revises: c4e8f2a1d703
Create Date: 2026-10-29 16:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "c7e4a1b2d9f0"
down_revision = "c4e8f2a1d703"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "evaluation_configurations",
        sa.Column("evaluation_framework", sa.String(length=20), server_default="ragas", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("evaluation_configurations", "evaluation_framework")
