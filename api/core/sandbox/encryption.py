from collections.abc import Mapping
from typing import Any

from core.entities.provider_entities import BasicProviderConfig
from core.helper.provider_cache import ProviderCredentialsCache
from core.helper.provider_encryption import ProviderConfigCache, ProviderConfigEncrypter, create_provider_encrypter


class SandboxProviderConfigCache(ProviderCredentialsCache):
    def __init__(self, tenant_id: str, provider_type: str):
        super().__init__(tenant_id=tenant_id, provider_type=provider_type)

    def _generate_cache_key(self, **kwargs) -> str:
        tenant_id = kwargs["tenant_id"]
        provider_type = kwargs["provider_type"]
        return f"sandbox_config:tenant_id:{tenant_id}:provider_type:{provider_type}"


def create_sandbox_config_encrypter(
    tenant_id: str,
    config_schema: list[BasicProviderConfig],
    provider_type: str,
) -> tuple[ProviderConfigEncrypter, ProviderConfigCache]:
    cache = SandboxProviderConfigCache(tenant_id=tenant_id, provider_type=provider_type)
    return create_provider_encrypter(tenant_id=tenant_id, config=config_schema, cache=cache)


def masked_config(
    schemas: list[BasicProviderConfig],
    config: Mapping[str, Any],
) -> Mapping[str, Any]:
    masked = dict(config)
    configs = {x.name: x for x in schemas}
    for key, value in config.items():
        schema = configs.get(key)
        if not schema:
            masked[key] = value
            continue
        if schema.type == BasicProviderConfig.Type.SECRET_INPUT:
            if not isinstance(value, str):
                continue
            if len(value) <= 4:
                masked[key] = "*" * len(value)
            else:
                masked[key] = value[:2] + "*" * (len(value) - 4) + value[-2:]
        else:
            masked[key] = value
    return masked
