"""Plugin and persistence adapters for datasource credential application ports."""

from collections.abc import Callable, Mapping, Sequence
from typing import Protocol

from configs import dify_config
from core.helper import encrypter
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.datasource import PluginDatasourceManager
from core.plugin.impl.oauth import OAuthHandler
from core.plugin.plugin_service import PluginService
from core.tools.utils.encryption import create_provider_encrypter
from graphon.model_runtime.entities.provider_entities import FormType
from models.provider_ids import DatasourceProviderID
from services.data_source.credential_gateway import (
    DatasourceCredentialError,
    DatasourceCredentialRefreshError,
    RefreshedDatasourceCredential,
)
from services.entities.data_source.credential import DatasourceCredentialRecord, DatasourceOAuthClientConfigRecord


class DatasourceOAuthClientConfigReader(Protocol):
    def get_oauth_client_config(
        self,
        *,
        workspace_id: str,
        provider: str,
        plugin_id: str,
    ) -> DatasourceOAuthClientConfigRecord: ...


class DatasourceOAuthClientResolver(Protocol):
    def resolve(self, *, workspace_id: str, provider_id: DatasourceProviderID) -> dict[str, object]: ...


class PluginDatasourceCredentialCodec:
    def __init__(self, provider_manager: PluginDatasourceManager) -> None:
        self._provider_manager = provider_manager

    def decrypt(self, record: DatasourceCredentialRecord) -> dict[str, object]:
        return transform_secret_fields(
            record.workspace_id, record.encrypted_credentials, self._secret_variables(record), encrypter.decrypt_token
        )

    def encrypt(self, record: DatasourceCredentialRecord, credentials: Mapping[str, object]) -> dict[str, object]:
        return transform_secret_fields(
            record.workspace_id, credentials, self._secret_variables(record), encrypter.encrypt_token
        )

    def _secret_variables(self, record: DatasourceCredentialRecord) -> tuple[str, ...]:
        return datasource_secret_variables(
            self._provider_manager,
            record.workspace_id,
            f"{record.plugin_id}/{record.provider}",
            CredentialType.of(record.auth_type),
        )


def transform_secret_fields(
    workspace_id: str,
    credentials: Mapping[str, object],
    secret_variables: Sequence[str],
    transform: Callable[[str, str], str],
) -> dict[str, object]:
    """Apply the shared token codec only to declared string secrets."""
    result = dict(credentials)
    for name in secret_variables:
        value = result.get(name)
        if isinstance(value, str):
            result[name] = transform(workspace_id, value)
    return result


def datasource_secret_variables(
    manager: PluginDatasourceManager, workspace_id: str, provider_id: str, credential_type: CredentialType
) -> tuple[str, ...]:
    provider = manager.fetch_datasource_provider(tenant_id=workspace_id, provider_id=provider_id)
    if credential_type == CredentialType.API_KEY:
        schemas = provider.declaration.credentials_schema
    elif credential_type == CredentialType.OAUTH2:
        if provider.declaration.oauth_schema is None:
            raise DatasourceCredentialError("Datasource provider oauth schema not found")
        schemas = provider.declaration.oauth_schema.credentials_schema
    else:
        raise DatasourceCredentialError(f"Unsupported credential type: {credential_type}")
    return tuple(schema.name for schema in schemas if schema.type.value == FormType.SECRET_INPUT)


class PluginDatasourceOAuthClientResolver:
    """Turn detached OAuth client rows into plugin-ready credentials."""

    def __init__(
        self,
        *,
        configs: DatasourceOAuthClientConfigReader,
        provider_manager: PluginDatasourceManager,
    ) -> None:
        self._configs = configs
        self._provider_manager = provider_manager

    def resolve(self, *, workspace_id: str, provider_id: DatasourceProviderID) -> dict[str, object]:
        config = self._configs.get_oauth_client_config(
            workspace_id=workspace_id,
            provider=provider_id.provider_name,
            plugin_id=provider_id.plugin_id,
        )
        return resolve_datasource_oauth_client(
            config, workspace_id=workspace_id, provider_id=provider_id, provider_manager=self._provider_manager
        )


def resolve_datasource_oauth_client(
    config: DatasourceOAuthClientConfigRecord,
    *,
    workspace_id: str,
    provider_id: DatasourceProviderID,
    provider_manager: PluginDatasourceManager,
) -> dict[str, object]:
    provider = provider_manager.fetch_datasource_provider(
        tenant_id=workspace_id,
        provider_id=str(provider_id),
    )
    if config.encrypted_tenant_params is not None:
        oauth_schema = provider.declaration.oauth_schema
        if oauth_schema is None:
            raise DatasourceCredentialError("Datasource provider oauth schema not found")
        credential_encrypter, _ = create_provider_encrypter(
            tenant_id=workspace_id,
            config=[item.to_basic_provider_config() for item in oauth_schema.client_schema],
            cache=NoOpProviderCredentialCache(),
        )
        return dict(credential_encrypter.decrypt(dict(config.encrypted_tenant_params)))

    if config.system_credentials is not None and PluginService.is_plugin_verified(
        workspace_id, provider.plugin_unique_identifier
    ):
        return dict(config.system_credentials)
    raise DatasourceCredentialError(f"OAuth client is not configured for {provider_id}")


class OAuthDatasourceCredentialRefresher:
    """Refresh datasource credentials through an injected OAuth-client resolver."""

    def __init__(
        self,
        *,
        oauth_clients: DatasourceOAuthClientResolver,
        oauth_handler: OAuthHandler,
    ) -> None:
        self._oauth_clients = oauth_clients
        self._oauth_handler = oauth_handler

    def refresh(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        record: DatasourceCredentialRecord,
        credentials: Mapping[str, object],
    ) -> RefreshedDatasourceCredential:
        provider_id = DatasourceProviderID(f"{record.plugin_id}/{record.provider}")
        try:
            return refresh_datasource_credential(
                self._oauth_handler,
                workspace_id=workspace_id,
                actor_id=actor_id,
                provider_id=provider_id,
                system_credentials=self._oauth_clients.resolve(workspace_id=workspace_id, provider_id=provider_id),
                credentials=credentials,
            )
        except DatasourceCredentialError:
            raise
        except Exception as error:
            raise DatasourceCredentialRefreshError(record.id) from error


def refresh_datasource_credential(
    handler: OAuthHandler,
    *,
    workspace_id: str,
    actor_id: str,
    provider_id: DatasourceProviderID,
    system_credentials: Mapping[str, object],
    credentials: Mapping[str, object],
) -> RefreshedDatasourceCredential:
    refreshed = handler.refresh_credentials(
        tenant_id=workspace_id,
        user_id=actor_id,
        plugin_id=provider_id.plugin_id,
        provider=provider_id.provider_name,
        redirect_uri=f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider_id}/datasource/callback",
        system_credentials=dict(system_credentials),
        credentials=dict(credentials),
    )
    return RefreshedDatasourceCredential(credentials=dict(refreshed.credentials), expires_at=refreshed.expires_at)
