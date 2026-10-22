"""Trigger OAuth client configuration and credential masking."""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol, cast

from constants import HIDDEN_VALUE, UNKNOWN_VALUE
from core.entities.provider_entities import ProviderConfig
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.helper.provider_encryption import create_provider_encrypter
from core.tools.utils.system_encryption import EncryptionError, decrypt_system_params
from models.provider_ids import TriggerProviderID
from services.plugin.dispatch_identity import PluginOAuthClientConfig


class TriggerOAuthClientConfigError(Exception):
    """The stored tenant or system OAuth client configuration cannot be read."""


class TriggerOAuthClientChangedError(Exception):
    """The OAuth client changed while settings were being prepared."""


@dataclass(frozen=True, slots=True)
class TriggerOAuthTenantClientRecord:
    id: str
    encrypted_oauth_params: str
    enabled: bool


@dataclass(frozen=True, slots=True)
class TriggerOAuthClientSnapshot:
    custom: TriggerOAuthTenantClientRecord | None
    # None means no system client exists; an empty ciphertext is corrupt config.
    encrypted_system_oauth_params: str | None

    @property
    def system_configured(self) -> bool:
        return self.encrypted_system_oauth_params is not None


@dataclass(frozen=True, slots=True)
class TriggerOAuthProviderMetadata:
    schema: list[ProviderConfig]
    plugin_unique_identifier: str


class TriggerOAuthProviderMetadataGateway(Protocol):
    """Read only the plugin metadata needed to configure and resolve OAuth clients."""

    def get_metadata(self, *, tenant_id: str, provider_id: TriggerProviderID) -> TriggerOAuthProviderMetadata: ...

    def is_verified(self, *, tenant_id: str, plugin_unique_identifier: str) -> bool: ...


@dataclass(frozen=True, slots=True)
class TriggerOAuthClientConfiguration:
    schema: list[ProviderConfig]
    params: Mapping[str, object]
    system_configured: bool
    custom_enabled: bool


class TriggerOAuthClientStore(Protocol):
    """Persistence operations finish their sessions before returning."""

    def get(self, *, tenant_id: str, provider_id: TriggerProviderID) -> TriggerOAuthClientSnapshot: ...

    def save(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        expected: TriggerOAuthTenantClientRecord | None,
        encrypted_oauth_params: str,
        enabled: bool | None,
    ) -> None:
        """Create when expected is None; otherwise update only an unchanged snapshot.

        None enabled leaves it unchanged or uses the new-row default.
        """
        ...

    def delete(self, *, tenant_id: str, provider_id: TriggerProviderID) -> None: ...


class TriggerOAuthClientService:
    """Handle credentials outside repository transactions.

    TODO: The shared RSA key provider still owns a scoped DB session; remove that
    dependency when its tenant key reads return detached values.
    """

    def __init__(
        self,
        *,
        clients: TriggerOAuthClientStore,
        providers: TriggerOAuthProviderMetadataGateway,
    ) -> None:
        self._clients = clients
        self._providers = providers

    def get(self, *, tenant_id: str, provider_id: TriggerProviderID) -> TriggerOAuthClientConfiguration:
        snapshot = self._clients.get(tenant_id=tenant_id, provider_id=provider_id)
        provider = self._providers.get_metadata(tenant_id=tenant_id, provider_id=provider_id)
        schema = provider.schema
        params: Mapping[str, object] = {}
        if snapshot.custom is not None:
            encrypter, _ = create_provider_encrypter(
                tenant_id=tenant_id,
                config=[field.to_basic_provider_config() for field in schema],
                cache=NoOpProviderCredentialCache(),
            )
            params = encrypter.mask_plugin_credentials(
                encrypter.decrypt(self._parse_params(snapshot.custom, provider_id))
            )

        return TriggerOAuthClientConfiguration(
            schema=schema,
            params=params,
            system_configured=snapshot.system_configured
            and self._providers.is_verified(
                tenant_id=tenant_id, plugin_unique_identifier=provider.plugin_unique_identifier
            ),
            custom_enabled=snapshot.custom is not None and snapshot.custom.enabled,
        )

    def resolve(self, *, tenant_id: str, provider_id: TriggerProviderID) -> PluginOAuthClientConfig | None:
        """Return credentials bound to their plugin package, or None if no permitted client exists.

        An enabled tenant client takes priority, including an empty configuration.
        Otherwise only a verified plugin may use its system client.
        """
        snapshot = self._clients.get(tenant_id=tenant_id, provider_id=provider_id)
        provider = self._providers.get_metadata(tenant_id=tenant_id, provider_id=provider_id)
        if snapshot.custom is not None and snapshot.custom.enabled:
            encrypter, _ = create_provider_encrypter(
                tenant_id=tenant_id,
                config=[field.to_basic_provider_config() for field in provider.schema],
                cache=NoOpProviderCredentialCache(),
            )
            return PluginOAuthClientConfig(
                plugin_unique_identifier=provider.plugin_unique_identifier,
                credentials=encrypter.decrypt(self._parse_params(snapshot.custom, provider_id)),
            )

        encrypted_system_params = snapshot.encrypted_system_oauth_params
        if encrypted_system_params is None or not self._providers.is_verified(
            tenant_id=tenant_id, plugin_unique_identifier=provider.plugin_unique_identifier
        ):
            return None
        try:
            return PluginOAuthClientConfig(
                plugin_unique_identifier=provider.plugin_unique_identifier,
                credentials=decrypt_system_params(encrypted_system_params),
            )
        except (EncryptionError, ValueError) as error:
            raise TriggerOAuthClientConfigError(
                f"Stored system OAuth client configuration for trigger provider {provider_id} is invalid."
            ) from error

    def save(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        client_params: Mapping[str, object] | None,
        enabled: bool | None,
    ) -> None:
        """Save client settings, preserving the existing request semantics.

        When both values are None this is a no-op. Otherwise None parameters
        clear the saved credentials; None enabled retains the current value.
        """
        if client_params is None and enabled is None:
            return

        snapshot = self._clients.get(tenant_id=tenant_id, provider_id=provider_id)
        provider = self._providers.get_metadata(tenant_id=tenant_id, provider_id=provider_id)
        encrypted_params = "{}"
        if client_params is not None:
            encrypter, cache = create_provider_encrypter(
                tenant_id=tenant_id,
                config=[field.to_basic_provider_config() for field in provider.schema],
                cache=NoOpProviderCredentialCache(),
            )
            original_params = encrypter.decrypt(
                self._parse_params(snapshot.custom, provider_id) if snapshot.custom is not None else {}
            )
            new_params = {
                key: value if value != HIDDEN_VALUE else original_params.get(key, UNKNOWN_VALUE)
                for key, value in client_params.items()
            }
            encrypted_params = json.dumps(encrypter.encrypt(new_params))
            cache.delete()

        self._clients.save(
            tenant_id=tenant_id,
            provider_id=provider_id,
            expected=snapshot.custom,
            encrypted_oauth_params=encrypted_params,
            enabled=enabled,
        )

    def delete(self, *, tenant_id: str, provider_id: TriggerProviderID) -> None:
        self._clients.delete(tenant_id=tenant_id, provider_id=provider_id)

    @staticmethod
    def _parse_params(custom: TriggerOAuthTenantClientRecord, provider_id: TriggerProviderID) -> dict[str, object]:
        try:
            params = json.loads(custom.encrypted_oauth_params or "{}")
        except json.JSONDecodeError as error:
            raise TriggerOAuthClientConfigError(
                f"Stored OAuth client configuration for trigger provider {provider_id} is invalid."
            ) from error
        if not isinstance(params, dict):
            raise TriggerOAuthClientConfigError(
                f"Stored OAuth client configuration for trigger provider {provider_id} must be an object."
            )
        return cast(dict[str, object], params)
