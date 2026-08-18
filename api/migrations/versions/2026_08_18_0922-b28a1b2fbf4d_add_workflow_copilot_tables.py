"""add workflow copilot tables

Revision ID: b28a1b2fbf4d
Revises: e4708db55c1d
Create Date: 2026-08-18 09:22:44.765467

"""

from alembic import op
import models as models
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b28a1b2fbf4d"
down_revision = "e4708db55c1d"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "workflow_copilot_sessions",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("owner_account_id", models.types.StringUUID(), nullable=False),
        sa.Column("entry_mode", sa.String(length=50), nullable=False),
        sa.Column("current_state", sa.String(length=50), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_session_pkey"),
    )
    op.create_index("workflow_copilot_session_tenant_idx", "workflow_copilot_sessions", ["tenant_id"])
    op.create_index("workflow_copilot_session_app_idx", "workflow_copilot_sessions", ["app_id"])

    op.create_table(
        "workflow_copilot_session_commits",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("session_id", models.types.StringUUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(length=50), nullable=False),
        sa.Column("context", models.types.AdjustedJSON(), nullable=False),
        sa.Column("actor", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_session_commit_pkey"),
    )
    op.create_index(
        "workflow_copilot_session_commit_session_idx", "workflow_copilot_session_commits", ["session_id"]
    )

    op.create_table(
        "workflow_copilot_snapshots",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("session_id", models.types.StringUUID(), nullable=False),
        sa.Column("hash", sa.String(length=255), nullable=False),
        sa.Column("graph", models.types.AdjustedJSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_snapshot_pkey"),
    )
    op.create_index("workflow_copilot_snapshot_session_idx", "workflow_copilot_snapshots", ["session_id"])

    op.create_table(
        "workflow_copilot_checkpoints",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("session_id", models.types.StringUUID(), nullable=False),
        sa.Column("state", sa.String(length=50), nullable=False),
        sa.Column("snapshot_id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_checkpoint_pkey"),
    )
    op.create_index("workflow_copilot_checkpoint_session_idx", "workflow_copilot_checkpoints", ["session_id"])

    op.create_table(
        "workflow_copilot_runs",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("session_id", models.types.StringUUID(), nullable=False),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("dify_run_id", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("per_node", models.types.AdjustedJSON(), nullable=True),
        sa.Column("culprit_node_id", sa.String(length=255), nullable=True),
        sa.Column("inputs_ref", sa.String(length=255), nullable=True),
        sa.Column("tokens", sa.Integer(), nullable=True),
        sa.Column("elapsed_ms", sa.Integer(), nullable=True),
        sa.Column("immutable", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_run_pkey"),
    )
    op.create_index("workflow_copilot_run_session_idx", "workflow_copilot_runs", ["session_id"])

    op.create_table(
        "workflow_copilot_conversation_items",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("session_id", models.types.StringUUID(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("payload", models.types.AdjustedJSON(), nullable=False),
        sa.Column("at_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_conversation_item_pkey"),
        sa.UniqueConstraint("session_id", "seq", name="workflow_copilot_conversation_item_session_seq_key"),
    )
    op.create_index(
        "workflow_copilot_conversation_item_session_idx", "workflow_copilot_conversation_items", ["session_id"]
    )

    op.create_table(
        "workflow_copilot_test_inputs",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("session_id", models.types.StringUUID(), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("inputs", models.types.AdjustedJSON(), nullable=False),
        sa.Column("start_schema_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_test_input_pkey"),
    )
    op.create_index("workflow_copilot_test_input_session_idx", "workflow_copilot_test_inputs", ["session_id"])


def downgrade():
    op.drop_index("workflow_copilot_test_input_session_idx", table_name="workflow_copilot_test_inputs")
    op.drop_table("workflow_copilot_test_inputs")

    op.drop_index(
        "workflow_copilot_conversation_item_session_idx", table_name="workflow_copilot_conversation_items"
    )
    op.drop_table("workflow_copilot_conversation_items")

    op.drop_index("workflow_copilot_run_session_idx", table_name="workflow_copilot_runs")
    op.drop_table("workflow_copilot_runs")

    op.drop_index("workflow_copilot_checkpoint_session_idx", table_name="workflow_copilot_checkpoints")
    op.drop_table("workflow_copilot_checkpoints")

    op.drop_index("workflow_copilot_snapshot_session_idx", table_name="workflow_copilot_snapshots")
    op.drop_table("workflow_copilot_snapshots")

    op.drop_index("workflow_copilot_session_commit_session_idx", table_name="workflow_copilot_session_commits")
    op.drop_table("workflow_copilot_session_commits")

    op.drop_index("workflow_copilot_session_app_idx", table_name="workflow_copilot_sessions")
    op.drop_index("workflow_copilot_session_tenant_idx", table_name="workflow_copilot_sessions")
    op.drop_table("workflow_copilot_sessions")
