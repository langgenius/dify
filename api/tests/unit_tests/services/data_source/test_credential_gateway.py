from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from unittest.mock import Mock, create_autospec

import pytest
from sqlalchemy.orm import Session, sessionmaker

import services.data_source.credential_adapters as credential_adapters_module
from core.datasource.entities.datasource_entities import (
    DatasourceProviderEntityWithPlugin,
    DatasourceProviderIdentity,
    DatasourceProviderType,
)
from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from core.plugin.entities.oauth import OAuthSchema
from core.plugin.entities.plugin_daemon import PluginDatasourceProviderEntity, PluginOAuthCredentialsResponse
from core.plugin.impl.datasource import PluginDatasourceManager
from core.plugin.impl.oauth import OAuthHandler
from models.oauth import DatasourceOauthParamConfig, DatasourceOauthTenantParamConfig
from repositories.data_source.credential_repository import SQLAlchemyDatasourceCredentialRepository
from services.data_source.credential_adapters import (
    OAuthDatasourceCredentialRefresher,
    PluginDatasourceCredentialCodec,
)
from services.data_source.credential_gateway import (
    ActorAwareDatasourceCredentialGateway,
    DatasourceCredentialConcurrentUpdateError,
    DatasourceCredentialError,
    DatasourceCredentialNotFoundError,
    DatasourceCredentialRefreshError,
    RefreshedDatasourceCredential,
    TrustedDatasourceCredentialStore,
    TrustedStoredDatasourceCredentialGateway,
)
from services.entities.data_source.credential import DatasourceCredentialRecord


def _record(
    *,
    auth_type: str = "oauth2",
    expires_at: int = -1,
    updated_at: datetime | None = None,
) -> DatasourceCredentialRecord:
    return DatasourceCredentialRecord(
        id="credential-1",
        workspace_id="workspace-1",
        owner_id="credential-owner-1",
        name="Notion",
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
        auth_type=auth_type,
        encrypted_credentials={"integration_secret": "encrypted"},
        expires_at=expires_at,
        updated_at=updated_at or datetime(2026, 1, 1),
    )


@dataclass
class ScriptedCredentialStore:
    records: list[DatasourceCredentialRecord | None]
    update_result: bool = True
    get_calls: list[tuple[str, str, str, str, str]] = field(default_factory=list)
    updates: list[tuple[DatasourceCredentialRecord, Mapping[str, object], int]] = field(default_factory=list)
    events: list[str] = field(default_factory=list)

    def get_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> DatasourceCredentialRecord | None:
        self.events.append("read")
        self.get_calls.append((workspace_id, actor_id, credential_id, provider, plugin_id))
        return self.records.pop(0)

    def update_if_unchanged(
        self,
        *,
        record: DatasourceCredentialRecord,
        encrypted_credentials: Mapping[str, object],
        expires_at: int,
    ) -> bool:
        self.events.append("update")
        self.updates.append((record, encrypted_credentials, expires_at))
        return self.update_result


@dataclass
class ReversibleCredentialCodec:
    def decrypt(self, record: DatasourceCredentialRecord) -> dict[str, object]:
        return {"integration_secret": f"plain:{record.encrypted_credentials['integration_secret']}"}

    def encrypt(self, record: DatasourceCredentialRecord, credentials: Mapping[str, object]) -> dict[str, object]:
        del record
        return {"integration_secret": f"cipher:{credentials['integration_secret']}"}


def _stored_catalog(record: DatasourceCredentialRecord | None) -> Mock:
    catalog = create_autospec(TrustedDatasourceCredentialStore, instance=True, spec_set=True)
    catalog.get_for_stored_document.return_value = record
    catalog.update_if_unchanged.return_value = True
    return catalog


@dataclass
class RecordingCredentialRefresher:
    calls: list[tuple[str, str, DatasourceCredentialRecord, Mapping[str, object]]] = field(default_factory=list)
    events: list[str] = field(default_factory=list)

    def refresh(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        record: DatasourceCredentialRecord,
        credentials: Mapping[str, object],
    ) -> RefreshedDatasourceCredential:
        self.events.append("refresh")
        self.calls.append((workspace_id, actor_id, record, credentials))
        return RefreshedDatasourceCredential({"integration_secret": "refreshed"}, 500)


def _provider_manager(provider: PluginDatasourceProviderEntity) -> Mock:
    manager = create_autospec(PluginDatasourceManager, instance=True, spec_set=True)
    manager.fetch_datasource_provider.return_value = provider
    return manager


def _oauth_handler(response: PluginOAuthCredentialsResponse | None = None, *, error: Exception | None = None) -> Mock:
    handler = create_autospec(OAuthHandler, instance=True, spec_set=True)
    handler.refresh_credentials.return_value = response
    handler.refresh_credentials.side_effect = error
    return handler


def _oauth_refresher(
    session_factory: sessionmaker[Session], *, manager: Mock, handler: Mock
) -> OAuthDatasourceCredentialRefresher:
    return OAuthDatasourceCredentialRefresher(
        configs=SQLAlchemyDatasourceCredentialRepository(session_factory=session_factory),
        provider_manager=manager,
        oauth_handler=handler,
    )


def _provider(*, with_oauth_schema: bool = True) -> PluginDatasourceProviderEntity:
    oauth_schema = (
        OAuthSchema(
            client_schema=[ProviderConfig(type=ProviderConfigType.SECRET_INPUT, name="client_secret")],
            credentials_schema=[
                ProviderConfig(type=ProviderConfigType.SECRET_INPUT, name="integration_secret"),
                ProviderConfig(type=ProviderConfigType.TEXT_INPUT, name="workspace_name"),
            ],
        )
        if with_oauth_schema
        else None
    )
    return PluginDatasourceProviderEntity(
        provider="notion_datasource",
        plugin_unique_identifier="langgenius/notion_datasource:1.0.0",
        plugin_id="langgenius/notion_datasource",
        declaration=DatasourceProviderEntityWithPlugin(
            identity=DatasourceProviderIdentity(
                author="langgenius",
                name="notion_datasource",
                description={"en_US": "Notion", "zh_Hans": "Notion"},
                icon="notion.svg",
                label={"en_US": "Notion", "zh_Hans": "Notion"},
            ),
            credentials_schema=[
                ProviderConfig(type=ProviderConfigType.SECRET_INPUT, name="api_secret"),
                ProviderConfig(type=ProviderConfigType.TEXT_INPUT, name="label"),
            ],
            oauth_schema=oauth_schema,
            provider_type=DatasourceProviderType.ONLINE_DOCUMENT,
        ),
    )


def _gateway(
    store: ScriptedCredentialStore, refresher: RecordingCredentialRefresher | None = None
) -> tuple[ActorAwareDatasourceCredentialGateway, RecordingCredentialRefresher]:
    refresh = refresher or RecordingCredentialRefresher()
    return (
        ActorAwareDatasourceCredentialGateway(
            credentials=store,
            codec=ReversibleCredentialCodec(),
            refresher=refresh,
            now=lambda: 100,
        ),
        refresh,
    )


def _resolve(gateway: ActorAwareDatasourceCredentialGateway) -> dict[str, object]:
    return gateway.resolve(
        workspace_id="workspace-1",
        actor_id="actor-1",
        credential_id="credential-1",
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )


def test_resolve_fails_closed_when_credential_is_not_visible() -> None:
    gateway, _ = _gateway(ScriptedCredentialStore(records=[None]))

    with pytest.raises(DatasourceCredentialNotFoundError):
        _resolve(gateway)


def test_trusted_stored_source_resolver_uses_distinct_owner_chain_port() -> None:
    catalog = _stored_catalog(_record())
    gateway = TrustedStoredDatasourceCredentialGateway(
        credentials=catalog,
        codec=ReversibleCredentialCodec(),
        refresher=RecordingCredentialRefresher(),
        now=lambda: 100,
    )

    result = gateway.resolve_for_document(
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        document_id="document-1",
        credential_id="credential-1",
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )

    assert result == {"integration_secret": "plain:encrypted"}
    catalog.get_for_stored_document.assert_called_once_with(
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        document_id="document-1",
        credential_id="credential-1",
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )


def test_trusted_stored_source_resolver_fails_closed_for_missing_credential() -> None:
    gateway = TrustedStoredDatasourceCredentialGateway(
        credentials=_stored_catalog(None),
        codec=ReversibleCredentialCodec(),
        refresher=RecordingCredentialRefresher(),
        now=lambda: 100,
    )

    with pytest.raises(DatasourceCredentialNotFoundError):
        gateway.resolve_for_document(
            workspace_id="workspace-1",
            dataset_id="dataset-1",
            document_id="document-1",
            credential_id="credential-1",
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )


def test_trusted_stored_source_refreshes_with_persisted_credential_owner() -> None:
    record = _record(expires_at=120)
    catalog = _stored_catalog(record)
    refresher = RecordingCredentialRefresher()
    gateway = TrustedStoredDatasourceCredentialGateway(
        credentials=catalog,
        codec=ReversibleCredentialCodec(),
        refresher=refresher,
        now=lambda: 100,
    )

    result = gateway.resolve_for_document(
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        document_id="document-1",
        credential_id="credential-1",
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )

    assert result == {"integration_secret": "refreshed"}
    assert refresher.calls == [("workspace-1", "credential-owner-1", record, {"integration_secret": "plain:encrypted"})]
    catalog.update_if_unchanged.assert_called_once_with(
        record=record,
        encrypted_credentials={"integration_secret": "cipher:refreshed"},
        expires_at=500,
    )


def test_resolve_decrypts_without_refreshing_non_expiring_credential() -> None:
    store = ScriptedCredentialStore(records=[_record()])
    gateway, refresher = _gateway(store)

    assert _resolve(gateway) == {"integration_secret": "plain:encrypted"}
    assert refresher.calls == []
    assert store.updates == []


def test_refresh_runs_between_read_and_conditional_update() -> None:
    record = _record(expires_at=120)
    events: list[str] = []
    store = ScriptedCredentialStore(records=[record], events=events)
    gateway, refresher = _gateway(store, RecordingCredentialRefresher(events=events))

    assert _resolve(gateway) == {"integration_secret": "refreshed"}
    assert refresher.calls == [("workspace-1", "actor-1", record, {"integration_secret": "plain:encrypted"})]
    assert store.updates == [(record, {"integration_secret": "cipher:refreshed"}, 500)]
    assert events == ["read", "refresh", "update"]


def test_concurrent_refresh_uses_newer_non_expiring_snapshot() -> None:
    stale = _record(expires_at=120)
    latest = replace(
        stale,
        encrypted_credentials={"integration_secret": "latest"},
        expires_at=500,
        updated_at=stale.updated_at + timedelta(seconds=1),
    )
    store = ScriptedCredentialStore(records=[stale, latest], update_result=False)
    gateway, _ = _gateway(store)

    assert _resolve(gateway) == {"integration_secret": "plain:latest"}
    assert store.get_calls == [
        ("workspace-1", "actor-1", "credential-1", "notion_datasource", "langgenius/notion_datasource"),
        ("workspace-1", "actor-1", "credential-1", "notion_datasource", "langgenius/notion_datasource"),
    ]


def test_concurrent_refresh_fails_closed_if_latest_snapshot_is_still_expired() -> None:
    stale = _record(expires_at=120)
    latest = replace(stale, updated_at=stale.updated_at + timedelta(seconds=1))
    gateway, _ = _gateway(ScriptedCredentialStore(records=[stale, latest], update_result=False))

    with pytest.raises(DatasourceCredentialConcurrentUpdateError):
        _resolve(gateway)


@pytest.mark.parametrize(
    ("auth_type", "secret_name"),
    [("api-key", "api_secret"), ("oauth2", "integration_secret")],
)
def test_plugin_codec_encrypts_and_decrypts_only_declared_secret_fields(
    monkeypatch: pytest.MonkeyPatch,
    auth_type: str,
    secret_name: str,
) -> None:
    manager = _provider_manager(_provider())
    codec = PluginDatasourceCredentialCodec(provider_manager=manager)
    record = replace(
        _record(auth_type=auth_type),
        encrypted_credentials={secret_name: "cipher", "label": "plain"},
    )
    decrypt_calls: list[tuple[str, str]] = []
    encrypt_calls: list[tuple[str, str]] = []

    def decrypt_token(workspace_id: str, value: str) -> str:
        decrypt_calls.append((workspace_id, value))
        return f"decrypted:{value}"

    def encrypt_token(workspace_id: str, value: str) -> str:
        encrypt_calls.append((workspace_id, value))
        return f"encrypted:{value}"

    monkeypatch.setattr(credential_adapters_module.encrypter, "decrypt_token", decrypt_token)
    monkeypatch.setattr(credential_adapters_module.encrypter, "encrypt_token", encrypt_token)

    assert codec.decrypt(record) == {secret_name: "decrypted:cipher", "label": "plain"}
    assert codec.encrypt(record, {secret_name: "secret", "label": "plain"}) == {
        secret_name: "encrypted:secret",
        "label": "plain",
    }
    assert decrypt_calls == [("workspace-1", "cipher")]
    assert encrypt_calls == [("workspace-1", "secret")]

    non_string_record = replace(record, encrypted_credentials={secret_name: 42})
    assert codec.decrypt(non_string_record) == {secret_name: 42}
    assert codec.encrypt(record, {secret_name: None}) == {secret_name: None}
    assert decrypt_calls == [("workspace-1", "cipher")]
    assert encrypt_calls == [("workspace-1", "secret")]


def test_plugin_codec_rejects_unsupported_credential_type() -> None:
    codec = PluginDatasourceCredentialCodec(provider_manager=_provider_manager(_provider()))

    with pytest.raises(DatasourceCredentialError, match="Unsupported credential type"):
        codec.decrypt(_record(auth_type="unauthorized"))


def test_oauth_refresher_prefers_enabled_tenant_client_and_returns_refreshed_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                DatasourceOauthTenantParamConfig(
                    tenant_id="workspace-1",
                    provider="notion_datasource",
                    plugin_id="langgenius/notion_datasource",
                    client_params={"client_secret": "tenant-cipher"},
                    enabled=True,
                ),
                DatasourceOauthParamConfig(
                    provider="notion_datasource",
                    plugin_id="langgenius/notion_datasource",
                    system_credentials={"client_secret": "system-secret"},
                ),
            ]
        )
    manager = _provider_manager(_provider())
    handler = _oauth_handler(
        response=PluginOAuthCredentialsResponse(
            credentials={"integration_secret": "refreshed-secret"},
            expires_at=500,
        )
    )
    encrypter = Mock(spec_set=["decrypt"])
    encrypter.decrypt.return_value = {"client_secret": "tenant-secret"}

    def create_encrypter(**kwargs: object) -> tuple[Mock, None]:
        assert kwargs["tenant_id"] == "workspace-1"
        return encrypter, None

    monkeypatch.setattr(credential_adapters_module, "create_provider_encrypter", create_encrypter)
    refresher = _oauth_refresher(sqlite_session_factory, manager=manager, handler=handler)

    result = refresher.refresh(
        workspace_id="workspace-1",
        actor_id="actor-1",
        record=_record(),
        credentials={"integration_secret": "old-secret"},
    )

    assert result == RefreshedDatasourceCredential({"integration_secret": "refreshed-secret"}, 500)
    encrypter.decrypt.assert_called_once_with({"client_secret": "tenant-cipher"})
    assert handler.refresh_credentials.call_args.kwargs["system_credentials"] == {"client_secret": "tenant-secret"}
    assert handler.refresh_credentials.call_args.kwargs["credentials"] == {"integration_secret": "old-secret"}
    assert handler.refresh_credentials.call_args.kwargs["user_id"] == "actor-1"


def test_oauth_refresher_rejects_tenant_client_when_provider_has_no_oauth_schema(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            DatasourceOauthTenantParamConfig(
                tenant_id="workspace-1",
                provider="notion_datasource",
                plugin_id="langgenius/notion_datasource",
                client_params={"client_secret": "tenant-cipher"},
                enabled=True,
            )
        )
    provider = _provider(with_oauth_schema=False)
    handler = _oauth_handler()
    refresher = _oauth_refresher(
        sqlite_session_factory,
        manager=_provider_manager(provider),
        handler=handler,
    )

    with pytest.raises(DatasourceCredentialError, match="oauth schema not found"):
        refresher.refresh(
            workspace_id="workspace-1",
            actor_id="actor-1",
            record=_record(),
            credentials={"integration_secret": "old"},
        )

    handler.refresh_credentials.assert_not_called()


@pytest.mark.parametrize("verified", [True, False])
def test_oauth_refresher_uses_system_client_only_for_verified_plugin(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    verified: bool,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                DatasourceOauthTenantParamConfig(
                    tenant_id="workspace-1",
                    provider="notion_datasource",
                    plugin_id="langgenius/notion_datasource",
                    client_params={"client_secret": "disabled-tenant-secret"},
                    enabled=False,
                ),
                DatasourceOauthParamConfig(
                    provider="notion_datasource",
                    plugin_id="langgenius/notion_datasource",
                    system_credentials={"client_secret": "system-secret"},
                ),
            ]
        )
    manager = _provider_manager(_provider())
    handler = _oauth_handler(
        response=PluginOAuthCredentialsResponse(credentials={"integration_secret": "refreshed"}, expires_at=500)
    )
    verification_calls: list[tuple[str, str]] = []

    def is_plugin_verified(workspace_id: str, plugin_unique_identifier: str) -> bool:
        verification_calls.append((workspace_id, plugin_unique_identifier))
        return verified

    monkeypatch.setattr(credential_adapters_module.PluginService, "is_plugin_verified", is_plugin_verified)
    refresher = _oauth_refresher(sqlite_session_factory, manager=manager, handler=handler)

    if not verified:
        with pytest.raises(DatasourceCredentialError, match="OAuth client is not configured"):
            refresher.refresh(
                workspace_id="workspace-1",
                actor_id="actor-1",
                record=_record(),
                credentials={"integration_secret": "old"},
            )
        handler.refresh_credentials.assert_not_called()
    else:
        refresher.refresh(
            workspace_id="workspace-1",
            actor_id="actor-1",
            record=_record(),
            credentials={"integration_secret": "old"},
        )
        assert handler.refresh_credentials.call_args.kwargs["system_credentials"] == {"client_secret": "system-secret"}

    assert verification_calls == [("workspace-1", "langgenius/notion_datasource:1.0.0")]


def test_oauth_refresher_translates_plugin_refresh_failure(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = _oauth_handler(error=RuntimeError("plugin unavailable"))
    monkeypatch.setattr(credential_adapters_module, "resolve_datasource_oauth_client", Mock(return_value={}))
    refresher = _oauth_refresher(sqlite_session_factory, manager=_provider_manager(_provider()), handler=handler)

    with pytest.raises(DatasourceCredentialRefreshError, match="credential-1"):
        refresher.refresh(
            workspace_id="workspace-1",
            actor_id="actor-1",
            record=_record(),
            credentials={"integration_secret": "old"},
        )
