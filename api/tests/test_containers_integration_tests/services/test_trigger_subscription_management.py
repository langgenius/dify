"""Management HTTP tests use real SQL, Redis locks/caches, RSA and plugin transport."""

from contextvars import Context
from dataclasses import replace
from http import HTTPStatus
from socket import socket
from uuid import uuid4

import pytest
from redis import Redis
from redis.backoff import NoBackoff
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import LockNotOwnedError
from redis.exceptions import TimeoutError as RedisTimeoutError
from redis.retry import Retry
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE, UNKNOWN_VALUE
from core.helper.encrypter import decrypt_token, encrypt_token
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.utils.encryption import TriggerProviderCredentialsCache, TriggerProviderPropertiesCache
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from extensions.ext_application_services import application_services
from extensions.ext_redis import redis_client
from models.account import TenantAccountRole
from models.trigger import TriggerSubscription, WorkflowPluginTrigger
from repositories.trigger.subscription_repository import RedisTriggerSubscriptionLocks, TriggerSubscriptionRepository
from services.trigger.subscription_gateway import PluginTriggerSubscriptionGateway
from services.trigger.subscription_service import TriggerSubscriptionService
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


@pytest.mark.parametrize("operation", ["create", "update", "delete"])
def test_committed_changes_succeed_when_redis_lock_ownership_is_lost(
    harness: _Harness, daemon: _Daemon, caplog: pytest.LogCaptureFixture, operation: str
) -> None:
    if operation == "create":
        builder = test_trigger_subscription_builder._create(harness, daemon, CredentialType.UNAUTHORIZED)
        subscription_id = builder.id
        url = f"{_BASE}/build/{subscription_id}"
        lock_key = f"trigger_provider_create_lock:{harness.tenant_id}_{_PROVIDER}"
    else:
        subscription_id = _seed(harness, daemon, CredentialType.UNAUTHORIZED).id
        url = _url(operation, subscription_id)
        lock_key = f"trigger_subscription_update_lock:{harness.tenant_id}_{subscription_id}"
    cache_keys = _cache_keys(harness, subscription_id)
    if operation != "create":
        for key in cache_keys:
            redis_client.setex(key, 1800, "{}")
    lost_tokens: list[bytes] = []
    successor_token = b"another-lock-owner"

    def lose_lock_after_commit(_session: Session) -> None:
        token = redis_client.get(lock_key)
        assert isinstance(token, bytes)
        lost_tokens.append(token)
        redis_client.set(lock_key, successor_token, ex=60)

    event.listen(harness.session_factory, "after_commit", lose_lock_after_commit)
    try:
        response = Context().run(harness.call, "POST", url=url, payload={"name": "Committed"})
        assert redis_client.get(lock_key) == successor_token
    finally:
        event.remove(harness.session_factory, "after_commit", lose_lock_after_commit)
        redis_client.delete(lock_key)

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"result": "success"}
    assert len(lost_tokens) == 1
    assert any(record.exc_info and isinstance(record.exc_info[1], LockNotOwnedError) for record in caplog.records)
    with harness.session_factory() as session:
        saved = session.get(TriggerSubscription, subscription_id)
        if operation == "delete":
            assert saved is None
        else:
            assert saved is not None
            assert saved.name == "Committed"
    if operation == "create":
        assert redis_client.get(test_trigger_subscription_builder._key(subscription_id)) is None
    else:
        assert all(redis_client.exists(key) == 0 for key in cache_keys)


def test_lock_release_failure_does_not_replace_subscription_name_conflict(
    harness: _Harness, daemon: _Daemon, caplog: pytest.LogCaptureFixture
) -> None:
    subscription = _seed(harness, daemon, CredentialType.UNAUTHORIZED)
    _add_subscription(harness, name="Taken", credential_type=CredentialType.UNAUTHORIZED)
    lock_key = f"trigger_subscription_update_lock:{harness.tenant_id}_{subscription.id}"
    successor_token = b"another-lock-owner"
    rolled_back: list[bool] = []

    def lose_lock_after_rollback(_session: Session) -> None:
        assert redis_client.get(lock_key) is not None
        redis_client.set(lock_key, successor_token, ex=60)
        rolled_back.append(True)

    event.listen(harness.session_factory, "after_rollback", lose_lock_after_rollback)
    try:
        response = Context().run(harness.call, "POST", url=_url("update", subscription.id), payload={"name": "Taken"})
        assert redis_client.get(lock_key) == successor_token
    finally:
        event.remove(harness.session_factory, "after_rollback", lose_lock_after_rollback)
        redis_client.delete(lock_key)

    assert response.status_code == HTTPStatus.CONFLICT
    assert response.get_json()["code"] == "trigger_subscription_name_conflict"
    assert rolled_back == [True]
    assert _read(harness, subscription.id).name == subscription.name
    assert any(record.exc_info and isinstance(record.exc_info[1], LockNotOwnedError) for record in caplog.records)


@pytest.mark.parametrize("operation", ["update", "delete"])
def test_committed_changes_succeed_when_redis_cache_invalidation_is_unavailable(
    harness: _Harness, daemon: _Daemon, caplog: pytest.LogCaptureFixture, operation: str
) -> None:
    subscription = _seed(harness, daemon, CredentialType.UNAUTHORIZED)
    cache_values = dict.fromkeys(_cache_keys(harness, subscription.id), b'{"value":"cached-before-write"}')
    for key, value in cache_values.items():
        redis_client.setex(key, 1800, value)
    with harness.app.app_context():
        services = application_services()
    invalidation_attempts: list[tuple[str, str, str]] = []

    # Keep the port reserved without listening, so only the cache-cleanup
    # transport fails; persistence, plugin calls and Redis locks remain real.
    with socket() as unavailable:
        unavailable.bind(("127.0.0.1", 0))
        with Redis(
            host="127.0.0.1",
            port=unavailable.getsockname()[1],
            socket_connect_timeout=0.1,
            retry=Retry(NoBackoff(), 0),
        ) as disconnected:

            def invalidate_cache(*, tenant_id: str, provider_id: str, subscription_id: str) -> None:
                invalidation_attempts.append((tenant_id, provider_id, subscription_id))
                disconnected.delete(
                    TriggerProviderCredentialsCache(tenant_id, provider_id, subscription_id).cache_key,
                    TriggerProviderPropertiesCache(tenant_id, provider_id, subscription_id).cache_key,
                )

            management = TriggerSubscriptionService(
                subscriptions=TriggerSubscriptionRepository(session_factory=harness.session_factory),
                providers=PluginTriggerSubscriptionGateway(),
                locks=RedisTriggerSubscriptionLocks(redis=redis_client),
                invalidate_cache=invalidate_cache,
            )
            harness.app.extensions["application_services"] = replace(
                services, workspaces=replace(services.workspaces, trigger_subscription_management=management)
            )
            try:
                response = Context().run(
                    harness.call, "POST", url=_url(operation, subscription.id), payload={"name": "Committed"}
                )
            finally:
                harness.app.extensions["application_services"] = services

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"result": "success"}
    assert invalidation_attempts == [(harness.tenant_id, _PROVIDER, subscription.id)]
    assert any(
        record.exc_info
        and isinstance(record.exc_info[1], RedisConnectionError | RedisTimeoutError)
        and subscription.id in record.getMessage()
        for record in caplog.records
    )
    with harness.session_factory() as session:
        saved = session.get(TriggerSubscription, subscription.id)
        if operation == "delete":
            assert saved is None
        else:
            assert saved is not None
            assert saved.name == "Committed"
    assert {key: redis_client.get(key) for key in cache_values} == cache_values
    assert all(redis_client.ttl(key) > 0 for key in cache_values)


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


@pytest.mark.parametrize("failed_operation", ["unsubscribe", "subscribe"])
def test_failed_rebuild_keeps_persisted_state_and_cache(
    harness: _Harness, daemon: _Daemon, failed_operation: str
) -> None:
    subscription = _seed(harness, daemon, CredentialType.OAUTH2)
    daemon.responses_by_path = {
        f"/plugin/{harness.tenant_id}/dispatch/trigger/unsubscribe": {"subscription": {"success": True}},
    }
    daemon.response_codes_by_path = {f"/plugin/{harness.tenant_id}/dispatch/trigger/{failed_operation}": 1}
    daemon.response_message = "provider unavailable"
    daemon.response_data = None
    cache_values = dict.fromkeys(_cache_keys(harness, subscription.id), b'{"value":"must-stay-cached"}')
    for key, value in cache_values.items():
        redis_client.setex(key, 1800, value)
    row_query = select(TriggerSubscription.__table__).where(TriggerSubscription.id == subscription.id)
    with harness.session_factory() as session:
        before = dict(session.execute(row_query).mappings().one())

    response = Context().run(
        harness.call,
        "POST",
        url=_url("update", subscription.id),
        payload={"name": "Must not commit", "parameters": {"event": "pull"}},
    )

    assert response.status_code == HTTPStatus.BAD_GATEWAY
    assert response.get_json()["code"] == "trigger_subscription_provider_error"
    assert subscription.id in response.get_json()["message"]
    assert ("remove" if failed_operation == "unsubscribe" else "rebuild") in response.get_json()["message"]
    sent = [sent for sent in daemon.requests if sent.method == "POST"]
    assert [call.path.rsplit("/", 1)[-1] for call in sent] == (
        ["unsubscribe"] if failed_operation == "unsubscribe" else ["unsubscribe", "subscribe"]
    )
    assert all(not sent.open_transactions for sent in daemon.requests)
    with harness.session_factory() as session:
        assert dict(session.execute(row_query).mappings().one()) == before
    assert {key: redis_client.get(key) for key in cache_values} == cache_values


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
