"""Persisted webhook endpoints use real SQL, Redis, RSA, storage, plugin HTTP and Celery."""

import json
from collections.abc import Iterator
from contextvars import Context
from dataclasses import dataclass, field
from http import HTTPStatus
from queue import Empty
from time import time
from uuid import uuid4

import pytest
from celery import Celery
from celery.signals import before_task_publish
from kombu.message import Message
from kombu.simple import SimpleQueue
from sqlalchemy import text

from controllers.trigger.trigger import trigger_endpoint
from core.helper.encrypter import encrypt_token
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.utils.http_parser import deserialize_request
from core.trigger.utils.encryption import TriggerProviderCredentialsCache, TriggerProviderPropertiesCache
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.trigger import TriggerSubscription
from services.trigger.trigger_request_service import TriggerHttpRequestCachingService
from services.workflow.entities import PluginTriggerDispatchData
from tasks.trigger_processing_tasks import TRIGGER_QUEUE, dispatch_triggered_workflows_async
from tests.test_containers_integration_tests.services import test_trigger_subscription_builder
from tests.test_containers_integration_tests.services.test_trigger_subscription_query import _provider_with_secrets
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_query import _add_subscription

application_redis = test_trigger_subscription_builder.application_redis
sqlite_engine = test_trigger_subscription_builder.sqlite_engine
sqlite_session_factory = test_trigger_subscription_builder.sqlite_session_factory
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon


@dataclass(frozen=True)
class _Publication:
    data: PluginTriggerDispatchData
    persisted_request: bytes
    persisted_payload: bytes
    open_transactions: bool


@dataclass
class _Runtime:
    queue: SimpleQueue
    publications: list[_Publication] = field(default_factory=list)

    def take_messages(self) -> list[Message]:
        messages: list[Message] = []
        while True:
            try:
                message = self.queue.get(block=False)
            except Empty:
                return messages
            messages.append(message)
            message.ack()


@pytest.fixture
def runtime(harness: _Harness) -> Iterator[_Runtime]:
    harness.app.add_url_rule(
        "/triggers/plugin/<string:endpoint_id>",
        view_func=trigger_endpoint,
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    )
    # Exercise the production shared task and enqueue callback with a real
    # in-memory broker. No worker executes the queued workflow in this test.
    previous_app = dispatch_triggered_workflows_async.app
    celery_app = Celery("trigger-endpoint-tests", broker="memory://", set_as_current=False)
    celery_app.conf.update(task_always_eager=False, task_serializer="json")
    celery_app.set_current()
    try:
        with celery_app.connection_for_write() as connection:
            with SimpleQueue(connection.channel(), TRIGGER_QUEUE) as queue:
                queue.clear()
                runtime = _Runtime(queue)

                def observe_publication(sender: str, body: object, **_kwargs: object) -> None:
                    if sender != dispatch_triggered_workflows_async.name:
                        return
                    assert isinstance(body, tuple)
                    args = body[0]
                    assert isinstance(args, tuple)
                    data = PluginTriggerDispatchData.model_validate(args[0])
                    runtime.publications.append(
                        _Publication(
                            data=data,
                            persisted_request=storage.load_once(f"triggers/{data.request_id}.raw"),
                            persisted_payload=storage.load_once(f"triggers/{data.request_id}.payload"),
                            open_transactions=any(session.in_transaction() for session in harness.metadata.sessions),
                        )
                    )

                before_task_publish.connect(observe_publication, weak=False)
                try:
                    yield runtime
                finally:
                    # Installed Celery stubs omit the public Signal.disconnect API.
                    before_task_publish.disconnect(observe_publication)  # pyrefly: ignore[missing-attribute]
                    queue.clear()
    finally:
        previous_app.set_current()
        celery_app.close()


def _seed(harness: _Harness, daemon: _Daemon, credential_type: CredentialType) -> TriggerSubscription:
    daemon.provider = _provider_with_secrets()
    with harness.app.app_context():
        token = encrypt_token(harness.tenant_id, "endpoint-token")
        secret = encrypt_token(harness.tenant_id, "endpoint-property")
    return _add_subscription(
        harness,
        user_id=str(uuid4()),
        credential_type=credential_type,
        credentials={} if credential_type == CredentialType.UNAUTHORIZED else {"token": token, "username": "octocat"},
        properties={"secret": secret, "repository": "dify"},
    )


def _dispatch(daemon: _Daemon, *, events: list[str]) -> bytes:
    body = b"accepted\x00\xff"
    raw_response = (
        b"HTTP/1.1 202 Accepted\r\nContent-Type: application/octet-stream\r\n"
        b"X-Webhook-Result: accepted\r\nSet-Cookie: first=1\r\nSet-Cookie: second=2\r\n"
        + f"Content-Length: {len(body)}\r\n\r\n".encode()
        + body
    )
    daemon.response_data = {
        "user_id": "plugin-user",
        "events": events,
        "response": raw_response.hex(),
        "payload": {"repository": "dify", "nested": {"count": 0, "empty": []}},
    }
    return body


@pytest.mark.parametrize("credential_type", list(CredentialType))
def test_callback_preserves_plugin_response_and_uses_subscription_owner_and_cached_secrets(
    harness: _Harness, daemon: _Daemon, runtime: _Runtime, credential_type: CredentialType
) -> None:
    subscription = _seed(harness, daemon, credential_type)
    expected_body = _dispatch(daemon, events=[])
    url = f"/triggers/plugin/{subscription.endpoint_id}?tenant_id=untrusted-workspace"

    response = Context().run(
        harness.client.post, url, data=b"webhook-body", headers={"X-Webhook-Signature": "signature"}
    )

    assert response.status_code == HTTPStatus.ACCEPTED
    assert response.data == expected_body
    assert response.content_type == "application/octet-stream"
    assert response.headers["X-Webhook-Result"] == "accepted"
    assert response.headers.getlist("Set-Cookie") == ["first=1", "second=2"]
    assert response.headers["Content-Length"] == str(len(expected_body))
    sent = next(request for request in daemon.requests if request.method == "POST")
    assert sent.path == f"/plugin/{harness.tenant_id}/dispatch/trigger/dispatch_event"
    assert sent.headers["X-Plugin-ID"] == "langgenius/github"
    assert sent.headers["X-Plugin-Unique-Identifier"] == daemon.provider["plugin_unique_identifier"]
    data = sent.payload["data"]
    assert isinstance(data, dict)
    expected_credentials: dict[str, str] = (
        {} if credential_type == CredentialType.UNAUTHORIZED else {"token": "endpoint-token", "username": "octocat"}
    )
    assert data["credentials"] == expected_credentials
    assert data["credential_type"] == credential_type.value
    assert data["provider"] == "github"
    assert data["subscription"] == {
        "expires_at": subscription.expires_at,
        "endpoint": generate_plugin_trigger_endpoint_url(subscription.endpoint_id),
        "parameters": {"event": "push"},
        "properties": {"secret": "endpoint-property", "repository": "dify"},
    }
    raw_request = data["raw_http_request"]
    assert isinstance(raw_request, str)
    restored = deserialize_request(bytes.fromhex(raw_request))
    assert restored.method == "POST"
    assert restored.full_path == url
    assert restored.headers["X-Webhook-Signature"] == "signature"
    assert restored.get_data() == b"webhook-body"
    assert all(not request.open_transactions for request in daemon.requests)

    credential_key = TriggerProviderCredentialsCache(harness.tenant_id, _PROVIDER, subscription.id).cache_key
    properties_key = TriggerProviderPropertiesCache(harness.tenant_id, _PROVIDER, subscription.id).cache_key
    cached_credentials = redis_client.get(credential_key)
    cached_properties = redis_client.get(properties_key)
    assert cached_credentials is not None
    assert cached_properties is not None
    assert json.loads(cached_credentials) == expected_credentials
    assert json.loads(cached_properties) == {"secret": "endpoint-property", "repository": "dify"}
    repeated = Context().run(harness.client.post, url, data=b"webhook-body")
    assert repeated.status_code == HTTPStatus.ACCEPTED
    assert repeated.data == expected_body
    repeated_data = daemon.requests[-1].payload["data"]
    assert isinstance(repeated_data, dict)
    assert repeated_data["credentials"] == expected_credentials
    assert repeated_data["subscription"] == data["subscription"]
    assert runtime.take_messages() == []
    assert runtime.publications == []
    assert not storage.exists("triggers/")
    with harness.session_factory() as session:
        saved = session.get(TriggerSubscription, subscription.id)
        assert saved is not None
        assert saved.credentials == subscription.credentials
        assert saved.properties == subscription.properties


def test_events_are_persisted_before_real_task_publication_with_trusted_subscription_identity(
    harness: _Harness, daemon: _Daemon, runtime: _Runtime
) -> None:
    subscription = _seed(harness, daemon, CredentialType.API_KEY)
    expected_body = _dispatch(daemon, events=["push", "push"])
    before = int(time())

    response = Context().run(
        harness.client.post,
        f"/triggers/plugin/{subscription.endpoint_id}?tenant_id=untrusted",
        data=b"persisted-webhook-body",
        headers={"X-Webhook-Signature": "signed"},
    )

    assert response.status_code == HTTPStatus.ACCEPTED
    assert response.data == expected_body
    assert len(runtime.publications) == 1
    publication = runtime.publications[0]
    data = publication.data
    assert before <= data.timestamp <= int(time())
    assert data.request_id.startswith(f"trigger_request_{data.timestamp}_")
    assert len(data.request_id.rsplit("_", 1)[1]) == 12
    assert data.model_dump(exclude={"request_id", "timestamp"}) == {
        "user_id": "plugin-user",
        "tenant_id": harness.tenant_id,
        "endpoint_id": subscription.endpoint_id,
        "provider_id": _PROVIDER,
        "subscription_id": subscription.id,
        "events": ["push", "push"],
    }
    assert not publication.open_transactions
    assert json.loads(publication.persisted_payload) == {"repository": "dify", "nested": {"count": 0, "empty": []}}
    assert deserialize_request(publication.persisted_request).get_data() == b"persisted-webhook-body"
    restored = TriggerHttpRequestCachingService.get_request(data.request_id)
    assert restored.get_data() == b"persisted-webhook-body"
    assert restored.headers["X-Webhook-Signature"] == "signed"
    assert TriggerHttpRequestCachingService.get_payload(data.request_id) == json.loads(publication.persisted_payload)
    messages = runtime.take_messages()
    assert len(messages) == 1
    assert messages[0].headers["task"] == dispatch_triggered_workflows_async.name
    assert messages[0].delivery_info["routing_key"] == TRIGGER_QUEUE
    assert messages[0].payload[0] == [data.model_dump(mode="json")]
    assert all(not request.open_transactions for request in daemon.requests)


def test_unknown_event_returns_bad_request_after_persistence_without_publishing(
    harness: _Harness, daemon: _Daemon, runtime: _Runtime
) -> None:
    subscription = _seed(harness, daemon, CredentialType.API_KEY)
    _dispatch(daemon, events=["push", "undeclared"])

    response = Context().run(harness.client.post, f"/triggers/plugin/{subscription.endpoint_id}", data=b"invalid-event")

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json() == {
        "error": "Endpoint processing failed",
        "message": f"Event name undeclared not found in provider {_PROVIDER}",
    }
    assert runtime.take_messages() == []
    assert runtime.publications == []
    files = storage.scan("triggers/")
    assert len(files) == 2
    assert {filename.rsplit(".", 1)[1] for filename in files} == {"raw", "payload"}
    raw_file = next(filename for filename in files if filename.endswith(".raw"))
    assert deserialize_request(storage.load_once(raw_file)).get_data() == b"invalid-event"


@pytest.mark.parametrize("failure", ["provider-unavailable", "invalid-provider", "invalid-credentials"])
def test_subscription_preparation_failures_keep_raw_error_response_and_do_not_fall_back(
    harness: _Harness, daemon: _Daemon, runtime: _Runtime, failure: str
) -> None:
    subscription = _seed(harness, daemon, CredentialType.API_KEY)
    _dispatch(daemon, events=[])
    if failure == "provider-unavailable":
        daemon.status = HTTPStatus.SERVICE_UNAVAILABLE
    else:
        with harness.session_factory.begin() as session:
            if failure == "invalid-provider":
                saved = session.get(TriggerSubscription, subscription.id)
                assert saved is not None
                saved.provider_id = "not/a/valid/provider"
            else:
                # Historical corrupt JSON bypasses the application-owned type.
                session.execute(
                    text("UPDATE trigger_subscriptions SET credentials = '42' WHERE id = :id"),
                    {"id": subscription.id},
                )

    response = Context().run(harness.client.post, f"/triggers/plugin/{subscription.endpoint_id}", data=b"body")

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.data == b"Failed to get subscription by endpoint"
    assert response.mimetype == "text/html"
    assert not any(request.method == "POST" for request in daemon.requests)
    assert all(not request.open_transactions for request in daemon.requests)
    assert runtime.take_messages() == []
    assert not storage.exists("triggers/")


@pytest.mark.parametrize("failure", ["rejected", "unavailable"])
def test_plugin_dispatch_errors_keep_json_response_without_persisting_or_publishing(
    harness: _Harness, daemon: _Daemon, runtime: _Runtime, failure: str
) -> None:
    subscription = _seed(harness, daemon, CredentialType.API_KEY)
    daemon.response_data = None
    if failure == "rejected":
        daemon.response_code = 1
        daemon.response_message = "signature rejected"
        expected_status = HTTPStatus.BAD_REQUEST
        expected_body = {
            "error": "Endpoint processing failed",
            "message": "plugin daemon: signature rejected, code: 1",
        }
    else:
        daemon.response_code = -500
        daemon.response_message = json.dumps(
            {"error_type": "PluginDaemonInternalServerError", "message": "unavailable"}
        )
        expected_status = HTTPStatus.INTERNAL_SERVER_ERROR
        expected_body = {"error": "Internal server error"}

    response = Context().run(harness.client.post, f"/triggers/plugin/{subscription.endpoint_id}", data=b"body")

    assert response.status_code == expected_status
    assert response.get_json() == expected_body
    assert runtime.take_messages() == []
    assert not storage.exists("triggers/")


def test_plugin_removed_before_dispatch_returns_not_found_without_persisting_or_publishing(
    harness: _Harness, daemon: _Daemon, runtime: _Runtime
) -> None:
    subscription = _seed(harness, daemon, CredentialType.API_KEY)
    daemon.response_data = None
    daemon.response_code = -500
    daemon.response_message = json.dumps({"error_type": "PluginNotFoundError", "message": "plugin uninstalled"})

    response = Context().run(harness.client.post, f"/triggers/plugin/{subscription.endpoint_id}", data=b"body")

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.data == b"Trigger provider not found"
    assert response.content_type == "text/html; charset=utf-8"
    assert [request.method for request in daemon.requests] == ["GET", "POST"]
    assert daemon.requests[-1].path == f"/plugin/{harness.tenant_id}/dispatch/trigger/dispatch_event"
    assert all(not request.open_transactions for request in daemon.requests)
    assert runtime.take_messages() == []
    assert runtime.publications == []
    assert not storage.exists("triggers/")
