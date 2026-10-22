"""Read visible trigger subscriptions and mask their credentials outside the query transaction."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

from core.entities.provider_entities import BasicProviderConfig
from core.helper.provider_encryption import create_provider_encrypter
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.api_entities import TriggerProviderSubscriptionApiEntity
from core.trigger.utils.encryption import TriggerProviderCredentialsCache, TriggerProviderPropertiesCache
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from models.provider_ids import TriggerProviderID
from services.credentials.query import CredentialQuery


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
    """

    def __init__(self, *, credentials: CredentialQuery, schemas: TriggerSubscriptionSchemaQuery) -> None:
        self._credentials = credentials
        self._schemas = schemas

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
