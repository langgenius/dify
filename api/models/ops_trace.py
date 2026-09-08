"""Durable, tenant-owned delivery attempts for immutable application traces."""

from datetime import datetime
from typing import Literal

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, DefaultFieldsMixin
from models.types import StringUUID


class OpsTraceDelivery(DefaultFieldsMixin, Base):
    __tablename__ = "ops_trace_deliveries"
    __table_args__ = (
        sa.UniqueConstraint("tenant_id", "export_id", name="ops_trace_delivery_export_unique"),
        sa.UniqueConstraint("tenant_id", "id", name="ops_trace_delivery_tenant_unique"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "parent_delivery_id"],
            ["ops_trace_deliveries.tenant_id", "ops_trace_deliveries.id"],
            name="ops_trace_delivery_parent_fk",
        ),
        sa.Index("ops_trace_delivery_due_idx", "status", "next_attempt_at"),
        sa.Index("ops_trace_delivery_owner_idx", "tenant_id", "app_id", "message_id", "workflow_run_id"),
        sa.CheckConstraint(
            "(source_type = 'app' AND app_id IS NOT NULL AND pipeline_id IS NULL) OR "
            "(source_type = 'pipeline' AND pipeline_id IS NOT NULL AND app_id IS NULL) OR "
            "(source_type = 'workspace' AND app_id IS NULL AND pipeline_id IS NULL)",
            name="ops_trace_delivery_source",
        ),
        sa.CheckConstraint(
            "destination_type = 'enterprise' OR "
            "(destination_type = 'app_provider' AND app_id IS NOT NULL AND config_id IS NOT NULL)",
            name="ops_trace_delivery_destination",
        ),
        sa.CheckConstraint("trace_size_bytes > 0 AND trace_size_bytes <= 8388608", name="ops_trace_delivery_size"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str | None] = mapped_column(StringUUID)
    pipeline_id: Mapped[str | None] = mapped_column(StringUUID)
    source_type: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    export_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    trace_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    operation_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    root_span_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    conversation_id: Mapped[str | None] = mapped_column(StringUUID)
    message_id: Mapped[str | None] = mapped_column(StringUUID)
    workflow_run_id: Mapped[str | None] = mapped_column(StringUUID)
    destination_type: Mapped[Literal["app_provider", "enterprise"]] = mapped_column(sa.String(16), nullable=False)
    provider_name: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    config_id: Mapped[str | None] = mapped_column(StringUUID)
    config_revision: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    destination_settings_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    trace_sha256: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    trace_size_bytes: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    schema_version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    attempt_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False)
    attempt_token: Mapped[str | None] = mapped_column(StringUUID)
    lease_expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime)
    parent_export_id: Mapped[str | None] = mapped_column(StringUUID)
    parent_delivery_id: Mapped[str | None] = mapped_column(StringUUID)
    parent_span_id: Mapped[str | None] = mapped_column(StringUUID)
    parent_references: Mapped[dict | None] = mapped_column(sa.JSON)
    error_code: Mapped[str | None] = mapped_column(sa.String(64))
    finished_at: Mapped[datetime | None] = mapped_column(sa.DateTime)
    trace_deleted_at: Mapped[datetime | None] = mapped_column(sa.DateTime)

    def trace_storage_key(self) -> str:
        """Only validated persisted owner IDs may name storage objects."""
        from uuid import UUID

        tenant_id = UUID(self.tenant_id)
        delivery_id = UUID(self.id)
        owner_id = UUID(self.app_id or self.pipeline_id) if self.app_id or self.pipeline_id else "workspace"
        return f"ops_trace/v2/{tenant_id}/{owner_id}/{delivery_id}.json"
