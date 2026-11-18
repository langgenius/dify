from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from enums.model_billing import TenantTokenerIntegrationStatus
from libs.uuid_utils import uuidv7

from .base import TypeBase
from .types import EnumText, StringUUID


class TenantTokenerIntegration(TypeBase):
    """Non-secret, replayable state for a tenant's managed Tokener setup."""

    __tablename__ = "tenant_tokener_integrations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tenant_tokener_integration_pkey"),
        sa.UniqueConstraint("tenant_id", name="tenant_tokener_integration_tenant_id_key"),
        sa.Index("tenant_tokener_integration_status_updated_at_idx", "status", "updated_at"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        primary_key=True,
        insert_default=lambda: str(uuidv7()),
        default_factory=lambda: str(uuidv7()),
        init=False,
    )
    tenant_id: Mapped[str] = mapped_column(
        StringUUID,
        sa.ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[TenantTokenerIntegrationStatus] = mapped_column(
        EnumText(TenantTokenerIntegrationStatus, length=40),
        nullable=False,
        server_default=text("'pending'"),
        default=TenantTokenerIntegrationStatus.PENDING,
    )
    plugin_unique_identifier: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    plugin_install_task_id: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    provider_credential_id: Mapped[str | None] = mapped_column(
        StringUUID,
        sa.ForeignKey("provider_credentials.id", ondelete="SET NULL"),
        nullable=True,
        default=None,
    )
    attempt_count: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        server_default=text("0"),
        default=0,
    )
    last_error_code: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    ready_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        init=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )


class AccountTokenerSignupIntent(TypeBase):
    """Account-creation proof; consumed_at permanently fences deletion/retry replay."""

    __tablename__ = "account_tokener_signup_intents"
    __table_args__ = (
        sa.PrimaryKeyConstraint("account_id", name="account_tokener_signup_intent_pkey"),
        sa.UniqueConstraint("consumed_tenant_id", name="account_tokener_signup_intent_tenant_key"),
        sa.CheckConstraint(
            "consumed_tenant_id IS NULL OR consumed_at IS NOT NULL",
            name="account_tokener_signup_intent_consumed_check",
        ),
    )
    account_id: Mapped[str] = mapped_column(
        StringUUID,
        sa.ForeignKey("accounts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    plugin_unique_identifier: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    consumed_tenant_id: Mapped[str | None] = mapped_column(
        StringUUID,
        sa.ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        default=None,
    )
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        init=False,
    )
