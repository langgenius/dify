"""Explicit-actor credential resolution and OAuth refresh infrastructure."""

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.helper import encrypter
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.datasource import PluginDatasourceManager
from core.plugin.impl.oauth import OAuthHandler
from core.plugin.plugin_service import PluginService
from core.tools.utils.encryption import create_provider_encrypter
from graphon.model_runtime.entities.provider_entities import FormType
from models.oauth import DatasourceOauthParamConfig, DatasourceOauthTenantParamConfig
from models.provider_ids import DatasourceProviderID
from services.entities.data_source.credential import DatasourceCredentialRecord


class DatasourceCredentialStore(Protocol):
    def get_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> DatasourceCredentialRecord | None: ...

    def update_if_unchanged(
        self,
        *,
        record: DatasourceCredentialRecord,
        encrypted_credentials: Mapping[str, object],
        expires_at: int,
    ) -> bool: ...


class DatasourceCredentialCodec(Protocol):
    def decrypt(self, record: DatasourceCredentialRecord) -> dict[str, object]: ...

    def encrypt(
        self,
        record: DatasourceCredentialRecord,
        credentials: Mapping[str, object],
    ) -> dict[str, object]: ...


@dataclass(frozen=True, slots=True)
class RefreshedDatasourceCredential:
    credentials: Mapping[str, object]
    expires_at: int


class DatasourceCredentialRefresher(Protocol):
    def refresh(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        record: DatasourceCredentialRecord,
        credentials: Mapping[str, object],
    ) -> RefreshedDatasourceCredential: ...


class DatasourceCredentialError(Exception):
    """Base class for credential resolution failures."""


class DatasourceCredentialNotFoundError(DatasourceCredentialError):
    def __init__(self) -> None:
        super().__init__("Credential not found")


class DatasourceCredentialConcurrentUpdateError(DatasourceCredentialError):
    def __init__(self) -> None:
        super().__init__("Credential changed while it was being refreshed")


class DatasourceCredentialRefreshError(DatasourceCredentialError):
    def __init__(self, credential_id: str) -> None:
        super().__init__(f"Failed to refresh datasource credential: {credential_id}")


class PluginDatasourceCredentialCodec:
    def __init__(self, provider_manager: PluginDatasourceManager | None = None) -> None:
        self._provider_manager = provider_manager or PluginDatasourceManager()

    def decrypt(self, record: DatasourceCredentialRecord) -> dict[str, object]:
        result = dict(record.encrypted_credentials)
        for name in self._secret_variables(record):
            value = result.get(name)
            if isinstance(value, str):
                result[name] = encrypter.decrypt_token(record.workspace_id, value)
        return result

    def encrypt(
        self,
        record: DatasourceCredentialRecord,
        credentials: Mapping[str, object],
    ) -> dict[str, object]:
        result = dict(credentials)
        for name in self._secret_variables(record):
            value = result.get(name)
            if isinstance(value, str):
                result[name] = encrypter.encrypt_token(record.workspace_id, value)
        return result

    def _secret_variables(self, record: DatasourceCredentialRecord) -> tuple[str, ...]:
        provider = self._provider_manager.fetch_datasource_provider(
            tenant_id=record.workspace_id,
            provider_id=f"{record.plugin_id}/{record.provider}",
        )
        credential_type = CredentialType.of(record.auth_type)
        if credential_type == CredentialType.API_KEY:
            schemas = provider.declaration.credentials_schema
        elif credential_type == CredentialType.OAUTH2 and provider.declaration.oauth_schema:
            schemas = provider.declaration.oauth_schema.credentials_schema
        else:
            raise DatasourceCredentialError(f"Unsupported credential type: {record.auth_type}")
        return tuple(schema.name for schema in schemas if schema.type.value == FormType.SECRET_INPUT)


class OAuthDatasourceCredentialRefresher:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        provider_manager: PluginDatasourceManager | None = None,
        oauth_handler: OAuthHandler | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._provider_manager = provider_manager or PluginDatasourceManager()
        self._oauth_handler = oauth_handler or OAuthHandler()

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
            refreshed = self._oauth_handler.refresh_credentials(
                tenant_id=workspace_id,
                user_id=actor_id,
                plugin_id=provider_id.plugin_id,
                provider=provider_id.provider_name,
                redirect_uri=(
                    f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider_id}/datasource/callback"
                ),
                system_credentials=self._oauth_client(workspace_id, provider_id),
                credentials=dict(credentials),
            )
        except DatasourceCredentialError:
            raise
        except Exception as error:
            raise DatasourceCredentialRefreshError(record.id) from error
        return RefreshedDatasourceCredential(
            credentials=dict(refreshed.credentials),
            expires_at=refreshed.expires_at,
        )

    def _oauth_client(self, workspace_id: str, provider_id: DatasourceProviderID) -> dict[str, object]:
        with self._session_factory() as session:
            tenant_config = session.scalar(
                select(DatasourceOauthTenantParamConfig)
                .where(
                    DatasourceOauthTenantParamConfig.tenant_id == workspace_id,
                    DatasourceOauthTenantParamConfig.provider == provider_id.provider_name,
                    DatasourceOauthTenantParamConfig.plugin_id == provider_id.plugin_id,
                    DatasourceOauthTenantParamConfig.enabled.is_(True),
                )
                .limit(1)
            )
            encrypted_tenant_params = dict(tenant_config.client_params) if tenant_config is not None else None
            system_config = session.scalar(
                select(DatasourceOauthParamConfig)
                .where(
                    DatasourceOauthParamConfig.provider == provider_id.provider_name,
                    DatasourceOauthParamConfig.plugin_id == provider_id.plugin_id,
                )
                .limit(1)
            )
            system_credentials = dict(system_config.system_credentials) if system_config is not None else None

        provider = self._provider_manager.fetch_datasource_provider(
            tenant_id=workspace_id,
            provider_id=str(provider_id),
        )
        if encrypted_tenant_params is not None:
            oauth_schema = provider.declaration.oauth_schema
            if oauth_schema is None:
                raise DatasourceCredentialError("Datasource provider oauth schema not found")
            credential_encrypter, _ = create_provider_encrypter(
                tenant_id=workspace_id,
                config=[item.to_basic_provider_config() for item in oauth_schema.client_schema],
                cache=NoOpProviderCredentialCache(),
            )
            return dict(credential_encrypter.decrypt(encrypted_tenant_params))

        if system_credentials is not None and PluginService.is_plugin_verified(
            workspace_id, provider.plugin_unique_identifier
        ):
            return system_credentials
        raise DatasourceCredentialError(f"OAuth client is not configured for {provider_id}")


class ActorAwareDatasourceCredentialGateway:
    def __init__(
        self,
        *,
        credentials: DatasourceCredentialStore,
        codec: DatasourceCredentialCodec,
        refresher: DatasourceCredentialRefresher,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._credentials = credentials
        self._codec = codec
        self._refresher = refresher
        self._now = now

    def resolve(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> dict[str, object]:
        record = self._get_visible(
            workspace_id=workspace_id,
            actor_id=actor_id,
            credential_id=credential_id,
            provider=provider,
            plugin_id=plugin_id,
        )
        decrypted = self._codec.decrypt(record)
        if not self._should_refresh(record):
            return decrypted

        refreshed = self._refresher.refresh(
            workspace_id=workspace_id,
            actor_id=actor_id,
            record=record,
            credentials=decrypted,
        )
        encrypted = self._codec.encrypt(record, refreshed.credentials)
        if self._credentials.update_if_unchanged(
            record=record,
            encrypted_credentials=encrypted,
            expires_at=refreshed.expires_at,
        ):
            return dict(refreshed.credentials)

        latest = self._get_visible(
            workspace_id=workspace_id,
            actor_id=actor_id,
            credential_id=credential_id,
            provider=provider,
            plugin_id=plugin_id,
        )
        if self._should_refresh(latest):
            raise DatasourceCredentialConcurrentUpdateError()
        return self._codec.decrypt(latest)

    def _get_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> DatasourceCredentialRecord:
        record = self._credentials.get_visible(
            workspace_id=workspace_id,
            actor_id=actor_id,
            credential_id=credential_id,
            provider=provider,
            plugin_id=plugin_id,
        )
        if record is None:
            raise DatasourceCredentialNotFoundError()
        return record

    def _should_refresh(self, record: DatasourceCredentialRecord) -> bool:
        return record.expires_at != -1 and record.expires_at - 60 < int(self._now())
