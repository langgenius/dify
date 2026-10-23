"""Renewal uses real SQLite, Redis, RSA, plugin HTTP and the Celery task entrypoint."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from contextvars import Context
from threading import Thread

import pytest
from sqlalchemy import Connection, Engine, event

from core.helper.encrypter import encrypt_token
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from core.trigger.utils.locks import build_trigger_refresh_lock_key
from extensions.ext_application_services import application_services
from extensions.ext_redis import redis_client
from models.enums import PermissionEnum
from models.trigger import TriggerSubscription
from services.plugin.dispatch_identity import PLUGIN_IDENTIFIER_HEADER
from services.trigger.subscription_service import TriggerSubscriptionChangedError
from tasks.trigger_subscription_refresh_tasks import trigger_subscription_refresh
from tests.test_containers_integration_tests.services import test_trigger_subscription_builder
from tests.test_containers_integration_tests.services.test_trigger_subscription_management import (
    _cache_keys,
    _decrypt,
    _read,
    _seed,
)
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _SCHEMA, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_provider_query import _IDENTIFIER
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon

application_redis = test_trigger_subscription_builder.application_redis
sqlite_engine = test_trigger_subscription_builder.sqlite_engine
sqlite_session_factory = test_trigger_subscription_builder.sqlite_session_factory
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon


def _expiring_subscription(
    harness: _Harness, daemon: _Daemon, *, credential_expiry: int, subscription_expiry: int
) -> TriggerSubscription:
    subscription = _seed(harness, daemon, CredentialType.OAUTH2)
    declaration = daemon.provider["declaration"]
    assert isinstance(declaration, dict)
    constructor = declaration["subscription_constructor"]
    assert isinstance(constructor, dict)
    oauth_schema = constructor["oauth_schema"]
    assert isinstance(oauth_schema, dict)
    # The client schema deliberately differs from the OAuth token schema.
    oauth_schema["client_schema"] = [field.model_dump(mode="json") for field in _SCHEMA]
    with harness.session_factory.begin() as session:
        row = session.get(TriggerSubscription, subscription.id)
        assert row is not None
        row.credential_expires_at = credential_expiry
        row.expires_at = subscription_expiry
    return _read(harness, subscription.id)


def _prepare_responses(harness: _Harness, daemon: _Daemon) -> None:
    daemon.responses_by_path = {
        f"/plugin/{harness.tenant_id}/dispatch/oauth/refresh_credentials": {
            "credentials": {"token": "renewed-token", "username": "new"},
            "expires_at": 1000,
        },
        f"/plugin/{harness.tenant_id}/dispatch/trigger/refresh": {
            "subscription": {
                "endpoint": "https://provider.example.test/changed-endpoint",
                "parameters": {"event": "provider-changed"},
                "properties": {"secret": "renewed-property", "repository": "after"},
                "expires_at": 2000,
            }
        },
    }


def _refresh(harness: _Harness, subscription_id: str) -> None:
    def run() -> None:
        with harness.app.app_context():
            application_services().workspaces.trigger_subscription_renewal.refresh_if_due(
                tenant_id=harness.tenant_id, subscription_id=subscription_id, now=100
            )

    Context().run(run)


@contextmanager
def _paused_refresh(harness: _Harness, daemon: _Daemon, subscription_id: str, path: str) -> Generator[None]:
    daemon.pause_path = path
    errors: list[BaseException] = []

    def run() -> None:
        try:
            _refresh(harness, subscription_id)
        except BaseException as error:
            errors.append(error)

    thread = Thread(target=run, daemon=True)
    thread.start()
    try:
        assert daemon.request_started.wait(timeout=5), "Renewal did not reach the plugin request"
        yield
    finally:
        daemon.resume_response.set()
        thread.join(timeout=10)
    assert not thread.is_alive(), "Renewal did not finish after releasing the plugin response"
    assert not errors


@pytest.mark.parametrize("client_configuration", ["missing", "empty", "configured"])
def test_oauth_refresh_uses_token_schema_and_pinned_client_then_invalidates_cache_after_commit(
    harness: _Harness, daemon: _Daemon, sqlite_engine: Engine, client_configuration: str
) -> None:
    subscription = _expiring_subscription(harness, daemon, credential_expiry=100, subscription_expiry=-1)
    expected_client: dict[str, object] = {}
    if client_configuration != "missing":
        expected_client = (
            {"client_id": "tenant-client", "client_secret": "client-secret"}
            if client_configuration == "configured"
            else {}
        )
        with harness.app.app_context():
            application_services().workspaces.trigger_oauth_clients.save(
                tenant_id=harness.tenant_id,
                provider_id=harness.metadata.provider.provider_id,
                client_params=expected_client,
                enabled=True,
            )
    _prepare_responses(harness, daemon)
    keys = _cache_keys(harness, subscription.id)
    for key in keys:
        redis_client.setex(key, 1800, '{"token":"stale-cache"}')
    cache_present_at_commit: list[bool] = []

    def observe_commit(_connection: Connection) -> None:
        cache_present_at_commit.append(all(redis_client.exists(key) for key in keys))

    event.listen(sqlite_engine, "commit", observe_commit)
    try:
        _refresh(harness, subscription.id)
    finally:
        event.remove(sqlite_engine, "commit", observe_commit)

    saved = _read(harness, subscription.id)
    assert _decrypt(harness, saved.credentials["token"]) == "renewed-token"
    assert saved.credentials["token"] != "renewed-token"
    assert saved.credentials["username"] == "new"
    assert saved.credential_expires_at == 1000
    assert saved.properties == subscription.properties
    assert saved.expires_at == -1
    sent = [request for request in daemon.requests if request.method == "POST"]
    assert len(sent) == 1
    assert sent[0].path == f"/plugin/{harness.tenant_id}/dispatch/oauth/refresh_credentials"
    assert sent[0].headers[PLUGIN_IDENTIFIER_HEADER] == _IDENTIFIER
    assert sent[0].payload == {
        "user_id": subscription.user_id,
        "data": {
            "provider": "github",
            "redirect_uri": f"https://console.example.test/console/api/oauth/plugin/{_PROVIDER}/trigger/callback",
            "system_credentials": expected_client,
            "credentials": {"token": "stored-token", "username": "old"},
        },
    }
    assert cache_present_at_commit == [True]
    assert all(redis_client.exists(key) == 0 for key in keys)
    assert all(not request.open_transactions for request in daemon.requests)


def test_subscription_refresh_reads_new_oauth_credentials_and_preserves_endpoint_and_parameters(
    harness: _Harness, daemon: _Daemon
) -> None:
    subscription = _expiring_subscription(harness, daemon, credential_expiry=100, subscription_expiry=100)
    _prepare_responses(harness, daemon)

    _refresh(harness, subscription.id)

    sent = [request for request in daemon.requests if request.method == "POST"]
    assert [request.path for request in sent] == [
        f"/plugin/{harness.tenant_id}/dispatch/oauth/refresh_credentials",
        f"/plugin/{harness.tenant_id}/dispatch/trigger/refresh",
    ]
    assert sent[1].payload == {
        "user_id": "system",
        "data": {
            "provider": "github",
            "subscription": {
                "endpoint": generate_plugin_trigger_endpoint_url(subscription.endpoint_id),
                "parameters": {"event": "push"},
                "properties": {"secret": "stored-property", "repository": "before"},
                "expires_at": 100,
            },
            "credentials": {"token": "renewed-token", "username": "new"},
            "credential_type": CredentialType.OAUTH2.value,
        },
    }
    assert all(request.headers[PLUGIN_IDENTIFIER_HEADER] == _IDENTIFIER for request in sent)
    assert all(not request.open_transactions for request in daemon.requests)
    saved = _read(harness, subscription.id)
    assert saved.credential_expires_at == 1000
    assert saved.expires_at == 2000
    assert saved.endpoint_id == subscription.endpoint_id
    assert saved.parameters == subscription.parameters
    assert saved.properties["repository"] == "after"
    assert _decrypt(harness, saved.properties["secret"]) == "renewed-property"
    assert redis_client.exists(_cache_keys(harness, subscription.id)[1]) == 0


@pytest.mark.parametrize("credential_type", [CredentialType.API_KEY, CredentialType.UNAUTHORIZED])
def test_subscription_only_refresh_preserves_credentials_and_invalidates_only_properties(
    harness: _Harness, daemon: _Daemon, sqlite_engine: Engine, credential_type: CredentialType
) -> None:
    subscription = _seed(harness, daemon, credential_type)
    with harness.session_factory.begin() as session:
        row = session.get(TriggerSubscription, subscription.id)
        assert row is not None
        row.credential_expires_at = row.expires_at = 100
    _prepare_responses(harness, daemon)
    keys = _cache_keys(harness, subscription.id)
    for key in keys:
        redis_client.setex(key, 1800, '{"value":"cached-before-renewal"}')
    cache_present_at_commit: list[bool] = []

    def observe_commit(_connection: Connection) -> None:
        cache_present_at_commit.append(all(redis_client.exists(key) for key in keys))

    event.listen(sqlite_engine, "commit", observe_commit)
    try:
        _refresh(harness, subscription.id)
    finally:
        event.remove(sqlite_engine, "commit", observe_commit)

    sent = [request for request in daemon.requests if request.method == "POST"]
    assert len(sent) == 1
    assert sent[0].path == f"/plugin/{harness.tenant_id}/dispatch/trigger/refresh"
    data = sent[0].payload["data"]
    assert isinstance(data, dict)
    assert data["credential_type"] == credential_type.value
    assert data["credentials"] == (
        {} if credential_type == CredentialType.UNAUTHORIZED else {"token": "stored-token", "username": "old"}
    )
    saved = _read(harness, subscription.id)
    assert saved.credentials == subscription.credentials
    assert saved.credential_expires_at == 100
    assert saved.expires_at == 2000
    assert _decrypt(harness, saved.properties["secret"]) == "renewed-property"
    assert cache_present_at_commit == [True]
    assert redis_client.exists(keys[0]) == 1
    assert redis_client.exists(keys[1]) == 0
    assert all(not request.open_transactions for request in daemon.requests)


@pytest.mark.parametrize("stage", ["oauth", "subscription"])
def test_renewal_preserves_concurrent_name_and_visibility_changes(
    harness: _Harness, daemon: _Daemon, stage: str
) -> None:
    subscription = _expiring_subscription(
        harness,
        daemon,
        credential_expiry=100 if stage == "oauth" else -1,
        subscription_expiry=-1 if stage == "oauth" else 100,
    )
    _prepare_responses(harness, daemon)
    path = f"/plugin/{harness.tenant_id}/dispatch/" + (
        "oauth/refresh_credentials" if stage == "oauth" else "trigger/refresh"
    )
    keys = _cache_keys(harness, subscription.id)
    for key in keys:
        redis_client.setex(key, 1800, '{"value":"cached-before-renewal"}')

    with _paused_refresh(harness, daemon, subscription.id, path):
        with harness.session_factory.begin() as session:
            row = session.get(TriggerSubscription, subscription.id)
            assert row is not None
            row.name = "Renamed while renewing"
            row.visibility = PermissionEnum.ONLY_ME

    saved = _read(harness, subscription.id)
    assert saved.name == "Renamed while renewing"
    assert saved.visibility == PermissionEnum.ONLY_ME
    assert saved.parameters == subscription.parameters
    assert saved.endpoint_id == subscription.endpoint_id
    if stage == "oauth":
        assert _decrypt(harness, saved.credentials["token"]) == "renewed-token"
        assert saved.credential_expires_at == 1000
        assert saved.properties == subscription.properties
        assert saved.expires_at == -1
        assert all(redis_client.exists(key) == 0 for key in keys)
    else:
        assert _decrypt(harness, saved.properties["secret"]) == "renewed-property"
        assert saved.expires_at == 2000
        assert saved.credentials == subscription.credentials
        assert saved.credential_expires_at == -1
        assert redis_client.exists(keys[0]) == 1
        assert redis_client.exists(keys[1]) == 0
    assert [request.path for request in daemon.requests if request.method == "POST"] == [path]
    assert all(not request.open_transactions for request in daemon.requests)


@pytest.mark.parametrize("stage", ["oauth", "subscription"])
def test_renewal_rejects_concurrently_changed_provider_inputs(
    harness: _Harness, daemon: _Daemon, caplog: pytest.LogCaptureFixture, stage: str
) -> None:
    subscription = _expiring_subscription(
        harness,
        daemon,
        credential_expiry=100 if stage == "oauth" else -1,
        subscription_expiry=-1 if stage == "oauth" else 100,
    )
    _prepare_responses(harness, daemon)
    with harness.app.app_context():
        replacement_token = encrypt_token(harness.tenant_id, "concurrently-replaced-token")
    path = f"/plugin/{harness.tenant_id}/dispatch/" + (
        "oauth/refresh_credentials" if stage == "oauth" else "trigger/refresh"
    )
    keys = _cache_keys(harness, subscription.id)
    for key in keys:
        redis_client.setex(key, 1800, '{"value":"cached-before-renewal"}')

    with _paused_refresh(harness, daemon, subscription.id, path):
        with harness.session_factory.begin() as session:
            row = session.get(TriggerSubscription, subscription.id)
            assert row is not None
            if stage == "oauth":
                row.credentials = {"token": replacement_token, "username": "concurrent"}
            else:
                row.parameters = {"event": "concurrent-change"}

    saved = _read(harness, subscription.id)
    assert saved.credential_expires_at == subscription.credential_expires_at
    assert saved.expires_at == subscription.expires_at
    assert saved.properties == subscription.properties
    if stage == "oauth":
        assert saved.credentials == {"token": replacement_token, "username": "concurrent"}
        assert saved.parameters == subscription.parameters
    else:
        assert saved.credentials == subscription.credentials
        assert saved.parameters == {"event": "concurrent-change"}
    assert all(redis_client.get(key) == b'{"value":"cached-before-renewal"}' for key in keys)
    assert any(
        record.exc_info
        and isinstance(record.exc_info[1], TriggerSubscriptionChangedError)
        and subscription.id in record.getMessage()
        for record in caplog.records
    )
    assert [request.path for request in daemon.requests if request.method == "POST"] == [path]
    assert all(not request.open_transactions for request in daemon.requests)


@pytest.mark.parametrize("failed_stage", ["oauth", "subscription"])
def test_failed_stage_keeps_its_persisted_values_without_reverting_the_other_stage(
    harness: _Harness, daemon: _Daemon, caplog: pytest.LogCaptureFixture, failed_stage: str
) -> None:
    subscription = _expiring_subscription(harness, daemon, credential_expiry=100, subscription_expiry=100)
    _prepare_responses(harness, daemon)
    failed_path = (
        f"/plugin/{harness.tenant_id}/dispatch/oauth/refresh_credentials"
        if failed_stage == "oauth"
        else f"/plugin/{harness.tenant_id}/dispatch/trigger/refresh"
    )
    daemon.response_codes_by_path[failed_path] = 1
    daemon.response_message = "renewal rejected"
    keys = _cache_keys(harness, subscription.id)
    for key in keys:
        redis_client.setex(key, 1800, json.dumps({"token": "stored-token", "username": "old"}))

    _refresh(harness, subscription.id)

    saved = _read(harness, subscription.id)
    requests = [request for request in daemon.requests if request.method == "POST"]
    assert len(requests) == 2
    assert any(record.exc_info and subscription.id in record.getMessage() for record in caplog.records)
    if failed_stage == "oauth":
        assert saved.credentials == subscription.credentials
        assert saved.credential_expires_at == 100
        assert saved.expires_at == 2000
        assert _decrypt(harness, saved.properties["secret"]) == "renewed-property"
        dispatched_data = requests[1].payload["data"]
        assert isinstance(dispatched_data, dict)
        assert dispatched_data["credentials"] == {"token": "stored-token", "username": "old"}
        assert redis_client.exists(keys[0]) == 1
    else:
        assert _decrypt(harness, saved.credentials["token"]) == "renewed-token"
        assert saved.credential_expires_at == 1000
        assert saved.properties == subscription.properties
        assert saved.expires_at == 100
    assert all(not request.open_transactions for request in daemon.requests)


@pytest.mark.parametrize("job_state", ["no-lock", "missing-subscription", "due"])
def test_task_requires_existing_reservation_and_releases_it_after_processing(
    harness: _Harness, daemon: _Daemon, job_state: str
) -> None:
    subscription = _expiring_subscription(harness, daemon, credential_expiry=1, subscription_expiry=1)
    _prepare_responses(harness, daemon)
    subscription_id = "missing-subscription" if job_state == "missing-subscription" else subscription.id
    key = build_trigger_refresh_lock_key(harness.tenant_id, subscription_id)
    if job_state != "no-lock":
        redis_client.setex(key, 60, "reserved")

    def run() -> None:
        with harness.app.app_context():
            trigger_subscription_refresh.run(harness.tenant_id, subscription_id)

    Context().run(run)

    assert redis_client.exists(key) == 0
    if job_state == "due":
        assert len([request for request in daemon.requests if request.method == "POST"]) == 2
        assert _read(harness, subscription.id).expires_at == 2000
    else:
        assert daemon.requests == []
        assert _read(harness, subscription.id).expires_at == 1
    assert all(not request.open_transactions for request in daemon.requests)
