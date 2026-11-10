"""Native webhook HTTP requests use real admission, SQL, quota HTTP and task publishing."""

import json
from collections.abc import Iterator
from contextvars import Context
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import BytesIO
from threading import Thread
from typing import override
from uuid import uuid4

import pytest
from celery import Celery
from kombu.simple import SimpleQueue
from sqlalchemy import Engine, delete, select
from sqlalchemy.pool import QueuePool
from werkzeug.test import TestResponse

from controllers.trigger import bp
from core.app.workflow.file_runtime import create_dify_workflow_file_runtime
from enums import DeploymentEdition
from extensions.ext_storage import storage
from graphon.file.runtime import use_workflow_file_runtime
from models.enums import AppTriggerStatus, AppTriggerType, EndUserType, WorkflowTriggerStatus
from models.model import AppMode, EndUser
from models.tools import ToolFile
from models.trigger import AppTrigger, WorkflowTriggerLog, WorkflowWebhookTrigger
from models.workflow import Workflow
from tasks.async_workflow_tasks import execute_workflow_sandbox
from tasks.workflow_cfs_scheduler.entities import AsyncWorkflowQueue
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.model_factories import make_app, make_workflow
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness


@dataclass(frozen=True)
class _Webhook:
    app_id: str
    webhook_id: str
    workflow_id: str
    draft_id: str
    trigger_id: str
    node_id: str = "webhook-node"

    @property
    def url(self) -> str:
        return f"/triggers/webhook/{self.webhook_id}"

    @property
    def debug_url(self) -> str:
        return f"/triggers/webhook-debug/{self.webhook_id}"


@pytest.fixture
def webhook(harness: _Harness) -> _Webhook:
    harness.app.register_blueprint(bp)
    app_id, webhook_id = str(uuid4()), uuid4().hex[:24]
    graph: dict[str, object] = {
        "nodes": [
            {
                "id": "webhook-node",
                "data": {
                    "type": "trigger-webhook",
                    "title": "Incoming webhook",
                    "method": "post",
                    "content_type": "application/json",
                    "headers": [],
                    "params": [],
                    "body": [],
                },
            }
        ],
        "edges": [],
    }
    published, draft = [
        make_workflow(
            tenant_id=harness.tenant_id,
            app_id=app_id,
            version=version,
            graph=graph,
            created_by=harness.account_id,
        )
        for version in ("published", Workflow.VERSION_DRAFT)
    ]
    with harness.session_factory.begin() as session:
        trigger = AppTrigger(
            tenant_id=harness.tenant_id,
            app_id=app_id,
            node_id="webhook-node",
            title="Incoming webhook",
            trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
            status=AppTriggerStatus.ENABLED,
        )
        session.add_all(
            [
                published,
                draft,
                make_app(app_id=app_id, tenant_id=harness.tenant_id, workflow_id=published.id, mode=AppMode.WORKFLOW),
                trigger,
                WorkflowWebhookTrigger(
                    tenant_id=harness.tenant_id,
                    app_id=app_id,
                    webhook_id=webhook_id,
                    node_id="webhook-node",
                    created_by=harness.account_id,
                ),
            ]
        )
        session.flush()
        return _Webhook(app_id, webhook_id, published.id, draft.id, trigger.id)


def _configure(harness: _Harness, webhook: _Webhook, **values: object) -> None:
    with harness.session_factory.begin() as session:
        for workflow_id in (webhook.workflow_id, webhook.draft_id):
            workflow = session.get(Workflow, workflow_id)
            assert workflow is not None
            graph = json.loads(workflow.graph)
            graph["nodes"][0]["data"].update(values)
            workflow.graph = json.dumps(graph)


@pytest.fixture
def broker() -> Iterator[SimpleQueue]:
    previous_app = execute_workflow_sandbox.app
    app = Celery("native-webhook-http-test", broker="memory://", set_as_current=False)
    app.conf.update(task_always_eager=False, task_serializer="json")
    app.set_current()
    try:
        with app.connection_for_write() as connection:
            with SimpleQueue(connection.channel(), AsyncWorkflowQueue.SANDBOX_QUEUE) as queue:
                queue.clear()
                try:
                    yield queue
                finally:
                    queue.clear()
    finally:
        previous_app.set_current()
        app.close()


@dataclass
class _Billing:
    requests: list[tuple[str, dict[str, object]]] = field(default_factory=list)
    open_connections: list[int] = field(default_factory=list)
    exhausted_feature: str | None = None


@pytest.fixture
def billing(sqlite_engine: Engine) -> Iterator[_Billing]:
    billing = _Billing()
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.respond(
                {
                    "enabled": True,
                    "subscription": {
                        "plan": "sandbox",
                        "interval": "month",
                        "education": False,
                        "status": "active",
                        "cancel_at_period_end": False,
                        "paid_period_end": 0,
                    },
                    "members": {"size": 1, "limit": 10},
                    "apps": {"size": 1, "limit": 10},
                    "vector_space": None,
                    "knowledge_rate_limit": {"size": 0, "limit": 10},
                    "documents_upload_quota": {"size": 0, "limit": 10},
                    "annotation_quota_limit": {"size": 0, "limit": 10},
                    "docs_processing": "standard",
                    "can_replace_logo": False,
                    "model_load_balancing_enabled": False,
                    "knowledge_pipeline_publish_enabled": False,
                    "next_credit_reset_date": 0,
                }
            )

        def do_POST(self) -> None:
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            billing.requests.append((self.path, payload))
            billing.open_connections.append(pool.checkedout())
            if self.path == "/quota/reserve":
                exhausted = payload["feature_key"] == billing.exhausted_feature
                self.respond(
                    {
                        "reservation_id": "" if exhausted else str(uuid4()),
                        "available": 0 if exhausted else 10,
                        "reserved": 0 if exhausted else 1,
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
    thread.start()
    try:
        url = f"http://127.0.0.1:{server.server_port}"
        with config_overrides_context(BILLING_API_URL=url, BILLING_QUOTA_API_URL=url):
            yield billing
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_success_publishes_actual_workflow_task_and_preserves_actor_and_inputs(
    harness: _Harness, webhook: _Webhook, broker: SimpleQueue, billing: _Billing
) -> None:
    with config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD):
        response = Context().run(harness.client.post, webhook.url + "?attempt=2", json={"ref": "main"})

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"status": "success", "message": "Webhook processed successfully"}
    assert response.headers["Content-Type"] == "application/json"
    message = broker.get(block=False)
    with harness.session_factory() as session:
        log = session.scalar(select(WorkflowTriggerLog).where(WorkflowTriggerLog.app_id == webhook.app_id))
        actor = session.scalar(select(EndUser).where(EndUser.app_id == webhook.app_id))
        assert log is not None
        assert actor is not None
        assert actor.tenant_id == harness.tenant_id
        assert actor.type == EndUserType.TRIGGER
        assert log.created_by == actor.id
        assert log.tenant_id == harness.tenant_id
        assert log.workflow_id == webhook.workflow_id
        assert log.root_node_id == webhook.node_id
        assert log.status == WorkflowTriggerStatus.QUEUED
        inputs = json.loads(log.inputs)
        assert inputs["webhook_body"] == {"ref": "main"}
        assert inputs["webhook_query_params"] == {"attempt": "2"}
        assert inputs["webhook_data"]["method"] == "POST"
        assert message.payload[0] == [{"workflow_trigger_log_id": log.id}]
        assert message.headers["id"] == log.celery_task_id
    assert message.headers["task"] == execute_workflow_sandbox.name
    message.ack()
    assert broker.qsize() == 0
    assert billing.open_connections
    assert not any(billing.open_connections)


@pytest.mark.parametrize(
    ("body", "status", "expected"),
    [
        ('{"accepted":true}', 202, {"accepted": True}),
        ('["one",2]', 201, ["one", 2]),
        ("accepted", 200, {"message": "accepted"}),
    ],
)
def test_configured_response_preserves_status_and_json_shape(
    harness: _Harness, webhook: _Webhook, broker: SimpleQueue, body: str, status: int, expected: object
) -> None:
    _configure(harness, webhook, response_body=body, status_code=status)
    response = Context().run(harness.client.post, webhook.url, json={})
    assert response.status_code == status
    assert response.get_json() == expected
    assert broker.qsize() == 1


@pytest.mark.parametrize("debug", [False, True])
@pytest.mark.parametrize("problem", ["method", "json", "required"])
def test_request_errors_are_400_before_execution(
    harness: _Harness, webhook: _Webhook, debug: bool, problem: str
) -> None:
    url = webhook.debug_url if debug else webhook.url
    if problem == "method":
        response = Context().run(harness.client.get, url)
    elif problem == "json":
        response = Context().run(harness.client.post, url, data="{bad", content_type="application/json")
    else:
        _configure(harness, webhook, body=[{"name": "required", "type": "string", "required": True}])
        response = Context().run(harness.client.post, url, json={})
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["error"] == "Bad Request"
    assert response.get_json()["message"]
    with harness.session_factory() as session:
        assert session.scalar(select(WorkflowTriggerLog)) is None
        assert session.scalar(select(EndUser)) is None


@pytest.mark.parametrize("debug", [False, True])
def test_invalid_stored_webhook_configuration_does_not_expose_details(
    harness: _Harness, webhook: _Webhook, debug: bool
) -> None:
    _configure(harness, webhook, body=[{"name": "amount", "type": "private-config-value", "required": True}])

    response = Context().run(harness.client.post, webhook.debug_url if debug else webhook.url, json={"amount": 1})

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.get_json() == {"error": "Internal server error", "message": "An internal error has occurred."}
    assert b"private-config-value" not in response.data
    with harness.session_factory() as session:
        assert session.scalar(select(WorkflowTriggerLog)) is None
        assert session.scalar(select(EndUser)) is None


@pytest.mark.parametrize("debug", [False, True])
def test_unknown_webhook_is_opaque_noncacheable_404(harness: _Harness, webhook: _Webhook, debug: bool) -> None:
    url = webhook.debug_url if debug else webhook.url
    with harness.session_factory.begin() as session:
        session.execute(delete(WorkflowWebhookTrigger))
    response = Context().run(harness.client.post, url, json={})
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.content_type == "text/html; charset=utf-8"
    assert response.headers["Cache-Control"] == "no-store"
    assert webhook.webhook_id not in response.get_data(as_text=True)


@pytest.mark.parametrize("debug", [False, True])
@pytest.mark.parametrize("broken_graph", ["missing-node", "empty-nodes", "malformed"])
def test_webhook_distinguishes_missing_node_from_corrupt_workflow(
    harness: _Harness, webhook: _Webhook, debug: bool, broken_graph: str
) -> None:
    workflow_id = webhook.draft_id if debug else webhook.workflow_id
    with harness.session_factory.begin() as session:
        workflow = session.get(Workflow, workflow_id)
        assert workflow is not None
        if broken_graph == "missing-node":
            graph = json.loads(workflow.graph)
            graph["nodes"][0]["id"] = "different-node"
            workflow.graph = json.dumps(graph)
        elif broken_graph == "empty-nodes":
            workflow.graph = '{"nodes": [], "edges": []}'
        else:
            workflow.graph = "{malformed"

    response = Context().run(harness.client.post, webhook.debug_url if debug else webhook.url, json={})

    if broken_graph == "missing-node":
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.headers["Cache-Control"] == "no-store"
    else:
        assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
        assert response.get_json() == {"error": "Internal server error", "message": "An internal error has occurred."}
    with harness.session_factory() as session:
        assert session.scalar(select(WorkflowTriggerLog)) is None
        assert session.scalar(select(EndUser)) is None


@pytest.mark.parametrize("debug", [False, True])
def test_body_limit_remains_413(harness: _Harness, webhook: _Webhook, debug: bool) -> None:
    with config_overrides_context(WEBHOOK_REQUEST_BODY_MAX_SIZE=4):
        response = Context().run(harness.client.post, webhook.debug_url if debug else webhook.url, json={"large": True})
    assert response.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE


@pytest.mark.parametrize("status", [AppTriggerStatus.DISABLED, AppTriggerStatus.RATE_LIMITED])
def test_published_status_blocks_execution_but_draft_still_reaches_request_validation(
    harness: _Harness, webhook: _Webhook, status: AppTriggerStatus
) -> None:
    with harness.session_factory.begin() as session:
        trigger = session.get(AppTrigger, webhook.trigger_id)
        assert trigger is not None
        trigger.status = status
    response = Context().run(harness.client.post, webhook.url, json={})
    assert response.status_code == (
        HTTPStatus.NOT_FOUND if status == AppTriggerStatus.DISABLED else HTTPStatus.TOO_MANY_REQUESTS
    )
    if status == AppTriggerStatus.RATE_LIMITED:
        assert response.get_json() == {
            "error": "Too Many Requests",
            "message": "Trigger event quota exceeded. Please upgrade your plan.",
        }
    debug = Context().run(harness.client.post, webhook.debug_url, data="{bad", content_type="application/json")
    assert debug.status_code == HTTPStatus.BAD_REQUEST


@pytest.mark.parametrize("status", [AppTriggerStatus.DISABLED, AppTriggerStatus.RATE_LIMITED])
@pytest.mark.parametrize("broken_workflow", ["missing", "empty-nodes", "malformed-graph"])
def test_unavailable_trigger_status_precedes_published_workflow_lookup_and_parsing(
    harness: _Harness, webhook: _Webhook, status: AppTriggerStatus, broken_workflow: str
) -> None:
    with harness.session_factory.begin() as session:
        trigger = session.get(AppTrigger, webhook.trigger_id)
        workflow = session.get(Workflow, webhook.workflow_id)
        assert trigger is not None
        assert workflow is not None
        trigger.status = status
        if broken_workflow == "missing":
            session.delete(workflow)
        elif broken_workflow == "empty-nodes":
            workflow.graph = '{"nodes": [], "edges": []}'
        else:
            workflow.graph = "{malformed"

    response = Context().run(harness.client.post, webhook.url, json={})

    if status == AppTriggerStatus.RATE_LIMITED:
        assert response.status_code == HTTPStatus.TOO_MANY_REQUESTS
        assert response.get_json() == {
            "error": "Too Many Requests",
            "message": "Trigger event quota exceeded. Please upgrade your plan.",
        }
    else:
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.content_type == "text/html; charset=utf-8"
        assert response.headers["Cache-Control"] == "no-store"
    # The intact draft continues to use its own config despite the published status and corruption.
    debug = Context().run(harness.client.post, webhook.debug_url, data="{bad", content_type="application/json")
    assert debug.status_code == HTTPStatus.BAD_REQUEST
    with harness.session_factory() as session:
        assert session.scalar(select(WorkflowTriggerLog)) is None
        assert session.scalar(select(EndUser)) is None


@pytest.mark.parametrize(
    ("feature", "message"),
    [
        ("trigger_event", "Trigger event quota exceeded. Please upgrade your plan."),
        ("api_rate_limit", "Workflow execution quota exceeded. Please upgrade your plan."),
    ],
)
def test_real_quota_denial_returns_specific_429_without_publishing(
    harness: _Harness, webhook: _Webhook, broker: SimpleQueue, billing: _Billing, feature: str, message: str
) -> None:
    billing.exhausted_feature = feature
    with config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD):
        response = Context().run(harness.client.post, webhook.url, json={})
    assert response.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert response.get_json() == {"error": "Too Many Requests", "message": message}
    assert broker.qsize() == 0
    with harness.session_factory() as session:
        log = session.scalar(select(WorkflowTriggerLog))
        if feature == "trigger_event":
            assert log is None
        else:
            assert log is not None
            assert log.status == WorkflowTriggerStatus.RATE_LIMITED
            assert log.celery_task_id is None
        trigger = session.get(AppTrigger, webhook.trigger_id)
        assert trigger is not None
        assert trigger.status == (
            AppTriggerStatus.RATE_LIMITED if feature == "trigger_event" else AppTriggerStatus.ENABLED
        )
    assert not any(billing.open_connections)


def test_corrupt_stored_workflow_returns_500_instead_of_client_validation_error(
    harness: _Harness, webhook: _Webhook
) -> None:
    with harness.session_factory.begin() as session:
        workflow = session.get(Workflow, webhook.workflow_id)
        assert workflow is not None
        workflow.graph = '{"nodes": [], "edges": []}'
    response = Context().run(harness.client.post, webhook.url, json={})
    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.get_json() == {"error": "Internal server error", "message": "An internal error has occurred."}


@pytest.mark.parametrize("content_type", ["multipart/form-data", "application/octet-stream"])
def test_uploaded_files_use_real_tool_file_storage_and_detached_workflow_inputs(
    harness: _Harness, webhook: _Webhook, broker: SimpleQueue, content_type: str
) -> None:
    _configure(harness, webhook, content_type=content_type)
    content = b"webhook upload bytes"
    data = (
        {"upload": (BytesIO(content), "sample.txt"), "caption": "incoming"}
        if content_type == "multipart/form-data"
        else content
    )

    def send() -> TestResponse:
        # The minimal Flask harness binds the same concrete file runtime as production DifyAppContext.
        with use_workflow_file_runtime(create_dify_workflow_file_runtime()):
            return harness.client.post(webhook.url, data=data, content_type=content_type)

    response = Context().run(send)
    assert response.status_code == HTTPStatus.OK
    assert broker.qsize() == 1
    with harness.session_factory() as session:
        tool_file = session.scalar(select(ToolFile))
        actor = session.scalar(select(EndUser).where(EndUser.app_id == webhook.app_id))
        assert tool_file is not None
        assert actor is not None
        assert tool_file.tenant_id == harness.tenant_id
        assert tool_file.user_id == actor.id
        assert tool_file.size == len(content)
        file_key = tool_file.file_key
        log = session.scalar(select(WorkflowTriggerLog).where(WorkflowTriggerLog.app_id == webhook.app_id))
        assert log is not None
        assert log.created_by == actor.id
        inputs = json.loads(log.inputs)
        saved_file = (
            inputs["webhook_data"]["files"]["upload"]
            if content_type == "multipart/form-data"
            else inputs["webhook_body"]["raw"]
        )
        assert saved_file["transfer_method"] == "tool_file"
        assert saved_file["size"] == len(content)
        assert saved_file["mime_type"] == tool_file.mimetype
    assert storage.load_once(file_key) == content
