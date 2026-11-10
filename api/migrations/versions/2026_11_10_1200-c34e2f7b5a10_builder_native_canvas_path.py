"""Save the Builder Native Test canvas path on the execution request.

Revision ID: c34e2f7b5a10
Revises: 7d95a2e61346
Create Date: 2026-11-10 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON

revision = "c34e2f7b5a10"
down_revision = "7d95a2e61346"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the nullable path or adopt the column already installed on local PostgreSQL."""
    op.add_column(
        "dify_builder_execution_requests",
        sa.Column("canvas_path", AdjustedJSON(), nullable=True),
        if_not_exists=op.get_context().dialect.name == "postgresql",
    )


def downgrade() -> None:
    """Remove the display snapshot without altering the execution evidence."""
    with op.batch_alter_table("dify_builder_execution_requests") as batch_op:
        batch_op.drop_column("canvas_path")
