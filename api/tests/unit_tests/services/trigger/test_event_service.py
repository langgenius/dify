"""Shared event invocation exercises real storage, parameter resolution and plugin HTTP."""

import json
from contextvars import Context
from uuid import uuid4

import pytest
from flask import request

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.entities.request import TriggerInvokeEventResponse
from core.plugin.impl.exc import PluginDaemonInternalServerError
from core.plugin.utils.http_parser import deserialize_request
from core.trigger.entities.entities import Subscription
from core.trigger.errors import TriggerPluginInvokeError
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from core.workflow.nodes.trigger_plugin.exc import TriggerEventParameterError
from extensions.ext_application_services import application_services
from extensions.ext_storage import storage
from services.plugin.dispatch_identity import PLUGIN_IDENTIFIER_HEADER
from services.trigger.event_service import PreparedTriggerEvent
from services.trigger.subscription_query_service import TriggerSubscriptionRuntime
from services.trigger.trigger_request_service import TriggerHttpRequestCachingService
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_subscription_builder
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_provider_query import _IDENTIFIER
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon


def _runtime(harness: _Harness) -> TriggerSubscriptionRuntime:
    return TriggerSubscriptionRuntime(
        id=str(uuid4()),
        tenant_id=harness.tenant_id,
        user_id=harness.account_id,
        provider_id=_PROVIDER,
        endpoint_id=str(uuid4()),
        credential_type=CredentialType.OAUTH2,
        credentials={"token": "event-token", "username": "octocat"},
        subscription=Subscription(
            endpoint="https://trigger.example.test/endpoint",
            expires_at=-1,
            parameters={"repository": "dify"},
            properties={"secret": "event-property"},
        ),
    )


def _node(subscription: TriggerSubscriptionRuntime) -> TriggerEventNodeData:
    return TriggerEventNodeData(
        plugin_id="langgenius/github",
        provider_id=subscription.provider_id,
        event_name="push",
        subscription_id=subscription.id,
        plugin_unique_identifier=_IDENTIFIER,
    )


def _prepare(harness: _Harness, subscription: TriggerSubscriptionRuntime) -> PreparedTriggerEvent:
    request_id = str(uuid4())
    with harness.app.test_request_context(
        "/incoming?source=github", method="POST", data=b"webhook-body", headers={"X-Webhook-Signature": "signed"}
    ):
        TriggerHttpRequestCachingService.persist_request(request_id, request)
        TriggerHttpRequestCachingService.persist_payload(request_id, {"count": 0, "nested": {"empty": []}})
    prepared = application_services().workspaces.trigger_events.prepare(
        subscription=subscription, event_name="push", request_id=request_id
    )
    # A prepared event must not read the persisted request again for each node.
    storage.delete(f"triggers/{request_id}.raw")
    storage.delete(f"triggers/{request_id}.payload")
    return prepared


def test_prepared_event_reuses_request_and_provider_identity_for_each_node(harness: _Harness, daemon: _Daemon) -> None:
    declaration = daemon.provider["declaration"]
    assert isinstance(declaration, dict)
    events = declaration["events"]
    assert isinstance(events, list)
    events[0]["parameters"] = [
        {"name": name, "type": kind, "label": {"en_US": name}}
        for name, kind in [("count", "number"), ("enabled", "boolean"), ("text", "string")]
    ]
    daemon.response_data = {"variables": {"accepted": True}, "cancelled": False}
    subscription = _runtime(harness)

    def run() -> list[TriggerInvokeEventResponse]:
        with harness.app.app_context():
            service = application_services().workspaces.trigger_events
            prepared = _prepare(harness, subscription)
            assert prepared.definition.plugin_unique_identifier == _IDENTIFIER
            assert prepared.definition.provider_name == _PROVIDER
            assert prepared.definition.icon == "icon.svg"
            assert prepared.definition.icon_dark == ""
            daemon.provider["plugin_unique_identifier"] = "langgenius/github:2.0.0@replacement"
            first = _node(subscription)
            first.event_parameters = {
                name: TriggerEventNodeData.TriggerEventInput(type="constant", value=value)
                for name, value in {"count": 0, "enabled": False, "text": "", "removed-parameter": "ignored"}.items()
            }
            second = _node(subscription)
            second.event_parameters = {
                "count": TriggerEventNodeData.TriggerEventInput(type="constant", value=2),
            }
            return [service.invoke(event=prepared, user_id="webhook-user", node_data=node) for node in [first, second]]

    results = Context().run(run)

    assert [result.model_dump() for result in results] == [
        {"variables": {"accepted": True}, "cancelled": False},
        {"variables": {"accepted": True}, "cancelled": False},
    ]
    assert [sent.method for sent in daemon.requests] == ["GET", "POST", "POST"]
    for sent, parameters in zip(
        daemon.requests[1:],
        [{"count": 0, "enabled": False, "text": "", "removed-parameter": None}, {"count": 2}],
        strict=True,
    ):
        assert sent.path == f"/plugin/{harness.tenant_id}/dispatch/trigger/invoke_event"
        assert sent.headers[PLUGIN_IDENTIFIER_HEADER] == _IDENTIFIER
        assert sent.payload["user_id"] == "webhook-user"
        data = sent.payload["data"]
        assert isinstance(data, dict)
        assert data["provider"] == "github"
        assert data["event"] == "push"
        assert data["credentials"] == subscription.credentials
        assert data["credential_type"] == CredentialType.OAUTH2.value
        assert data["subscription"] == subscription.subscription.model_dump()
        assert data["parameters"] == parameters
        assert data["payload"] == {"count": 0, "nested": {"empty": []}}
        restored = deserialize_request(bytes.fromhex(data["raw_http_request"]))
        assert restored.get_data() == b"webhook-body"
        assert restored.args["source"] == "github"
        assert restored.headers["X-Webhook-Signature"] == "signed"
        assert not sent.open_transactions


@pytest.mark.parametrize("ignored_error", [False, True])
def test_cancelled_response_and_event_ignore_error_preserve_cancellation(
    harness: _Harness, daemon: _Daemon, ignored_error: bool
) -> None:
    daemon.response_data = {"variables": {}, "cancelled": True}
    if ignored_error:
        daemon.response_code = -500
        daemon.response_message = json.dumps(
            {
                "error_type": "PluginInvokeError",
                "message": json.dumps({"error_type": "EventIgnoreError", "message": "Event does not match filter"}),
            }
        )
    subscription = _runtime(harness)

    def run() -> TriggerInvokeEventResponse:
        with harness.app.app_context():
            prepared = _prepare(harness, subscription)
            return application_services().workspaces.trigger_events.invoke(
                event=prepared, user_id="webhook-user", node_data=_node(subscription)
            )

    result = Context().run(run)

    assert result.cancelled
    assert result.variables == {}
    assert [sent.method for sent in daemon.requests] == ["GET", "POST"]


def test_plugin_invoke_error_keeps_its_type_and_description(harness: _Harness, daemon: _Daemon) -> None:
    daemon.response_code = -500
    daemon.response_message = json.dumps(
        {
            "error_type": "PluginInvokeError",
            "message": json.dumps({"error_type": "TriggerPluginInvokeError", "message": "Repository is unavailable"}),
        }
    )
    subscription = _runtime(harness)

    def run() -> None:
        with harness.app.app_context():
            prepared = _prepare(harness, subscription)
            with pytest.raises(TriggerPluginInvokeError, match="Repository is unavailable"):
                application_services().workspaces.trigger_events.invoke(
                    event=prepared, user_id="webhook-user", node_data=_node(subscription)
                )

    Context().run(run)

    assert [sent.method for sent in daemon.requests] == ["GET", "POST"]


def test_plugin_daemon_failure_is_not_reported_as_cancelled(harness: _Harness, daemon: _Daemon) -> None:
    daemon.response_code = -500
    daemon.response_message = json.dumps(
        {"error_type": "PluginDaemonInternalServerError", "message": "Plugin runtime is unavailable"}
    )
    subscription = _runtime(harness)

    def run() -> None:
        with harness.app.app_context():
            prepared = _prepare(harness, subscription)
            with pytest.raises(PluginDaemonInternalServerError):
                application_services().workspaces.trigger_events.invoke(
                    event=prepared, user_id="webhook-user", node_data=_node(subscription)
                )

    Context().run(run)

    assert [sent.method for sent in daemon.requests] == ["GET", "POST"]


def test_invalid_parameter_kind_fails_before_event_dispatch(harness: _Harness, daemon: _Daemon) -> None:
    declaration = daemon.provider["declaration"]
    assert isinstance(declaration, dict)
    events = declaration["events"]
    assert isinstance(events, list)
    events[0]["parameters"] = [{"name": "branch", "type": "string", "label": {"en_US": "Branch"}}]
    subscription = _runtime(harness)

    def run() -> None:
        with harness.app.app_context():
            prepared = _prepare(harness, subscription)
            node = _node(subscription)
            node.event_parameters = {
                "branch": TriggerEventNodeData.TriggerEventInput(type="variable", value=["node", "branch"]),
            }
            with pytest.raises(TriggerEventParameterError, match="Unknown plugin trigger input type 'variable'"):
                application_services().workspaces.trigger_events.invoke(
                    event=prepared, user_id="webhook-user", node_data=node
                )

    Context().run(run)

    assert [sent.method for sent in daemon.requests] == ["GET"]
