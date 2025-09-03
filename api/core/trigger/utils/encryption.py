from typing import Union

from core.helper.provider_cache import TriggerProviderCredentialsCache, TriggerProviderOAuthClientParamsCache
from core.helper.provider_encryption import ProviderConfigCache, ProviderConfigEncrypter, create_provider_encrypter
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.api_entities import TriggerProviderSubscriptionApiEntity
from core.trigger.provider import PluginTriggerProviderController
from models.trigger import TriggerSubscription


def create_trigger_provider_encrypter_for_subscription(
    tenant_id: str,
    controller: PluginTriggerProviderController,
    subscription: Union[TriggerSubscription, TriggerProviderSubscriptionApiEntity],
) -> tuple[ProviderConfigEncrypter, ProviderConfigCache]:
    cache = TriggerProviderCredentialsCache(
        tenant_id=tenant_id,
        provider_id=str(controller.get_provider_id()),
        credential_id=subscription.id,
    )
    encrypter, _ = create_provider_encrypter(
        tenant_id=tenant_id,
        config=controller.get_credential_schema_config(subscription.credential_type),
        cache=cache,
    )
    return encrypter, cache


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


def create_trigger_provider_oauth_encrypter(
    tenant_id: str, controller: PluginTriggerProviderController
) -> tuple[ProviderConfigEncrypter, ProviderConfigCache]:
    cache = TriggerProviderOAuthClientParamsCache(
        tenant_id=tenant_id,
        provider_id=str(controller.get_provider_id()),
    )
    encrypter, _ = create_provider_encrypter(
        tenant_id=tenant_id,
        config=[x.to_basic_provider_config() for x in controller.get_oauth_client_schema()],
        cache=cache,
    )
    return encrypter, cache
