"""add workflow agent runtime sessions

Revision ID: 7885bd53f9a9
Revises: d4a5e1f3c9b7
Create Date: 2026-05-27 09:53:54.711805

"""

import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = "7885bd53f9a9"
down_revision = "d4a5e1f3c9b7"
branch_labels = None
depends_on = None


def _is_pg() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _uuid_column(name: str, *, nullable: bool = False, primary_key: bool = False) -> sa.Column:
    """Match the ``uuidv7()`` default that other tables on Postgres rely on,
    while staying portable on MySQL where the ORM supplies the id."""
    kwargs: dict[str, object] = {"nullable": nullable, "primary_key": primary_key}
    if primary_key and _is_pg():
        kwargs["server_default"] = sa.text("uuidv7()")
    return sa.Column(name, models.types.StringUUID(), **kwargs)


def upgrade() -> None:
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
        # MySQL rejects ``server_default`` on TEXT/BLOB columns. The JSON
        # payload is always populated at the ORM layer via
        # ``WorkflowAgentRuntimeSessionStore.save_active_snapshot`` so the
        # missing DB-level default cannot leave new rows uninitialized.
        sa.Column("composition_layer_specs", models.types.LongText(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            server_default=sa.text("'active'"),
            nullable=False,
        ),
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
            unique=False,
        )
        batch_op.create_index(
            "workflow_agent_runtime_session_backend_run_idx",
            ["backend_run_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("workflow_agent_runtime_sessions", schema=None) as batch_op:
        batch_op.drop_index("workflow_agent_runtime_session_backend_run_idx")
        batch_op.drop_index("workflow_agent_runtime_session_lookup_idx")
    op.drop_table("workflow_agent_runtime_sessions")
