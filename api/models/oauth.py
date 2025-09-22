from datetime import datetime

from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped

from .base import Base
from .engine import db
from .types import StringUUID


class DatasourceOauthParamConfig(Base):  # type: ignore[name-defined]
    __tablename__ = "datasource_oauth_params"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="datasource_oauth_config_pkey"),
        db.UniqueConstraint("plugin_id", "provider", name="datasource_oauth_config_datasource_id_provider_idx"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuidv7()"))
    plugin_id: Mapped[str] = db.Column(db.String(255), nullable=False)
    provider: Mapped[str] = db.Column(db.String(255), nullable=False)
    system_credentials: Mapped[dict] = db.Column(JSONB, nullable=False)


class DatasourceProvider(Base):
    __tablename__ = "datasource_providers"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="datasource_provider_pkey"),
        db.UniqueConstraint("tenant_id", "plugin_id", "provider", "name", name="datasource_provider_unique_name"),
        db.Index("datasource_provider_auth_type_provider_idx", "tenant_id", "plugin_id", "provider"),
    )
    id = db.Column(StringUUID, server_default=db.text("uuidv7()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    name: Mapped[str] = db.Column(db.String(255), nullable=False)
    provider: Mapped[str] = db.Column(db.String(255), nullable=False)
    plugin_id: Mapped[str] = db.Column(db.String(255), nullable=False)
    auth_type: Mapped[str] = db.Column(db.String(255), nullable=False)
    encrypted_credentials: Mapped[dict] = db.Column(JSONB, nullable=False)
    avatar_url: Mapped[str] = db.Column(db.String(255), nullable=True, default="default")
    is_default: Mapped[bool] = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    expires_at: Mapped[int] = db.Column(db.Integer, nullable=False, server_default="-1")

    created_at: Mapped[datetime] = db.Column(db.DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = db.Column(db.DateTime, nullable=False, default=datetime.now)


class DatasourceOauthTenantParamConfig(Base):
    __tablename__ = "datasource_oauth_tenant_params"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="datasource_oauth_tenant_config_pkey"),
        db.UniqueConstraint("tenant_id", "plugin_id", "provider", name="datasource_oauth_tenant_config_unique"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuidv7()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider: Mapped[str] = db.Column(db.String(255), nullable=False)
    plugin_id: Mapped[str] = db.Column(db.String(255), nullable=False)
    client_params: Mapped[dict] = db.Column(JSONB, nullable=False, default={})
    enabled: Mapped[bool] = db.Column(db.Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = db.Column(db.DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = db.Column(db.DateTime, nullable=False, default=datetime.now)
