from datetime import datetime

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
    system_credentials: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)


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
    encrypted_credentials: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
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
    client_params: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False, default_factory=dict)
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
