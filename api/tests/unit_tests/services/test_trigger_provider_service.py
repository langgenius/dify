"""SQLite-backed tests for trigger provider subscription lifecycle.

The service intentionally owns short-lived sessions for subscription and OAuth
client operations.  Tests bind those session constructors to an isolated SQLite
engine and assert persisted tenant scope, commits, rollbacks, and constraints;
provider daemons, encryption, Redis locks, and caches remain external mocks.
"""

from __future__ import annotations

import contextlib
import json
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from constants import HIDDEN_VALUE
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
    controller.plugin_unique_identifier = "langgenius/github:0.0.1"
    return controller


def _patch_provider(mocker, provider: object) -> None:
    mocker.patch.object(service_module.TriggerManager, "get_trigger_provider", return_value=provider)


def _patch_lock(mocker) -> None:
    redis = mocker.patch.object(service_module, "redis_client")
    redis.lock.return_value = contextlib.nullcontext()


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


def test_provider_manager_entities_are_forwarded(mocker, trigger_db: TriggerDatabase) -> None:
    provider = Mock()
    provider.to_api_entity.return_value = {"provider": "ok"}
    _patch_provider(mocker, provider)
    provider_b = Mock()
    provider_b.to_api_entity.return_value = {"provider": "other"}
    mocker.patch.object(
        service_module.TriggerManager, "list_all_trigger_providers", return_value=[provider, provider_b]
    )

    assert TriggerProviderService.get_trigger_provider(trigger_db.tenant_id, trigger_db.provider_id) == {
        "provider": "ok"
    }
    assert TriggerProviderService.list_trigger_providers(trigger_db.tenant_id) == [
        {"provider": "ok"},
        {"provider": "other"},
    ]


def test_list_subscriptions_empty_state(trigger_db: TriggerDatabase) -> None:
    assert (
        TriggerProviderService.list_trigger_provider_subscriptions(trigger_db.tenant_id, trigger_db.provider_id) == []
    )


def test_list_subscriptions_masks_and_counts_distinct_apps(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    target = trigger_db.add_subscription(subscription_id=str(uuid4()))
    trigger_db.add_subscription(tenant_id=trigger_db.other_tenant_id, name="foreign")
    with trigger_db.session_maker.begin() as session:
        session.add_all(
            [
                WorkflowPluginTrigger(
                    app_id=str(uuid4()),
                    node_id="node-1",
                    tenant_id=trigger_db.tenant_id,
                    provider_id=str(trigger_db.provider_id),
                    event_name="push",
                    subscription_id=target.id,
                ),
                WorkflowPluginTrigger(
                    app_id=str(uuid4()),
                    node_id="node-2",
                    tenant_id=trigger_db.tenant_id,
                    provider_id=str(trigger_db.provider_id),
                    event_name="push",
                    subscription_id=target.id,
                ),
                WorkflowPluginTrigger(
                    app_id=str(uuid4()),
                    node_id="foreign",
                    tenant_id=trigger_db.other_tenant_id,
                    provider_id=str(trigger_db.provider_id),
                    event_name="push",
                    subscription_id=target.id,
                ),
            ]
        )
    _patch_provider(mocker, provider_controller)
    masked = _encrypter(masked={"secret": "****"})
    mocker.patch.object(
        service_module, "create_trigger_provider_encrypter_for_subscription", return_value=(masked, Mock())
    )
    mocker.patch.object(
        service_module, "create_trigger_provider_encrypter_for_properties", return_value=(masked, Mock())
    )

    subscriptions = TriggerProviderService.list_trigger_provider_subscriptions(
        trigger_db.tenant_id, trigger_db.provider_id
    )

    assert [item.id for item in subscriptions] == [target.id]
    assert subscriptions[0].credentials == {"secret": "****"}
    assert subscriptions[0].workflows_in_use == 2


@pytest.mark.parametrize("credential_type", [CredentialType.API_KEY, CredentialType.UNAUTHORIZED])
def test_add_subscription_commits_encrypted_state(
    mocker,
    trigger_db: TriggerDatabase,
    provider_controller: Mock,
    credential_type: CredentialType,
) -> None:
    _patch_lock(mocker)
    _patch_provider(mocker, provider_controller)
    encrypter = _encrypter(encrypted={"stored": "encrypted"})
    mocker.patch.object(service_module, "create_provider_encrypter", return_value=(encrypter, Mock()))
    subscription_id = str(uuid4())

    result = TriggerProviderService.add_trigger_subscription(
        tenant_id=trigger_db.tenant_id,
        user_id=trigger_db.user_id,
        name="main",
        provider_id=trigger_db.provider_id,
        endpoint_id="endpoint-main",
        credential_type=credential_type,
        parameters={"event": "push"},
        properties={"project": "plain"},
        credentials={"token": "plain"},
        subscription_id=subscription_id,
    )

    persisted = trigger_db.get_subscription(subscription_id)
    assert result == {"result": "success", "id": subscription_id}
    assert persisted is not None
    assert persisted.properties == {"stored": "encrypted"}
    expected_credentials = {} if credential_type == CredentialType.UNAUTHORIZED else {"stored": "encrypted"}
    assert persisted.credentials == expected_credentials


def test_add_subscription_limit_rolls_back_without_cross_tenant_count(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    for index in range(TriggerProviderService.__MAX_TRIGGER_PROVIDER_COUNT__):
        trigger_db.add_subscription(name=f"target-{index}")
    for index in range(3):
        trigger_db.add_subscription(tenant_id=trigger_db.other_tenant_id, name=f"foreign-{index}")
    _patch_lock(mocker)
    _patch_provider(mocker, provider_controller)

    with pytest.raises(ValueError, match="Maximum number of providers"):
        TriggerProviderService.add_trigger_subscription(
            tenant_id=trigger_db.tenant_id,
            user_id=trigger_db.user_id,
            name="overflow",
            provider_id=trigger_db.provider_id,
            endpoint_id="overflow",
            credential_type=CredentialType.UNAUTHORIZED,
            parameters={},
            properties={},
            credentials={},
        )

    with trigger_db.session_maker() as session:
        count = session.scalar(
            select(func.count())
            .select_from(TriggerSubscription)
            .where(TriggerSubscription.tenant_id == trigger_db.tenant_id)
        )
    assert count == TriggerProviderService.__MAX_TRIGGER_PROVIDER_COUNT__


def test_add_duplicate_name_rolls_back_and_database_constraint_matches_precheck(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    original = trigger_db.add_subscription(name="main")
    _patch_lock(mocker)
    _patch_provider(mocker, provider_controller)

    with pytest.raises(ValueError, match="already exists"):
        TriggerProviderService.add_trigger_subscription(
            tenant_id=trigger_db.tenant_id,
            user_id=trigger_db.user_id,
            name="main",
            provider_id=trigger_db.provider_id,
            endpoint_id="second-endpoint",
            credential_type=CredentialType.UNAUTHORIZED,
            parameters={},
            properties={},
            credentials={},
        )

    duplicate = TriggerSubscription(
        tenant_id=trigger_db.tenant_id,
        user_id=trigger_db.user_id,
        name="main",
        endpoint_id="constraint-endpoint",
        provider_id=str(trigger_db.provider_id),
        parameters={},
        properties={},
        credentials={},
        credential_type=CredentialType.UNAUTHORIZED,
    )
    with pytest.raises(IntegrityError):
        with trigger_db.session_maker.begin() as session:
            session.add(duplicate)
    assert trigger_db.get_subscription(original.id) is not None


def test_update_subscription_persists_fields_and_preserves_hidden_property(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    subscription = trigger_db.add_subscription(properties={"project": "old-encrypted"})
    _patch_lock(mocker)
    _patch_provider(mocker, provider_controller)
    properties = _encrypter(decrypted={"project": "old-value"})
    credentials = _encrypter(encrypted={"token": "new-encrypted"})
    mocker.patch.object(
        service_module,
        "create_provider_encrypter",
        side_effect=[(properties, Mock()), (credentials, Mock())],
    )
    clear_cache = mocker.patch.object(service_module, "delete_cache_for_subscription")

    TriggerProviderService.update_trigger_subscription(
        trigger_db.tenant_id,
        subscription.id,
        name="renamed",
        properties={"project": HIDDEN_VALUE, "region": "us"},
        parameters={"event": "issues"},
        credentials={"token": "plain"},
        credential_expires_at=100,
        expires_at=200,
    )

    persisted = trigger_db.get_subscription(subscription.id)
    assert persisted is not None
    assert persisted.name == "renamed"
    assert persisted.properties == {"project": "old-value", "region": "us"}
    assert persisted.credentials == {"token": "new-encrypted"}
    assert persisted.expires_at == 200
    clear_cache.assert_called_once()


def test_update_missing_and_conflicting_names_leave_rows_unchanged(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    first = trigger_db.add_subscription(name="first")
    trigger_db.add_subscription(name="second")
    _patch_lock(mocker)
    _patch_provider(mocker, provider_controller)

    with pytest.raises(ValueError, match="not found"):
        TriggerProviderService.update_trigger_subscription(trigger_db.tenant_id, str(uuid4()))
    with pytest.raises(ValueError, match="already exists"):
        TriggerProviderService.update_trigger_subscription(trigger_db.tenant_id, first.id, name="second")
    assert trigger_db.get_subscription(first.id).name == "first"  # type: ignore[union-attr]


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
    assert result.credentials == {"token": "plain"}
    assert result.properties == {"project": "plain"}


@pytest.mark.parametrize("credential_type", [CredentialType.API_KEY, CredentialType.UNAUTHORIZED])
def test_delete_subscription_uses_real_caller_transaction(
    mocker,
    trigger_db: TriggerDatabase,
    provider_controller: Mock,
    credential_type: CredentialType,
) -> None:
    subscription = trigger_db.add_subscription(credential_type=credential_type)
    _patch_provider(mocker, provider_controller)
    _patch_identity_encryption(mocker)
    unsubscribe = mocker.patch.object(service_module.TriggerManager, "unsubscribe_trigger")
    mocker.patch.object(service_module, "delete_cache_for_subscription")

    with trigger_db.session_maker.begin() as session:
        TriggerProviderService.delete_trigger_provider(trigger_db.tenant_id, subscription.id, session=session)

    assert trigger_db.get_subscription(subscription.id) is None
    if credential_type == CredentialType.UNAUTHORIZED:
        unsubscribe.assert_not_called()
    else:
        unsubscribe.assert_called_once()


def test_refresh_oauth_token_persists_credentials_after_commit(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    subscription = trigger_db.add_subscription(credential_type=CredentialType.OAUTH2)
    _patch_provider(mocker, provider_controller)
    encrypter = _encrypter(decrypted={"refresh": "old"}, encrypted={"access": "new"})
    mocker.patch.object(service_module, "create_provider_encrypter", return_value=(encrypter, Mock()))
    mocker.patch.object(TriggerProviderService, "get_oauth_client", return_value={"client": "system"})
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

    assert TriggerProviderService.get_oauth_client(trigger_db.tenant_id, trigger_db.provider_id) == {"client": "tenant"}


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

    assert TriggerProviderService.get_oauth_client(trigger_db.tenant_id, trigger_db.provider_id) == {"client": "system"}
    assert TriggerProviderService.is_oauth_system_client_exists(trigger_db.tenant_id, trigger_db.provider_id)


def test_unverified_plugin_cannot_read_system_oauth(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    _patch_provider(mocker, provider_controller)
    mocker.patch.object(service_module.PluginService, "is_plugin_verified", return_value=False)

    assert TriggerProviderService.get_oauth_client(trigger_db.tenant_id, trigger_db.provider_id) is None
    assert not TriggerProviderService.is_oauth_system_client_exists(trigger_db.tenant_id, trigger_db.provider_id)


def test_custom_oauth_client_create_mask_enable_and_delete(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    _patch_provider(mocker, provider_controller)
    encrypter = _encrypter(
        encrypted={"client_secret": "encrypted"}, decrypted={"client_secret": "plain"}, masked={"client_secret": "****"}
    )
    cache = Mock()
    mocker.patch.object(service_module, "create_provider_encrypter", return_value=(encrypter, cache))

    assert TriggerProviderService.save_custom_oauth_client_params(
        trigger_db.tenant_id,
        trigger_db.provider_id,
        client_params={"client_secret": "plain"},
        enabled=True,
    ) == {"result": "success"}
    assert TriggerProviderService.is_oauth_custom_client_enabled(trigger_db.tenant_id, trigger_db.provider_id)
    assert TriggerProviderService.get_custom_oauth_client_params(trigger_db.tenant_id, trigger_db.provider_id) == {
        "client_secret": "****"
    }
    assert TriggerProviderService.delete_custom_oauth_client_params(trigger_db.tenant_id, trigger_db.provider_id) == {
        "result": "success"
    }
    assert TriggerProviderService.get_custom_oauth_client_params(trigger_db.tenant_id, trigger_db.provider_id) == {}


def test_endpoint_lookup_decrypts_persisted_subscription(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    subscription = trigger_db.add_subscription(endpoint_id="lookup-endpoint")
    _patch_provider(mocker, provider_controller)
    _patch_identity_encryption(mocker)

    assert TriggerProviderService.get_subscription_by_endpoint("missing") is None
    found = TriggerProviderService.get_subscription_by_endpoint("lookup-endpoint")
    assert found is not None
    assert found.id == subscription.id


@pytest.mark.parametrize("valid", [True, False])
def test_verify_api_key_credentials_uses_persisted_subscription(
    mocker,
    trigger_db: TriggerDatabase,
    provider_controller: Mock,
    valid: bool,
) -> None:
    subscription = trigger_db.add_subscription(credentials={"token": "old"})
    _patch_provider(mocker, provider_controller)
    _patch_identity_encryption(mocker)
    if not valid:
        provider_controller.validate_credentials.side_effect = RuntimeError("denied")

    if valid:
        assert TriggerProviderService.verify_subscription_credentials(
            trigger_db.tenant_id,
            trigger_db.user_id,
            trigger_db.provider_id,
            subscription.id,
            {"token": HIDDEN_VALUE},
        ) == {"verified": True}
        provider_controller.validate_credentials.assert_called_once_with(
            trigger_db.user_id, credentials={"token": "old"}
        )
    else:
        with pytest.raises(ValueError, match="Invalid credentials"):
            TriggerProviderService.verify_subscription_credentials(
                trigger_db.tenant_id,
                trigger_db.user_id,
                trigger_db.provider_id,
                subscription.id,
                {"token": "new"},
            )


def test_rebuild_subscription_preserves_id_endpoint_and_updates_state(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    subscription = trigger_db.add_subscription(endpoint_id="stable-endpoint", credentials={"token": "old"})
    _patch_provider(mocker, provider_controller)
    _patch_lock(mocker)
    _patch_identity_encryption(mocker)
    mocker.patch.object(
        service_module.TriggerManager, "unsubscribe_trigger", return_value=SimpleNamespace(success=True)
    )
    mocker.patch.object(
        service_module.TriggerManager,
        "subscribe_trigger",
        return_value=TriggerSubscriptionEntity(
            expires_at=777,
            endpoint="stable-endpoint",
            parameters={"event": "issues"},
            properties={"hook": "new"},
        ),
    )
    mocker.patch.object(service_module, "delete_cache_for_subscription")

    TriggerProviderService.rebuild_trigger_subscription(
        trigger_db.tenant_id,
        trigger_db.provider_id,
        subscription.id,
        credentials={"token": HIDDEN_VALUE},
        parameters={"event": "issues"},
        name="rebuilt",
    )

    persisted = trigger_db.get_subscription(subscription.id)
    assert persisted is not None
    assert persisted.endpoint_id == "stable-endpoint"
    assert persisted.name == "rebuilt"
    assert persisted.credentials == {"token": "old"}
    assert persisted.properties == {"hook": "new"}
    assert persisted.expires_at == 777
