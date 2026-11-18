"""Adapt existing provider encryption to the subscription service's codec port."""

from core.entities.provider_entities import BasicProviderConfig
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.helper.provider_encryption import create_provider_encrypter
from services.trigger.subscription_service import TriggerSubscriptionCipher


class ProviderTriggerSubscriptionCodec:
    """Use the existing workspace key provider for schema-defined secret fields."""

    def for_schema(self, *, tenant_id: str, schema: list[BasicProviderConfig]) -> TriggerSubscriptionCipher:
        """Create an uncached provider cipher scoped to the workspace and schema."""
        encrypter, _ = create_provider_encrypter(
            tenant_id=tenant_id, config=schema, cache=NoOpProviderCredentialCache()
        )
        return encrypter
