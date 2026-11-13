"""Persistence for malware scanning of stored files.

A provider is a workspace's connection to one scanner. A policy turns scanning on for one
product resource (a "scope": a dataset, a KnowledgeFS space, ...). A record is the verdict for one
file under one provider. None of these tables reference a product module's tables, so any module
can adopt scanning by choosing a scope type.
"""

from datetime import datetime
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy import DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import DefaultFieldsDCMixin, TypeBase
from .types import EnumText, LongText, StringUUID


class FileScanProviderStatus(StrEnum):
    ACTIVE = "active"
    ERROR = "error"
    """The last scan or test hit a credential or quota failure; an administrator must act."""


class FileScanFallbackAction(StrEnum):
    BLOCK = "block"
    ALLOW = "allow"


class FileScanRecordStatus(StrEnum):
    CLEAN = "clean"
    INFECTED = "infected"
    UNSCANNABLE = "unscannable"
    UNAVAILABLE = "unavailable"


class FileScanProvider(DefaultFieldsDCMixin, TypeBase):
    __tablename__ = "file_scan_providers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="file_scan_provider_pkey"),
        UniqueConstraint("tenant_id", "name", name="file_scan_provider_tenant_name_uq"),
        Index("file_scan_provider_tenant_idx", "tenant_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(32), nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(sa.JSON, nullable=False, default_factory=dict)
    encrypted_credentials: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)
    status: Mapped[FileScanProviderStatus] = mapped_column(
        EnumText(FileScanProviderStatus, length=16),
        nullable=False,
        server_default=sa.text("'active'"),
        default=FileScanProviderStatus.ACTIVE,
    )
    last_error: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)


class FileScanPolicy(DefaultFieldsDCMixin, TypeBase):
    __tablename__ = "file_scan_policies"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="file_scan_policy_pkey"),
        UniqueConstraint("tenant_id", "scope_type", "scope_id", name="file_scan_policy_scope_uq"),
        Index("file_scan_policy_provider_idx", "tenant_id", "provider_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    scope_type: Mapped[str] = mapped_column(String(64), nullable=False)
    scope_id: Mapped[str] = mapped_column(String(255), nullable=False)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.false(), default=False)
    provider_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    on_unavailable: Mapped[FileScanFallbackAction] = mapped_column(
        EnumText(FileScanFallbackAction, length=16),
        nullable=False,
        server_default=sa.text("'block'"),
        default=FileScanFallbackAction.BLOCK,
    )
    on_unscannable: Mapped[FileScanFallbackAction] = mapped_column(
        EnumText(FileScanFallbackAction, length=16),
        nullable=False,
        server_default=sa.text("'block'"),
        default=FileScanFallbackAction.BLOCK,
    )
    updated_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)


class FileScanRecord(DefaultFieldsDCMixin, TypeBase):
    __tablename__ = "file_scan_records"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="file_scan_record_pkey"),
        Index("file_scan_record_hash_idx", "tenant_id", "provider_id", "file_hash", "created_at"),
        Index("file_scan_record_upload_file_idx", "tenant_id", "upload_file_id", "created_at"),
        Index("file_scan_record_scope_idx", "tenant_id", "scope_type", "scope_id", "created_at"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_type: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    status: Mapped[FileScanRecordStatus] = mapped_column(EnumText(FileScanRecordStatus, length=16), nullable=False)
    allowed: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    upload_file_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    scope_type: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    scope_id: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    problem: Mapped[str | None] = mapped_column(String(32), nullable=True, default=None)
    threats: Mapped[list[str]] = mapped_column(sa.JSON, nullable=False, default_factory=list)
    engine: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    message: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    size_limit: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True, default=None)
