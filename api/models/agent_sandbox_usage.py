"""Independent E2B accounting records, retained after business resource deletion.

All timestamps are explicit naive UTC values, following the API's database
convention. These records deliberately have no business-object foreign keys.
"""

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now

from .base import Base, DefaultFieldsMixin
from .types import StringUUID


class AgentSandboxUsageEvent(DefaultFieldsMixin, Base):
    __tablename__ = "agent_sandbox_usage_events"
    __table_args__ = (
        sa.UniqueConstraint(
            "provider", "provider_project_id", "source", "source_event_id", name="sandbox_usage_event_unique"
        ),
        sa.Index("sandbox_usage_event_sandbox_idx", "provider_project_id", "sandbox_id", "occurred_at"),
        sa.Index("sandbox_usage_event_allocation_idx", "allocation_id", "received_at"),
        sa.Index("sandbox_usage_event_owner_idx", "provider_project_id", "binding_id", "event_type"),
        sa.Index("sandbox_usage_event_pending_idx", "projection_status", "received_at"),
        sa.Index("sandbox_usage_checkpoint_idx", "provider_project_id", "event_type", "purpose", "occurred_at"),
        sa.Index("sandbox_usage_diagnostics_idx", "provider_project_id", "projection_status"),
        sa.Index(
            "sandbox_usage_execution_idx", "provider_project_id", "provider_execution_id", "projection_error_code"
        ),
        sa.CheckConstraint("source IN ('application', 'provider')", name="sandbox_usage_event_source_check"),
    )

    provider: Mapped[str] = mapped_column(sa.String(32), nullable=False, default="e2b")
    provider_project_id: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    source: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    source_event_id: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    event_type: Mapped[str] = mapped_column(sa.String(96), nullable=False)
    sandbox_id: Mapped[str | None] = mapped_column(sa.String(128))
    provider_execution_id: Mapped[str | None] = mapped_column(sa.String(128))
    allocation_id: Mapped[str | None] = mapped_column(StringUUID)
    operation_id: Mapped[str | None] = mapped_column(StringUUID)
    lease_id: Mapped[str | None] = mapped_column(StringUUID)
    attempt: Mapped[int | None] = mapped_column(sa.Integer)
    tenant_id: Mapped[str | None] = mapped_column(StringUUID)
    app_id: Mapped[str | None] = mapped_column(StringUUID)
    agent_id: Mapped[str | None] = mapped_column(StringUUID)
    binding_id: Mapped[str | None] = mapped_column(StringUUID)
    workspace_id: Mapped[str | None] = mapped_column(StringUUID)
    purpose: Mapped[str | None] = mapped_column(sa.String(32))
    correlation: Mapped[dict[str, Any]] = mapped_column(sa.JSON, nullable=False, default=dict)
    occurred_at: Mapped[datetime | None] = mapped_column(sa.DateTime)
    received_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, default=naive_utc_now)
    payload: Mapped[dict[str, Any]] = mapped_column(sa.JSON, nullable=False)
    canonical_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    payload_versions: Mapped[list[dict[str, Any]]] = mapped_column(sa.JSON, nullable=False, default=list)
    resolution: Mapped[dict[str, Any]] = mapped_column(sa.JSON, nullable=False, default=dict)
    projection_status: Mapped[str] = mapped_column(sa.String(32), nullable=False, default="pending")
    projection_error_code: Mapped[str | None] = mapped_column(sa.String(96))
    processed_at: Mapped[datetime | None] = mapped_column(sa.DateTime)


class AgentSandboxExecution(DefaultFieldsMixin, Base):
    """One provider execution, not one request, lease, or connect call."""

    __tablename__ = "agent_sandbox_executions"
    __table_args__ = (
        sa.UniqueConstraint(
            "provider", "provider_project_id", "provider_execution_id", name="sandbox_execution_unique"
        ),
        sa.Index("sandbox_execution_project_time_idx", "provider_project_id", "started_at"),
        sa.Index("sandbox_execution_tenant_time_idx", "tenant_id", "started_at"),
        sa.Index("sandbox_execution_sandbox_idx", "provider_project_id", "sandbox_id", "started_at"),
        sa.Index("sandbox_execution_allocation_idx", "allocation_id"),
        sa.Index("sandbox_execution_reconcile_idx", "quality", "state", "last_reconciled_at"),
        sa.Index("sandbox_execution_diagnostics_idx", "provider_project_id", "state", "attribution_status"),
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

    provider: Mapped[str] = mapped_column(sa.String(32), nullable=False, default="e2b")
    provider_project_id: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    sandbox_id: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    provider_execution_id: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    allocation_id: Mapped[str | None] = mapped_column(StringUUID)
    tenant_id: Mapped[str | None] = mapped_column(StringUUID)
    app_id: Mapped[str | None] = mapped_column(StringUUID)
    agent_id: Mapped[str | None] = mapped_column(StringUUID)
    binding_id: Mapped[str | None] = mapped_column(StringUUID)
    workspace_id: Mapped[str | None] = mapped_column(StringUUID)
    attribution_status: Mapped[str] = mapped_column(sa.String(32), nullable=False, default="unresolved")
    template_id: Mapped[str | None] = mapped_column(sa.String(128))
    template_build_id: Mapped[str | None] = mapped_column(sa.String(128))
    vcpu_count: Mapped[int | None] = mapped_column(sa.Integer)
    memory_mib: Mapped[int | None] = mapped_column(sa.BigInteger)
    started_at: Mapped[datetime | None] = mapped_column(sa.DateTime)
    started_at_source: Mapped[str | None] = mapped_column(sa.String(32))
    started_at_precision_ms: Mapped[int | None] = mapped_column(sa.Integer)
    terminal_event_at: Mapped[datetime | None] = mapped_column(sa.DateTime)
    metered_duration_ms: Mapped[int | None] = mapped_column(sa.BigInteger)
    measurement_source: Mapped[str] = mapped_column(sa.String(32), nullable=False, default="unknown")
    state: Mapped[str] = mapped_column(sa.String(16), nullable=False, default="unknown")
    quality: Mapped[str] = mapped_column(sa.String(16), nullable=False, default="pending")
    close_reason: Mapped[str | None] = mapped_column(sa.String(64))
    terminal_event_id: Mapped[str | None] = mapped_column(StringUUID)
    last_reconciled_at: Mapped[datetime | None] = mapped_column(sa.DateTime)
    revision: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=1)
