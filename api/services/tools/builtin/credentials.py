"""Resolve provider OAuth client metadata outside database transactions."""

from core.helper.provider_cache import NoOpProviderCredentialCache
from core.plugin.plugin_service import PluginService
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.utils.encryption import create_provider_encrypter
from core.tools.utils.system_encryption import decrypt_system_params
from models.provider_ids import ToolProviderID
from services.plugin.dispatch_identity import PluginOAuthClientConfig
from services.tools.provider_queries import ToolProviders


def resolve_oauth_client(
    *,
    providers: ToolProviders,
    controller: PluginToolProviderController,
    tenant_id: str,
    provider_id: str,
) -> PluginOAuthClientConfig | None:
    provider = ToolProviderID(provider_id)
    config = providers.oauth_client(
        tenant_id=tenant_id,
        plugin_id=provider.plugin_id,
        provider=provider.provider_name,
    )
    if config.tenant_params is not None:
        encrypter, _ = create_provider_encrypter(
            tenant_id=tenant_id,
            config=[field.to_basic_provider_config() for field in controller.get_oauth_client_schema()],
            cache=NoOpProviderCredentialCache(),
        )
        return PluginOAuthClientConfig(
            controller.plugin_unique_identifier,
            dict(encrypter.decrypt(config.tenant_params)),
        )
    if config.system_params is None:
        return None
    if not PluginService.is_plugin_verified(tenant_id, controller.plugin_unique_identifier):
        return None
    return PluginOAuthClientConfig(
        controller.plugin_unique_identifier,
        dict(decrypt_system_params(config.system_params)),
    )
