"""Management HTTP tests use real SQL, Redis locks/caches, RSA and plugin transport."""

from contextvars import Context
from http import HTTPStatus
from uuid import uuid4

import pytest
from sqlalchemy import Connection, Engine, event, select

from constants import HIDDEN_VALUE, UNKNOWN_VALUE
from core.helper.encrypter import decrypt_token, encrypt_token
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.utils.encryption import TriggerProviderCredentialsCache, TriggerProviderPropertiesCache
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from extensions.ext_redis import redis_client
from models.account import TenantAccountRole
from models.trigger import TriggerSubscription, WorkflowPluginTrigger
from tests.test_containers_integration_tests.services import test_trigger_subscription_builder
from tests.test_containers_integration_tests.services.test_trigger_subscription_query import _provider_with_secrets
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _BASE, _Daemon
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_management import _url
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_query import _add_subscription

application_redis = test_trigger_subscription_builder.application_redis
sqlite_engine = test_trigger_subscription_builder.sqlite_engine
sqlite_session_factory = test_trigger_subscription_builder.sqlite_session_factory
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon


def _seed(harness: _Harness, daemon: _Daemon, credential_type: CredentialType) -> TriggerSubscription:
    daemon.provider = _provider_with_secrets()
    with harness.app.app_context():
        token = encrypt_token(harness.tenant_id, "stored-token")
        secret = encrypt_token(harness.tenant_id, "stored-property")
    return _add_subscription(
        harness,
        user_id=str(uuid4()),
        credential_type=credential_type,
        credentials={} if credential_type == CredentialType.UNAUTHORIZED else {"token": token, "username": "old"},
        properties={"secret": secret, "repository": "before"},
    )


def _read(harness: _Harness, subscription_id: str) -> TriggerSubscription:
    with harness.session_factory() as session:
        subscription = session.get(TriggerSubscription, subscription_id)
        assert subscription is not None
        return subscription


def _decrypt(harness: _Harness, value: object) -> str:
    assert isinstance(value, str)
    with harness.app.app_context():
        return decrypt_token(harness.tenant_id, value)


def _cache_keys(harness: _Harness, subscription_id: str) -> tuple[str, str]:
    return (
        TriggerProviderCredentialsCache(harness.tenant_id, _PROVIDER, subscription_id).cache_key,
        TriggerProviderPropertiesCache(harness.tenant_id, _PROVIDER, subscription_id).cache_key,
    )


def test_manual_update_restores_hidden_property_and_invalidates_cache_after_commit(
    harness: _Harness, daemon: _Daemon, sqlite_engine: Engine
) -> None:
    subscription = _seed(harness, daemon, CredentialType.UNAUTHORIZED)
    harness.set_role(TenantAccountRole.EDITOR)
    keys = _cache_keys(harness, subscription.id)
    for key in keys:
        redis_client.setex(key, 1800, '{"secret":"stale-cache-must-not-be-restored"}')
    cache_present_at_commit: list[bool] = []

    def observe_commit(_connection: Connection) -> None:
        cache_present_at_commit.append(all(redis_client.exists(key) for key in keys))

    event.listen(sqlite_engine, "commit", observe_commit)
    try:
        response = Context().run(
            harness.call,
            "POST",
            url=_url("update", subscription.id),
            payload={"name": "Renamed", "properties": {"secret": HIDDEN_VALUE, "repository": "after"}},
        )
    finally:
        event.remove(sqlite_engine, "commit", observe_commit)

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"result": "success"}
    saved = _read(harness, subscription.id)
    assert saved.name == "Renamed"
    assert saved.credentials == {}
    assert saved.parameters == subscription.parameters
    assert saved.properties["repository"] == "after"
    assert _decrypt(harness, saved.properties["secret"]) == "stored-property"
    assert cache_present_at_commit == [True]
    assert all(redis_client.exists(key) == 0 for key in keys)
    assert all(sent.method == "GET" and not sent.open_transactions for sent in daemon.requests)


def test_rename_authorized_subscription_does_not_rebuild_or_change_credentials(
    harness: _Harness, daemon: _Daemon
) -> None:
    subscription = _seed(harness, daemon, CredentialType.API_KEY)

    response = Context().run(
        harness.call, "POST", url=_url("update", subscription.id), payload={"name": "Only renamed"}
    )

    assert response.status_code == HTTPStatus.OK
    saved = _read(harness, subscription.id)
    assert saved.name == "Only renamed"
    assert saved.credentials == subscription.credentials
    assert saved.properties == subscription.properties
    assert saved.parameters == subscription.parameters
    assert not any(sent.method == "POST" for sent in daemon.requests)


@pytest.mark.parametrize("outcome", ["verified", "invalid-credentials", "provider-failure"])
def test_verify_restores_hidden_credentials_without_updating_and_maps_provider_errors(
    harness: _Harness, daemon: _Daemon, outcome: str
) -> None:
    subscription = _seed(harness, daemon, CredentialType.API_KEY)
    harness.set_role(TenantAccountRole.EDITOR)
    daemon.response_data = {"result": outcome == "verified"}
    if outcome == "provider-failure":
        daemon.response_code = 1
        daemon.response_message = "provider unavailable"
        daemon.response_data = None

    response = Context().run(
        harness.call,
        "POST",
        url=_url("verify", subscription.id),
        payload={"credentials": {"token": HIDDEN_VALUE, "username": "candidate", "missing": HIDDEN_VALUE}},
    )

    if outcome == "verified":
        assert response.status_code == HTTPStatus.OK
        assert response.get_json() == {"verified": True}
    else:
        assert response.status_code == (
            HTTPStatus.BAD_REQUEST if outcome == "invalid-credentials" else HTTPStatus.BAD_GATEWAY
        )
        assert response.get_json()["code"] == (
            "trigger_subscription_invalid"
            if outcome == "invalid-credentials"
            else "trigger_subscription_provider_error"
        )
        assert _PROVIDER in response.get_json()["message"]
    sent = [sent for sent in daemon.requests if sent.method == "POST"]
    assert len(sent) == 1
    assert sent[0].path == f"/plugin/{harness.tenant_id}/dispatch/trigger/validate_credentials"
    assert sent[0].payload == {
        "user_id": harness.account_id,
        "data": {
            "provider": "github",
            "credentials": {"token": "stored-token", "username": "candidate", "missing": UNKNOWN_VALUE},
        },
    }
    assert all(not sent.open_transactions for sent in daemon.requests)
    assert _read(harness, subscription.id).credentials == subscription.credentials


def test_rebuild_preserves_owner_and_endpoint_while_replacing_provider_state(
    harness: _Harness, daemon: _Daemon
) -> None:
    subscription = _seed(harness, daemon, CredentialType.OAUTH2)
    daemon.observed_lock_key = f"trigger_subscription_update_lock:{harness.tenant_id}_{subscription.id}"
    daemon.responses_by_path = {
        f"/plugin/{harness.tenant_id}/dispatch/trigger/unsubscribe": {"subscription": {"success": True}},
        f"/plugin/{harness.tenant_id}/dispatch/trigger/subscribe": {
            "subscription": {
                "endpoint": generate_plugin_trigger_endpoint_url(subscription.endpoint_id),
                "parameters": {"event": "pull"},
                "properties": {"secret": HIDDEN_VALUE, "repository": "rebuilt"},
                "expires_at": 987654321,
            }
        },
    }

    response = Context().run(
        harness.call,
        "POST",
        url=_url("update", subscription.id),
        payload={"name": "Rebuilt", "credentials": {"token": HIDDEN_VALUE}, "parameters": {"event": "pull"}},
    )

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"result": "success"}
    saved = _read(harness, subscription.id)
    assert (saved.id, saved.endpoint_id, saved.user_id, saved.tenant_id) == (
        subscription.id,
        subscription.endpoint_id,
        subscription.user_id,
        subscription.tenant_id,
    )
    assert saved.name == "Rebuilt"
    assert saved.parameters == {"event": "pull"}
    assert saved.properties["repository"] == "rebuilt"
    assert saved.expires_at == 987654321
    assert _decrypt(harness, saved.credentials["token"]) == "stored-token"
    assert _decrypt(harness, saved.properties["secret"]) == "stored-property"
    sent = [sent for sent in daemon.requests if sent.method == "POST"]
    assert [call.path.rsplit("/", 1)[-1] for call in sent] == ["unsubscribe", "subscribe"]
    assert all(call.lock_held is False for call in sent)
    assert all(call.payload["user_id"] == subscription.user_id for call in sent)
    assert sent[1].payload["data"] == {
        "provider": "github",
        "credentials": {"token": "stored-token"},
        "credential_type": "oauth2",
        "endpoint": generate_plugin_trigger_endpoint_url(subscription.endpoint_id),
        "parameters": {"event": "pull"},
    }
    assert all(not sent.open_transactions for sent in daemon.requests)


def test_failed_rebuild_keeps_persisted_state_and_cache(harness: _Harness, daemon: _Daemon) -> None:
    subscription = _seed(harness, daemon, CredentialType.OAUTH2)
    daemon.response_code = 1
    daemon.response_message = "provider unavailable"
    daemon.response_data = None
    keys = _cache_keys(harness, subscription.id)
    for key in keys:
        redis_client.setex(key, 1800, "{}")

    response = Context().run(
        harness.call,
        "POST",
        url=_url("update", subscription.id),
        payload={"name": "Must not commit", "parameters": {"event": "pull"}},
    )

    assert response.status_code == HTTPStatus.BAD_GATEWAY
    assert response.get_json()["code"] == "trigger_subscription_provider_error"
    assert subscription.id in response.get_json()["message"]
    saved = _read(harness, subscription.id)
    assert saved.name == subscription.name
    assert saved.credentials == subscription.credentials
    assert saved.properties == subscription.properties
    assert saved.parameters == subscription.parameters
    assert all(redis_client.exists(key) for key in keys)


@pytest.mark.parametrize("provider_rejects", [False, True], ids=["unsubscribed", "provider-failed"])
def test_delete_removes_all_owned_workflow_links_even_when_provider_fails(
    harness: _Harness, daemon: _Daemon, provider_rejects: bool
) -> None:
    subscription = _seed(harness, daemon, CredentialType.API_KEY)
    harness.set_role(TenantAccountRole.ADMIN)
    daemon.observed_lock_key = f"trigger_subscription_update_lock:{harness.tenant_id}_{subscription.id}"
    daemon.response_data = {"subscription": {"success": True}}
    if provider_rejects:
        daemon.response_code = 1
        daemon.response_message = "provider unavailable"
        daemon.response_data = None
    with harness.session_factory.begin() as session:
        links = [
            WorkflowPluginTrigger(
                app_id=str(uuid4()),
                node_id=f"node-{index}",
                tenant_id=tenant,
                provider_id=_PROVIDER,
                event_name="push",
                subscription_id=subscription.id,
            )
            for index, tenant in enumerate([harness.tenant_id, harness.tenant_id, str(uuid4())])
        ]
        session.add_all(links)
    for key in _cache_keys(harness, subscription.id):
        redis_client.setex(key, 1800, "{}")

    response = Context().run(harness.call, "POST", url=_url("delete", subscription.id), payload={})

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"result": "success"}
    with harness.session_factory() as session:
        assert session.get(TriggerSubscription, subscription.id) is None
        assert list(session.scalars(select(WorkflowPluginTrigger.id))) == [links[2].id]
    assert all(redis_client.exists(key) == 0 for key in _cache_keys(harness, subscription.id))
    sent = [sent for sent in daemon.requests if sent.method == "POST"]
    assert len(sent) == 1
    assert sent[0].path.endswith("/dispatch/trigger/unsubscribe")
    assert sent[0].lock_held is False
    assert all(not sent.open_transactions for sent in daemon.requests)


def test_builder_uses_the_shared_writer_to_encrypt_nonempty_credentials(harness: _Harness, daemon: _Daemon) -> None:
    builder = test_trigger_subscription_builder._create(harness, daemon, CredentialType.API_KEY)
    update = Context().run(
        harness.call, "POST", url=f"{_BASE}/update/{builder.id}", payload={"credentials": {"token": "builder-secret"}}
    )
    assert update.status_code == HTTPStatus.OK
    daemon.response_data = {
        "subscription": {
            "endpoint": generate_plugin_trigger_endpoint_url(builder.endpoint_id),
            "parameters": {"event": "push"},
            "properties": {"repository": "dify"},
            "expires_at": -1,
        }
    }

    response = Context().run(harness.call, "POST", url=f"{_BASE}/build/{builder.id}", payload={"name": "Published"})

    assert response.status_code == HTTPStatus.OK
    saved = _read(harness, builder.id)
    assert saved.credentials["token"] != "builder-secret"
    assert _decrypt(harness, saved.credentials["token"]) == "builder-secret"
    assert redis_client.get(test_trigger_subscription_builder._key(builder.id)) is None
