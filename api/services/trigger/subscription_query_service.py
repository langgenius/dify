"""Prepare masked console listings and decrypted runtime subscriptions after SQL reads close."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

from core.entities.provider_entities import BasicProviderConfig
from core.helper.provider_encryption import create_provider_encrypter
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.api_entities import TriggerProviderSubscriptionApiEntity
from core.trigger.entities.entities import Subscription
from core.trigger.utils.encryption import TriggerProviderCredentialsCache, TriggerProviderPropertiesCache
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from models.provider_ids import TriggerProviderID
from services.credentials.query import CredentialQuery

if TYPE_CHECKING:
    from services.trigger.subscription_service import TriggerSubscriptionSnapshot


@dataclass(frozen=True, slots=True)
class TriggerSubscriptionRuntime:
    """Detached, unmasked subscription data for internal event execution only."""

    id: str
    tenant_id: str
    user_id: str
    provider_id: str
    endpoint_id: str
    credential_type: CredentialType
    credentials: Mapping[str, Any] = field(repr=False)
    subscription: Subscription = field(repr=False)


class TriggerSubscriptionRuntimeReader(Protocol):
    def get_for_execution(self, *, tenant_id: str, subscription_id: str) -> TriggerSubscriptionRuntime | None: ...


class TriggerSubscriptionReader(Protocol):
    def get(self, *, tenant_id: str, subscription_id: str) -> TriggerSubscriptionSnapshot | None: ...


@dataclass(frozen=True, slots=True)
class TriggerSubscriptionSchemas:
    credentials: Mapping[CredentialType, list[BasicProviderConfig]]
    properties: list[BasicProviderConfig]


class TriggerSubscriptionSchemaQuery(Protocol):
    def get_subscription_schemas(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        credential_types: frozenset[CredentialType],
    ) -> TriggerSubscriptionSchemas: ...


class TriggerSubscriptionQueryService:
    """Compose visible records with plugin schemas after the read session closes.

    Credential decryption and caching remain with the shared encryption helpers.
    TODO: Remove the shared RSA key provider's scoped-session dependency when
    tenant key reads return detached values.
    """

    def __init__(
        self,
        *,
        credentials: CredentialQuery,
        schemas: TriggerSubscriptionSchemaQuery,
        subscriptions: TriggerSubscriptionReader,
    ) -> None:
        self._credentials = credentials
        self._schemas = schemas
        self._subscriptions = subscriptions

    def get_for_execution(self, *, tenant_id: str, subscription_id: str) -> TriggerSubscriptionRuntime | None:
        """Read an exact workspace subscription; None means missing or outside that workspace.

        Runtime execution uses the stored owner, independently of console list visibility.
        The returned credentials and properties are unmasked and must not be returned by an API.
        """
        if not subscription_id:
            return None
        row = self._subscriptions.get(tenant_id=tenant_id, subscription_id=subscription_id)
        if row is None:
            return None

        provider_id = TriggerProviderID(row.provider_id)
        schemas = self._schemas.get_subscription_schemas(
            tenant_id=row.tenant_id,
            provider_id=provider_id,
            credential_types=frozenset({row.credential_type}),
        )
        credential_encrypter, _ = create_provider_encrypter(
            tenant_id=row.tenant_id,
            config=schemas.credentials[row.credential_type],
            cache=TriggerProviderCredentialsCache(
                tenant_id=row.tenant_id, provider_id=str(provider_id), credential_id=row.id
            ),
        )
        credentials = credential_encrypter.decrypt(row.credentials)
        properties_encrypter, _ = create_provider_encrypter(
            tenant_id=row.tenant_id,
            config=schemas.properties,
            cache=TriggerProviderPropertiesCache(
                tenant_id=row.tenant_id, provider_id=str(provider_id), subscription_id=row.id
            ),
        )
        return TriggerSubscriptionRuntime(
            id=row.id,
            tenant_id=row.tenant_id,
            user_id=row.user_id,
            provider_id=row.provider_id,
            endpoint_id=row.endpoint_id,
            credential_type=row.credential_type,
            credentials=dict(credentials),
            subscription=Subscription(
                expires_at=row.expires_at,
                endpoint=generate_plugin_trigger_endpoint_url(row.endpoint_id),
                parameters=row.parameters,
                properties=dict(properties_encrypter.decrypt(row.properties)),
            ),
        )

    def list(
        self, *, tenant_id: str, account_id: str, provider_id: TriggerProviderID
    ) -> list[TriggerProviderSubscriptionApiEntity]:
        rows = self._credentials.list_trigger_subscriptions(
            workspace_id=tenant_id,
            provider=str(provider_id),
            actor_id=account_id,
        )
        if not rows:
            return []

        schemas = self._schemas.get_subscription_schemas(
            tenant_id=tenant_id,
            provider_id=provider_id,
            credential_types=frozenset(row.credential_type for row in rows),
        )
        subscriptions: list[TriggerProviderSubscriptionApiEntity] = []
        for row in rows:
            credential_encrypter, _ = create_provider_encrypter(
                tenant_id=tenant_id,
                config=schemas.credentials[row.credential_type],
                cache=TriggerProviderCredentialsCache(
                    tenant_id=tenant_id,
                    provider_id=str(provider_id),
                    credential_id=row.id,
                ),
            )
            properties_encrypter, _ = create_provider_encrypter(
                tenant_id=tenant_id,
                config=schemas.properties,
                cache=TriggerProviderPropertiesCache(
                    tenant_id=tenant_id,
                    provider_id=str(provider_id),
                    subscription_id=row.id,
                ),
            )
            subscriptions.append(
                TriggerProviderSubscriptionApiEntity(
                    id=row.id,
                    name=row.name,
                    provider=row.provider,
                    credential_type=row.credential_type,
                    credentials=dict(
                        credential_encrypter.mask_credentials(credential_encrypter.decrypt(row.credentials))
                    ),
                    endpoint=generate_plugin_trigger_endpoint_url(row.endpoint_id),
                    parameters=dict(row.parameters),
                    properties=dict(
                        properties_encrypter.mask_credentials(properties_encrypter.decrypt(row.properties))
                    ),
                    workflows_in_use=row.workflows_in_use,
                )
            )
        return subscriptions
