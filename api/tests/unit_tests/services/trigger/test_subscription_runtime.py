"""Runtime lookup guards use the injected service, real rows and provider HTTP."""

from collections.abc import Mapping
from contextvars import Context
from http import HTTPStatus
from uuid import uuid4

import pytest
from flask import has_app_context
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.impl.exc import PluginDaemonInternalServerError
from core.trigger.debug.events import PluginTriggerDebugEvent
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from extensions.ext_application_services import application_services
from repositories.credentials.query_repository import CredentialQueryRepository
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository
from services.trigger.provider_gateway import PluginTriggerProviderQuery
from services.trigger.subscription_query_service import TriggerSubscriptionQueryService, TriggerSubscriptionRuntime
from services.trigger.trigger_service import TriggerService
from services.workflow.entities import PluginTriggerDispatchData
from tasks.trigger_processing_tasks import dispatch_triggered_workflows_async
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_subscription_builder
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_query import _add_subscription

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon


def test_missing_debug_subscription_uses_injected_reader_without_flask_context(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    subscriptions = TriggerSubscriptionQueryService(
        credentials=CredentialQueryRepository(session_factory=sqlite_session_factory),
        schemas=PluginTriggerProviderQuery(),
        subscriptions=TriggerSubscriptionRepository(session_factory=sqlite_session_factory),
    )
    event = PluginTriggerDebugEvent(
        timestamp=100,
        name="push",
        user_id=str(uuid4()),
        request_id=str(uuid4()),
        subscription_id=str(uuid4()),
        provider_id=_PROVIDER,
    )
    node = TriggerEventNodeData(
        plugin_id="langgenius/github",
        provider_id=_PROVIDER,
        event_name=event.name,
        subscription_id=event.subscription_id,
        plugin_unique_identifier="langgenius/github:1.0.0",
    )

    def run() -> None:
        assert not has_app_context()
        with pytest.raises(ValueError, match="^Subscription not found$"):
            TriggerService.invoke_trigger_event(
                tenant_id=str(uuid4()),
                user_id=event.user_id,
                node_config={"id": "trigger", "data": node},
                event=event,
                subscriptions=subscriptions,
            )

    Context().run(run)


def _get(harness: _Harness, tenant_id: str, subscription_id: str) -> TriggerSubscriptionRuntime | None:
    def run() -> TriggerSubscriptionRuntime | None:
        with harness.app.app_context():
            return application_services().workspaces.trigger_subscriptions.get_for_execution(
                tenant_id=tenant_id, subscription_id=subscription_id
            )

    return Context().run(run)


@pytest.mark.parametrize("missing_scope", ["tenant", "subscription", "empty-subscription"])
def test_runtime_lookup_requires_matching_tenant_and_explicit_subscription(
    harness: _Harness, daemon: _Daemon, missing_scope: str
) -> None:
    subscription = _add_subscription(harness)
    requested_id = subscription.id
    if missing_scope == "subscription":
        requested_id = str(uuid4())
    elif missing_scope == "empty-subscription":
        requested_id = ""

    result = _get(harness, str(uuid4()) if missing_scope == "tenant" else harness.tenant_id, requested_id)

    assert result is None
    assert daemon.requests == []
    assert all(not session.in_transaction() and not session.identity_map for session in harness.metadata.sessions)


def test_provider_failure_propagates_after_runtime_repository_transaction_closes(
    harness: _Harness, daemon: _Daemon
) -> None:
    subscription = _add_subscription(harness)
    repository = TriggerSubscriptionRepository(session_factory=harness.session_factory)
    before = repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id)
    daemon.status = HTTPStatus.SERVICE_UNAVAILABLE

    with pytest.raises(PluginDaemonInternalServerError):
        _get(harness, harness.tenant_id, subscription.id)

    assert len(daemon.requests) == 1
    assert daemon.requests[0].method == "GET"
    assert not daemon.requests[0].open_transactions
    assert repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id) == before
    assert all(not session.in_transaction() and not session.identity_map for session in harness.metadata.sessions)


@pytest.mark.parametrize("missing_scope", ["tenant", "subscription", "empty-subscription"])
def test_async_worker_reports_missing_subscription_before_provider_or_dispatch(
    harness: _Harness, daemon: _Daemon, missing_scope: str
) -> None:
    subscription = _add_subscription(harness)
    subscription_id = subscription.id
    if missing_scope == "subscription":
        subscription_id = str(uuid4())
    elif missing_scope == "empty-subscription":
        subscription_id = ""
    dispatch = PluginTriggerDispatchData(
        tenant_id=str(uuid4()) if missing_scope == "tenant" else harness.tenant_id,
        user_id="webhook-end-user",
        endpoint_id=subscription.endpoint_id,
        provider_id=_PROVIDER,
        subscription_id=subscription_id,
        timestamp=100,
        events=["push"],
        request_id=str(uuid4()),
    )

    def run() -> Mapping[str, object]:
        with harness.app.app_context():
            return dispatch_triggered_workflows_async.run(dispatch.model_dump())

    result = Context().run(run)

    assert result == {"status": "failed", "error": "Subscription not found"}
    assert daemon.requests == []
    assert all(not session.in_transaction() and not session.identity_map for session in harness.metadata.sessions)
