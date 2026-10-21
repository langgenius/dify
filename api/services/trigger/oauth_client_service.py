"""Trigger OAuth client configuration and credential masking."""

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol, cast

from constants import HIDDEN_VALUE, UNKNOWN_VALUE
from core.entities.provider_entities import ProviderConfig
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.helper.provider_encryption import create_provider_encrypter
from core.trigger.provider import PluginTriggerProviderController
from models.provider_ids import TriggerProviderID


class TriggerOAuthClientConfigError(Exception):
    """The stored tenant OAuth client configuration cannot be read."""


class TriggerOAuthClientChangedError(Exception):
    """The OAuth client was created or removed while settings were being prepared."""


@dataclass(frozen=True, slots=True)
class TriggerOAuthTenantClientRecord:
    id: str
    encrypted_oauth_params: str
    enabled: bool


@dataclass(frozen=True, slots=True)
class TriggerOAuthClientSnapshot:
    custom: TriggerOAuthTenantClientRecord | None
    system_configured: bool


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
        existing_client_id: str | None,
        encrypted_oauth_params: str,
        enabled: bool | None,
    ) -> None:
        """Create when existing_client_id is None; otherwise update that original client.

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
        # TODO: When migrating OAuth authorize/callback, consolidate these callbacks
        # into a shared provider gateway returning metadata instead of a controller.
        get_provider: Callable[[str, TriggerProviderID], PluginTriggerProviderController],
        is_plugin_verified: Callable[[str, str], bool],
    ) -> None:
        self._clients = clients
        self._get_provider = get_provider
        self._is_plugin_verified = is_plugin_verified

    def get(self, *, tenant_id: str, provider_id: TriggerProviderID) -> TriggerOAuthClientConfiguration:
        snapshot = self._clients.get(tenant_id=tenant_id, provider_id=provider_id)
        provider = self._get_provider(tenant_id, provider_id)
        schema = provider.get_oauth_client_schema()
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
            and self._is_plugin_verified(tenant_id, provider.plugin_unique_identifier),
            custom_enabled=snapshot.custom is not None and snapshot.custom.enabled,
        )

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
        provider = self._get_provider(tenant_id, provider_id)
        encrypted_params = "{}"
        if client_params is not None:
            encrypter, cache = create_provider_encrypter(
                tenant_id=tenant_id,
                config=[field.to_basic_provider_config() for field in provider.get_oauth_client_schema()],
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
            existing_client_id=snapshot.custom.id if snapshot.custom is not None else None,
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
