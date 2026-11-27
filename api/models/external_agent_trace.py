"""External observations and delivery intents, separate from business Invocations.

There is intentionally no asset cascade. Parent lifecycle cleanup fences the
Invocation and removes its retained payloads; immutable delivery snapshots never
follow the asset's current provider configuration.
"""

from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now
from models.base import TypeBase
from models.types import AdjustedJSON, StringUUID


class ExternalAgentTraceRecord(TypeBase, kw_only=True):
    __tablename__ = "external_agent_trace_records"
    __table_args__ = (sa.Index("external_agent_trace_owner_idx", "tenant_id", "agent_id", "created_at"),)

    invocation_id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    agent_id: Mapped[str] = mapped_column(StringUUID)
    state: Mapped[str] = mapped_column(sa.String(24))
    revision: Mapped[int] = mapped_column(sa.Integer, default=0)
    targets_frozen: Mapped[bool] = mapped_column(sa.Boolean, default=False)
    payload_bytes: Mapped[int] = mapped_column(sa.BigInteger, default=0)
    diagnostics: Mapped[list[str]] = mapped_column(AdjustedJSON(), default_factory=list)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)


class ExternalAgentTraceReceipt(TypeBase, kw_only=True):
    __tablename__ = "external_agent_trace_receipts"
    __table_args__ = (
        sa.UniqueConstraint("tenant_id", "invocation_id", "receipt_key", name="external_trace_receipt_uq"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    invocation_id: Mapped[str] = mapped_column(StringUUID)
    receipt_key: Mapped[str] = mapped_column(sa.String(64))
    payload_hash: Mapped[str] = mapped_column(sa.String(64))
    source_id: Mapped[str] = mapped_column(sa.String(512))
    dialect: Mapped[str] = mapped_column(sa.String(32))
    received_at: Mapped[datetime] = mapped_column(sa.DateTime)


class ExternalAgentTraceStep(TypeBase, kw_only=True):
    __tablename__ = "external_agent_trace_steps"
    __table_args__ = (sa.UniqueConstraint("tenant_id", "invocation_id", "step_key", name="external_trace_step_uq"),)

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    invocation_id: Mapped[str] = mapped_column(StringUUID)
    step_key: Mapped[str] = mapped_column(sa.String(64))
    payload_hash: Mapped[str] = mapped_column(sa.String(64))
    trace_path: Mapped[list[str]] = mapped_column(AdjustedJSON())
    remote_trace_id: Mapped[str] = mapped_column(sa.String(512))
    remote_step_id: Mapped[str] = mapped_column(sa.String(512))
    parent_step_id: Mapped[str | None] = mapped_column(sa.String(512))
    resolved_parent_key: Mapped[str | None] = mapped_column(sa.String(64))
    kind: Mapped[str | None] = mapped_column(sa.String(32))
    name: Mapped[str | None] = mapped_column(sa.String(512))
    started_at: Mapped[datetime | None] = mapped_column(sa.DateTime)
    ended_at: Mapped[datetime | None] = mapped_column(sa.DateTime)
    status: Mapped[str | None] = mapped_column(sa.String(64))
    error: Mapped[str | None] = mapped_column(sa.Text)
    total_tokens: Mapped[int | None] = mapped_column(sa.BigInteger)
    raw_data: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON(), repr=False)


class ExternalAgentTraceUsageSummary(TypeBase, kw_only=True):
    __tablename__ = "external_agent_trace_usage_summaries"

    invocation_id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    total_tokens: Mapped[int] = mapped_column(sa.BigInteger)
    source_path: Mapped[str] = mapped_column(sa.String(512))
    adapter: Mapped[str] = mapped_column(sa.String(128))
    revision: Mapped[int] = mapped_column(sa.Integer)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime)


class ExternalAgentTracingConfig(TypeBase, kw_only=True):
    __tablename__ = "external_agent_tracing_configs"
    __table_args__ = (sa.UniqueConstraint("tenant_id", "agent_id", "provider", name="external_trace_config_uq"),)

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    agent_id: Mapped[str] = mapped_column(StringUUID)
    provider: Mapped[str] = mapped_column(sa.String(32))
    encrypted_config: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON(), repr=False)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, default=False)
    capture_content: Mapped[bool] = mapped_column(sa.Boolean, default=False)
    revision: Mapped[int] = mapped_column(sa.Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)


class ExternalAgentTraceDelivery(TypeBase, kw_only=True):
    __tablename__ = "external_agent_trace_deliveries"
    __table_args__ = (
        sa.UniqueConstraint("tenant_id", "delivery_key", name="external_trace_delivery_uq"),
        sa.Index("external_trace_delivery_due_idx", "state", "next_attempt_at"),
        sa.Index("external_trace_delivery_invocation_idx", "tenant_id", "invocation_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    invocation_id: Mapped[str] = mapped_column(StringUUID)
    delivery_key: Mapped[str] = mapped_column(sa.String(64))
    target_kind: Mapped[str] = mapped_column(sa.String(16))
    target_id: Mapped[str] = mapped_column(StringUUID)
    provider: Mapped[str] = mapped_column(sa.String(32))
    config_revision: Mapped[str] = mapped_column(sa.String(64))
    payload_revision: Mapped[int] = mapped_column(sa.Integer)
    encrypted_config: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON(), repr=False)
    trace_payload: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON(), repr=False)
    capture_content: Mapped[bool] = mapped_column(sa.Boolean)
    state: Mapped[str] = mapped_column(sa.String(24), default="pending")
    attempts: Mapped[int] = mapped_column(sa.Integer, default=0)
    lease_token: Mapped[str | None] = mapped_column(StringUUID, default=None)
    lease_until: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    next_attempt_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    error_code: Mapped[str | None] = mapped_column(sa.String(96), default=None)
    trace_url: Mapped[str | None] = mapped_column(sa.Text, default=None)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, default_factory=naive_utc_now)


class ExternalAgentTraceTarget(TypeBase, kw_only=True):
    __tablename__ = "external_agent_trace_targets"
    __table_args__ = (
        sa.UniqueConstraint("tenant_id", "invocation_id", "target_kind", "target_id", name="external_trace_target_uq"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    invocation_id: Mapped[str] = mapped_column(StringUUID)
    target_kind: Mapped[str] = mapped_column(sa.String(16))
    target_id: Mapped[str] = mapped_column(StringUUID)
    provider: Mapped[str] = mapped_column(sa.String(32))
    config_revision: Mapped[str] = mapped_column(sa.String(64))
    encrypted_config: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON(), repr=False)
    capture_content: Mapped[bool] = mapped_column(sa.Boolean)


class ExternalAgentDataTombstone(TypeBase, kw_only=True):
    __tablename__ = "external_agent_data_tombstones"
    __table_args__ = (sa.UniqueConstraint("tenant_id", "owner_kind", "owner_id", name="external_data_tombstone_uq"),)

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    owner_kind: Mapped[str] = mapped_column(sa.String(32))
    owner_id: Mapped[str] = mapped_column(sa.String(255))
    deleted_at: Mapped[datetime] = mapped_column(sa.DateTime)
