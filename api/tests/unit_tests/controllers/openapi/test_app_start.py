from __future__ import annotations

import dataclasses
import json
import logging
import threading
import time
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session

from controllers.openapi import app_start
from controllers.openapi._catalog import build_catalog, iter_handlers
from controllers.openapi._errors import OpenApiErrorCode
from controllers.openapi._models import IDEMPOTENCY_KEY_MAX_LENGTH, AdvancedChatStartPayload, WorkflowStartPayload
from controllers.openapi.app_run import _RUN_GUARDS
from controllers.openapi.app_start import ADVANCED_CHAT_START_OP, WORKFLOW_START_OP
from controllers.openapi.auth.spec import Effect, Kind, spec_of
from extensions.ext_application_services import ApplicationServices
from models import App
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.run_job_contracts import JobStatus
from services.run_job_service import WAIT_DEFAULT_SECONDS, WAIT_MAX_SECONDS, RunJobService, RunResult
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld
from tests.unit_tests.services.run_job_fakes import InMemoryRedis, InMemoryRunResults, RecordingTaskControl

WORKFLOW_ROUTE = "/openapi/v1/apps/{app_id}/workflow:start"
CHATFLOW_ROUTE = "/openapi/v1/apps/{app_id}/advanced-chat:start"
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

    def generate(self, **kwargs: object):
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
    threads: list[threading.Thread] = field(default_factory=list)

    def join(self) -> None:
        if self.generator.hold is not None:
            self.generator.hold.set()
        for thread in self.threads:
            thread.join(timeout=5)

    def start(self, route: str = WORKFLOW_ROUTE, **body: object):
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
    service = RunJobService(
        store=store,
        results=results,
        tasks=RecordingTaskControl(),
        max_background_runs=max_background_runs,
        max_waiters=4,
        sleep=lambda _seconds: time.sleep(0.01),
    )
    services = dataclasses.replace(account_application_services, run_jobs=service)
    monkeypatch.setattr(app_start, "application_services", lambda: services)
    generator = Generator()

    class GenerateService:
        generate = staticmethod(generator.generate)

    monkeypatch.setattr("controllers.openapi.app_run.AppGenerateService", GenerateService)
    world = World(admitted_bearer, generator, store, redis, results, service)
    attach = service.attach

    def attach_and_track(job_id: str, frames: Iterable[str]) -> threading.Thread:
        thread = attach(job_id, frames)
        world.threads.append(thread)
        return thread

    monkeypatch.setattr(service, "attach", attach_and_track)
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


def test_start_orders_audit_attach_end_of_read_transaction_then_wait(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    order: list[str] = []
    attach = world.service.attach
    wait = world.service.wait

    def recording_attach(job_id: str, frames: Iterable[str]) -> threading.Thread:
        order.append("attach")
        return attach(job_id, frames)

    def recording_wait(*args: object, **kwargs: object):
        order.append("wait")
        return wait(*args, **kwargs)

    monkeypatch.setattr(app_start, "emit_app_run", lambda **_kwargs: order.append("emit"))
    monkeypatch.setattr(app_start, "end_read_transaction", lambda _session: order.append("end"))
    monkeypatch.setattr(world.service, "attach", recording_attach)
    monkeypatch.setattr(world.service, "wait", recording_wait)

    world.start(wait_seconds=0)

    assert order == ["emit", "attach", "end", "wait"]


def test_advanced_chat_start_returns_a_finished_job(world: World, sqlite_session: Session) -> None:
    sqlite_session.get(App, world.client.app_id).mode = AppMode.ADVANCED_CHAT
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


def test_a_failing_audit_discards_the_job(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(**_kwargs: object) -> None:
        raise RuntimeError("audit down")

    monkeypatch.setattr(app_start, "emit_app_run", fail)

    response = world.start(wait_seconds=0, idempotency_key="k2")

    assert response.status_code == 500
    assert _job_ids(world) == []
    assert not [name for name in world.redis.values if "k2" in name]


def test_start_does_not_pass_wait_or_key_to_the_run_service(world: World) -> None:
    world.start(wait_seconds=5, idempotency_key="k3", inputs={"a": 1})

    args = world.generator.calls[0]["args"]
    assert args["inputs"] == {"a": 1}
    assert "wait_seconds" not in args
    assert "idempotency_key" not in args


@pytest.mark.parametrize("model", [WorkflowStartPayload, AdvancedChatStartPayload])
def test_start_payloads_bound_the_start_fields_and_forbid_extras(model: type) -> None:
    extra = {"query": "hi"} if model is AdvancedChatStartPayload else {}
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


def test_start_ops_are_in_the_catalog_with_the_run_guards_and_pat_policy(openapi_app: Flask) -> None:
    from constants.personal_access_token import PersonalAccessTokenPolicy

    ops = build_catalog(openapi_app)["ops"]
    specs = {spec.catalog.op: spec for _, _, fn in iter_handlers(openapi_app) if (spec := spec_of(fn)) is not None}
    for op in (WORKFLOW_START_OP, ADVANCED_CHAT_START_OP):
        assert ops[op]["kind"] == Kind.OBJECT.value
        assert ops[op]["effect"] == Effect.WRITE.value
        assert specs[op].pat_policy is PersonalAccessTokenPolicy.RESOURCE_CALLS
        assert specs[op].requirements == _RUN_GUARDS


class ClosableStream:
    def __init__(self) -> None:
        self.closed = False

    def __iter__(self) -> Iterator[str]:
        return iter(())

    def close(self) -> None:
        self.closed = True


def test_a_failed_launch_closes_the_stream(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    stream = ClosableStream()
    world.generator.stream = stream

    def fail(**_kwargs: object) -> None:
        raise RuntimeError("audit down")

    monkeypatch.setattr(app_start, "emit_app_run", fail)

    response = world.start(wait_seconds=0)

    assert response.status_code == 500
    assert stream.closed
