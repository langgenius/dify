"""SQLite-backed tests for trigger provider subscription lifecycle.

The service intentionally owns short-lived sessions for subscription and OAuth
client operations.  Tests bind those session constructors to an isolated SQLite
engine and assert persisted tenant scope, commits, rollbacks, and constraints;
provider daemons, encryption, Redis locks, and caches remain external mocks.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import Subscription as TriggerSubscriptionEntity
from models.base import TypeBase
from models.provider_ids import TriggerProviderID
from models.trigger import (
    TriggerOAuthSystemClient,
    TriggerOAuthTenantClient,
    TriggerSubscription,
    WorkflowPluginTrigger,
)
from services.plugin.dispatch_identity import PluginOAuthClientConfig
from services.trigger import trigger_provider_service as service_module
from services.trigger.trigger_provider_service import TriggerProviderService


@dataclass(frozen=True)
class _DatabaseBinding:
    engine: Engine


@dataclass(frozen=True)
class TriggerDatabase:
    """Factory and identifiers for persisted subscription lifecycle state."""

    session_maker: sessionmaker[Session]
    tenant_id: str
    other_tenant_id: str
    user_id: str
    provider_id: TriggerProviderID

    def add_subscription(
        self,
        *,
        tenant_id: str | None = None,
        subscription_id: str | None = None,
        name: str = "main",
        endpoint_id: str | None = None,
        credential_type: CredentialType = CredentialType.API_KEY,
        credentials: dict[str, str] | None = None,
        properties: dict[str, object] | None = None,
        parameters: dict[str, object] | None = None,
        credential_expires_at: int = -1,
        expires_at: int = -1,
    ) -> TriggerSubscription:
        subscription = TriggerSubscription(
            tenant_id=tenant_id or self.tenant_id,
            user_id=self.user_id,
            name=name,
            endpoint_id=endpoint_id or f"endpoint-{uuid4()}",
            provider_id=str(self.provider_id),
            parameters=parameters or {"event": "push"},
            properties=properties or {"project": "encrypted"},
            credentials=credentials or {"token": "encrypted"},
            credential_type=credential_type,
            credential_expires_at=credential_expires_at,
            expires_at=expires_at,
        )
        if subscription_id is not None:
            subscription.id = subscription_id
        with self.session_maker.begin() as session:
            session.add(subscription)
        return subscription

    def get_subscription(self, subscription_id: str) -> TriggerSubscription | None:
        with self.session_maker() as session:
            return session.get(TriggerSubscription, subscription_id)


@pytest.fixture
def trigger_db(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> TriggerDatabase:
    """Create trigger tables and bind every service-owned session to SQLite."""

    TypeBase.metadata.create_all(
        sqlite_engine,
        tables=[
            TriggerSubscription.__table__,
            WorkflowPluginTrigger.__table__,
            TriggerOAuthTenantClient.__table__,
            TriggerOAuthSystemClient.__table__,
        ],
    )
    monkeypatch.setattr(service_module, "db", _DatabaseBinding(engine=sqlite_engine))
    return TriggerDatabase(
        session_maker=sessionmaker(bind=sqlite_engine, expire_on_commit=False),
        tenant_id=str(uuid4()),
        other_tenant_id=str(uuid4()),
        user_id=str(uuid4()),
        provider_id=TriggerProviderID("langgenius/github/github"),
    )


@pytest.fixture
def provider_controller() -> Mock:
    controller = Mock()
    controller.get_credential_schema_config.return_value = []
    controller.get_properties_schema.return_value = []
    controller.get_oauth_client_schema.return_value = []
    controller.plugin_unique_identifier = "langgenius/github:0.0.1@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    return controller


def _patch_provider(mocker, provider: object) -> None:
    mocker.patch.object(service_module.TriggerManager, "get_trigger_provider", return_value=provider)


def _encrypter(
    *,
    decrypted: dict[str, object] | None = None,
    encrypted: dict[str, object] | None = None,
    masked: dict[str, object] | None = None,
) -> Mock:
    result = Mock()
    result.decrypt.side_effect = lambda value: decrypted if decrypted is not None else dict(value)
    result.encrypt.side_effect = lambda value: encrypted if encrypted is not None else dict(value)
    result.mask_credentials.side_effect = lambda value: masked if masked is not None else dict(value)
    result.mask_plugin_credentials.side_effect = lambda value: masked if masked is not None else dict(value)
    return result


def _patch_identity_encryption(mocker) -> Mock:
    encrypter = _encrypter()
    cache = Mock()
    mocker.patch.object(service_module, "create_provider_encrypter", return_value=(encrypter, cache))
    mocker.patch.object(
        service_module,
        "create_trigger_provider_encrypter_for_subscription",
        return_value=(encrypter, cache),
    )
    mocker.patch.object(
        service_module,
        "create_trigger_provider_encrypter_for_properties",
        return_value=(encrypter, cache),
    )
    return cache


def test_get_subscription_scopes_tenant_and_decrypts(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    subscription = trigger_db.add_subscription()
    _patch_provider(mocker, provider_controller)
    credential = _encrypter(decrypted={"token": "plain"})
    properties = _encrypter(decrypted={"project": "plain"})
    mocker.patch.object(
        service_module, "create_trigger_provider_encrypter_for_subscription", return_value=(credential, Mock())
    )
    mocker.patch.object(
        service_module, "create_trigger_provider_encrypter_for_properties", return_value=(properties, Mock())
    )

    assert TriggerProviderService.get_subscription_by_id(trigger_db.other_tenant_id, subscription.id) is None
    result = TriggerProviderService.get_subscription_by_id(trigger_db.tenant_id, subscription.id)
    assert result is not None
    assert (
        TriggerProviderService.get_subscription_by_id(
            trigger_db.tenant_id, subscription.id, provider_id=TriggerProviderID("langgenius/other/other")
        )
        is None
    )
    assert result.credentials == {"token": "plain"}
    assert result.properties == {"project": "plain"}


@pytest.mark.parametrize("client_credentials", [None, {}, {"client": "system"}])
def test_refresh_oauth_token_persists_credentials_after_commit(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock, client_credentials: dict[str, str] | None
) -> None:
    subscription = trigger_db.add_subscription(credential_type=CredentialType.OAUTH2)
    _patch_provider(mocker, provider_controller)
    encrypter = _encrypter(decrypted={"refresh": "old"}, encrypted={"access": "new"})
    mocker.patch.object(service_module, "create_provider_encrypter", return_value=(encrypter, Mock()))
    mocker.patch.object(
        TriggerProviderService,
        "get_oauth_client",
        return_value=(
            PluginOAuthClientConfig(provider_controller.plugin_unique_identifier, client_credentials)
            if client_credentials is not None
            else None
        ),
    )
    handler = Mock()
    handler.refresh_credentials.return_value = SimpleNamespace(credentials={"access": "plain"}, expires_at=1234)
    mocker.patch.object(service_module, "OAuthHandler", return_value=handler)
    clear_cache = mocker.patch.object(service_module, "delete_cache_for_subscription")

    result = TriggerProviderService.refresh_oauth_token(trigger_db.tenant_id, subscription.id)

    persisted = trigger_db.get_subscription(subscription.id)
    assert result == {"result": "success", "expires_at": 1234}
    assert persisted.credentials == {"access": "new"}  # type: ignore[union-attr]
    assert persisted.credential_expires_at == 1234  # type: ignore[union-attr]
    clear_cache.assert_called_once()
    handler.refresh_credentials.assert_called_once()
    assert handler.refresh_credentials.call_args.kwargs["system_credentials"] == (client_credentials or {})
    assert handler.refresh_credentials.call_args.kwargs["plugin_unique_identifier"] == (
        provider_controller.plugin_unique_identifier
    )


def test_refresh_oauth_rejects_missing_and_non_oauth(trigger_db: TriggerDatabase) -> None:
    with pytest.raises(ValueError, match="not found"):
        TriggerProviderService.refresh_oauth_token(trigger_db.tenant_id, str(uuid4()))
    subscription = trigger_db.add_subscription(credential_type=CredentialType.API_KEY)
    with pytest.raises(ValueError, match="Only OAuth"):
        TriggerProviderService.refresh_oauth_token(trigger_db.tenant_id, subscription.id)


def test_refresh_subscription_skips_or_persists_refreshed_properties(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    skipped = trigger_db.add_subscription(name="future", expires_at=500)
    assert TriggerProviderService.refresh_subscription(trigger_db.tenant_id, skipped.id, now=100) == {
        "result": "skipped",
        "expires_at": 500,
    }
    due = trigger_db.add_subscription(name="due", expires_at=50)
    _patch_provider(mocker, provider_controller)
    _patch_identity_encryption(mocker)
    provider_controller.refresh_trigger.return_value = TriggerSubscriptionEntity(
        expires_at=900,
        endpoint="https://example.test/hook",
        parameters={"event": "push"},
        properties={"project": "refreshed"},
    )

    result = TriggerProviderService.refresh_subscription(trigger_db.tenant_id, due.id, now=100)

    persisted = trigger_db.get_subscription(due.id)
    assert result == {"result": "success", "expires_at": 900}
    assert persisted.properties == {"project": "refreshed"}  # type: ignore[union-attr]


def test_oauth_client_prefers_enabled_tenant_record(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    with trigger_db.session_maker.begin() as session:
        session.add(
            TriggerOAuthTenantClient(
                tenant_id=trigger_db.tenant_id,
                plugin_id=trigger_db.provider_id.plugin_id,
                provider=trigger_db.provider_id.provider_name,
                enabled=True,
                encrypted_oauth_params=json.dumps({"client": "encrypted"}),
            )
        )
    _patch_provider(mocker, provider_controller)
    mocker.patch.object(
        service_module, "create_provider_encrypter", return_value=(_encrypter(decrypted={"client": "tenant"}), Mock())
    )

    assert TriggerProviderService.get_oauth_client(
        trigger_db.tenant_id, trigger_db.provider_id
    ) == PluginOAuthClientConfig(provider_controller.plugin_unique_identifier, {"client": "tenant"})


def test_oauth_client_falls_back_to_verified_system_record(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    with trigger_db.session_maker.begin() as session:
        session.add(
            TriggerOAuthSystemClient(
                plugin_id=trigger_db.provider_id.plugin_id,
                provider=trigger_db.provider_id.provider_name,
                encrypted_oauth_params="system-encrypted",
            )
        )
    _patch_provider(mocker, provider_controller)
    mocker.patch.object(service_module.PluginService, "is_plugin_verified", return_value=True)
    mocker.patch.object(service_module, "decrypt_system_params", return_value={"client": "system"})

    assert TriggerProviderService.get_oauth_client(
        trigger_db.tenant_id, trigger_db.provider_id
    ) == PluginOAuthClientConfig(provider_controller.plugin_unique_identifier, {"client": "system"})


def test_unverified_plugin_cannot_read_system_oauth(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    _patch_provider(mocker, provider_controller)
    mocker.patch.object(service_module.PluginService, "is_plugin_verified", return_value=False)

    assert TriggerProviderService.get_oauth_client(trigger_db.tenant_id, trigger_db.provider_id) is None
