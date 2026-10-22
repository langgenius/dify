"""Add durable application tracing collection and delivery state.

Revision ID: a17c2980f3e6
Revises: f1d3c5b7a902
Create Date: 2026-10-15 03:30:00
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "a17c2980f3e6"
down_revision = "f1d3c5b7a902"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "application_trace_runs",
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("source_kind", sa.String(16), nullable=False),
        sa.Column("source_id", StringUUID(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("config_revision", sa.String(64), nullable=False),
        sa.Column("provider_config", sa.JSON(), nullable=False),
        sa.Column("trace_id", sa.String(32), nullable=False),
        sa.Column("root_span_id", sa.String(16), nullable=False),
        sa.Column("session_id", sa.String(255), nullable=False),
        sa.Column("capture_content", sa.Boolean(), nullable=False),
        sa.Column("capture_agent", sa.Boolean(), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("outer_trace", sa.JSON(), nullable=True),
        sa.Column("span_count", sa.Integer(), nullable=False),
        sa.Column("payload_bytes", sa.BigInteger(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(96), nullable=True),
        sa.Column("trace_url", sa.Text(), nullable=True),
        sa.Column("provider_trace_id", sa.String(255), nullable=True),
        sa.Column("span_urls", sa.JSON(), nullable=False),
        sa.Column("export_token", StringUUID(), nullable=True),
        sa.Column("export_started_at", sa.DateTime(), nullable=True),
        sa.Column("export_heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column("terminal_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("tenant_id", "app_id", "source_kind", "source_id", name="application_trace_source_unique"),
    )
    op.create_index("application_trace_delivery_idx", "application_trace_runs", ["state", "next_attempt_at"])
    op.create_index("application_trace_retention_idx", "application_trace_runs", ["created_at"])
    op.create_table(
        "application_trace_invocations",
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("run_id", StringUUID(), nullable=False),
        sa.Column("agent_id", StringUUID(), nullable=False),
        sa.Column("parent_span_id", sa.String(16), nullable=False),
        sa.Column("span_id", sa.String(16), nullable=False),
        sa.Column("node_execution_id", StringUUID(), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("finalized", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("finalized_at", sa.DateTime(), nullable=True),
    )
    op.create_index("application_trace_invocation_run_idx", "application_trace_invocations", ["run_id"])
    op.create_table(
        "application_trace_batches",
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("run_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", StringUUID(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("spans", sa.JSON(), nullable=False),
        sa.Column("final", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("application_trace_batch_run_idx", "application_trace_batches", ["run_id", "created_at"])


def downgrade() -> None:
    op.drop_table("application_trace_batches")
    op.drop_table("application_trace_invocations")
    op.drop_table("application_trace_runs")
