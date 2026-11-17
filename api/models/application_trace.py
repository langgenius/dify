"""Durable application tracing envelopes, separate from business execution state.

Provider configuration snapshots contain the existing workspace-encrypted secret
values. They are never serialized by Console endpoints or sent to Agent runs.
"""

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now
from models.base import TypeBase
from models.types import StringUUID


class ApplicationTraceRun(TypeBase, kw_only=True):
    __tablename__ = "application_trace_runs"
    __table_args__ = (
        sa.UniqueConstraint("tenant_id", "app_id", "source_kind", "source_id", name="application_trace_source_unique"),
        sa.Index("application_trace_delivery_idx", "state", "next_attempt_at"),
        sa.Index("application_trace_retention_idx", "created_at"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    app_id: Mapped[str] = mapped_column(StringUUID)
    source_kind: Mapped[str] = mapped_column(sa.String(16))
    source_id: Mapped[str] = mapped_column(StringUUID)
    provider: Mapped[str] = mapped_column(sa.String(32))
    config_revision: Mapped[str] = mapped_column(sa.String(64))
    provider_config: Mapped[dict[str, Any]] = mapped_column(sa.JSON)
    trace_id: Mapped[str] = mapped_column(sa.String(32))
    root_span_id: Mapped[str] = mapped_column(sa.String(16))
    session_id: Mapped[str] = mapped_column(sa.String(255))
    capture_content: Mapped[bool] = mapped_column(sa.Boolean)
    capture_agent: Mapped[bool] = mapped_column(sa.Boolean, default=True)
    state: Mapped[str] = mapped_column(sa.String(24), default="collecting")
    outer_trace: Mapped[dict[str, Any] | None] = mapped_column(sa.JSON, default=None)
    span_count: Mapped[int] = mapped_column(sa.Integer, default=0)
    payload_bytes: Mapped[int] = mapped_column(sa.BigInteger, default=0)
    attempts: Mapped[int] = mapped_column(sa.Integer, default=0)
    error_code: Mapped[str | None] = mapped_column(sa.String(96), default=None)
    trace_url: Mapped[str | None] = mapped_column(sa.Text, default=None)
    provider_trace_id: Mapped[str | None] = mapped_column(sa.String(255), default=None)
    span_urls: Mapped[dict[str, str]] = mapped_column(sa.JSON, default_factory=dict)
    export_token: Mapped[str | None] = mapped_column(StringUUID, default=None)
    export_started_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    export_heartbeat_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    next_attempt_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    accepted_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    terminal_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)


class ApplicationTraceInvocation(TypeBase, kw_only=True):
    __tablename__ = "application_trace_invocations"
    __table_args__ = (sa.Index("application_trace_invocation_run_idx", "run_id"),)

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    run_id: Mapped[str] = mapped_column(StringUUID)
    agent_id: Mapped[str] = mapped_column(StringUUID)
    parent_span_id: Mapped[str] = mapped_column(sa.String(16))
    span_id: Mapped[str] = mapped_column(sa.String(16))
    node_execution_id: Mapped[str | None] = mapped_column(StringUUID)
    attempt: Mapped[int] = mapped_column(sa.Integer)
    finalized: Mapped[bool] = mapped_column(sa.Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)
    finalized_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)


class ApplicationTraceBatch(TypeBase, kw_only=True):
    __tablename__ = "application_trace_batches"
    __table_args__ = (sa.Index("application_trace_batch_run_idx", "run_id", "created_at"),)

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    run_id: Mapped[str] = mapped_column(StringUUID)
    invocation_id: Mapped[str] = mapped_column(StringUUID)
    payload_hash: Mapped[str] = mapped_column(sa.String(64))
    spans: Mapped[list[dict[str, Any]]] = mapped_column(sa.JSON)
    final: Mapped[bool] = mapped_column(sa.Boolean)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)
