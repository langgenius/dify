"""Persist explicit Fix intake independently from running task commits.

Revision ID: 6c84f1d90235
Revises: 5b73e0c8f124
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON, StringUUID

revision = "6c84f1d90235"
down_revision = "5b73e0c8f124"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("dify_builder_runs", sa.Column("origin_task_id", sa.String(255), nullable=True))
    op.create_table(
        "dify_builder_fix_intents",
        sa.Column("id", StringUUID, nullable=False),
        sa.Column("tenant_id", StringUUID, nullable=False),
        sa.Column("owner_account_id", StringUUID, nullable=False),
        sa.Column("app_id", StringUUID, nullable=False),
        sa.Column("session_id", StringUUID, nullable=False),
        sa.Column("target_task_id", sa.String(255), nullable=False),
        sa.Column("client_action_id", sa.String(128), nullable=False),
        sa.Column("input_digest", sa.String(64), nullable=False),
        sa.Column("source_digest", sa.String(64), nullable=False),
        sa.Column("source", AdjustedJSON, nullable=False),
        sa.Column("model_config", AdjustedJSON, nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("decision_id", sa.String(128), nullable=True),
        sa.Column("decision_kind", sa.String(32), nullable=True),
        sa.Column("enqueue", sa.String(16), nullable=False),
        sa.Column("command_id", StringUUID, nullable=True),
        sa.Column("activated_version", sa.Integer, nullable=True),
        sa.Column("response", AdjustedJSON, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.current_timestamp()),
        sa.PrimaryKeyConstraint("id", name="dify_builder_fix_intent_pkey"),
        sa.UniqueConstraint("session_id", "client_action_id", name="builder_fix_intent_action_unique"),
        sa.UniqueConstraint("session_id", "decision_id", name="builder_fix_intent_decision_unique"),
    )
    op.create_index(
        "builder_fix_intent_owner_idx",
        "dify_builder_fix_intents",
        ["tenant_id", "owner_account_id", "app_id", "session_id"],
    )


def downgrade():
    op.drop_index("builder_fix_intent_owner_idx", table_name="dify_builder_fix_intents")
    op.drop_table("dify_builder_fix_intents")
    op.drop_column("dify_builder_runs", "origin_task_id")
