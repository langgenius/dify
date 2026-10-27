from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

from enums.oauth_client import OAuthClientKind
from libs.uuid_utils import uuidv7

from .base import TypeBase
from .enums import PermissionEnum
from .types import AdjustedJSON, EnumText, LongText, StringUUID


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
    user_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    avatar_url: Mapped[str] = mapped_column(LongText, nullable=True, default="default")
    is_default: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    expires_at: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=-1)
    visibility: Mapped[PermissionEnum] = mapped_column(
        EnumText(PermissionEnum, length=40), nullable=False, default=PermissionEnum.ALL_TEAM
    )

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


class OpenAPIOAuthAccessToken(TypeBase):
    """Device-flow bearer. account_id NOT NULL ⇒ dfoa_ (Dify account,
    subject_issuer = "dify:account" sentinel); account_id NULL +
    subject_issuer = verified IdP issuer ⇒ dfoe_ (external SSO, EE-only).
    subject_issuer is non-NULL for all rows the app writes — Postgres
    treats NULLs as distinct in unique indices, so the partial unique
    index on (subject_email, subject_issuer, client_id, device_label)
    WHERE revoked_at IS NULL would otherwise fail to rotate in place.
    """

    __tablename__ = "openapi_oauth_access_tokens"
    # The constraint name predates the table rename (migration e3a7c5d9f182).
    __table_args__ = (sa.PrimaryKeyConstraint("id", name="oauth_access_tokens_pkey"),)

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    # Indexed text columns are bounded VARCHARs so the schema is portable
    # across PostgreSQL and MySQL (MySQL cannot index TEXT without a prefix
    # length). 255 chars accommodates RFC-compliant emails and typical
    # OIDC issuer URLs / device labels.
    subject_email: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    client_id: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    device_label: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    prefix: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    subject_issuer: Mapped[str | None] = mapped_column(sa.String(255), nullable=True, default=None)
    account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    token_hash: Mapped[str | None] = mapped_column(sa.String(64), nullable=True, default=None)
    last_used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True, default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True, default=None)

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=func.now(), init=False
    )


class OpenAPIOAuthClient(TypeBase):
    __tablename__ = "openapi_oauth_clients"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="openapi_oauth_clients_pkey"),
        sa.Index("uq_openapi_oauth_clients_client_id", "client_id", unique=True),
        sa.Index("idx_openapi_oauth_clients_unused", "last_token_at", "created_at"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    client_id: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    kind: Mapped[OAuthClientKind] = mapped_column(EnumText(OAuthClientKind, length=32), nullable=False)
    display_name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    redirect_uris: Mapped[list[str]] = mapped_column(AdjustedJSON, nullable=False)
    grant_types: Mapped[list[str]] = mapped_column(AdjustedJSON, nullable=False)
    client_secret_hash: Mapped[str | None] = mapped_column(sa.String(64), nullable=True, default=None)
    logo_uri: Mapped[str | None] = mapped_column(sa.String(1024), nullable=True, default=None)

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=func.now(), init=False
    )
    last_token_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True, default=None, init=False
    )


class OpenAPIOAuthRefreshToken(TypeBase):
    __tablename__ = "openapi_oauth_refresh_tokens"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="openapi_oauth_refresh_tokens_pkey"),
        sa.Index("uq_openapi_oauth_refresh_tokens_token_hash", "token_hash", unique=True),
        sa.Index(
            "idx_openapi_oauth_refresh_tokens_grant",
            "subject_email",
            "subject_issuer",
            "client_id",
            "device_label",
            mysql_length={"subject_email": 191, "subject_issuer": 191, "device_label": 191},
        ),
        sa.Index("idx_openapi_oauth_refresh_tokens_account_id", "account_id"),
        sa.Index("idx_openapi_oauth_refresh_tokens_family_id", "family_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    family_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    token_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    subject_email: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    subject_issuer: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    client_id: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    device_label: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    workspace_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    rotated_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True, default=None)

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=func.now(), init=False
    )
