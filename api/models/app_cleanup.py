"""Durable execution state for App related-data cleanup."""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now

from .base import TypeBase
from .types import StringUUID


class AppCleanupOperation(TypeBase):
    """One recoverable cleanup operation for an App identity.

    The App row may already be gone when this record is recovered, so the
    tenant and App identifiers are stored without foreign keys.
    """

    __tablename__ = "app_cleanup_operations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("app_id", name="app_cleanup_operations_pkey"),
        sa.Index("app_cleanup_operations_recovery_idx", "status", "available_at", "lease_expires_at"),
    )

    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False, default="pending", server_default="pending")
    available_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        insert_default=naive_utc_now,
        default_factory=naive_utc_now,
        server_default=sa.func.current_timestamp(),
    )
    lease_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    lease_expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True, default=None)
    attempts: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0, server_default="0")
    last_error: Mapped[str | None] = mapped_column(sa.Text, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        insert_default=naive_utc_now,
        default_factory=naive_utc_now,
        server_default=sa.func.current_timestamp(),
        init=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        insert_default=naive_utc_now,
        default_factory=naive_utc_now,
        server_default=sa.func.current_timestamp(),
        onupdate=sa.func.current_timestamp(),
        init=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True, default=None)
