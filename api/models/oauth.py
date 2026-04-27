from datetime import datetime
from typing import Any, Optional

import sqlalchemy as sa
from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

from libs.uuid_utils import uuidv7

from .base import TypeBase
from .types import AdjustedJSON, LongText, StringUUID


class DatasourceOauthParamConfig(TypeBase):
    __tablename__ = "datasource_oauth_params"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="datasource_oauth_config_pkey"),
        sa.UniqueConstraint("plugin_id", "provider", name="datasource_oauth_config_datasource_id_provider_idx"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    plugin_id: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    provider: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    system_credentials: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON, nullable=False)


class DatasourceProvider(TypeBase):
    __tablename__ = "datasource_providers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="datasource_provider_pkey"),
        sa.UniqueConstraint("tenant_id", "plugin_id", "provider", "name", name="datasource_provider_unique_name"),
        sa.Index("datasource_provider_auth_type_provider_idx", "tenant_id", "plugin_id", "provider"),
    )
    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    provider: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    plugin_id: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    auth_type: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    encrypted_credentials: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON, nullable=False)
    avatar_url: Mapped[str] = mapped_column(LongText, nullable=True, default="default")
    is_default: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"), default=False)
    expires_at: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="-1", default=-1)

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )


class DatasourceOauthTenantParamConfig(TypeBase):
    __tablename__ = "datasource_oauth_tenant_params"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="datasource_oauth_tenant_config_pkey"),
        sa.UniqueConstraint("tenant_id", "plugin_id", "provider", name="datasource_oauth_tenant_config_unique"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    plugin_id: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    client_params: Mapped[dict[str, Any]] = mapped_column(AdjustedJSON, nullable=False, default_factory=dict)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )


class OAuthAccessToken(TypeBase):
    """Device-flow bearer. account_id NOT NULL ⇒ dfoa_ (Dify account);
    account_id NULL + subject_issuer ⇒ dfoe_ (external SSO, EE-only).
    Partial unique index on (subject_email, subject_issuer, client_id,
    device_label) WHERE revoked_at IS NULL lets re-login rotate in place.
    """

    __tablename__ = "oauth_access_tokens"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="oauth_access_tokens_pkey"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    subject_email: Mapped[str] = mapped_column(sa.Text, nullable=False)
    client_id: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    device_label: Mapped[str] = mapped_column(sa.Text, nullable=False)
    prefix: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    subject_issuer: Mapped[Optional[str]] = mapped_column(sa.Text, nullable=True, default=None)
    account_id: Mapped[Optional[str]] = mapped_column(StringUUID, nullable=True, default=None)
    token_hash: Mapped[Optional[str]] = mapped_column(sa.String(64), nullable=True, default=None)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        sa.DateTime(timezone=True), nullable=True, default=None
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        sa.DateTime(timezone=True), nullable=True, default=None
    )

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=func.now(), init=False
    )
