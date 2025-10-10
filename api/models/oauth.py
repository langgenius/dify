from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .engine import db
from .types import StringUUID


class DatasourceOauthParamConfig(Base):  # type: ignore[name-defined]
    __tablename__ = "datasource_oauth_params"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="datasource_oauth_config_pkey"),
        db.UniqueConstraint("plugin_id", "provider", name="datasource_oauth_config_datasource_id_provider_idx"),
    )

    id = mapped_column(StringUUID, server_default=db.text("uuidv7()"))
    plugin_id: Mapped[str] = mapped_column(db.String(255), nullable=False)
    provider: Mapped[str] = mapped_column(db.String(255), nullable=False)
    system_credentials: Mapped[dict] = mapped_column(JSONB, nullable=False)


class DatasourceProvider(Base):
    __tablename__ = "datasource_providers"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="datasource_provider_pkey"),
        db.UniqueConstraint("tenant_id", "plugin_id", "provider", "name", name="datasource_provider_unique_name"),
        db.Index("datasource_provider_auth_type_provider_idx", "tenant_id", "plugin_id", "provider"),
    )
    id = mapped_column(StringUUID, server_default=db.text("uuidv7()"))
    tenant_id = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(db.String(255), nullable=False)
    provider: Mapped[str] = mapped_column(db.String(255), nullable=False)
    plugin_id: Mapped[str] = mapped_column(db.String(255), nullable=False)
    auth_type: Mapped[str] = mapped_column(db.String(255), nullable=False)
    encrypted_credentials: Mapped[dict] = mapped_column(JSONB, nullable=False)
    avatar_url: Mapped[str] = mapped_column(sa.Text, nullable=True, default="default")
    is_default: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=db.text("false"))
    expires_at: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="-1")

    created_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, default=datetime.now)


class DatasourceOauthTenantParamConfig(Base):
    __tablename__ = "datasource_oauth_tenant_params"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="datasource_oauth_tenant_config_pkey"),
        db.UniqueConstraint("tenant_id", "plugin_id", "provider", name="datasource_oauth_tenant_config_unique"),
    )

    id = mapped_column(StringUUID, server_default=db.text("uuidv7()"))
    tenant_id = mapped_column(StringUUID, nullable=False)
    provider: Mapped[str] = mapped_column(db.String(255), nullable=False)
    plugin_id: Mapped[str] = mapped_column(db.String(255), nullable=False)
    client_params: Mapped[dict] = mapped_column(JSONB, nullable=False, default={})
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, default=datetime.now)
