"""Stream operations answer their stream, or with ``X-Dify-Stream-Result: job`` their run as a background job."""

from __future__ import annotations

import dataclasses
import json
import logging
import threading
import uuid
from collections.abc import Callable, Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime

import pytest
from flask import Flask
from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from configs import dify_config
from constants import HEADER_NAME_IDEMPOTENCY_KEY, HEADER_NAME_JOB_WAIT_SECONDS, HEADER_NAME_STREAM_RESULT
from controllers.openapi import app_run, jobs, workflow_events
from controllers.openapi._catalog import iter_handlers
from controllers.openapi._contract import Kind, endpoint, op_of
from controllers.openapi._stream_result import JOB_FIELD_HEADERS, STREAM_HEADERS, StreamResult
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.spec import AdmissionContext, spec_of
from controllers.openapi.workflow_events import OpenApiWorkflowEventsApi
from core.app.entities.task_entities import HumanInputRequiredResponse
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices
from graphon.enums import WorkflowExecutionStatus
from libs import helper
from models import Account, App
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import WorkflowRun, WorkflowType
from repositories.run_job_store import RedisRunJobStore
from services.enterprise.enterprise_service import EnterpriseService, WebAppSettings
from services.entities.feature_entities import SystemFeatureModel
from services.run_job import READER_THREAD_NAME, JobStatus, RunJobService, RunResult
from services.run_job.reader import logger as reader_logger
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld
from tests.unit_tests.services.run_job.fakes import (
    InMemoryRedis,
    InMemoryRunResults,
    RecordingTaskControl,
    polling_service,
    workflow_finished,
)

RUN_ID = str(uuid.uuid4())
TASK_ID = "t1"
MESSAGE_ID = "m1"
CONVERSATION_ID = "c1"
FORM_TOKEN = "ft-1"
MISFIT_TEXT = "does not fit core's model"
EVENTS_ROUTE = "/openapi/v1/apps/{app_id}/runs/{run_id}/events"
WAIT_ROUTE = "/openapi/v1/apps/{app_id}/jobs/{job_id}:wait"
AS_JOB = {HEADER_NAME_STREAM_RESULT: StreamResult.JOB.value, HEADER_NAME_JOB_WAIT_SECONDS: "0"}


def _frame(payload: Mapping[str, object]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


FINISHED = workflow_finished(WorkflowExecutionStatus.SUCCEEDED).model_copy(
    update={"task_id": TASK_ID, "workflow_run_id": RUN_ID}
)
GRAPH_FRAMES = [
    _frame({"event": "workflow_started", "task_id": TASK_ID, "workflow_run_id": RUN_ID}),
    _frame(FINISHED.model_dump(mode="json")),
]
# A message_end without a conversation passes the reply layer untouched, so the stream bytes are the frames.
MESSAGE_FRAMES = [
    _frame({"event": "message", "task_id": TASK_ID, "message_id": MESSAGE_ID, "answer": "he"}),
    _frame({"event": "message_end", "task_id": TASK_ID, "message_id": MESSAGE_ID, "id": MESSAGE_ID}),
]


def _form_event(form_token: str | None) -> dict[str, object]:
    return {
        "event": "human_input_required",
        "task_id": TASK_ID,
        "workflow_run_id": RUN_ID,
        "data": {
            "form_id": "f1",
            "node_id": "n1",
            "node_title": "Review",
            "form_content": "",
            "inputs": [{"type": "paragraph", "output_variable_name": "comment"}],
            "actions": [{"id": "approve", "title": "Approve"}],
            "form_token": form_token,
            "expiration_time": 4102444800,
        },
    }


def _paused_event() -> dict[str, object]:
    return {"event": "workflow_paused", "task_id": TASK_ID, "workflow_run_id": RUN_ID, "data": {}}


@dataclass(frozen=True)
class StreamRoute:
    resource: type[Resource]
    segment: str
    mode: AppMode
    body: dict[str, object]
    frames: list[str]

    @property
    def op(self) -> str:
        # The per-mode run resources are created dynamically, so pyrefly only sees `Resource`.
        return op_of(self.resource.post)  # pyrefly: ignore[missing-attribute]


RUN_ROUTES = [
    StreamRoute(app_run.WorkflowRunApi, "workflow", AppMode.WORKFLOW, {}, GRAPH_FRAMES),
    StreamRoute(app_run.ChatRunApi, "chat", AppMode.CHAT, {"query": "hi"}, MESSAGE_FRAMES),
    StreamRoute(app_run.AdvancedChatRunApi, "advanced-chat", AppMode.ADVANCED_CHAT, {"query": "hi"}, GRAPH_FRAMES),
    StreamRoute(app_run.CompletionRunApi, "completion", AppMode.COMPLETION, {}, MESSAGE_FRAMES),
    StreamRoute(app_run.WorkflowDraftRunApi, "draft/workflow", AppMode.WORKFLOW, {}, GRAPH_FRAMES),
    StreamRoute(
        app_run.AdvancedChatDraftRunApi, "draft/advanced-chat", AppMode.ADVANCED_CHAT, {"query": "hi"}, GRAPH_FRAMES
    ),
]


@dataclass
class Generator:
    """Stands in for AppGenerateService: records calls and replays the frames it was given."""

    frames: list[str] = field(default_factory=lambda: list(GRAPH_FRAMES))
    hold: threading.Event | None = None
    calls: list[dict[str, object]] = field(default_factory=list)

    def generate(self, **kwargs: object) -> Iterable[str]:
        self.calls.append(kwargs)
        return self._stream()

    def _stream(self) -> Iterator[str]:
        for frame in self.frames:
            if self.hold is not None:
                self.hold.wait(timeout=10)
            yield frame


@dataclass
class World:
    client: AdmittedWorld
    session: Session
    generator: Generator
    store: RedisRunJobStore
    results: InMemoryRunResults
    service: RunJobService
    caller_id: str

    def join(self) -> None:
        if self.generator.hold is not None:
            self.generator.hold.set()
        for thread in threading.enumerate():
            if thread.name == READER_THREAD_NAME:
                thread.join(timeout=5)

    def set_mode(self, mode: AppMode) -> None:
        app = self.session.get(App, self.client.app_id)
        assert app is not None
        app.mode = mode
        self.session.commit()

    def run(self, route: StreamRoute, headers: Mapping[str, str] | None = None) -> TestResponse:
        self.set_mode(route.mode)
        self.generator.frames = list(route.frames)
        url = f"/openapi/v1/apps/{self.client.app_id}/{route.segment}:run"
        return self.client.client.post(url, json=route.body, headers={**self.client.headers, **(headers or {})})

    def events(self, query: str = "", headers: Mapping[str, str] | None = None) -> TestResponse:
        url = EVENTS_ROUTE.format(app_id=self.client.app_id, run_id=RUN_ID) + query
        return self.client.client.get(url, headers={**self.client.headers, **(headers or {})})

    def wait(self, job_id: str) -> TestResponse:
        url = WAIT_ROUTE.format(app_id=self.client.app_id, job_id=job_id) + "?wait_seconds=5"
        return self.client.client.get(url, headers=self.client.headers)

    def add_run(self, status: WorkflowExecutionStatus, job_status: JobStatus) -> None:
        finished = job_status.is_final
        run = WorkflowRun(
            id=RUN_ID,
            app_id=self.client.app_id,
            tenant_id=self.client.workspace_id,
            workflow_id=str(uuid.uuid4()),
            type=WorkflowType.WORKFLOW,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            graph="{}",
            inputs="{}",
            outputs='{"x": 1}',
            status=status,
            elapsed_time=0.1,
            total_tokens=0,
            total_steps=1,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=self.caller_id,
            finished_at=datetime(2026, 1, 1, tzinfo=UTC) if finished else None,
        )
        run.created_at = datetime(2026, 1, 1, tzinfo=UTC)
        self.session.add(run)
        self.session.commit()
        self.results.runs[(self.client.workspace_id, RUN_ID)] = RunResult(status=job_status, outputs={"x": 1})


@pytest.fixture
def world(
    admitted_bearer: AdmittedWorld,
    account_application_services: ApplicationServices,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[World]:
    store = RedisRunJobStore(redis_client=InMemoryRedis(), job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)
    results = InMemoryRunResults()
    results.runs[(admitted_bearer.workspace_id, RUN_ID)] = RunResult(status=JobStatus.SUCCEEDED, outputs={"x": 1})
    service = polling_service(store=store, results=results, tasks=RecordingTaskControl())
    services = dataclasses.replace(account_application_services, run_jobs=service)
    monkeypatch.setattr(jobs, "application_services", lambda: services)
    generator = Generator()

    class GenerateService:
        generate = staticmethod(generator.generate)

    monkeypatch.setattr(app_run, "AppGenerateService", GenerateService)
    caller = sqlite_session.scalars(select(Account).where(Account.email == "caller@example.com")).one()
    built = World(admitted_bearer, sqlite_session, generator, store, results, service, caller.id)
    yield built
    built.join()


def _job_op(world: World, response: TestResponse) -> str:
    record = world.store.get(response.get_json()["id"])
    assert record is not None
    return record.op


@pytest.mark.parametrize("route", RUN_ROUTES, ids=lambda route: route.segment)
def test_without_the_header_a_run_streams_the_bytes_the_old_builder_sent(world: World, route: StreamRoute) -> None:
    response = world.run(route)

    old = helper.compact_generate_response(iter(route.frames))
    assert response.status_code == 200
    assert response.mimetype == old.mimetype
    assert response.get_data() == old.get_data()
    assert {name: response.headers[name] for name in STREAM_HEADERS} == dict(STREAM_HEADERS)
    assert len(world.generator.calls) == 1


@pytest.mark.parametrize("route", RUN_ROUTES, ids=lambda route: route.segment)
def test_with_the_header_a_run_answers_a_job_of_its_own_op(world: World, route: StreamRoute) -> None:
    response = world.run(route, AS_JOB)

    assert response.status_code == 200
    assert response.mimetype == "application/json"
    assert response.get_json()["status"] in {JobStatus.RUNNING, JobStatus.SUCCEEDED}
    assert _job_op(world, response) == route.op
    assert len(world.generator.calls) == 1
    assert world.generator.calls[0]["streaming"] is True


def test_every_stream_op_is_one_of_the_seven_these_tests_cover(openapi_app: Flask) -> None:
    streams = {
        spec.catalog.op
        for _, _, handler in iter_handlers(openapi_app)
        if (spec := spec_of(handler)) is not None and spec.catalog.kind is Kind.SSE
    }

    assert streams == {route.op for route in RUN_ROUTES} | {op_of(OpenApiWorkflowEventsApi.get)}


def test_a_bad_header_value_answers_422_before_anything_runs(world: World) -> None:
    response = world.run(RUN_ROUTES[0], {**AS_JOB, HEADER_NAME_JOB_WAIT_SECONDS: "forever"})

    assert response.status_code == 422
    assert [detail["loc"] for detail in response.get_json()["details"]] == [[HEADER_NAME_JOB_WAIT_SECONDS]]
    assert world.generator.calls == []


def test_another_header_value_streams(world: World) -> None:
    response = world.run(RUN_ROUTES[0], {HEADER_NAME_STREAM_RESULT: "inline"})

    assert response.mimetype == "text/event-stream"


def test_a_repeated_key_returns_the_first_job_and_runs_the_handler_once(world: World) -> None:
    world.generator.hold = threading.Event()
    keyed = {**AS_JOB, HEADER_NAME_IDEMPOTENCY_KEY: "k1"}
    try:
        first = world.run(RUN_ROUTES[0], keyed)
        second = world.run(RUN_ROUTES[0], keyed)
    finally:
        world.generator.hold.set()

    assert first.status_code == second.status_code == 200
    assert second.get_json()["id"] == first.get_json()["id"]
    assert len(world.generator.calls) == 1


def test_a_job_audits_the_run_inside_its_launch(world: World, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="controllers.openapi._audit"):
        world.run(RUN_ROUTES[0], AS_JOB)

    record = next(r for r in caplog.records if "app.run.openapi" in r.getMessage())
    assert record.app_id == world.client.app_id  # type: ignore[attr-defined]


def test_the_reader_takes_frames_that_carry_hints_without_a_misfit(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    end = {"event": "message_end", "task_id": TASK_ID, "message_id": MESSAGE_ID, "id": MESSAGE_ID}
    route = dataclasses.replace(
        RUN_ROUTES[1], frames=[MESSAGE_FRAMES[0], _frame({**end, "conversation_id": CONVERSATION_ID})]
    )

    with caplog.at_level(logging.ERROR, logger=reader_logger.name):
        started = world.run(route, AS_JOB)
        world.join()
        body = world.wait(started.get_json()["id"]).get_json()

    assert body["status"] == JobStatus.SUCCEEDED
    assert body["hints"][0]["op"] == route.op
    assert not [r for r in caplog.records if MISFIT_TEXT in r.getMessage()]


def _private_enterprise_app(monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]) -> None:
    """An enterprise app whose web access is private and which this caller may not open as a web app."""
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr("controllers.openapi.auth.router.assert_license_valid", lambda: None)
    monkeypatch.setattr(
        "controllers.openapi.auth.requirements.SystemFeatureService.get_public_system_features",
        lambda: SystemFeatureModel(
            agent_tracing_api_collection_enabled=False, deployment_edition=DeploymentEdition.ENTERPRISE
        ),
    )
    monkeypatch.setattr(
        EnterpriseService.WebAppAuth,
        "get_app_access_mode_by_id",
        lambda **_: WebAppSettings(access_mode="private"),
    )
    monkeypatch.setattr(EnterpriseService.WebAppAuth, "is_user_allowed_to_access_webapp", lambda **_: False)


def test_an_editor_starts_and_waits_on_a_draft_test_of_a_private_app(
    world: World, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    _private_enterprise_app(monkeypatch, config_overrides)
    published, draft = RUN_ROUTES[0], RUN_ROUTES[4]

    refused = world.run(published, AS_JOB)
    started = world.run(draft, AS_JOB)
    world.join()
    waited = world.wait(started.get_json()["id"])

    assert refused.status_code == 403
    assert started.status_code == 200
    assert _job_op(world, started) == draft.op
    assert waited.status_code == 200
    assert waited.get_json()["status"] == JobStatus.SUCCEEDED


def test_a_paused_draft_test_says_a_human_must_answer_its_form_in_the_console(world: World) -> None:
    route = dataclasses.replace(
        RUN_ROUTES[4], frames=[GRAPH_FRAMES[0], _frame(_form_event(None)), _frame(_paused_event())]
    )
    world.results.runs[(world.client.workspace_id, RUN_ID)] = RunResult(status=JobStatus.PAUSED)
    form = HumanInputRequiredResponse.model_validate(_form_event(None))
    world.results.forms[(world.client.workspace_id, world.client.app_id, RUN_ID, AppMode.WORKFLOW)] = form

    started = world.run(route, AS_JOB)
    world.join()
    body = world.wait(started.get_json()["id"]).get_json()

    assert body["status"] == JobStatus.PAUSED
    assert body["note"] == jobs.CONSOLE_FORM_NOTE
    assert [hint["summary"] for hint in body["hints"]] == [jobs.CONSOLE_FORM_WAIT_SUMMARY]


class _Events:
    """Stands in for core's MessageGenerator: replays events, holding on a gate when given one."""

    def __init__(self, events: list[Mapping[str, object]], gate: threading.Event | None = None) -> None:
        self._events = events
        self._gate = gate

    def retrieve_events(self, *_args: object, **_kwargs: object) -> Iterator[Mapping[str, object]]:
        yield from self._events
        if self._gate is not None:
            self._gate.wait(timeout=10)


def test_get_run_event_as_a_job_on_a_finished_run(world: World) -> None:
    world.add_run(WorkflowExecutionStatus.SUCCEEDED, JobStatus.SUCCEEDED)

    streamed = world.events()
    started = world.events(headers=AS_JOB)
    world.join()
    body = world.wait(started.get_json()["id"]).get_json()

    assert streamed.mimetype == "text/event-stream"
    assert "workflow_finished" in streamed.get_data(as_text=True)
    assert started.status_code == 200
    assert _job_op(world, started) == op_of(OpenApiWorkflowEventsApi.get)
    assert (body["status"], body["run_id"], body["outputs"], body["hints"]) == (
        JobStatus.SUCCEEDED,
        RUN_ID,
        {"x": 1},
        [],
    )


def test_get_run_event_as_a_job_on_a_running_run(
    world: World, monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest
) -> None:
    world.add_run(WorkflowExecutionStatus.RUNNING, JobStatus.RUNNING)
    gate = threading.Event()
    request.addfinalizer(gate.set)
    started_event: dict[str, object] = {"event": "workflow_started", "task_id": TASK_ID, "workflow_run_id": RUN_ID}
    monkeypatch.setattr(workflow_events, "MessageGenerator", lambda: _Events([started_event], gate))

    started = world.events(headers=AS_JOB)
    waited = world.client.client.get(
        WAIT_ROUTE.format(app_id=world.client.app_id, job_id=started.get_json()["id"]) + "?wait_seconds=0",
        headers=world.client.headers,
    )

    assert started.status_code == 200
    assert waited.get_json()["status"] == JobStatus.RUNNING
    assert [hint["op"] for hint in waited.get_json()["hints"]] == [jobs.WAIT_JOB_OP]


def test_get_run_event_as_a_job_on_a_paused_run(
    world: World, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    world.add_run(WorkflowExecutionStatus.PAUSED, JobStatus.PAUSED)
    form = HumanInputRequiredResponse.model_validate(_form_event(FORM_TOKEN))
    world.results.forms[(world.client.workspace_id, world.client.app_id, RUN_ID, AppMode.WORKFLOW)] = form
    snapshot = [_form_event(FORM_TOKEN), _paused_event()]
    monkeypatch.setattr(workflow_events, "build_workflow_event_stream", lambda **_kwargs: iter(snapshot))

    with caplog.at_level(logging.ERROR, logger=reader_logger.name):
        started = world.events("?include_state_snapshot=true", headers=AS_JOB)
        world.join()
        body = world.wait(started.get_json()["id"]).get_json()

    assert (body["status"], body["run_id"], body["note"]) == (JobStatus.PAUSED, RUN_ID, None)
    assert [hint["input"].get("form_token") for hint in body["hints"]] == [FORM_TOKEN, None]
    assert not [r for r in caplog.records if MISFIT_TEXT in r.getMessage()]


def test_the_job_fields_are_the_headers_they_arrive_in() -> None:
    assert JOB_FIELD_HEADERS == {
        "wait_seconds": HEADER_NAME_JOB_WAIT_SECONDS,
        "idempotency_key": HEADER_NAME_IDEMPOTENCY_KEY,
    }


class _WithWaitSeconds(BaseModel):
    wait_seconds: int = Field(default=1)


def _stream_handler(self: Resource, ctx: Context, app_id: str) -> Iterable[str]:  # noqa: ARG001
    return iter(())


def _no_app_handler(self: Resource, ctx: Context) -> Iterable[str]:  # noqa: ARG001
    return iter(())


@dataclass(frozen=True)
class Refused:
    handler: Callable[..., Iterable[str]]
    reason: str
    context: AdmissionContext | None = "orm"
    query: type[BaseModel] | None = None
    body: type[BaseModel] | None = None


@pytest.mark.parametrize(
    "case",
    [
        Refused(_stream_handler, "'orm' context", context="workspace"),
        Refused(_stream_handler, "'orm' context", context=None),
        Refused(_no_app_handler, "'app_id'"),
        Refused(_stream_handler, "job start field names", body=_WithWaitSeconds),
        Refused(_stream_handler, "job start field names", query=_WithWaitSeconds),
    ],
    ids=["workspace context", "no context", "no app", "body field", "query field"],
)
def test_a_stream_op_that_cannot_run_as_a_job_fails_at_import(case: Refused) -> None:
    declare = endpoint(
        op="test.stream", kind=Kind.SSE, summary="A stream", context=case.context, query=case.query, body=case.body
    )
    with pytest.raises(TypeError, match=case.reason):
        declare(case.handler)
