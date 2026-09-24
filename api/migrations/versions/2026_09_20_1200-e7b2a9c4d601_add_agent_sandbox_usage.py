"""Add independent sandbox execution accounting.

Revision ID: e7b2a9c4d601
Revises: d8e4a6b1c902
Create Date: 2026-09-20 12:00:00
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "e7b2a9c4d601"
down_revision = "d8e4a6b1c902"
branch_labels = None
depends_on = None


def _identity_columns():
    # UTC timestamps, explicit application values; not runtime measurements.
    return [
        sa.Column("id", StringUUID(), primary_key=True, nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("provider_project_id", sa.String(128), nullable=False),
        sa.Column("allocation_id", StringUUID()),
        sa.Column("tenant_id", StringUUID()),
        sa.Column("app_id", StringUUID()),
        sa.Column("agent_id", StringUUID()),
        sa.Column("binding_id", StringUUID()),
        sa.Column("workspace_id", StringUUID()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    ]


def upgrade():
    op.create_table(
        "agent_sandbox_usage_events",
        *_identity_columns(),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("source_event_id", sa.String(255), nullable=False),
        sa.Column("event_type", sa.String(96), nullable=False),
        sa.Column("sandbox_id", sa.String(128)),
        sa.Column("provider_execution_id", sa.String(128)),
        sa.Column("operation_id", StringUUID()),
        sa.Column("lease_id", StringUUID()),
        sa.Column("attempt", sa.Integer()),
        sa.Column("purpose", sa.String(32)),
        sa.Column("correlation", sa.JSON(), nullable=False),
        sa.Column("occurred_at", sa.DateTime()),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("canonical_hash", sa.String(64), nullable=False),
        sa.Column("payload_versions", sa.JSON(), nullable=False),
        sa.Column("resolution", sa.JSON(), nullable=False),
        sa.Column("projection_status", sa.String(32), nullable=False),
        sa.Column("projection_error_code", sa.String(96)),
        sa.Column("processed_at", sa.DateTime()),
        sa.UniqueConstraint(
            "provider", "provider_project_id", "source", "source_event_id", name="sandbox_usage_event_unique"
        ),
        sa.CheckConstraint("source IN ('application', 'provider')", name="sandbox_usage_event_source_check"),
    )
    for name, columns in (
        ("sandbox_usage_event_sandbox_idx", ["provider_project_id", "sandbox_id", "occurred_at"]),
        ("sandbox_usage_event_allocation_idx", ["allocation_id", "received_at"]),
        ("sandbox_usage_event_owner_idx", ["provider_project_id", "binding_id", "event_type"]),
        ("sandbox_usage_event_pending_idx", ["projection_status", "received_at"]),
        ("sandbox_usage_checkpoint_idx", ["provider_project_id", "event_type", "purpose", "occurred_at"]),
        ("sandbox_usage_diagnostics_idx", ["provider_project_id", "projection_status"]),
        ("sandbox_usage_execution_idx", ["provider_project_id", "provider_execution_id", "projection_error_code"]),
    ):
        op.create_index(name, "agent_sandbox_usage_events", columns)

    op.create_table(
        "agent_sandbox_executions",
        *_identity_columns(),
        sa.Column("sandbox_id", sa.String(128), nullable=False),
        sa.Column("provider_execution_id", sa.String(128), nullable=False),
        sa.Column("attribution_status", sa.String(32), nullable=False),
        sa.Column("template_id", sa.String(128)),
        sa.Column("template_build_id", sa.String(128)),
        sa.Column("vcpu_count", sa.Integer()),
        sa.Column("memory_mib", sa.BigInteger()),
        sa.Column("started_at", sa.DateTime()),
        sa.Column("started_at_source", sa.String(32)),
        sa.Column("started_at_precision_ms", sa.Integer()),
        sa.Column("terminal_event_at", sa.DateTime()),
        sa.Column("metered_duration_ms", sa.BigInteger()),
        sa.Column("measurement_source", sa.String(32), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("quality", sa.String(16), nullable=False),
        sa.Column("close_reason", sa.String(64)),
        sa.Column("terminal_event_id", StringUUID()),
        sa.Column("last_reconciled_at", sa.DateTime()),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "provider", "provider_project_id", "provider_execution_id", name="sandbox_execution_unique"
        ),
        sa.CheckConstraint("metered_duration_ms IS NULL OR metered_duration_ms >= 0", name="sandbox_duration_check"),
        sa.CheckConstraint("vcpu_count IS NULL OR vcpu_count > 0", name="sandbox_vcpu_check"),
        sa.CheckConstraint("memory_mib IS NULL OR memory_mib > 0", name="sandbox_memory_check"),
        sa.CheckConstraint(
            "quality <> 'metered' OR (state = 'closed' AND measurement_source = 'provider_execution' "
            "AND metered_duration_ms IS NOT NULL AND started_at IS NOT NULL "
            "AND vcpu_count IS NOT NULL AND memory_mib IS NOT NULL)",
            name="sandbox_metered_check",
        ),
    )
    for name, columns in (
        ("sandbox_execution_project_time_idx", ["provider_project_id", "started_at"]),
        ("sandbox_execution_tenant_time_idx", ["tenant_id", "started_at"]),
        ("sandbox_execution_sandbox_idx", ["provider_project_id", "sandbox_id", "started_at"]),
        ("sandbox_execution_allocation_idx", ["allocation_id"]),
        ("sandbox_execution_reconcile_idx", ["quality", "state", "last_reconciled_at"]),
        ("sandbox_execution_diagnostics_idx", ["provider_project_id", "state", "attribution_status"]),
    ):
        op.create_index(name, "agent_sandbox_executions", columns)


def downgrade():
    op.drop_table("agent_sandbox_executions")
    op.drop_table("agent_sandbox_usage_events")
