import json
import time
from datetime import datetime
from typing import cast

import sqlalchemy as sa
from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.api_entities import TriggerProviderCredentialApiEntity
from models.base import Base
from models.types import StringUUID


class TriggerProvider(Base):
    """
    Trigger provider model for managing credentials
    Supports multiple credential instances per provider
    """

    __tablename__ = "trigger_providers"
    __table_args__ = (Index("idx_trigger_providers_tenant_provider", "tenant_id", "provider_id"),)

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_id: Mapped[str] = mapped_column(
        String(255), nullable=False, comment="Provider identifier (e.g., plugin_id/provider_name)"
    )
    credential_type: Mapped[str] = mapped_column(String(50), nullable=False, comment="oauth or api_key")
    encrypted_credentials: Mapped[str] = mapped_column(Text, nullable=False, comment="Encrypted credentials JSON")
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="Credential instance name")
    expires_at: Mapped[int] = mapped_column(
        Integer, default=-1, comment="OAuth token expiration timestamp, -1 for never"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    @property
    def credentials(self) -> dict:
        """Get credentials as dict (still encrypted)"""
        try:
            return json.loads(self.encrypted_credentials) if self.encrypted_credentials else {}
        except (json.JSONDecodeError, TypeError):
            return {}

    def is_oauth_expired(self) -> bool:
        """Check if OAuth token is expired"""
        if self.credential_type != CredentialType.OAUTH2.value:
            return False
        if self.expires_at == -1:
            return False
        # Check if token expires in next 3 minutes
        return (self.expires_at - 180) < int(time.time())

    def to_api_entity(self) -> TriggerProviderCredentialApiEntity:
        return TriggerProviderCredentialApiEntity(
            id=self.id,
            name=self.name,
            provider=self.provider_id,
            credential_type=CredentialType(self.credential_type),
            credentials=self.credentials,
        )

# system level trigger oauth client params
class TriggerOAuthSystemClient(Base):
    __tablename__ = "trigger_oauth_system_clients"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="trigger_oauth_system_client_pkey"),
        sa.UniqueConstraint("plugin_id", "provider", name="trigger_oauth_system_client_plugin_id_provider_idx"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    plugin_id: Mapped[str] = mapped_column(String(512), nullable=False)
    provider: Mapped[str] = mapped_column(String(255), nullable=False)
    # oauth params of the trigger provider
    encrypted_oauth_params: Mapped[str] = mapped_column(sa.Text, nullable=False)


# tenant level trigger oauth client params (client_id, client_secret, etc.)
class TriggerOAuthTenantClient(Base):
    __tablename__ = "trigger_oauth_tenant_clients"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="trigger_oauth_tenant_client_pkey"),
        sa.UniqueConstraint("tenant_id", "plugin_id", "provider", name="unique_trigger_oauth_tenant_client"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    # tenant id
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    plugin_id: Mapped[str] = mapped_column(String(512), nullable=False)
    provider: Mapped[str] = mapped_column(String(255), nullable=False)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("true"))
    # oauth params of the trigger provider
    encrypted_oauth_params: Mapped[str] = mapped_column(sa.Text, nullable=False)

    @property
    def oauth_params(self) -> dict:
        return cast(dict, json.loads(self.encrypted_oauth_params or "{}"))
