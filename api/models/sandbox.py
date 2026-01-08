import json
from collections.abc import Mapping
from datetime import datetime
from typing import Any, cast
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import TypeBase
from .types import LongText, StringUUID


class SandboxProviderSystemConfig(TypeBase):
    """
    System-level sandbox provider configuration.
    Stores default configuration for each provider type.
    """

    __tablename__ = "sandbox_provider_system_config"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="sandbox_provider_system_config_pkey"),
        sa.UniqueConstraint("provider_type", name="unique_sandbox_provider_system_config_type"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    provider_type: Mapped[str] = mapped_column(String(50), nullable=False, comment="e2b, docker, local")
    encrypted_config: Mapped[str] = mapped_column(LongText, nullable=False, comment="Encrypted config JSON")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
        init=False,
    )

    @property
    def config(self) -> Mapping[str, Any]:
        return cast(Mapping[str, Any], json.loads(self.encrypted_config or "{}"))


class SandboxProvider(TypeBase):
    """
    Tenant-level sandbox provider configuration.
    Each tenant can have one configuration per provider type.
    Only one provider can be active at a time per tenant.
    """

    __tablename__ = "sandbox_providers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="sandbox_provider_pkey"),
        sa.UniqueConstraint("tenant_id", "provider_type", name="unique_sandbox_provider_tenant_type"),
        sa.Index("idx_sandbox_providers_tenant_id", "tenant_id"),
        sa.Index("idx_sandbox_providers_tenant_active", "tenant_id", "is_active"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_type: Mapped[str] = mapped_column(String(50), nullable=False, comment="e2b, docker, local")
    encrypted_config: Mapped[str] = mapped_column(LongText, nullable=False, comment="Encrypted config JSON")
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"), default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
        init=False,
    )

    @property
    def config(self) -> Mapping[str, Any]:
        return cast(Mapping[str, Any], json.loads(self.encrypted_config or "{}"))
