"""add agent llm invocation ledger

Revision ID: 39f8d6c14a21
Revises: e4708db55c1d
Create Date: 2026-08-12 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

revision = "39f8d6c14a21"
down_revision = "e4708db55c1d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_llm_invocations",
        sa.Column("invocation_id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_run_id", models.types.StringUUID(), nullable=False),
        sa.Column("call_index", sa.Integer(), nullable=False),
        sa.Column("agent_mode", sa.String(length=32), nullable=False),
        sa.Column("invoke_from", sa.String(length=32), nullable=False),
        sa.Column("user_id", models.types.StringUUID(), nullable=False),
        sa.Column("user_from", sa.String(length=16), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("workflow_id", models.types.StringUUID(), nullable=True),
        sa.Column("workflow_run_id", models.types.StringUUID(), nullable=True),
        sa.Column("node_id", sa.String(length=255), nullable=True),
        sa.Column("node_execution_id", sa.String(length=255), nullable=True),
        sa.Column("conversation_id", models.types.StringUUID(), nullable=True),
        sa.Column("agent_id", models.types.StringUUID(), nullable=True),
        sa.Column("agent_config_version_id", models.types.StringUUID(), nullable=True),
        sa.Column("agent_config_version_kind", sa.String(length=16), nullable=True),
        sa.Column("trace_id", sa.String(length=255), nullable=True),
        sa.Column("provider", sa.String(length=255), nullable=False),
        sa.Column("model", sa.String(length=255), nullable=False),
        sa.Column("credential_source", sa.String(length=16), nullable=False),
        sa.Column("quota_type", sa.String(length=32), nullable=True),
        sa.Column("pool_type", sa.String(length=32), nullable=True),
        sa.Column("credits", sa.Integer(), server_default="0", nullable=False),
        sa.Column("billing_status", sa.String(length=24), server_default="pending", nullable=False),
        sa.Column("execution_status", sa.String(length=16), server_default="prepared", nullable=False),
        sa.Column("usage", models.types.LongText(), nullable=True),
        sa.Column("error_type", sa.String(length=255), nullable=True),
        sa.Column("error_message", models.types.LongText(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("agent_llm_invocation_pkey")),
        sa.UniqueConstraint("invocation_id", name=op.f("agent_llm_invocation_id_unique")),
        sa.UniqueConstraint("agent_run_id", "call_index", name=op.f("agent_llm_invocation_run_call_unique")),
    )
    with op.batch_alter_table("agent_llm_invocations", schema=None) as batch_op:
        batch_op.create_index("agent_llm_invocation_billing_status_idx", ["billing_status", "updated_at"], unique=False)
        batch_op.create_index(
            "agent_llm_invocation_execution_status_idx", ["execution_status", "updated_at"], unique=False
        )
        batch_op.create_index("agent_llm_invocation_tenant_created_idx", ["tenant_id", "created_at"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("agent_llm_invocations", schema=None) as batch_op:
        batch_op.drop_index("agent_llm_invocation_tenant_created_idx")
        batch_op.drop_index("agent_llm_invocation_execution_status_idx")
        batch_op.drop_index("agent_llm_invocation_billing_status_idx")
    op.drop_table("agent_llm_invocations")
