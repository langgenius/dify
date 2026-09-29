"""Web workflow policy and composed dispatch across persistence, quota, and queue boundaries."""

import json
from collections.abc import Callable, Generator, Mapping
from dataclasses import dataclass, field

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

import services.app_generate_service as generation
from enums import DeploymentEdition
from extensions.application_services.app import AppServices
from libs.stream import close_stream
from machinery.context import WebAppRequestContext
from models.model import App, AppMode
from models.workflow import Workflow
from services.app.web_workflow_service import WebAppNotWorkflowError, WebWorkflowService, WebWorkflowUnavailableError
from services.errors.app import (
    IsDraftWorkflowError,
    TriggerWorkflowServiceModeUnavailableError,
    WorkflowIdFormatError,
    WorkflowNotFoundError,
)
from services.workflow.run_entities import WebWorkflowTarget
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_app, make_end_user, make_workflow

CONTEXT = WebAppRequestContext(
    request_id="request-1", trace_id=None, tenant_id="tenant-1", app_id="app-1", end_user_id="user-1"
)


@dataclass
class Queries:
    target: WebWorkflowTarget[str, str] | None = field(
        default_factory=lambda: WebWorkflowTarget(
            app="app-record", user="user-record", mode="workflow", workflow_id="published-workflow"
        )
    )
    contexts: list[WebAppRequestContext] = field(default_factory=list)
    workflow_calls: list[tuple[str, str, str | None]] = field(default_factory=list)

    def get_app_and_user(self, context: WebAppRequestContext) -> WebWorkflowTarget[str, str] | None:
        self.contexts.append(context)
        return self.target

    def get_workflow(self, *, tenant_id: str, app_id: str, workflow_id: str | None) -> str | None:
        self.workflow_calls.append((tenant_id, app_id, workflow_id))
        return workflow_id


@dataclass
class Runtime:
    calls: list[tuple[str, str, Mapping[str, object]]] = field(default_factory=list)
    load_workflow: Callable[[str | None], str | None] | None = None
    closed: bool = False

    def __call__(
        self,
        *,
        app_model: str,
        user: str,
        args: Mapping[str, object],
        load_workflow: Callable[[str | None], str | None],
    ) -> Generator[str, None, None]:
        self.calls.append((app_model, user, args))
        self.load_workflow = load_workflow
        return self.events()

    def events(self) -> Generator[str, None, None]:
        try:
            yield "event-1"
            yield "event-2"
        finally:
            self.closed = True


@dataclass
class Tasks:
    stopped: list[str] = field(default_factory=list)

    def stop_workflow_task_no_user_check(self, *, task_id: str) -> None:
        self.stopped.append(task_id)


def test_run_keeps_stream_lazy_and_caller_can_close_it() -> None:
    queries, runtime, tasks = Queries(), Runtime(), Tasks()
    service = WebWorkflowService(queries=queries, runtime=runtime, tasks=tasks)
    args = {"inputs": {"question": "hello"}}
    response = service.run(CONTEXT, app_mode="workflow", args=args)
    assert queries.contexts == [CONTEXT]
    assert runtime.calls == [("app-record", "user-record", args)]
    assert queries.workflow_calls == []
    assert not runtime.closed
    assert next(response) == "event-1"
    close_stream(response)
    assert runtime.closed
    assert tasks.stopped == []


@pytest.mark.parametrize("app_mode", ["chat", "advanced-chat", "completion", "agent", "rag-pipeline"])
def test_wrong_mode_cannot_generate_or_stop(app_mode: str) -> None:
    queries, runtime, tasks = Queries(), Runtime(), Tasks()
    service = WebWorkflowService(queries=queries, runtime=runtime, tasks=tasks)
    with pytest.raises(WebAppNotWorkflowError):
        service.run(CONTEXT, app_mode=app_mode, args={"inputs": {}})
    with pytest.raises(WebAppNotWorkflowError):
        service.stop(app_mode=app_mode, task_id="task-1")
    assert runtime.calls == []
    assert tasks.stopped == []
    assert queries.contexts == []


def test_stop_preserves_admitted_webapp_task_policy() -> None:
    queries, runtime, tasks = Queries(), Runtime(), Tasks()
    service = WebWorkflowService(queries=queries, runtime=runtime, tasks=tasks)
    service.stop(app_mode="workflow", task_id="task-1")
    assert tasks.stopped == ["task-1"]
    assert runtime.calls == []
    assert queries.contexts == []


@pytest.mark.parametrize("mode", ["chat", None])
def test_current_app_state_is_checked_before_generation(mode: str | None) -> None:
    target = (
        WebWorkflowTarget(app="app-record", user="user-record", mode=mode, workflow_id="published-workflow")
        if mode is not None
        else None
    )
    queries, runtime = Queries(target=target), Runtime()
    service = WebWorkflowService(queries=queries, runtime=runtime, tasks=Tasks())
    error = WebWorkflowUnavailableError if mode is None else WebAppNotWorkflowError
    with pytest.raises(error):
        service.run(CONTEXT, app_mode="workflow", args={})
    assert queries.contexts == [CONTEXT]
    assert runtime.calls == []


@pytest.mark.parametrize("workflow_id", [None, "selected-workflow"])
def test_workflow_loader_preserves_owner_scope_and_selects_the_requested_version(workflow_id: str | None) -> None:
    queries, runtime = Queries(), Runtime()
    service = WebWorkflowService(queries=queries, runtime=runtime, tasks=Tasks())
    service.run(CONTEXT, app_mode="workflow", args={})
    assert runtime.load_workflow is not None
    selected = workflow_id or "published-workflow"
    assert runtime.load_workflow(workflow_id) == selected
    assert queries.workflow_calls == [(CONTEXT.tenant_id, CONTEXT.app_id, selected)]


WORKFLOW_ID = "00000000-0000-0000-0000-000000000001"


@dataclass
class Boundaries:
    connections: int = 0
    operations: list[str] = field(default_factory=list)
    queued: list[dict[str, object]] = field(default_factory=list)

    def checkout(self, _connection: object, _record: object, _proxy: object) -> None:
        self.connections += 1

    def checkin(self, _connection: object, _record: object) -> None:
        self.connections -= 1

    def queue(self, payload: str) -> None:
        assert self.connections == 0
        self.queued.append(json.loads(payload))


@dataclass
class RateLimit:
    boundary: Boundaries

    def enter(self, request_id: str) -> str:
        assert self.boundary.connections == 0
        self.boundary.operations.append("enter")
        return request_id

    @staticmethod
    def gen_request_key() -> str:
        return "limit-request-1"

    def exit(self, _request_id: str) -> None:
        self.boundary.operations.append("exit")

    def generate(self, stream: Generator[str, None, None], request_id: str) -> Generator[str, None, None]:
        try:
            yield from stream
        finally:
            self.exit(request_id)


@dataclass
class Quota:
    boundary: Boundaries

    def commit(self) -> None:
        assert self.boundary.connections == 0
        self.boundary.operations.append("commit")

    def refund(self) -> None:
        self.boundary.operations.append("refund")


@pytest.fixture
def boundary(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Generator[Boundaries, None, None]:
    app = make_app(app_id="app-1", mode=AppMode.WORKFLOW, workflow_id=WORKFLOW_ID)
    user = make_end_user(end_user_id="user-1", app_id=app.id)
    workflow = make_workflow(workflow_id=WORKFLOW_ID, version="1")
    with sqlite_session_factory.begin() as session:
        session.add_all([app, user, workflow])
    boundary = Boundaries()
    limiter = RateLimit(boundary)

    class RateLimits:
        def __new__(cls, _app_id: str, _max_active_requests: int) -> RateLimit:
            return limiter

        gen_request_key = staticmethod(limiter.gen_request_key)

    def reserve(_quota_type: object, tenant_id: str) -> Quota:
        assert tenant_id == CONTEXT.tenant_id
        assert boundary.connections == 0
        boundary.operations.append("reserve")
        return Quota(boundary)

    def retrieve_events(
        app_mode: AppMode, _run_id: str, *, on_subscribe: Callable[[], None]
    ) -> Generator[Mapping[str, object] | str, None, None]:
        assert app_mode == AppMode.WORKFLOW
        assert boundary.connections == 0
        on_subscribe()
        yield {"event": "workflow_started"}
        yield {"event": "workflow_finished"}

    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        PUBSUB_REDIS_CHANNEL_TYPE="streams",
        ENABLE_OTEL=False,
    )
    monkeypatch.setattr(generation, "RateLimit", RateLimits)
    monkeypatch.setattr(generation.QuotaService, "reserve", reserve)
    monkeypatch.setattr(generation.workflow_based_app_execution_task, "delay", boundary.queue)
    monkeypatch.setattr(generation.MessageBasedAppGenerator, "retrieve_events", retrieve_events)
    event.listen(sqlite_engine, "checkout", boundary.checkout)
    event.listen(sqlite_engine, "checkin", boundary.checkin)
    try:
        yield boundary
    finally:
        event.remove(sqlite_engine, "checkout", boundary.checkout)
        event.remove(sqlite_engine, "checkin", boundary.checkin)


def test_composed_web_workflow_closes_sessions_before_quota_and_lazy_dispatch(
    app_services: AppServices, boundary: Boundaries
) -> None:
    response = app_services.web_workflows.run(CONTEXT, app_mode="workflow", args={"inputs": {"name": "value"}})
    assert boundary.queued == []
    assert boundary.connections == 0
    assert boundary.operations == ["reserve", "enter", "commit", "enter", "exit"]
    assert "workflow_started" in next(response)
    assert len(boundary.queued) == 1
    payload = boundary.queued[0]
    assert (payload["app_id"], payload["tenant_id"], payload["workflow_id"]) == ("app-1", "tenant-1", WORKFLOW_ID)
    assert payload["user"] == {"TYPE": "end_user", "end_user_id": "user-1"}
    assert payload["args"] == {"inputs": {"name": "value"}}
    assert payload["streaming"] is True
    assert payload["invoke_from"] == "web-app"
    close_stream(response)
    assert boundary.operations == ["reserve", "enter", "commit", "enter", "exit", "exit"]


@pytest.mark.parametrize(
    ("workflow_id", "error"),
    [("invalid", WorkflowIdFormatError), ("00000000-0000-0000-0000-000000000002", WorkflowNotFoundError)],
)
def test_workflow_lookup_failure_refunds_and_releases(
    app_services: AppServices, boundary: Boundaries, workflow_id: str, error: type[Exception]
) -> None:
    with pytest.raises(error):
        app_services.web_workflows.run(CONTEXT, app_mode="workflow", args={"inputs": {}, "workflow_id": workflow_id})
    assert boundary.operations == ["reserve", "enter", "commit", "refund", "exit"]
    assert boundary.queued == []
    assert boundary.connections == 0


def test_explicit_draft_is_rejected_before_dispatch(
    app_services: AppServices, boundary: Boundaries, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        workflow = session.get(Workflow, WORKFLOW_ID)
        assert workflow is not None
        workflow.version = Workflow.VERSION_DRAFT
    with pytest.raises(IsDraftWorkflowError):
        app_services.web_workflows.run(CONTEXT, app_mode="workflow", args={"inputs": {}, "workflow_id": WORKFLOW_ID})
    assert boundary.queued == []
    assert boundary.operations[-2:] == ["refund", "exit"]


def test_trigger_workflow_keeps_manual_run_rejection(
    app_services: AppServices, boundary: Boundaries, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        workflow = session.get(Workflow, WORKFLOW_ID)
        assert workflow is not None
        workflow.graph = json.dumps({"nodes": [{"id": "trigger", "data": {"type": "trigger-webhook"}}], "edges": []})
    with pytest.raises(TriggerWorkflowServiceModeUnavailableError):
        app_services.web_workflows.run(CONTEXT, app_mode="workflow", args={"inputs": {}})
    assert boundary.operations[-2:] == ["refund", "exit"]
    assert boundary.queued == []


@pytest.mark.parametrize("mode", [AppMode.CHAT, None])
def test_changed_or_deleted_app_cannot_dispatch(
    app_services: AppServices, boundary: Boundaries, sqlite_session_factory: sessionmaker[Session], mode: AppMode | None
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, CONTEXT.app_id)
        assert app is not None
        if mode is None:
            session.delete(app)
        else:
            app.mode = mode
    expected = WebWorkflowUnavailableError if mode is None else WebAppNotWorkflowError
    with pytest.raises(expected):
        app_services.web_workflows.run(CONTEXT, app_mode="workflow", args={"inputs": {}})
    assert boundary.operations == []
    assert boundary.queued == []
