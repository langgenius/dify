"""unify agent runtime sessions table

Revision ID: 121e7346074d
Revises: 7885bd53f9a9
Create Date: 2026-05-29 10:54:19.400054

Unifies the workflow-only ``workflow_agent_runtime_sessions`` table into an
owner-agnostic ``agent_runtime_sessions`` table that serves both workflow
Agent Node runs (owner_type=workflow_run) and Agent App conversations
(owner_type=conversation). The feature is unreleased, so the old table is
dropped rather than migrated (no data to preserve).
"""

import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = "121e7346074d"
# Rebased onto main's head after merge: credential-visibility (a1b2c3d4e5f6)
# landed on top of the lifecycle migration (7885bd53f9a9) this one also branched
# from, which created two alembic heads. The two migrations are unrelated, so
# chain this one after the credential migration to restore a single linear head.
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def _is_pg() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _uuid_column(name: str, *, nullable: bool = False, primary_key: bool = False) -> sa.Column:
    kwargs: dict[str, object] = {"nullable": nullable, "primary_key": primary_key}
    if primary_key and _is_pg():
        kwargs["server_default"] = sa.text("uuidv7()")
    return sa.Column(name, models.types.StringUUID(), **kwargs)


def upgrade() -> None:
    # Drop the unreleased workflow-only table; recreate as the unified table.
    op.drop_table("workflow_agent_runtime_sessions")

    op.create_table(
        "agent_runtime_sessions",
        _uuid_column("id", primary_key=True),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("owner_type", sa.String(length=32), nullable=False),
        sa.Column("agent_id", models.types.StringUUID(), nullable=False),
        sa.Column("backend_run_id", sa.String(length=255), nullable=True),
        sa.Column("session_snapshot", models.types.LongText(), nullable=False),
        # Workflow-owner columns (NULL for conversation owner).
        sa.Column("workflow_id", models.types.StringUUID(), nullable=True),
        sa.Column("workflow_run_id", models.types.StringUUID(), nullable=True),
        sa.Column("node_id", sa.String(length=255), nullable=True),
        sa.Column("node_execution_id", sa.String(length=255), nullable=True),
        sa.Column("binding_id", models.types.StringUUID(), nullable=True),
        sa.Column("agent_config_snapshot_id", models.types.StringUUID(), nullable=True),
        # MySQL rejects defaults on TEXT; the ORM always supplies this value.
        sa.Column("composition_layer_specs", models.types.LongText(), nullable=False),
        # Conversation-owner column (NULL for workflow owner). Conversation
        # sessions are also scoped by agent_config_snapshot_id so a Soul version
        # change never resumes an incompatible backend snapshot.
        sa.Column("conversation_id", models.types.StringUUID(), nullable=True),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'active'"), nullable=False),
        sa.Column("cleaned_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("agent_runtime_session_pkey")),
    )
    with op.batch_alter_table("agent_runtime_sessions", schema=None) as batch_op:
        batch_op.create_index(
            "agent_runtime_session_workflow_scope_unique",
            ["tenant_id", "workflow_run_id", "node_id", "binding_id", "agent_id"],
            unique=True,
            postgresql_where=sa.text("workflow_run_id IS NOT NULL"),
        )
        batch_op.create_index(
            "agent_runtime_session_conversation_scope_unique",
            ["tenant_id", "conversation_id", "agent_id", "agent_config_snapshot_id"],
            unique=True,
            postgresql_where=sa.text("conversation_id IS NOT NULL"),
        )
        batch_op.create_index(
            "agent_runtime_session_workflow_lookup_idx",
            ["tenant_id", "workflow_run_id", "node_id", "status"],
        )
        batch_op.create_index(
            "agent_runtime_session_conversation_lookup_idx",
            ["tenant_id", "conversation_id", "status"],
        )
        batch_op.create_index("agent_runtime_session_backend_run_idx", ["backend_run_id"])


def downgrade() -> None:
    with op.batch_alter_table("agent_runtime_sessions", schema=None) as batch_op:
        batch_op.drop_index("agent_runtime_session_backend_run_idx")
        batch_op.drop_index("agent_runtime_session_conversation_lookup_idx")
        batch_op.drop_index("agent_runtime_session_workflow_lookup_idx")
        batch_op.drop_index(
            "agent_runtime_session_conversation_scope_unique",
            postgresql_where=sa.text("conversation_id IS NOT NULL"),
        )
        batch_op.drop_index(
            "agent_runtime_session_workflow_scope_unique",
            postgresql_where=sa.text("workflow_run_id IS NOT NULL"),
        )
    op.drop_table("agent_runtime_sessions")

    op.create_table(
        "workflow_agent_runtime_sessions",
        _uuid_column("id", primary_key=True),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("workflow_id", models.types.StringUUID(), nullable=False),
        sa.Column("workflow_run_id", models.types.StringUUID(), nullable=False),
        sa.Column("node_id", sa.String(length=255), nullable=False),
        sa.Column("node_execution_id", sa.String(length=255), nullable=True),
        sa.Column("binding_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_config_snapshot_id", models.types.StringUUID(), nullable=False),
        sa.Column("backend_run_id", sa.String(length=255), nullable=True),
        sa.Column("session_snapshot", models.types.LongText(), nullable=False),
        sa.Column("composition_layer_specs", models.types.LongText(), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'active'"), nullable=False),
        sa.Column("cleaned_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("workflow_agent_runtime_session_pkey")),
        sa.UniqueConstraint(
            "tenant_id",
            "workflow_run_id",
            "node_id",
            "binding_id",
            "agent_id",
            name=op.f("workflow_agent_runtime_session_scope_unique"),
        ),
    )
    with op.batch_alter_table("workflow_agent_runtime_sessions", schema=None) as batch_op:
        batch_op.create_index(
            "workflow_agent_runtime_session_lookup_idx",
            ["tenant_id", "workflow_run_id", "node_id", "status"],
        )
        batch_op.create_index("workflow_agent_runtime_session_backend_run_idx", ["backend_run_id"])
