"""Runtime subscription reads use real SQLite, Redis, RSA, storage and plugin transport."""

import json
from contextvars import Context
from functools import partial
from uuid import uuid4

import pytest
from flask import request

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.utils.http_parser import deserialize_request
from core.trigger.debug.event_bus import TriggerDebugEventBus
from core.trigger.debug.event_selectors import TriggerDebugEvent, create_event_poller, select_trigger_debug_events
from core.trigger.debug.events import PluginTriggerDebugEvent, build_plugin_pool_key
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from extensions.ext_application_services import application_services
from extensions.ext_redis import redis_client
from graphon.entities.graph_config import NodeConfigDict
from models.model import App, AppMode
from models.workflow import Workflow
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository
from services.plugin.dispatch_identity import PLUGIN_IDENTIFIER_HEADER
from services.trigger.subscription_query_service import TriggerSubscriptionRuntime
from services.trigger.trigger_request_service import TriggerHttpRequestCachingService
from services.trigger.trigger_service import TriggerService
from tests.test_containers_integration_tests.services import test_trigger_subscription_builder
from tests.test_containers_integration_tests.services.test_trigger_subscription_management import _cache_keys, _seed
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_provider_query import _IDENTIFIER
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon

application_redis = test_trigger_subscription_builder.application_redis
sqlite_engine = test_trigger_subscription_builder.sqlite_engine
sqlite_session_factory = test_trigger_subscription_builder.sqlite_session_factory
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon


def _get(harness: _Harness, subscription_id: str) -> TriggerSubscriptionRuntime:
    def run() -> TriggerSubscriptionRuntime:
        with harness.app.app_context():
            runtime = application_services().workspaces.trigger_subscriptions.get_for_execution(
                tenant_id=harness.tenant_id, subscription_id=subscription_id
            )
            assert runtime is not None
            return runtime

    return Context().run(run)


@pytest.mark.parametrize("credential_type", list(CredentialType))
def test_runtime_returns_plaintext_and_detached_subscription_without_changing_ciphertext(
    harness: _Harness, daemon: _Daemon, credential_type: CredentialType
) -> None:
    subscription = _seed(harness, daemon, credential_type)
    repository = TriggerSubscriptionRepository(session_factory=harness.session_factory)
    before = repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id)

    runtime = _get(harness, subscription.id)

    assert (runtime.id, runtime.tenant_id, runtime.user_id, runtime.provider_id, runtime.endpoint_id) == (
        subscription.id,
        harness.tenant_id,
        subscription.user_id,
        _PROVIDER,
        subscription.endpoint_id,
    )
    assert runtime.credential_type == credential_type
    expected_credentials: dict[str, str] = (
        {} if credential_type == CredentialType.UNAUTHORIZED else {"token": "stored-token", "username": "old"}
    )
    assert runtime.credentials == expected_credentials
    assert runtime.subscription.model_dump() == {
        "expires_at": -1,
        "endpoint": generate_plugin_trigger_endpoint_url(subscription.endpoint_id),
        "parameters": {"event": "push"},
        "properties": {"secret": "stored-property", "repository": "before"},
    }
    keys = _cache_keys(harness, subscription.id)
    credentials = redis_client.get(keys[0])
    properties = redis_client.get(keys[1])
    assert credentials is not None
    assert properties is not None
    assert json.loads(credentials) == expected_credentials
    assert json.loads(properties) == {"secret": "stored-property", "repository": "before"}
    assert repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id) == before
    assert len(daemon.requests) == 1
    assert all(not sent.open_transactions for sent in daemon.requests)
    assert all(not session.in_transaction() and not session.identity_map for session in harness.metadata.sessions)

    # Runtime values may be used after the query transaction has closed without
    # turning provider-side mutation into an ORM write.
    runtime.subscription.parameters = {"event": "caller-only"}
    runtime.subscription.properties = {"secret": "caller-only"}
    assert repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id) == before


def test_runtime_reuses_existing_decrypted_credential_and_property_caches(harness: _Harness, daemon: _Daemon) -> None:
    subscription = _seed(harness, daemon, CredentialType.OAUTH2)
    repository = TriggerSubscriptionRepository(session_factory=harness.session_factory)
    before = repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id)
    keys = _cache_keys(harness, subscription.id)
    cached_credentials = {"token": "cached-token", "username": "cached-user"}
    cached_properties = {"secret": "cached-property", "repository": "cached-repository"}
    redis_client.setex(keys[0], 1800, json.dumps(cached_credentials))
    redis_client.setex(keys[1], 1800, json.dumps(cached_properties))

    runtime = _get(harness, subscription.id)

    assert runtime.credentials == cached_credentials
    assert runtime.subscription.properties == cached_properties
    assert repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id) == before
    assert all(not sent.open_transactions for sent in daemon.requests)


@pytest.mark.parametrize("cancelled", [False, True])
def test_debug_poller_invokes_injected_subscription_query_after_receiving_event(
    harness: _Harness, daemon: _Daemon, cancelled: bool
) -> None:
    subscription = _seed(harness, daemon, CredentialType.OAUTH2)
    request_id = str(uuid4())
    repository = TriggerSubscriptionRepository(session_factory=harness.session_factory)
    before = repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id)
    with harness.app.test_request_context(
        "/incoming?source=github", method="POST", data=b"webhook-body", headers={"X-Webhook-Signature": "signature"}
    ):
        TriggerHttpRequestCachingService.persist_request(request_id, request)
        TriggerHttpRequestCachingService.persist_payload(request_id, {"repository": "dify"})
    daemon.response_data = {"variables": {"repository": "dify", "event": "push"}, "cancelled": cancelled}
    node_config: NodeConfigDict = {
        "id": "plugin-trigger",
        "data": TriggerEventNodeData(
            plugin_id="langgenius/github",
            provider_id=_PROVIDER,
            event_name="push",
            subscription_id=subscription.id,
            plugin_unique_identifier=_IDENTIFIER,
        ),
    }
    debug_event = PluginTriggerDebugEvent(
        timestamp=100,
        name="push",
        user_id="webhook-end-user",
        request_id=request_id,
        subscription_id=subscription.id,
        provider_id=_PROVIDER,
    )
    app = App(
        id=str(uuid4()),
        tenant_id=harness.tenant_id,
        name="Trigger debug",
        mode=AppMode.WORKFLOW,
        enable_site=True,
        enable_api=True,
    )
    workflow = Workflow.new(
        tenant_id=harness.tenant_id,
        app_id=app.id,
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"nodes": [{"id": node_config["id"], "data": node_config["data"].model_dump(mode="json")}]}),
        features="{}",
        created_by=harness.account_id,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    with harness.session_factory.begin() as session:
        session.add_all([app, workflow])

    def poll() -> TriggerDebugEvent | None:
        with harness.app.app_context():
            invoke = partial(
                TriggerService.invoke_trigger_event,
                subscriptions=application_services().workspaces.trigger_subscriptions,
            )
            poller = create_event_poller(
                draft_workflow=workflow,
                tenant_id=harness.tenant_id,
                user_id=harness.account_id,
                app_id=app.id,
                node_id=node_config["id"],
                invoke_plugin_event=invoke,
            )
            assert poller.poll() is None
            assert daemon.requests == []
            dispatched = TriggerDebugEventBus.dispatch(
                tenant_id=harness.tenant_id,
                event=debug_event,
                pool_key=build_plugin_pool_key(
                    tenant_id=harness.tenant_id,
                    provider_id=_PROVIDER,
                    subscription_id=subscription.id,
                    name="push",
                ),
            )
            assert dispatched == 1
            result = select_trigger_debug_events(
                draft_workflow=workflow,
                app_model=app,
                user_id=harness.account_id,
                node_ids=[node_config["id"]],
                invoke_plugin_event=invoke,
            )
            # Both success and cancellation consume the event exactly once.
            assert (
                select_trigger_debug_events(
                    draft_workflow=workflow,
                    app_model=app,
                    user_id=harness.account_id,
                    node_ids=[node_config["id"]],
                    invoke_plugin_event=invoke,
                )
                is None
            )
            return result

    result = Context().run(poll)

    if cancelled:
        assert result is None
    else:
        assert result is not None
        assert result.node_id == node_config["id"]
        assert result.workflow_args == {"inputs": {"repository": "dify", "event": "push"}, "files": []}
    sent = [entry for entry in daemon.requests if entry.method == "POST"]
    assert len(sent) == 1
    assert sent[0].path == f"/plugin/{harness.tenant_id}/dispatch/trigger/invoke_event"
    assert sent[0].headers[PLUGIN_IDENTIFIER_HEADER] == _IDENTIFIER
    assert sent[0].payload["user_id"] == debug_event.user_id
    data = sent[0].payload["data"]
    assert isinstance(data, dict)
    assert data["provider"] == "github"
    assert data["event"] == "push"
    assert data["credentials"] == {"token": "stored-token", "username": "old"}
    assert data["credential_type"] == CredentialType.OAUTH2.value
    assert data["parameters"] == {}
    assert data["payload"] == {"repository": "dify"}
    assert data["subscription"] == {
        "expires_at": -1,
        "endpoint": generate_plugin_trigger_endpoint_url(subscription.endpoint_id),
        "parameters": {"event": "push"},
        "properties": {"secret": "stored-property", "repository": "before"},
    }
    restored_request = deserialize_request(bytes.fromhex(data["raw_http_request"]))
    assert restored_request.get_data() == b"webhook-body"
    assert restored_request.headers["X-Webhook-Signature"] == "signature"
    assert repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id) == before
    assert all(not entry.open_transactions for entry in daemon.requests)
