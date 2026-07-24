import contextlib
from collections.abc import Mapping
from copy import deepcopy
from typing import Any, Protocol

from core.entities.provider_entities import BasicProviderConfig
from core.helper import encrypter


class ProviderConfigCache(Protocol):
    """
    Interface for provider configuration cache operations
    """

    def get(self) -> dict[str, Any] | None:
        """Get cached provider configuration"""
        ...

    def set(self, config: dict[str, Any]) -> None:
        """Cache provider configuration"""
        ...

    def delete(self) -> None:
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

    def _deep_copy(self, data: Mapping[str, Any]) -> Mapping[str, Any]:
        """
        deep copy data
        """
        return deepcopy(data)

    def encrypt(self, data: Mapping[str, Any]) -> Mapping[str, Any]:
        """
        encrypt tool credentials with tenant id

        return a deep copy of credentials with encrypted values
        """
        data = dict(self._deep_copy(data))

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

    def mask_credentials(self, data: Mapping[str, Any]) -> Mapping[str, Any]:
        """
        mask credentials

        return a deep copy of credentials with masked values
        """
        data = dict(self._deep_copy(data))

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

    def mask_plugin_credentials(self, data: Mapping[str, Any]) -> Mapping[str, Any]:
        return self.mask_credentials(data)

    def decrypt(self, data: Mapping[str, Any]) -> Mapping[str, Any]:
        """
        decrypt tool credentials with tenant id

        return a deep copy of credentials with decrypted values
        """
        cached_credentials = self.provider_config_cache.get()
        if cached_credentials:
            return cached_credentials

        data = dict(self._deep_copy(data))
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

        self.provider_config_cache.set(dict(data))
        return data


def create_provider_encrypter(tenant_id: str, config: list[BasicProviderConfig], cache: ProviderConfigCache):
    return ProviderConfigEncrypter(tenant_id=tenant_id, config=config, provider_config_cache=cache), cache
