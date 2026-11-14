"""Durable post-commit App deletion cleanup requests."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import DefaultFieldsDCMixin, TypeBase
from .types import EnumText, LongText, StringUUID


class AppDeletionOutboxStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    RETRY = "retry"
    SUCCEEDED = "succeeded"


class AppDeletionOutbox(DefaultFieldsDCMixin, TypeBase):
    """Immutable deletion payload with leased, retryable post-commit delivery."""

    __tablename__ = "app_deletion_outbox"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="app_deletion_outbox_pkey"),
        UniqueConstraint("tenant_id", "app_id", name="app_deletion_outbox_app_uq"),
        Index("app_deletion_outbox_dispatch_idx", "status", "next_attempt_at", "id"),
        Index("app_deletion_outbox_completed_idx", "status", "completed_at", "id"),
        sa.CheckConstraint("attempt_count >= 0", name=sa.schema.conv("app_deletion_outbox_attempt_ck")),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'retry', 'succeeded')",
            name=sa.schema.conv("app_deletion_outbox_status_ck"),
        ),
        sa.CheckConstraint(
            "(status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) "
            "OR (status != 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)",
            name=sa.schema.conv("app_deletion_outbox_lease_ck"),
        ),
        sa.CheckConstraint(
            "(status = 'succeeded' AND completed_at IS NOT NULL) OR (status != 'succeeded' AND completed_at IS NULL)",
            name=sa.schema.conv("app_deletion_outbox_completed_ck"),
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    deletion_payload: Mapped[dict[str, object]] = mapped_column(sa.JSON, nullable=False)
    account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    status: Mapped[AppDeletionOutboxStatus] = mapped_column(
        EnumText(AppDeletionOutboxStatus, length=32),
        nullable=False,
        server_default=sa.text("'pending'"),
        default=AppDeletionOutboxStatus.PENDING,
    )
    attempt_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("0"), default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    lease_owner: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    last_error_message: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)


__all__ = ["AppDeletionOutbox", "AppDeletionOutboxStatus"]
