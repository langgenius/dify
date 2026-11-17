from __future__ import annotations

import dataclasses
import json
import logging
import threading
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from controllers.openapi import app_start, jobs
from controllers.openapi._catalog import build_catalog, iter_handlers
from controllers.openapi._errors import OpenApiErrorCode
from controllers.openapi._models import (
    IDEMPOTENCY_KEY_MAX_LENGTH,
    AdvancedChatStartPayload,
    ChatStartPayload,
    CompletionStartPayload,
    WorkflowStartPayload,
)
from controllers.openapi.app_start import (
    ADVANCED_CHAT_START_OP,
    CHAT_START_OP,
    COMPLETION_START_OP,
    START_MODES,
    START_OP_PREFIX,
    WORKFLOW_START_OP,
    ChatStartApi,
    CompletionStartApi,
)
from controllers.openapi.auth.spec import spec_of
from extensions.ext_application_services import ApplicationServices
from models import App
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.run_job_contracts import JobOwner, JobStatus
from services.run_job_service import (
    READER_THREAD_NAME,
    WAIT_DEFAULT_SECONDS,
    WAIT_MAX_SECONDS,
    JobOpening,
    JobView,
    MessageResult,
    RunJobService,
    RunResult,
)
from services.workflow.graph_check import GRAPH_MODES
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld
from tests.unit_tests.services.run_job_fakes import (
    InMemoryRedis,
    InMemoryRunResults,
    RecordingTaskControl,
    polling_service,
)

WORKFLOW_ROUTE = "/openapi/v1/apps/{app_id}/workflow:start"
CHATFLOW_ROUTE = "/openapi/v1/apps/{app_id}/advanced-chat:start"
CHAT_ROUTE = "/openapi/v1/apps/{app_id}/chat:start"
COMPLETION_ROUTE = "/openapi/v1/apps/{app_id}/completion:start"
WAIT_ROUTE = "/openapi/v1/apps/{app_id}/jobs/{job_id}:wait"
RUN_ID = "r1"


def _frame(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


FINISHING_FRAMES = [
    _frame({"event": "workflow_started", "task_id": "t1", "workflow_run_id": RUN_ID}),
    _frame({"event": "workflow_finished", "workflow_run_id": RUN_ID, "data": {"status": "succeeded"}}),
]


@dataclass
class Generator:
    """Stands in for AppGenerateService: records calls and replays the frames it was given."""

    frames: list[str] = field(default_factory=lambda: list(FINISHING_FRAMES))
    error: Exception | None = None
    hold: threading.Event | None = None
    calls: list[dict[str, object]] = field(default_factory=list)
    stream: Iterable[str] | None = None

    def generate(self, **kwargs: object) -> Iterable[str]:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        if self.stream is not None:
            return self.stream
        return self._stream()

    def _stream(self) -> Iterator[str]:
        for frame in self.frames:
            if self.hold is not None:
                self.hold.wait(timeout=10)
            yield frame


@dataclass
class World:
    client: AdmittedWorld
    generator: Generator
    store: RedisRunJobStore
    redis: InMemoryRedis
    results: InMemoryRunResults
    service: RunJobService

    def join(self) -> None:
        if self.generator.hold is not None:
            self.generator.hold.set()
        for thread in threading.enumerate():
            if thread.name == READER_THREAD_NAME:
                thread.join(timeout=5)

    def start(self, route: str = WORKFLOW_ROUTE, **body: object) -> TestResponse:
        return self.client.client.post(route.format(app_id=self.client.app_id), json=body, headers=self.client.headers)


def _world(
    admitted_bearer: AdmittedWorld,
    account_application_services: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
    request: pytest.FixtureRequest,
    *,
    max_background_runs: int = 10,
) -> World:
    redis = InMemoryRedis()
    store = RedisRunJobStore(redis_client=redis)
    results = InMemoryRunResults()
    results.runs[(admitted_bearer.workspace_id, RUN_ID)] = RunResult(status=JobStatus.SUCCEEDED, outputs={"x": 1})
    service = polling_service(
        store=store, results=results, tasks=RecordingTaskControl(), max_background_runs=max_background_runs
    )
    services = dataclasses.replace(account_application_services, run_jobs=service)
    monkeypatch.setattr(app_start, "application_services", lambda: services)
    monkeypatch.setattr(jobs, "application_services", lambda: services)
    generator = Generator()

    class GenerateService:
        generate = staticmethod(generator.generate)

    monkeypatch.setattr("controllers.openapi.app_run.AppGenerateService", GenerateService)
    world = World(admitted_bearer, generator, store, redis, results, service)
    request.addfinalizer(world.join)
    return world


@pytest.fixture
def world(
    admitted_bearer: AdmittedWorld,
    account_application_services: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
    request: pytest.FixtureRequest,
) -> World:
    return _world(admitted_bearer, account_application_services, monkeypatch, request)


def _job_ids(world: World) -> list[str]:
    return list(world.redis.hashes)


def test_start_returns_a_finished_job_when_the_run_ends_inside_the_wait(world: World) -> None:
    response = world.start(wait_seconds=5)

    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "succeeded"
    assert body["run_id"] == RUN_ID
    assert body["outputs"] == {"x": 1}


def test_start_audits_inside_the_start_then_ends_the_read_transaction_then_waits(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    order: list[str] = []
    start = world.service.start
    wait = world.service.wait

    def recording_start(opening: JobOpening, launch: Callable[[], Iterable[str]]) -> str:
        order.append("start")
        job_id = start(opening, launch)
        order.append("started")
        return job_id

    def recording_wait(owner: JobOwner, job_id: str, *, wait_seconds: int) -> JobView:
        order.append("wait")
        return wait(owner, job_id, wait_seconds=wait_seconds)

    monkeypatch.setattr(app_start, "emit_run_audit", lambda _ctx: order.append("emit"))
    monkeypatch.setattr(app_start, "end_read_transaction", lambda _session: order.append("end"))
    monkeypatch.setattr(world.service, "start", recording_start)
    monkeypatch.setattr(world.service, "wait", recording_wait)

    world.start(wait_seconds=0)

    assert order == ["start", "emit", "started", "end", "wait"]


def test_advanced_chat_start_returns_a_finished_job(world: World, sqlite_session: Session) -> None:
    app = sqlite_session.get(App, world.client.app_id)
    assert app is not None
    app.mode = AppMode.ADVANCED_CHAT
    sqlite_session.commit()

    response = world.start(CHATFLOW_ROUTE, query="hi", wait_seconds=5)

    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "succeeded"
    assert body["run_id"] == RUN_ID
    assert body["outputs"] == {"x": 1}


def test_start_with_wait_zero_answers_running_with_a_job_id(world: World) -> None:
    release = threading.Event()
    world.generator.hold = release
    try:
        response = world.start(wait_seconds=0)
    finally:
        release.set()

    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "running"
    assert body["id"]
    assert body["outputs"] is None


def test_a_service_error_maps_as_the_run_route_maps_it_and_leaves_no_job(world: World) -> None:
    world.generator.error = ValueError("variable abc is bad")

    response = world.start(wait_seconds=0)

    assert response.status_code == 400
    assert "variable abc" not in response.get_data(as_text=True)
    assert _job_ids(world) == []


def test_a_repeated_idempotency_key_returns_the_first_job_and_runs_nothing(world: World) -> None:
    release = threading.Event()
    world.generator.hold = release
    try:
        first = world.start(wait_seconds=0, idempotency_key="k1")
        second = world.start(wait_seconds=0, idempotency_key="k1")
    finally:
        release.set()

    assert first.status_code == second.status_code == 200
    assert second.get_json()["id"] == first.get_json()["id"]
    assert len(world.generator.calls) == 1
    assert world.store.get(first.get_json()["id"]) is not None


def test_start_refuses_an_app_of_another_mode(world: World) -> None:
    response = world.start(CHATFLOW_ROUTE, query="hi", wait_seconds=0)

    assert response.status_code == 422
    assert response.get_json()["code"] == OpenApiErrorCode.APP_MODE_MISMATCH
    assert world.generator.calls == []
    assert _job_ids(world) == []


def test_start_at_the_background_cap_answers_429(
    admitted_bearer: AdmittedWorld,
    account_application_services: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
    request: pytest.FixtureRequest,
) -> None:
    world = _world(admitted_bearer, account_application_services, monkeypatch, request, max_background_runs=1)
    release = threading.Event()
    world.generator.hold = release
    try:
        first = world.start(wait_seconds=0)
        second = world.start(wait_seconds=0)
    finally:
        release.set()

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.get_json()["code"] == OpenApiErrorCode.JOB_CAPACITY_REACHED
    assert len(world.generator.calls) == 1


def test_start_emits_the_app_run_audit_event(world: World, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="controllers.openapi._audit"):
        world.start(wait_seconds=0)

    record = next(r for r in caplog.records if "app.run.openapi" in r.getMessage())
    assert record.app_id == world.client.app_id  # type: ignore[attr-defined]
    assert record.surface == "apps"  # type: ignore[attr-defined]


def test_start_does_not_pass_wait_or_key_to_the_run_service(world: World) -> None:
    world.start(wait_seconds=5, idempotency_key="k3", inputs={"a": 1})

    args = world.generator.calls[0]["args"]
    assert isinstance(args, dict)
    assert args["inputs"] == {"a": 1}
    assert "wait_seconds" not in args
    assert "idempotency_key" not in args


@pytest.mark.parametrize(
    "model", [WorkflowStartPayload, AdvancedChatStartPayload, ChatStartPayload, CompletionStartPayload]
)
def test_start_payloads_bound_the_start_fields_and_forbid_extras(model: type) -> None:
    extra = {"query": "hi"} if model in (AdvancedChatStartPayload, ChatStartPayload) else {}
    assert model(**extra).wait_seconds == WAIT_DEFAULT_SECONDS
    for bad in (
        {"wait_seconds": WAIT_MAX_SECONDS + 1},
        {"wait_seconds": -1},
        {"idempotency_key": ""},
        {"idempotency_key": "k" * (IDEMPOTENCY_KEY_MAX_LENGTH + 1)},
    ):
        with pytest.raises(ValidationError):
            model(**extra, **bad)
    with pytest.raises(ValidationError):
        model(**extra, surprise=1)
    schema = model.model_json_schema()["properties"]
    assert {"wait_seconds", "idempotency_key"} <= set(schema)


def test_the_start_ops_are_the_catalogs_and_each_graph_mode_has_exactly_one(openapi_app: Flask) -> None:
    ops = build_catalog(openapi_app)["ops"]

    assert {op for op in ops if op.startswith(START_OP_PREFIX)} == set(START_MODES)
    for mode in GRAPH_MODES:
        assert len([op for op, modes in START_MODES.items() if mode in modes]) == 1, mode


def test_start_ops_take_the_resource_calls_pat_policy(openapi_app: Flask) -> None:
    from constants.personal_access_token import PersonalAccessTokenPolicy

    specs = {spec.catalog.op: spec for _, _, fn in iter_handlers(openapi_app) if (spec := spec_of(fn)) is not None}
    for op in START_MODES:
        assert specs[op].pat_policy is PersonalAccessTokenPolicy.RESOURCE_CALLS


CHAT_ID = "c1"
MESSAGE_ID = "m1"
TASK_ID = "t1"
CHAT_FRAMES = [
    _frame(
        {"event": "message", "task_id": TASK_ID, "message_id": MESSAGE_ID, "conversation_id": CHAT_ID, "answer": "he"}
    ),
    _frame({"event": "message_end", "task_id": TASK_ID, "message_id": MESSAGE_ID, "conversation_id": CHAT_ID}),
]


@dataclass
class RecordingFrames:
    """A frame stream that blocks on a gate, then records each frame it yields and whether it was exhausted."""

    frames: list[str]
    gate: threading.Event
    yielded: list[str] = field(default_factory=list)
    exhausted: bool = False

    def __iter__(self) -> Iterator[str]:
        for frame in self.frames:
            self.gate.wait(timeout=10)
            self.yielded.append(frame)
            yield frame
        self.exhausted = True


def _set_mode(world: World, sqlite_session: Session, mode: AppMode) -> None:
    sqlite_session.get(App, world.client.app_id).mode = mode
    sqlite_session.commit()


def test_a_chat_run_is_read_to_the_end_after_the_response_is_sent(world: World, sqlite_session: Session) -> None:
    _set_mode(world, sqlite_session, AppMode.CHAT)
    world.results.messages[(world.client.app_id, MESSAGE_ID)] = MessageResult(answer="hello", error=None)
    gate = threading.Event()
    frames = RecordingFrames(CHAT_FRAMES, gate)
    world.generator.stream = frames

    started = world.start(CHAT_ROUTE, query="hi", wait_seconds=0)

    assert started.status_code == 200
    assert started.get_json()["status"] == "running"
    assert frames.yielded == []
    gate.set()
    job_id = started.get_json()["id"]
    waited = world.client.client.get(
        WAIT_ROUTE.format(app_id=world.client.app_id, job_id=job_id) + "?wait_seconds=5",
        headers=world.client.headers,
    )

    body = waited.get_json()
    assert body["status"] == "succeeded"
    assert body["answer"] == "hello"
    assert body["conversation_id"] == CHAT_ID
    assert body["hints"][0]["op"] == CHAT_START_OP
    world.join()
    assert frames.yielded == CHAT_FRAMES
    assert frames.exhausted


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT])
def test_chat_start_serves_chat_and_agent_chat_apps(world: World, sqlite_session: Session, mode: AppMode) -> None:
    _set_mode(world, sqlite_session, mode)
    world.generator.frames = CHAT_FRAMES

    response = world.start(CHAT_ROUTE, query="hi", wait_seconds=0)

    assert response.status_code == 200
    assert len(world.generator.calls) == 1


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.COMPLETION, AppMode.ADVANCED_CHAT])
def test_chat_start_refuses_other_modes(world: World, sqlite_session: Session, mode: AppMode) -> None:
    _set_mode(world, sqlite_session, mode)

    response = world.start(CHAT_ROUTE, query="hi", wait_seconds=0)

    assert response.status_code == 422
    assert response.get_json()["code"] == OpenApiErrorCode.APP_MODE_MISMATCH
    assert world.generator.calls == []


def test_completion_start_serves_completion_apps_only(world: World, sqlite_session: Session) -> None:
    refused = world.start(COMPLETION_ROUTE, wait_seconds=0)
    _set_mode(world, sqlite_session, AppMode.COMPLETION)
    world.generator.frames = [
        _frame({"event": "message", "task_id": TASK_ID, "message_id": MESSAGE_ID}),
        _frame({"event": "message_end", "task_id": TASK_ID, "message_id": MESSAGE_ID}),
    ]
    accepted = world.start(COMPLETION_ROUTE, inputs={"a": 1}, wait_seconds=0)

    assert refused.status_code == 422
    assert refused.get_json()["code"] == OpenApiErrorCode.APP_MODE_MISMATCH
    assert accepted.status_code == 200
    assert len(world.generator.calls) == 1


def test_the_four_start_ops_are_separate_resource_classes(openapi_app: Flask) -> None:
    ops = (WORKFLOW_START_OP, ADVANCED_CHAT_START_OP, CHAT_START_OP, COMPLETION_START_OP)
    handlers: dict[str, object] = {}
    for _, _, fn in iter_handlers(openapi_app):
        spec = spec_of(fn)
        if spec is not None and spec.catalog.op in ops:
            handlers[spec.catalog.op] = fn

    assert set(handlers) == set(ops)
    assert len({id(fn) for fn in handlers.values()}) == 4
    assert handlers[CHAT_START_OP] is ChatStartApi.post
    assert handlers[COMPLETION_START_OP] is CompletionStartApi.post
