"""add durable workflow draft coordination

Revision ID: e832a94f210b
Revises: d41e6b8c2a75
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON, StringUUID

revision = "e832a94f210b"
down_revision = "d41e6b8c2a75"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "workflow_draft_coordination",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("workflow_id", StringUUID(), nullable=False),
        sa.Column("workflow_version", sa.String(255), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=True),
        sa.Column("retirement_agent_ids", AdjustedJSON(), nullable=False),
        sa.Column("emit_draft_event", sa.Boolean(), nullable=False),
        sa.Column("available_at", sa.DateTime(), nullable=False),
        sa.Column("claim_token", StringUUID(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="workflow_draft_coordination_pkey"),
        sa.CheckConstraint("attempt_count >= 0", name="workflow_draft_coordination_attempt_count"),
    )
    op.create_index(
        "workflow_draft_coordination_due", "workflow_draft_coordination", ["available_at", "created_at", "id"]
    )
    op.create_index(
        "workflow_draft_coordination_owner",
        "workflow_draft_coordination",
        ["tenant_id", "app_id", "workflow_id", "workflow_version"],
    )


def downgrade():
    op.drop_index("workflow_draft_coordination_owner", table_name="workflow_draft_coordination")
    op.drop_index("workflow_draft_coordination_due", table_name="workflow_draft_coordination")
    op.drop_table("workflow_draft_coordination")
