"""Builder compatibility callers use real Redis, SQL, Flask and plugin HTTP transport."""

import logging
from collections.abc import Iterator
from dataclasses import dataclass, field
from http import HTTPStatus
from threading import Lock
from uuid import uuid4

import pytest
from flask import Flask

import contexts
from controllers.trigger.trigger import trigger_endpoint
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import SubscriptionBuilderUpdater
from extensions.ext_application_services import application_services
from extensions.ext_redis import RedisClientWrapper, redis_client
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription
from repositories.trigger.subscription_builder_repository import RedisTriggerSubscriptionBuilderRepository
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService
from tests.test_containers_integration_tests.services import test_trigger_subscription_query
from tests.unit_tests.controllers.console.workspace import test_trigger_subscription_builder
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon

sqlite_engine = test_trigger_subscription_query.sqlite_engine
sqlite_session_factory = test_trigger_subscription_query.sqlite_session_factory
harness = test_trigger_subscription_builder.harness
daemon = test_trigger_subscription_builder.daemon
_PROVIDER_ID = TriggerProviderID(_PROVIDER)


@pytest.fixture
def application_redis(flask_app_with_containers: Flask) -> RedisClientWrapper:
    assert redis_client is flask_app_with_containers.extensions["redis"]
    return redis_client


@dataclass
class _Runtime:
    builders: TriggerSubscriptionBuilderService
    ids: set[str] = field(default_factory=set)

    def key(self, builder_id: str) -> str:
        self.ids.add(builder_id)
        return RedisTriggerSubscriptionBuilderRepository.encode_cache_key(builder_id)

    def create(self, harness: _Harness) -> str:
        builder = self.builders.create_trigger_subscription_builder(
            tenant_id=harness.tenant_id,
            user_id=harness.account_id,
            provider_id=_PROVIDER_ID,
            credential_type=CredentialType.API_KEY,
        )
        self.ids.add(builder.id)
        return builder.id


@pytest.fixture
def runtime(harness: _Harness) -> Iterator[_Runtime]:
    harness.app.add_url_rule(
        "/triggers/plugin/<string:endpoint_id>", view_func=trigger_endpoint, methods=["GET", "POST"]
    )
    previous_providers = contexts.plugin_trigger_providers.get({})
    previous_lock = contexts.plugin_trigger_providers_lock.get(Lock())
    contexts.plugin_trigger_providers.set({})
    contexts.plugin_trigger_providers_lock.set(Lock())
    with harness.app.app_context():
        runtime = _Runtime(application_services().workspaces.trigger_builders)
        try:
            yield runtime
        finally:
            for builder_id in runtime.ids:
                redis_client.delete(
                    RedisTriggerSubscriptionBuilderRepository.encode_cache_key(builder_id),
                    RedisTriggerSubscriptionBuilderRepository.encode_lock_key(builder_id),
                    f"trigger:subscription:builder:logs:{builder_id}",
                )
            contexts.plugin_trigger_providers.set(previous_providers)
            contexts.plugin_trigger_providers_lock.set(previous_lock)


def _persist_subscription(
    harness: _Harness, *, subscription_id: str, tenant_id: str, provider_id: str, credentials: dict[str, str]
) -> None:
    with harness.session_factory.begin() as session:
        subscription = TriggerSubscription(
            name=f"subscription-{subscription_id}",
            tenant_id=tenant_id,
            user_id=harness.account_id,
            provider_id=provider_id,
            endpoint_id=subscription_id,
            parameters={},
            properties={},
            credentials=credentials,
            credential_type=CredentialType.API_KEY,
        )
        subscription.id = subscription_id
        session.add(subscription)


def _options_response(daemon: _Daemon) -> None:
    daemon.response_data = {"options": [{"value": "main", "label": {"en_US": "Main branch"}}]}


def test_dynamic_select_uses_owned_builder_credentials_and_package(
    harness: _Harness, runtime: _Runtime, daemon: _Daemon
) -> None:
    builder_id = runtime.create(harness)
    runtime.builders.update_trigger_subscription_builder(
        tenant_id=harness.tenant_id,
        user_id=harness.account_id,
        provider_id=_PROVIDER_ID,
        subscription_builder_id=builder_id,
        subscription_builder_updater=SubscriptionBuilderUpdater(credentials={"token": "draft-token"}),
    )
    _options_response(daemon)
    daemon.requests.clear()

    options = application_services().workspaces.plugin_parameters.get_dynamic_select_options(
        tenant_id=harness.tenant_id,
        user_id=harness.account_id,
        plugin_id=_PROVIDER_ID.plugin_id,
        provider=_PROVIDER_ID.provider_name,
        action="push",
        parameter="branch",
        credential_id=builder_id,
        provider_type="trigger",
    )

    assert [(option.value, option.label.en_US) for option in options] == [("main", "Main branch")]
    assert len(daemon.requests) == 1
    sent = daemon.requests[0]
    assert sent.path == f"/plugin/{harness.tenant_id}/dispatch/dynamic_select/fetch_parameter_options"
    assert sent.headers["X-Plugin-ID"] == _PROVIDER_ID.plugin_id
    assert sent.headers["X-Plugin-Unique-Identifier"] == daemon.provider["plugin_unique_identifier"]
    assert sent.payload == {
        "user_id": harness.account_id,
        "data": {
            "provider": _PROVIDER_ID.provider_name,
            "credentials": {"token": "draft-token"},
            "credential_type": CredentialType.API_KEY,
            "provider_action": "push",
            "parameter": "branch",
        },
    }


@pytest.mark.parametrize("mismatch", ["tenant", "user", "provider"])
def test_dynamic_select_rejects_builder_owner_mismatch_before_persisted_fallback(
    harness: _Harness, runtime: _Runtime, daemon: _Daemon, mismatch: str
) -> None:
    builder_id = runtime.create(harness)
    tenant_id = str(uuid4()) if mismatch == "tenant" else harness.tenant_id
    user_id = str(uuid4()) if mismatch == "user" else harness.account_id
    provider_id = TriggerProviderID("langgenius/github/other") if mismatch == "provider" else _PROVIDER_ID
    # A fallback with this ID would succeed, so a rejection proves that an owned
    # builder mismatch is not treated as an expired temporary capability.
    _persist_subscription(
        harness,
        subscription_id=builder_id,
        tenant_id=tenant_id,
        provider_id=str(provider_id),
        credentials={"token": "persisted-token"},
    )
    daemon.requests.clear()

    with pytest.raises(ValueError, match="not found"):
        application_services().workspaces.plugin_parameters.get_dynamic_select_options(
            tenant_id=tenant_id,
            user_id=user_id,
            plugin_id=provider_id.plugin_id,
            provider=provider_id.provider_name,
            action="push",
            parameter="branch",
            credential_id=builder_id,
            provider_type="trigger",
        )

    assert daemon.requests == []


@pytest.mark.usefixtures("runtime")
def test_dynamic_select_uses_persisted_subscription_after_builder_expires(harness: _Harness, daemon: _Daemon) -> None:
    subscription_id = str(uuid4())
    _persist_subscription(
        harness,
        subscription_id=subscription_id,
        tenant_id=harness.tenant_id,
        provider_id=_PROVIDER,
        credentials={"token": "persisted-token"},
    )
    _options_response(daemon)

    options = application_services().workspaces.plugin_parameters.get_dynamic_select_options(
        tenant_id=harness.tenant_id,
        user_id=harness.account_id,
        plugin_id=_PROVIDER_ID.plugin_id,
        provider=_PROVIDER_ID.provider_name,
        action="push",
        parameter="branch",
        credential_id=subscription_id,
        provider_type="trigger",
    )

    assert [option.value for option in options] == ["main"]
    sent = [request for request in daemon.requests if request.method == "POST"]
    assert len(sent) == 1
    assert sent[0].payload["data"] == {
        "provider": _PROVIDER_ID.provider_name,
        "credentials": {"token": "persisted-token"},
        "credential_type": CredentialType.API_KEY,
        "provider_action": "push",
        "parameter": "branch",
    }


@pytest.mark.usefixtures("runtime")
def test_dynamic_select_rejects_missing_builder_and_subscription(harness: _Harness, daemon: _Daemon) -> None:
    with pytest.raises(ValueError, match="not found"):
        application_services().workspaces.plugin_parameters.get_dynamic_select_options(
            tenant_id=harness.tenant_id,
            user_id=harness.account_id,
            plugin_id=_PROVIDER_ID.plugin_id,
            provider=_PROVIDER_ID.provider_name,
            action="push",
            parameter="branch",
            credential_id=str(uuid4()),
            provider_type="trigger",
        )

    assert daemon.requests == []


def _dispatch_response(daemon: _Daemon) -> None:
    raw_response = b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 8\r\n\r\naccepted"
    daemon.response_data = {"user_id": "plugin-user", "events": [], "response": raw_response.hex(), "payload": {}}


@pytest.mark.usefixtures("runtime")
def test_public_callback_missing_capability_keeps_its_json_contract(harness: _Harness, daemon: _Daemon) -> None:
    response = harness.client.post(f"/triggers/plugin/{uuid4()}", json={})

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.data == b'{"error":"Endpoint not found"}'
    assert response.mimetype == "application/json"
    assert response.headers["Cache-Control"] == "no-store"
    assert daemon.requests == []


def test_public_callback_uses_builder_without_account_admission_and_records_log(
    harness: _Harness, runtime: _Runtime, daemon: _Daemon
) -> None:
    builder_id = runtime.create(harness)
    _dispatch_response(daemon)
    daemon.requests.clear()

    response = harness.client.post(f"/triggers/plugin/{builder_id}", data="validation-request")

    assert response.status_code == HTTPStatus.OK
    assert response.data == b"accepted"
    assert response.mimetype == "text/plain"
    assert len(daemon.requests) == 1
    assert daemon.requests[0].path == f"/plugin/{harness.tenant_id}/dispatch/trigger/dispatch_event"
    logs = runtime.builders.list_logs(
        tenant_id=harness.tenant_id,
        user_id=harness.account_id,
        provider_id=_PROVIDER_ID,
        subscription_builder_id=builder_id,
    )
    assert len(logs) == 1
    assert logs[0].endpoint == builder_id
    assert logs[0].request["data"] == "validation-request"
    assert logs[0].response["data"] == "accepted"
    assert logs[0].response["status_code"] == HTTPStatus.OK


def test_public_callback_handles_persisted_subscription_before_builder_fallback(
    harness: _Harness, runtime: _Runtime, daemon: _Daemon
) -> None:
    subscription_id = str(uuid4())
    _persist_subscription(
        harness,
        subscription_id=subscription_id,
        tenant_id=harness.tenant_id,
        provider_id=_PROVIDER,
        credentials={},
    )
    # Accessing this invalid Redis value would fail if the builder fallback ran.
    redis_client.hset(runtime.key(subscription_id), "invalid", "not-a-string")
    _dispatch_response(daemon)

    response = harness.client.post(f"/triggers/plugin/{subscription_id}", json={})

    assert response.status_code == HTTPStatus.OK
    assert response.data == b"accepted"
    assert redis_client.hgetall(runtime.key(subscription_id)) == {b"invalid": b"not-a-string"}


def test_public_callback_invalid_builder_data_is_a_bad_request(
    harness: _Harness, runtime: _Runtime, daemon: _Daemon
) -> None:
    builder_id = str(uuid4())
    redis_client.set(runtime.key(builder_id), "invalid-json")

    response = harness.client.post(f"/triggers/plugin/{builder_id}", json={})

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["error"] == "Endpoint processing failed"
    assert "Invalid JSON" in response.get_json()["message"]
    assert daemon.requests == []


def test_public_callback_unexpected_redis_error_is_logged_without_exposing_details(
    harness: _Harness, runtime: _Runtime, daemon: _Daemon, caplog: pytest.LogCaptureFixture
) -> None:
    builder_id = str(uuid4())
    redis_client.hset(runtime.key(builder_id), "invalid", "not-a-string")

    with caplog.at_level(logging.ERROR, logger="controllers.trigger.trigger"):
        response = harness.client.post(f"/triggers/plugin/{builder_id}", json={})

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.get_json() == {"error": "Internal server error"}
    assert builder_id in caplog.text
    assert "WRONGTYPE" in caplog.text
    assert daemon.requests == []
