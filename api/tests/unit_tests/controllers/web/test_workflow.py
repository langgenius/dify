"""Web workflow transport contracts through passport admission and the application service."""

from collections.abc import Callable, Generator, Mapping
from dataclasses import dataclass, field
from functools import partial

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import InternalServerError, NotFound, Unauthorized

from app_factory import create_flask_app_with_configs
from controllers.web import flask_admission, workflow
from controllers.web.error import (
    CompletionRequestError,
    NotWorkflowAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
    TriggerWorkflowServiceModeUnavailableError,
)
from controllers.web.error import (
    InvokeRateLimitError as InvokeRateLimitHttpError,
)
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.logging.context import clear_request_context, get_identity_context
from enums import DeploymentEdition
from graphon.model_runtime.errors.invoke import InvokeError
from libs.external_api import ExternalApi
from machinery.context import WebAppRequestContext
from models.model import App, AppMode, EndUser
from models.workflow import Workflow
from services.app.web_workflow_service import WebWorkflowService, WebWorkflowUnavailableError
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.feature_entities import LicenseStatus
from services.errors.app import (
    TriggerWorkflowServiceModeUnavailableError as TriggerWorkflowServiceModeUnavailableServiceError,
)
from services.errors.llm import InvokeRateLimitError
from services.workflow.run_entities import WebWorkflowTarget
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_end_user


@dataclass
class Queries:
    app: App
    user: EndUser
    contexts: list[WebAppRequestContext] = field(default_factory=list)

    def get_app_and_user(self, context: WebAppRequestContext) -> WebWorkflowTarget[App, EndUser]:
        self.contexts.append(context)
        return WebWorkflowTarget(app=self.app, user=self.user, mode=self.app.mode, workflow_id=self.app.workflow_id)

    def get_workflow(self, *, tenant_id: str, app_id: str, workflow_id: str | None) -> Workflow | None:
        raise AssertionError(f"Transport tests must not load workflows: {tenant_id}/{app_id}/{workflow_id}")


@dataclass
class Runtime:
    calls: list[tuple[App, EndUser, Mapping[str, object]]] = field(default_factory=list)
    load_workflow: Callable[[str | None], Workflow | None] | None = None
    error: Exception | None = None

    def __call__(
        self,
        *,
        app_model: App,
        user: EndUser,
        args: Mapping[str, object],
        load_workflow: Callable[[str | None], Workflow | None],
    ) -> Generator[str, None, None]:
        self.calls.append((app_model, user, args))
        self.load_workflow = load_workflow
        if self.error is not None:
            raise self.error
        return self.events()

    @staticmethod
    def events() -> Generator[str, None, None]:
        yield 'data: {"event":"workflow_started"}\n\n'
        yield 'data: {"event":"workflow_finished"}\n\n'


@dataclass
class Tasks:
    stopped: list[str] = field(default_factory=list)

    def stop_workflow_task_no_user_check(self, *, task_id: str) -> None:
        self.stopped.append(task_id)


@dataclass(frozen=True)
class AppServices:
    web_workflows: WebWorkflowService[App, EndUser, Workflow]


@dataclass(frozen=True)
class Services:
    apps: AppServices


@dataclass
class Boundary:
    app: App
    user: EndUser
    queries: Queries
    runtime: Runtime
    tasks: Tasks


@pytest.fixture
def boundary(monkeypatch: pytest.MonkeyPatch) -> Generator[Boundary, None, None]:
    app_model = App(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
    user = make_end_user(end_user_id="eu-1", tenant_id="tenant-1", app_id="app-1")
    queries = Queries(app=app_model, user=user)
    runtime, tasks = Runtime(), Tasks()
    services = Services(AppServices(WebWorkflowService(queries=queries, runtime=runtime, tasks=tasks)))
    monkeypatch.setattr(workflow, "application_services", lambda: services)
    monkeypatch.setattr(flask_admission, "decode_jwt_token", lambda: (app_model, user))
    monkeypatch.setattr(flask_admission, "get_request_id", lambda: "request-1")
    monkeypatch.setattr(flask_admission, "get_trace_id", lambda: "")
    clear_request_context()
    yield Boundary(app_model, user, queries, runtime, tasks)
    clear_request_context()


def test_run_admits_stable_scope_parses_input_and_serializes_sse(app: Flask, boundary: Boundary) -> None:
    with app.test_request_context(
        "/workflows/run", method="POST", json={"inputs": {"key": "value"}}, headers={"X-Trace-Id": "trace-1"}
    ):
        response = workflow.WorkflowRunApi().post()
        assert response.mimetype == "text/event-stream"
        assert response.get_data(as_text=True) == (
            'data: {"event":"workflow_started"}\n\ndata: {"event":"workflow_finished"}\n\n'
        )
        assert get_identity_context() == ("tenant-1", "eu-1", boundary.user.type)
    assert boundary.runtime.calls == [(boundary.app, boundary.user, {"inputs": {"key": "value"}})]
    assert boundary.queries.contexts == [
        WebAppRequestContext(
            request_id="request-1", trace_id="trace-1", tenant_id="tenant-1", app_id="app-1", end_user_id="eu-1"
        )
    ]


@pytest.mark.parametrize("stop", [False, True])
def test_wrong_app_mode_is_rejected_before_runtime(app: Flask, boundary: Boundary, stop: bool) -> None:
    boundary.app.mode = AppMode.CHAT
    invoke = partial(workflow.WorkflowTaskStopApi().post, task_id="task-1") if stop else workflow.WorkflowRunApi().post
    with app.test_request_context("/", method="POST", json={"inputs": {}}), pytest.raises(NotWorkflowAppError):
        invoke()
    assert boundary.runtime.calls == []
    assert boundary.tasks.stopped == []


def test_invalid_input_does_not_generate(app: Flask, boundary: Boundary) -> None:
    with app.test_request_context("/", method="POST", json={"inputs": []}), pytest.raises(ValidationError):
        workflow.WorkflowRunApi().post()
    assert boundary.runtime.calls == []


@pytest.mark.parametrize("field", ["tenant_id", "app_id"])
@pytest.mark.parametrize("stop", [False, True])
def test_passport_actor_must_belong_to_admitted_app(app: Flask, boundary: Boundary, field: str, stop: bool) -> None:
    setattr(boundary.user, field, "other-owner")
    invoke = partial(workflow.WorkflowTaskStopApi().post, task_id="task-1") if stop else workflow.WorkflowRunApi().post
    with app.test_request_context("/", method="POST", json={"inputs": {}}), pytest.raises(Unauthorized):
        invoke()
    assert boundary.runtime.calls == []
    assert boundary.tasks.stopped == []
    assert get_identity_context() == ("", "", "")


@pytest.mark.parametrize("stop", [False, True])
def test_authentication_failure_precedes_payload_parsing(
    app: Flask, boundary: Boundary, monkeypatch: pytest.MonkeyPatch, stop: bool
) -> None:
    def deny() -> tuple[App, EndUser]:
        raise Unauthorized("App token is missing.")

    monkeypatch.setattr(flask_admission, "decode_jwt_token", deny)
    invoke = partial(workflow.WorkflowTaskStopApi().post, task_id="task-1") if stop else workflow.WorkflowRunApi().post
    with app.test_request_context("/", method="POST", json={"inputs": []}), pytest.raises(Unauthorized):
        invoke()
    assert boundary.runtime.calls == []
    assert boundary.tasks.stopped == []


@pytest.mark.parametrize(
    ("error", "http_error"),
    [
        (ProviderTokenNotInitError(description="not initialized"), ProviderNotInitializeError),
        (QuotaExceededError(), ProviderQuotaExceededError),
        (ModelCurrentlyNotSupportError(), ProviderModelCurrentlyNotSupportError),
        (InvokeError("provider failed"), CompletionRequestError),
        (InvokeRateLimitError("limit reached"), InvokeRateLimitHttpError),
        (TriggerWorkflowServiceModeUnavailableServiceError(), TriggerWorkflowServiceModeUnavailableError),
        (WebWorkflowUnavailableError(), NotFound),
        (RuntimeError("dispatch failed"), InternalServerError),
    ],
)
def test_generation_errors_keep_http_mapping(
    app: Flask, boundary: Boundary, error: Exception, http_error: type[Exception]
) -> None:
    boundary.runtime.error = error
    with app.test_request_context("/", method="POST", json={"inputs": {}}), pytest.raises(http_error):
        workflow.WorkflowRunApi().post()


def test_validation_errors_remain_unchanged(app: Flask, boundary: Boundary) -> None:
    error = ValueError("Workflow not published")
    boundary.runtime.error = error
    with app.test_request_context("/", method="POST", json={"inputs": {}}), pytest.raises(ValueError) as raised:
        workflow.WorkflowRunApi().post()
    assert raised.value is error


def test_stop_uses_existing_task_control_policy(app: Flask, boundary: Boundary) -> None:
    with app.test_request_context("/workflows/tasks/task-1/stop", method="POST"):
        response = workflow.WorkflowTaskStopApi().post(task_id="task-1")
    assert response == {"result": "success"}
    assert boundary.tasks.stopped == ["task-1"]
    assert boundary.runtime.calls == []


@pytest.mark.parametrize("stop", [False, True])
@pytest.mark.parametrize("license_status", [LicenseStatus.ACTIVE, LicenseStatus.EXPIRED, None])
def test_shared_license_admission_runs_before_web_workflow(
    boundary: Boundary, monkeypatch: pytest.MonkeyPatch, stop: bool, license_status: LicenseStatus | None
) -> None:
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(EnterpriseService, "get_cached_license_status", lambda: license_status)
    app = create_flask_app_with_configs()
    resource = workflow.WorkflowTaskStopApi if stop else workflow.WorkflowRunApi
    path = "/api/workflows/tasks/<string:task_id>/stop" if stop else "/api/workflows/run"
    api = ExternalApi(app)
    api.add_resource(resource, path)
    url = "/api/workflows/tasks/task-1/stop" if stop else "/api/workflows/run"
    response = app.test_client().post(url, json={"inputs": {}})
    try:
        assert response.status_code == (200 if license_status == LicenseStatus.ACTIVE else 401)
        if license_status != LicenseStatus.ACTIVE:
            assert boundary.runtime.calls == []
            assert boundary.tasks.stopped == []
        elif stop:
            assert boundary.tasks.stopped == ["task-1"]
        else:
            assert len(boundary.runtime.calls) == 1
    finally:
        response.close()
