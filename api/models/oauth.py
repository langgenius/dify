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

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    plugin_id: Mapped[str] = db.Column(StringUUID, nullable=False)
    provider: Mapped[str] = db.Column(db.String(255), nullable=False)
    system_credentials: Mapped[dict] = db.Column(JSONB, nullable=False)


class DatasourceProvider(Base):
    __tablename__ = "datasource_providers"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="datasource_provider_pkey"),
        db.UniqueConstraint("plugin_id", "provider", "auth_type", name="datasource_provider_auth_type_provider_idx"),
    )
    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    provider: Mapped[str] = db.Column(db.String(255), nullable=False)
    plugin_id: Mapped[str] = db.Column(db.TEXT, nullable=False)
    auth_type: Mapped[str] = db.Column(db.String(255), nullable=False)
    encrypted_credentials: Mapped[dict] = db.Column(JSONB, nullable=False)
    created_at: Mapped[datetime] = db.Column(db.DateTime, nullable=False, default=datetime.now)
    updated_at: Mapped[datetime] = db.Column(db.DateTime, nullable=False, default=datetime.now)
