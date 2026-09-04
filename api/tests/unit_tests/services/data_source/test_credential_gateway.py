from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import cast

import pytest
from sqlalchemy.orm import Session, sessionmaker

import services.data_source.credential_gateway as credential_gateway_module
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
from services.data_source.credential_gateway import (
    ActorAwareDatasourceCredentialGateway,
    DatasourceCredentialConcurrentUpdateError,
    DatasourceCredentialError,
    DatasourceCredentialNotFoundError,
    DatasourceCredentialRefreshError,
    OAuthDatasourceCredentialRefresher,
    PluginDatasourceCredentialCodec,
    RefreshedDatasourceCredential,
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

    def encrypt(self, _record: DatasourceCredentialRecord, credentials: Mapping[str, object]) -> dict[str, object]:
        return {"integration_secret": f"cipher:{credentials['integration_secret']}"}


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


@dataclass
class StaticProviderManager:
    provider: PluginDatasourceProviderEntity
    calls: list[tuple[str, str]] = field(default_factory=list)

    def fetch_datasource_provider(self, *, tenant_id: str, provider_id: str) -> PluginDatasourceProviderEntity:
        self.calls.append((tenant_id, provider_id))
        return self.provider


@dataclass
class RecordingOAuthHandler:
    response: PluginOAuthCredentialsResponse | None = None
    error: Exception | None = None
    calls: list[dict[str, object]] = field(default_factory=list)

    def refresh_credentials(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        redirect_uri: str,
        system_credentials: Mapping[str, object],
        credentials: Mapping[str, object],
    ) -> PluginOAuthCredentialsResponse:
        self.calls.append(
            {
                "tenant_id": tenant_id,
                "user_id": user_id,
                "plugin_id": plugin_id,
                "provider": provider,
                "redirect_uri": redirect_uri,
                "system_credentials": system_credentials,
                "credentials": credentials,
            }
        )
        if self.error is not None:
            raise self.error
        assert self.response is not None
        return self.response


@dataclass
class RecordingCredentialEncrypter:
    decrypted: Mapping[str, object]
    calls: list[Mapping[str, object]] = field(default_factory=list)

    def decrypt(self, credentials: Mapping[str, object]) -> Mapping[str, object]:
        self.calls.append(credentials)
        return self.decrypted


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
    manager = StaticProviderManager(_provider())
    codec = PluginDatasourceCredentialCodec(provider_manager=cast(PluginDatasourceManager, manager))
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

    monkeypatch.setattr(credential_gateway_module.encrypter, "decrypt_token", decrypt_token)
    monkeypatch.setattr(credential_gateway_module.encrypter, "encrypt_token", encrypt_token)

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
    codec = PluginDatasourceCredentialCodec(
        provider_manager=cast(PluginDatasourceManager, StaticProviderManager(_provider()))
    )

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
    manager = StaticProviderManager(_provider())
    handler = RecordingOAuthHandler(
        response=PluginOAuthCredentialsResponse(
            credentials={"integration_secret": "refreshed-secret"},
            expires_at=500,
        )
    )
    encrypter = RecordingCredentialEncrypter({"client_secret": "tenant-secret"})

    def create_encrypter(**kwargs: object) -> tuple[RecordingCredentialEncrypter, None]:
        assert kwargs["tenant_id"] == "workspace-1"
        return encrypter, None

    monkeypatch.setattr(credential_gateway_module, "create_provider_encrypter", create_encrypter)
    refresher = OAuthDatasourceCredentialRefresher(
        session_factory=sqlite_session_factory,
        provider_manager=cast(PluginDatasourceManager, manager),
        oauth_handler=cast(OAuthHandler, handler),
    )

    result = refresher.refresh(
        workspace_id="workspace-1",
        actor_id="actor-1",
        record=_record(),
        credentials={"integration_secret": "old-secret"},
    )

    assert result == RefreshedDatasourceCredential({"integration_secret": "refreshed-secret"}, 500)
    assert encrypter.calls == [{"client_secret": "tenant-cipher"}]
    assert handler.calls[0]["system_credentials"] == {"client_secret": "tenant-secret"}
    assert handler.calls[0]["credentials"] == {"integration_secret": "old-secret"}
    assert handler.calls[0]["user_id"] == "actor-1"


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
    handler = RecordingOAuthHandler()
    refresher = OAuthDatasourceCredentialRefresher(
        session_factory=sqlite_session_factory,
        provider_manager=cast(PluginDatasourceManager, StaticProviderManager(provider)),
        oauth_handler=cast(OAuthHandler, handler),
    )

    with pytest.raises(DatasourceCredentialError, match="oauth schema not found"):
        refresher.refresh(
            workspace_id="workspace-1",
            actor_id="actor-1",
            record=_record(),
            credentials={"integration_secret": "old"},
        )

    assert handler.calls == []


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
    manager = StaticProviderManager(_provider())
    handler = RecordingOAuthHandler(
        response=PluginOAuthCredentialsResponse(credentials={"integration_secret": "refreshed"}, expires_at=500)
    )
    verification_calls: list[tuple[str, str]] = []

    def is_plugin_verified(workspace_id: str, plugin_unique_identifier: str) -> bool:
        verification_calls.append((workspace_id, plugin_unique_identifier))
        return verified

    monkeypatch.setattr(credential_gateway_module.PluginService, "is_plugin_verified", is_plugin_verified)
    refresher = OAuthDatasourceCredentialRefresher(
        session_factory=sqlite_session_factory,
        provider_manager=cast(PluginDatasourceManager, manager),
        oauth_handler=cast(OAuthHandler, handler),
    )

    if not verified:
        with pytest.raises(DatasourceCredentialError, match="OAuth client is not configured"):
            refresher.refresh(
                workspace_id="workspace-1",
                actor_id="actor-1",
                record=_record(),
                credentials={"integration_secret": "old"},
            )
        assert handler.calls == []
    else:
        refresher.refresh(
            workspace_id="workspace-1",
            actor_id="actor-1",
            record=_record(),
            credentials={"integration_secret": "old"},
        )
        assert handler.calls[0]["system_credentials"] == {"client_secret": "system-secret"}

    assert verification_calls == [("workspace-1", "langgenius/notion_datasource:1.0.0")]


def test_oauth_refresher_translates_plugin_refresh_failure(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    handler = RecordingOAuthHandler(error=RuntimeError("plugin unavailable"))
    refresher = OAuthDatasourceCredentialRefresher(
        session_factory=sqlite_session_factory,
        provider_manager=cast(PluginDatasourceManager, StaticProviderManager(_provider())),
        oauth_handler=cast(OAuthHandler, handler),
    )
    monkeypatch.setattr(refresher, "_oauth_client", lambda _workspace_id, _provider_id: {})

    with pytest.raises(DatasourceCredentialRefreshError, match="credential-1"):
        refresher.refresh(
            workspace_id="workspace-1",
            actor_id="actor-1",
            record=_record(),
            credentials={"integration_secret": "old"},
        )
