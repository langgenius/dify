# Import generic components from provider_encryption module
from core.helper.provider_encryption import (
    ProviderConfigCache,
    ProviderConfigEncrypter,
    create_provider_encrypter,
)

# Re-export for backward compatibility
__all__ = [
    "ProviderConfigCache",
    "ProviderConfigEncrypter",
    "create_provider_encrypter",
    "create_tool_provider_encrypter",
]

# Tool-specific imports
from core.helper.provider_cache import SingletonProviderCredentialsCache
from core.tools.__base.tool_provider import ToolProviderController


def create_tool_provider_encrypter(tenant_id: str, controller: ToolProviderController):
    cache = SingletonProviderCredentialsCache(
        tenant_id=tenant_id,
        provider_type=controller.provider_type.value,
        provider_identity=controller.entity.identity.name,
    )
    encrypt = ProviderConfigEncrypter(
        tenant_id=tenant_id,
        config=[x.to_basic_provider_config() for x in controller.get_credentials_schema()],
        provider_config_cache=cache,
    )
    return encrypt, cache
