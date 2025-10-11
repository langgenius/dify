import json
import time
from datetime import datetime
from typing import cast

import sqlalchemy as sa
from sqlalchemy import DateTime, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.api_entities import TriggerProviderSubscriptionApiEntity
from core.trigger.entities.entities import Subscription
from core.trigger.utils.endpoint import parse_endpoint_id
from models.base import Base
from models.types import StringUUID


class TriggerSubscription(Base):
    """
    Trigger provider model for managing credentials
    Supports multiple credential instances per provider
    """

    __tablename__ = "trigger_subscriptions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="trigger_provider_pkey"),
        Index("idx_trigger_providers_tenant_provider", "tenant_id", "provider_id"),
        # Primary index for O(1) lookup by endpoint
        Index("idx_trigger_providers_endpoint", "endpoint_id", unique=True),
        # Composite index for tenant-specific queries (optional, kept for compatibility)
        Index("idx_trigger_providers_tenant_endpoint", "tenant_id", "endpoint_id"),
        UniqueConstraint("tenant_id", "provider_id", "name", name="unique_trigger_provider"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="Subscription instance name")
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_id: Mapped[str] = mapped_column(
        String(255), nullable=False, comment="Provider identifier (e.g., plugin_id/provider_name)"
    )
    endpoint_id: Mapped[str] = mapped_column(String(255), nullable=False, comment="Subscription endpoint")
    parameters: Mapped[dict] = mapped_column(sa.JSON, nullable=False, comment="Subscription parameters JSON")
    properties: Mapped[dict] = mapped_column(sa.JSON, nullable=False, comment="Subscription properties JSON")

    credentials: Mapped[dict] = mapped_column(sa.JSON, nullable=False, comment="Subscription credentials JSON")
    credential_type: Mapped[str] = mapped_column(String(50), nullable=False, comment="oauth or api_key")
    credential_expires_at: Mapped[int] = mapped_column(
        Integer, default=-1, comment="OAuth token expiration timestamp, -1 for never"
    )
    expires_at: Mapped[int] = mapped_column(
        Integer, default=-1, comment="Subscription instance expiration timestamp, -1 for never"
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
    )

    def is_credential_expired(self) -> bool:
        """Check if credential is expired"""
        if self.credential_expires_at == -1:
            return False
        # Check if token expires in next 3 minutes
        return (self.credential_expires_at - 180) < int(time.time())

    def to_entity(self) -> Subscription:
        return Subscription(
            expires_at=self.expires_at,
            endpoint=parse_endpoint_id(self.endpoint_id),
            parameters=self.parameters,
            properties=self.properties,
        )

    def to_api_entity(self) -> TriggerProviderSubscriptionApiEntity:
        return TriggerProviderSubscriptionApiEntity(
            id=self.id,
            name=self.name,
            provider=self.provider_id,
            endpoint=parse_endpoint_id(self.endpoint_id),
            parameters=self.parameters,
            properties=self.properties,
            credential_type=CredentialType(self.credential_type),
            credentials=self.credentials,
            workflows_in_use=-1,
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
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
    )


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
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
    )

    @property
    def oauth_params(self) -> dict:
        return cast(dict, json.loads(self.encrypted_oauth_params or "{}"))
