from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

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
    is_default: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"), default=False)
    expires_at: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="-1", default=-1)
    visibility: Mapped[PermissionEnum] = mapped_column(
        EnumText(PermissionEnum, length=40),
        nullable=False,
        server_default=sa.text("'all_team_members'"),
        default=PermissionEnum.ALL_TEAM,
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


class OAuthAccessToken(TypeBase):
    """Device-flow bearer. account_id NOT NULL ⇒ dfoa_ (Dify account,
    subject_issuer = "dify:account" sentinel); account_id NULL +
    subject_issuer = verified IdP issuer ⇒ dfoe_ (external SSO, EE-only).
    subject_issuer is non-NULL for all rows the app writes — Postgres
    treats NULLs as distinct in unique indices, so the partial unique
    index on (subject_email, subject_issuer, client_id, device_label)
    WHERE revoked_at IS NULL would otherwise fail to rotate in place.
    """

    __tablename__ = "oauth_access_tokens"
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
