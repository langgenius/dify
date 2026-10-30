"""Fence Builder commands across conversations for the same workflow.

Revision ID: 5b73e0c8f124
Revises: 4a62d9b7e013
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "5b73e0c8f124"
down_revision = "4a62d9b7e013"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "dify_builder_workflow_writers",
        sa.Column("tenant_id", StringUUID, nullable=False),
        sa.Column("app_id", StringUUID, nullable=False),
        sa.Column("session_id", StringUUID, nullable=False),
        sa.Column("token", sa.String(255), nullable=False),
        sa.Column("generation", sa.Integer, nullable=False),
        sa.Column("expires_at", sa.DateTime, nullable=False),
        sa.PrimaryKeyConstraint("tenant_id", "app_id", name="builder_workflow_writer_pkey"),
    )
    op.create_index("builder_workflow_writer_session_idx", "dify_builder_workflow_writers", ["session_id"])


def downgrade():
    op.drop_index("builder_workflow_writer_session_idx", table_name="dify_builder_workflow_writers")
    op.drop_table("dify_builder_workflow_writers")
