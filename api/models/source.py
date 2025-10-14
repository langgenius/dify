import json
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models.base import TypeBase

from .types import StringUUID


class DataSourceOauthBinding(TypeBase):
    __tablename__ = "data_source_oauth_bindings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="source_binding_pkey"),
        sa.Index("source_binding_tenant_id_idx", "tenant_id"),
        sa.Index("source_info_idx", "source_info", postgresql_using="gin"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"), init=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    access_token: Mapped[str] = mapped_column(String(255), nullable=False)
    provider: Mapped[str] = mapped_column(String(255), nullable=False)
    source_info: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )
    disabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=True, server_default=sa.text("false"), default=False)


class DataSourceApiKeyAuthBinding(TypeBase):
    __tablename__ = "data_source_api_key_auth_bindings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="data_source_api_key_auth_binding_pkey"),
        sa.Index("data_source_api_key_auth_binding_tenant_id_idx", "tenant_id"),
        sa.Index("data_source_api_key_auth_binding_provider_idx", "provider"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"), init=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    category: Mapped[str] = mapped_column(String(255), nullable=False)
    provider: Mapped[str] = mapped_column(String(255), nullable=False)
    credentials: Mapped[str | None] = mapped_column(sa.Text, nullable=True, default=None)  # JSON
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )
    disabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=True, server_default=sa.text("false"), default=False)

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "category": self.category,
            "provider": self.provider,
            "credentials": json.loads(self.credentials) if self.credentials else None,
            "created_at": self.created_at.timestamp(),
            "updated_at": self.updated_at.timestamp(),
            "disabled": self.disabled,
        }
