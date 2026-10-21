"""Durable state for workspace provisioning and ownership convergence."""

from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now

from .base import TypeBase
from .types import StringUUID


class WorkspaceProvisioningOperation(TypeBase):
    """A stable mutex and recovery record for one preallocated workspace ID.

    The row is committed before key or RBAC preparation. Both provisioning and
    recovery lock it before inspecting Tenant, so a resolver cannot mistake an
    in-flight aggregate commit for a rolled-back one.
    """

    __tablename__ = "workspace_provisioning_operations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("workspace_id", name="workspace_provisioning_operations_pkey"),
        sa.Index("workspace_provisioning_operations_recovery_idx", "status", "lease_expires_at", "updated_at"),
    )

    workspace_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    owner_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    operation: Mapped[str] = mapped_column(sa.String(32), nullable=False, default="create")
    status: Mapped[str] = mapped_column(sa.String(32), nullable=False, default="preparing")
    lease_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    lease_expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True, default=None)
    key_prepared: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False, server_default=sa.false())
    rbac_prepared: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False, server_default=sa.false())
    compensation_attempts: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0, server_default="0")
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


class WorkspaceOwnerTransferOperation(TypeBase):
    """Recoverable intent for one workspace ownership transfer.

    The row remains as a desired-owner watch after local completion. A stale
    external call from an expired execution can therefore be repaired even
    after a later ownership transfer has completed.
    """

    __tablename__ = "workspace_owner_transfer_operations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("workspace_id", name="workspace_owner_transfer_operations_pkey"),
        sa.Index(
            "workspace_owner_transfer_operations_recovery_idx",
            "status",
            "next_reconcile_at",
            "updated_at",
            "workspace_id",
        ),
    )

    workspace_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    old_owner_account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    new_owner_account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    operation_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        default_factory=lambda: str(uuid4()),
        init=False,
    )
    possible_owner_account_ids: Mapped[list[str]] = mapped_column(sa.JSON, nullable=False, default_factory=list)
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False, default="pending")
    execution_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    lease_expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True, default=None)
    next_reconcile_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        insert_default=naive_utc_now,
        default_factory=naive_utc_now,
    )
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


class WorkspaceOwnerTransferNotification(TypeBase):
    """Durable delivery state for one recipient of a completed transfer."""

    __tablename__ = "workspace_owner_transfer_notifications"
    __table_args__ = (
        sa.PrimaryKeyConstraint("notification_id", name="workspace_owner_transfer_notifications_pkey"),
        sa.UniqueConstraint(
            "operation_id",
            "recipient_type",
            name="workspace_owner_transfer_notifications_operation_recipient_key",
        ),
        sa.Index(
            "workspace_owner_transfer_notifications_delivery_idx",
            "status",
            "next_attempt_at",
            "lease_expires_at",
            "notification_id",
        ),
    )

    operation_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workspace_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    old_owner_account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    new_owner_account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    recipient_type: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    recipient_email: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    recipient_language: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    workspace_name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    new_owner_email: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    notification_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        default_factory=lambda: str(uuid4()),
        init=False,
    )
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False, default="waiting", server_default="waiting")
    claim_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    lease_expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True, default=None)
    next_attempt_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        insert_default=naive_utc_now,
        default_factory=naive_utc_now,
    )
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
    sent_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True, default=None)
