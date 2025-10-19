import contextlib
from copy import deepcopy
from typing import Any, Protocol

from core.entities.provider_entities import BasicProviderConfig
from core.helper import encrypter
from core.helper.provider_cache import SingletonProviderCredentialsCache
from core.tools.__base.tool_provider import ToolProviderController


class ProviderConfigCache(Protocol):
    """
    Interface for provider configuration cache operations
    """

    def get(self) -> dict | None:
        """Get cached provider configuration"""
        ...

    def set(self, config: dict[str, Any]):
        """Cache provider configuration"""
        ...

    def delete(self):
        """Delete cached provider configuration"""
        ...


class ProviderConfigEncrypter:
    tenant_id: str
    config: list[BasicProviderConfig]
    provider_config_cache: ProviderConfigCache

    def __init__(
        self,
        tenant_id: str,
        config: list[BasicProviderConfig],
        provider_config_cache: ProviderConfigCache,
    ):
        self.tenant_id = tenant_id
        self.config = config
        self.provider_config_cache = provider_config_cache

    def _deep_copy(self, data: dict[str, str]) -> dict[str, str]:
        """
        deep copy data
        """
        return deepcopy(data)

    def encrypt(self, data: dict[str, str]) -> dict[str, str]:
        """
        encrypt tool credentials with tenant id

        return a deep copy of credentials with encrypted values
        """
        data = self._deep_copy(data)

        # get fields need to be decrypted
        fields = dict[str, BasicProviderConfig]()
        for credential in self.config:
            fields[credential.name] = credential

        for field_name, field in fields.items():
            if field.type == BasicProviderConfig.Type.SECRET_INPUT:
                if field_name in data:
                    encrypted = encrypter.encrypt_token(self.tenant_id, data[field_name] or "")
                    data[field_name] = encrypted

        return data

    def mask_tool_credentials(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        mask tool credentials

        return a deep copy of credentials with masked values
        """
        data = self._deep_copy(data)

        # get fields need to be decrypted
        fields = dict[str, BasicProviderConfig]()
        for credential in self.config:
            fields[credential.name] = credential

        for field_name, field in fields.items():
            if field.type == BasicProviderConfig.Type.SECRET_INPUT:
                if field_name in data:
                    if len(data[field_name]) > 6:
                        data[field_name] = (
                            data[field_name][:2] + "*" * (len(data[field_name]) - 4) + data[field_name][-2:]
                        )
                    else:
                        data[field_name] = "*" * len(data[field_name])

        return data

    def decrypt(self, data: dict[str, str]) -> dict[str, Any]:
        """
        decrypt tool credentials with tenant id

        return a deep copy of credentials with decrypted values
        """
        cached_credentials = self.provider_config_cache.get()
        if cached_credentials:
            return cached_credentials

        data = self._deep_copy(data)
        # get fields need to be decrypted
        fields = dict[str, BasicProviderConfig]()
        for credential in self.config:
            fields[credential.name] = credential

        for field_name, field in fields.items():
            if field.type == BasicProviderConfig.Type.SECRET_INPUT:
                if field_name in data:
                    with contextlib.suppress(Exception):
                        # if the value is None or empty string, skip decrypt
                        if not data[field_name]:
                            continue

                        data[field_name] = encrypter.decrypt_token(self.tenant_id, data[field_name])

        self.provider_config_cache.set(data)
        return data


def create_provider_encrypter(
    tenant_id: str, config: list[BasicProviderConfig], cache: ProviderConfigCache
) -> tuple[ProviderConfigEncrypter, ProviderConfigCache]:
    return ProviderConfigEncrypter(tenant_id=tenant_id, config=config, provider_config_cache=cache), cache


def create_tool_provider_encrypter(
    tenant_id: str, controller: ToolProviderController
) -> tuple[ProviderConfigEncrypter, ProviderConfigCache]:
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
