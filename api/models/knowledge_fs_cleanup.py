"""Persistent authorization for the irreversible P9 KnowledgeFS cleanup window."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import DefaultFieldsDCMixin, TypeBase
from .types import EnumText, StringUUID


class KnowledgeFSCleanupAuthorizationStatus(StrEnum):
    REQUESTED = "requested"
    APPROVED = "approved"
    STARTED = "started"
    COMPLETED = "completed"


class KnowledgeFSCleanupTarget(StrEnum):
    LEGACY_SNAPSHOT_FOREIGN_KEYS = "legacy_snapshot_foreign_keys"
    LEGACY_ACL_ROUTES = "legacy_acl_routes"
    LEGACY_ACL_SCHEMA = "legacy_acl_schema"
    LEGACY_API_KEY_SCHEMA = "legacy_api_key_schema"
    LEGACY_V1_AUTH = "legacy_v1_auth"
    RAW_LIST_CREATE_PROXY = "raw_list_create_proxy"


class KnowledgeFSCleanupAuthorization(DefaultFieldsDCMixin, TypeBase):
    """Four-eyes approval and immutable evidence for one cleanup start fence."""

    __tablename__ = "knowledge_fs_cleanup_authorizations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="kfs_cleanup_authorization_pkey"),
        UniqueConstraint("tenant_id", "ledger_id", "request_id", name="kfs_cleanup_authorization_request_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "ledger_id"],
            ["knowledge_fs_workspace_cutover_ledgers.tenant_id", "knowledge_fs_workspace_cutover_ledgers.id"],
            name="kfs_cleanup_authorization_ledger_fk",
        ),
        Index("kfs_cleanup_authorization_status_idx", "tenant_id", "status", "updated_at"),
        sa.CheckConstraint("row_version >= 0", name=sa.schema.conv("kfs_cleanup_authorization_version_ck")),
        sa.CheckConstraint(
            "readiness_ledger_cas_version >= 0 "
            "AND (approved_ledger_cas_version IS NULL OR approved_ledger_cas_version >= 0) "
            "AND (started_ledger_cas_version IS NULL OR started_ledger_cas_version >= 0) "
            "AND (completed_ledger_cas_version IS NULL OR completed_ledger_cas_version >= 0)",
            name=sa.schema.conv("kfs_cleanup_authorization_ledger_versions_ck"),
        ),
        sa.CheckConstraint(
            "(status = 'requested' "
            "AND approved_by_account_id IS NULL AND approved_at IS NULL "
            "AND approval_expires_at IS NULL AND approved_ledger_cas_version IS NULL "
            "AND started_by_account_id IS NULL AND started_at IS NULL "
            "AND started_ledger_cas_version IS NULL "
            "AND completed_by_account_id IS NULL AND completed_at IS NULL "
            "AND completion_evidence IS NULL AND completed_ledger_cas_version IS NULL) OR "
            "(status = 'approved' "
            "AND approved_by_account_id IS NOT NULL AND approved_at IS NOT NULL "
            "AND approval_expires_at IS NOT NULL AND approved_ledger_cas_version IS NOT NULL "
            "AND started_by_account_id IS NULL AND started_at IS NULL "
            "AND started_ledger_cas_version IS NULL "
            "AND completed_by_account_id IS NULL AND completed_at IS NULL "
            "AND completion_evidence IS NULL AND completed_ledger_cas_version IS NULL) OR "
            "(status = 'started' "
            "AND approved_by_account_id IS NOT NULL AND approved_at IS NOT NULL "
            "AND approval_expires_at IS NOT NULL AND approved_ledger_cas_version IS NOT NULL "
            "AND started_by_account_id IS NOT NULL AND started_at IS NOT NULL "
            "AND started_ledger_cas_version IS NOT NULL "
            "AND completed_by_account_id IS NULL AND completed_at IS NULL "
            "AND completion_evidence IS NULL AND completed_ledger_cas_version IS NULL) OR "
            "(status = 'completed' "
            "AND approved_by_account_id IS NOT NULL AND approved_at IS NOT NULL "
            "AND approval_expires_at IS NOT NULL AND approved_ledger_cas_version IS NOT NULL "
            "AND started_by_account_id IS NOT NULL AND started_at IS NOT NULL "
            "AND started_ledger_cas_version IS NOT NULL "
            "AND completed_by_account_id IS NOT NULL AND completed_at IS NOT NULL "
            "AND completion_evidence IS NOT NULL AND completed_ledger_cas_version IS NOT NULL)",
            name=sa.schema.conv("kfs_cleanup_authorization_status_fields_ck"),
        ),
        sa.CheckConstraint(
            "approval_expires_at IS NULL OR approval_expires_at > approved_at",
            name=sa.schema.conv("kfs_cleanup_authorization_approval_window_ck"),
        ),
        sa.CheckConstraint(
            "completed_at IS NULL OR completed_at >= started_at",
            name=sa.schema.conv("kfs_cleanup_authorization_completion_time_ck"),
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    ledger_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    request_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    plan_schema_version: Mapped[str] = mapped_column(String(32), nullable=False)
    plan_digest: Mapped[str] = mapped_column(String(71), nullable=False)
    targets: Mapped[list[str]] = mapped_column(sa.JSON, nullable=False)
    readiness_evidence: Mapped[dict[str, object]] = mapped_column(sa.JSON, nullable=False)
    requested_by_account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    readiness_ledger_cas_version: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    status: Mapped[KnowledgeFSCleanupAuthorizationStatus] = mapped_column(
        EnumText(KnowledgeFSCleanupAuthorizationStatus, length=16),
        nullable=False,
        server_default=sa.text("'requested'"),
        default=KnowledgeFSCleanupAuthorizationStatus.REQUESTED,
    )
    approved_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    approval_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    approved_ledger_cas_version: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True, default=None)
    started_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    started_ledger_cas_version: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True, default=None)
    completed_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    completion_evidence: Mapped[dict[str, object] | None] = mapped_column(
        sa.JSON(none_as_null=True), nullable=True, default=None
    )
    completed_ledger_cas_version: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True, default=None)
    row_version: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("0"), default=0)


__all__ = [
    "KnowledgeFSCleanupAuthorization",
    "KnowledgeFSCleanupAuthorizationStatus",
    "KnowledgeFSCleanupTarget",
]
