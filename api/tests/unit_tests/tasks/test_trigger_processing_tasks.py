"""Worker dispatch uses real persistence, plugin HTTP, quota HTTP and Celery transport."""

import json
from collections.abc import Iterator
from contextlib import closing
from contextvars import Context
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from typing import override
from uuid import uuid4

import pytest
from celery import Celery
from flask import Request
from kombu.simple import SimpleQueue
from sqlalchemy import delete, select
from werkzeug.test import EnvironBuilder

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import Subscription
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from extensions.ext_storage import storage
from models.enums import AppTriggerStatus, AppTriggerType, EndUserType, WorkflowTriggerStatus
from models.model import App, AppMode, EndUser
from models.trigger import AppTrigger, WorkflowPluginTrigger, WorkflowTriggerLog
from models.workflow import WorkflowRun
from services.billing_service import BillingService
from services.trigger.subscription_query_service import TriggerSubscriptionRuntime
from services.trigger.trigger_request_service import TriggerHttpRequestCachingService
from tasks.async_workflow_tasks import execute_workflow_sandbox
from tasks.trigger_processing_tasks import dispatch_triggered_workflow
from tasks.workflow_cfs_scheduler.entities import AsyncWorkflowQueue
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_subscription_builder
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon
from tests.unit_tests.model_factories import make_app, make_workflow

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon


@dataclass
class _Billing:
    requests: list[tuple[str, dict[str, object]]] = field(default_factory=list)
    exhausted: bool = False


@pytest.fixture
def billing() -> Iterator[_Billing]:
    billing = _Billing()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.respond(
                {
                    "subscription": {"plan": "sandbox", "interval": "month", "education": False},
                    "members": {"size": 1, "limit": 10},
                    "apps": {"size": 1, "limit": 10},
                    "documents_upload_quota": {"size": 0, "limit": 10},
                    "annotation_quota_limit": {"size": 0, "limit": 10},
                    "can_replace_logo": False,
                    "model_load_balancing_enabled": False,
                    "knowledge_pipeline_publish_enabled": False,
                }
            )

        def do_POST(self) -> None:
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            billing.requests.append((self.path, payload))
            if self.path == "/quota/reserve":
                self.respond(
                    {
                        "reservation_id": "" if billing.exhausted else str(uuid4()),
                        "available": 0 if billing.exhausted else 10,
                        "reserved": 0 if billing.exhausted else 1,
                    }
                )
            elif self.path == "/quota/commit":
                self.respond({"available": 9, "reserved": 0, "refunded": 0})
            else:
                assert self.path == "/quota/release"
                self.respond({"available": 10, "reserved": 0, "released": 1})

        def respond(self, data: dict[str, object]) -> None:
            body = json.dumps(data).encode()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    previous_url, previous_quota_url = BillingService.base_url, BillingService.quota_base_url
    BillingService.base_url = BillingService.quota_base_url = f"http://127.0.0.1:{server.server_port}"
    thread.start()
    try:
        yield billing
    finally:
        BillingService.base_url, BillingService.quota_base_url = previous_url, previous_quota_url
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@dataclass(frozen=True)
class _Dispatch:
    subscription: TriggerSubscriptionRuntime
    app_id: str
    request_id: str

    def run(self, harness: _Harness) -> int:
        def invoke() -> int:
            with (
                harness.app.app_context(),
                config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
            ):
                services = application_services()
                return dispatch_triggered_workflow(
                    user_id="webhook-actor",
                    subscription=self.subscription,
                    event_name="push",
                    request_id=self.request_id,
                    end_users=services.app_scoped_end_users.commands,
                    events=services.workspaces.trigger_events,
                )

        return Context().run(invoke)


@pytest.fixture
def dispatch(harness: _Harness) -> _Dispatch:
    app_id, subscription_id, request_id = str(uuid4()), str(uuid4()), str(uuid4())
    node = TriggerEventNodeData(
        title="GitHub push",
        plugin_id="langgenius/github",
        provider_id=_PROVIDER,
        event_name="push",
        subscription_id=subscription_id,
        plugin_unique_identifier="langgenius/github:1.0.0@package-hash",
    )
    workflow = make_workflow(
        tenant_id=harness.tenant_id,
        app_id=app_id,
        version="published",
        graph={"nodes": [{"id": "push-node", "data": node.model_dump(mode="json")}], "edges": []},
        created_by=harness.account_id,
    )
    with harness.session_factory.begin() as session:
        session.add_all(
            [
                workflow,
                make_app(
                    app_id=app_id,
                    tenant_id=harness.tenant_id,
                    workflow_id=workflow.id,
                    mode=AppMode.WORKFLOW,
                ),
                AppTrigger(
                    tenant_id=harness.tenant_id,
                    app_id=app_id,
                    node_id="push-node",
                    trigger_type=AppTriggerType.TRIGGER_PLUGIN,
                    title="GitHub push",
                ),
                WorkflowPluginTrigger(
                    app_id=app_id,
                    node_id="push-node",
                    tenant_id=harness.tenant_id,
                    provider_id=_PROVIDER,
                    event_name="push",
                    subscription_id=subscription_id,
                ),
            ]
        )
    with closing(EnvironBuilder(path="/triggers/plugin/endpoint", method="POST", json={"ref": "main"})) as builder:
        TriggerHttpRequestCachingService.persist_request(request_id, Request(builder.get_environ()))
    TriggerHttpRequestCachingService.persist_payload(request_id, {"repository": "dify"})
    return _Dispatch(
        subscription=TriggerSubscriptionRuntime(
            id=subscription_id,
            tenant_id=harness.tenant_id,
            user_id=harness.account_id,
            endpoint_id=str(uuid4()),
            provider_id=_PROVIDER,
            credentials={"token": "subscription-token"},
            credential_type=CredentialType.API_KEY,
            subscription=Subscription(
                expires_at=-1, endpoint="https://example.test/triggers/plugin/endpoint", parameters={}, properties={}
            ),
        ),
        app_id=app_id,
        request_id=request_id,
    )


def test_dispatch_skips_request_loading_when_no_workflows_subscribe(
    harness: _Harness, daemon: _Daemon, billing: _Billing, dispatch: _Dispatch
) -> None:
    with harness.session_factory.begin() as session:
        session.execute(delete(WorkflowPluginTrigger))
    storage.delete(f"triggers/{dispatch.request_id}.raw")
    storage.delete(f"triggers/{dispatch.request_id}.payload")

    assert dispatch.run(harness) == 0

    assert daemon.requests == []
    assert billing.requests == []
    with harness.session_factory() as session:
        assert session.scalar(select(EndUser)) is None
        assert session.scalar(select(WorkflowTriggerLog)) is None


def test_dispatch_skips_when_workflow_missing(
    harness: _Harness, daemon: _Daemon, billing: _Billing, dispatch: _Dispatch
) -> None:
    with harness.session_factory.begin() as session:
        app = session.get(App, dispatch.app_id)
        assert app is not None
        app.workflow_id = None

    assert dispatch.run(harness) == 0

    assert [sent.method for sent in daemon.requests] == ["GET"]
    assert billing.requests == []
    with harness.session_factory() as session:
        assert session.scalar(select(WorkflowTriggerLog)) is None
        assert session.scalar(select(AppTrigger.status)) == AppTriggerStatus.ENABLED


def test_dispatch_marks_rate_limited_when_quota_exceeded(
    harness: _Harness, daemon: _Daemon, billing: _Billing, dispatch: _Dispatch
) -> None:
    billing.exhausted = True

    assert dispatch.run(harness) == 0

    assert [sent.method for sent in daemon.requests] == ["GET"]
    assert [(path, body["feature_key"]) for path, body in billing.requests] == [("/quota/reserve", "trigger_event")]
    with harness.session_factory() as session:
        assert session.scalar(select(AppTrigger.status)) == AppTriggerStatus.RATE_LIMITED
        assert session.scalar(select(WorkflowTriggerLog)) is None


def test_dispatch_commits_quota_and_publishes_actual_workflow_task(
    harness: _Harness, daemon: _Daemon, billing: _Billing, dispatch: _Dispatch
) -> None:
    daemon.response_data = {"variables": {"ref": "main"}, "cancelled": False}
    previous_app = execute_workflow_sandbox.app
    celery_app = Celery("trigger-worker-dispatch-test", broker="memory://", set_as_current=False)
    celery_app.conf.update(task_always_eager=False, task_serializer="json")
    celery_app.set_current()
    try:
        with celery_app.connection_for_write() as connection:
            with SimpleQueue(connection.channel(), AsyncWorkflowQueue.SANDBOX_QUEUE) as queue:
                queue.clear()
                try:
                    assert dispatch.run(harness) == 1

                    message = queue.get(block=False)
                    with harness.session_factory() as session:
                        log = session.scalar(select(WorkflowTriggerLog))
                        end_user = session.scalar(select(EndUser).where(EndUser.app_id == dispatch.app_id))
                        assert log is not None
                        assert end_user is not None
                        assert end_user.type == EndUserType.TRIGGER
                        assert log.status == WorkflowTriggerStatus.QUEUED
                        assert log.created_by == end_user.id
                        assert json.loads(log.inputs) == {"ref": "main"}
                        assert message.payload[0] == [{"workflow_trigger_log_id": log.id}]
                        assert message.headers["id"] == log.celery_task_id
                    assert message.headers["task"] == execute_workflow_sandbox.name
                    message.ack()
                    assert queue.qsize() == 0
                finally:
                    queue.clear()
    finally:
        previous_app.set_current()
        celery_app.close()
    assert execute_workflow_sandbox.app is previous_app

    assert [(path, body["feature_key"]) for path, body in billing.requests] == [
        ("/quota/reserve", "trigger_event"),
        ("/quota/reserve", "api_rate_limit"),
        ("/quota/commit", "api_rate_limit"),
        ("/quota/commit", "trigger_event"),
    ]
    assert [sent.method for sent in daemon.requests] == ["GET", "POST"]
    sent = daemon.requests[1]
    assert not sent.open_transactions
    assert sent.payload["user_id"] == "webhook-actor"
    assert sent.headers["X-Plugin-ID"] == "langgenius/github"
    assert sent.headers["X-Plugin-Unique-Identifier"] == "langgenius/github:1.0.0@package-hash"
    assert all(not session.in_transaction() for session in harness.metadata.sessions)


@pytest.mark.parametrize("outcome", ["cancelled", "invoke-error"])
def test_dispatch_refunds_quota_without_publishing_for_rejected_event(
    harness: _Harness, daemon: _Daemon, billing: _Billing, dispatch: _Dispatch, outcome: str
) -> None:
    daemon.response_data = {"variables": {}, "cancelled": True}
    if outcome == "invoke-error":
        daemon.response_code = -500
        daemon.response_message = json.dumps(
            {
                "error_type": "PluginInvokeError",
                "message": json.dumps({"error_type": "ProviderRejected", "message": "Repository no longer exists"}),
            }
        )
        daemon.response_data = None

    assert dispatch.run(harness) == 0

    assert [(path, body["feature_key"]) for path, body in billing.requests] == [
        ("/quota/reserve", "trigger_event"),
        ("/quota/release", "trigger_event"),
    ]
    assert [sent.method for sent in daemon.requests] == ["GET", "POST"]
    assert not daemon.requests[1].open_transactions
    with harness.session_factory() as session:
        log = session.scalar(select(WorkflowTriggerLog))
        run = session.scalar(select(WorkflowRun))
        if outcome == "cancelled":
            assert log is None
            assert run is None
        else:
            assert log is not None
            assert run is not None
            assert log.status == WorkflowTriggerStatus.FAILED
            assert "Repository no longer exists" in (log.error or "")
            assert run.error == log.error
