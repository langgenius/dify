from collections.abc import Mapping
from typing import override

from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from core.helper.provider_cache import ProviderCredentialsCache
from core.helper.provider_encryption import ProviderConfigCache, ProviderConfigEncrypter, create_provider_encrypter
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.provider import PluginTriggerProviderController


class TriggerProviderCredentialsCache(ProviderCredentialsCache):
    """Cache for trigger provider credentials"""

    def __init__(self, tenant_id: str, provider_id: str, credential_id: str):
        super().__init__(tenant_id=tenant_id, provider_id=provider_id, credential_id=credential_id)

    @override
    def _generate_cache_key(self, **kwargs) -> str:
        tenant_id = kwargs["tenant_id"]
        provider_id = kwargs["provider_id"]
        credential_id = kwargs["credential_id"]
        return f"trigger_credentials:tenant_id:{tenant_id}:provider_id:{provider_id}:credential_id:{credential_id}"


class TriggerProviderPropertiesCache(ProviderCredentialsCache):
    """Cache for trigger provider properties"""

    def __init__(self, tenant_id: str, provider_id: str, subscription_id: str):
        super().__init__(tenant_id=tenant_id, provider_id=provider_id, subscription_id=subscription_id)

    @override
    def _generate_cache_key(self, **kwargs) -> str:
        tenant_id = kwargs["tenant_id"]
        provider_id = kwargs["provider_id"]
        subscription_id = kwargs["subscription_id"]
        return f"trigger_properties:tenant_id:{tenant_id}:provider_id:{provider_id}:subscription_id:{subscription_id}"


def delete_cache_for_subscription(tenant_id: str, provider_id: str, subscription_id: str):
    TriggerProviderCredentialsCache(
        tenant_id=tenant_id,
        provider_id=provider_id,
        credential_id=subscription_id,
    ).delete()
    TriggerProviderPropertiesCache(
        tenant_id=tenant_id,
        provider_id=provider_id,
        subscription_id=subscription_id,
    ).delete()


def create_trigger_provider_encrypter(
    tenant_id: str, controller: PluginTriggerProviderController, credential_id: str, credential_type: CredentialType
) -> tuple[ProviderConfigEncrypter, ProviderConfigCache]:
    cache = TriggerProviderCredentialsCache(
        tenant_id=tenant_id,
        provider_id=str(controller.get_provider_id()),
        credential_id=credential_id,
    )
    encrypter, _ = create_provider_encrypter(
        tenant_id=tenant_id,
        config=controller.get_credential_schema_config(credential_type),
        cache=cache,
    )
    return encrypter, cache


def masked_credentials(
    schemas: list[ProviderConfig],
    credentials: Mapping[str, str],
) -> Mapping[str, str]:
    masked_credentials = {}
    configs = {x.name: x.to_basic_provider_config() for x in schemas}
    for key, value in credentials.items():
        config = configs.get(key)
        if not config:
            masked_credentials[key] = value
            continue
        if config.type == ProviderConfigType.SECRET_INPUT:
            if len(value) <= 4:
                masked_credentials[key] = "*" * len(value)
            else:
                masked_credentials[key] = value[:2] + "*" * (len(value) - 4) + value[-2:]
        else:
            masked_credentials[key] = value
    return masked_credentials
