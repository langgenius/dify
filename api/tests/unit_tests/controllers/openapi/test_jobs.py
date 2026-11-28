from __future__ import annotations

import dataclasses
import uuid
from collections.abc import Callable
from dataclasses import dataclass

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from configs import dify_config
from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.openapi import app_run, jobs
from controllers.openapi._catalog import build_catalog, iter_handlers
from controllers.openapi._contract import op_of
from controllers.openapi._errors import OpenApiErrorCode
from controllers.openapi.auth.requirements import CheckAppAccess
from controllers.openapi.auth.spec import Effect, spec_of
from controllers.openapi.human_input_form import OpenApiWorkflowHumanInputFormSubmitApi
from controllers.openapi.jobs import STOP_JOB_OP, WAIT_JOB_OP
from controllers.openapi.workflow_events import OpenApiWorkflowEventsApi
from core.app.entities.task_entities import HumanInputRequiredResponse
from extensions.ext_application_services import ApplicationServices
from models import Account
from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.run_job import (
    WAIT_DEFAULT_SECONDS,
    WAIT_MAX_SECONDS,
    JobEnding,
    JobIds,
    JobOwner,
    JobRecord,
    JobStatus,
    JobWaitQuery,
    RunJobService,
    RunResult,
)
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld
from tests.unit_tests.services.run_job.fakes import (
    InMemoryRedis,
    InMemoryRunResults,
    RecordingTaskControl,
    polling_service,
)

WAIT_ROUTE = "/openapi/v1/apps/{app_id}/jobs/{job_id}:wait"
STOP_ROUTE = "/openapi/v1/apps/{app_id}/jobs/{job_id}:stop"
CALLER_EMAIL = "caller@example.com"
RUN_ID = "r1"
TASK_ID = "t1"
SAMPLE_OP = "run.sample"
FORM = HumanInputRequiredResponse.model_validate(
    {
        "task_id": TASK_ID,
        "workflow_run_id": RUN_ID,
        "data": {
            "form_id": "f1",
            "node_id": "n1",
            "node_title": "Review",
            "form_content": "",
            "inputs": [{"type": "paragraph", "output_variable_name": "comment"}],
            "actions": [{"id": "approve", "title": "Approve"}, {"id": "reject", "title": ""}],
            "form_token": "ft-1",
            "expiration_time": 4102444800,
        },
    }
)


def _record(owner: JobOwner) -> JobRecord:
    return JobRecord(id=str(uuid.uuid4()), owner=owner, mode=AppMode.WORKFLOW, op=SAMPLE_OP)


@dataclass
class World:
    client: AdmittedWorld
    service: RunJobService
    store: RedisRunJobStore
    results: InMemoryRunResults
    tasks: RecordingTaskControl
    caller_id: str

    def owner(self, caller_id: str | None = None) -> JobOwner:
        return JobOwner(
            tenant_id=self.client.workspace_id,
            app_id=self.client.app_id,
            caller_role=CreatorUserRole.ACCOUNT,
            caller_id=caller_id or self.caller_id,
        )

    def open_job(
        self,
        *,
        caller_id: str | None = None,
        ids: JobIds | None = None,
        ending: JobEnding | None = None,
        mode: AppMode = AppMode.WORKFLOW,
        op: str = SAMPLE_OP,
    ) -> str:
        record = JobRecord(id=str(uuid.uuid4()), owner=self.owner(caller_id), mode=mode, op=op)
        self.store.create(record)
        if ids is not None:
            self.store.record_ids(record.id, ids)
        if ending is not None:
            self.store.settle(record.id, ending)
        return record.id

    def wait(self, job_id: str, query: str = "wait_seconds=0") -> TestResponse:
        url = WAIT_ROUTE.format(app_id=self.client.app_id, job_id=job_id) + f"?{query}"
        return self.client.client.get(url, headers=self.client.headers)

    def stop(self, job_id: str) -> TestResponse:
        url = STOP_ROUTE.format(app_id=self.client.app_id, job_id=job_id)
        return self.client.client.post(url, headers=self.client.headers)


@pytest.fixture
def world(
    admitted_bearer: AdmittedWorld,
    account_application_services: ApplicationServices,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> World:
    store = RedisRunJobStore(redis_client=InMemoryRedis(), job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)
    results = InMemoryRunResults()
    tasks = RecordingTaskControl()
    service = polling_service(store=store, results=results, tasks=tasks)
    services = dataclasses.replace(account_application_services, run_jobs=service)
    monkeypatch.setattr(jobs, "application_services", lambda: services)
    caller = sqlite_session.scalars(select(Account).where(Account.email == CALLER_EMAIL)).one()
    return World(admitted_bearer, service, store, results, tasks, caller.id)


def _wait_hint(job_id: str, app_id: str, summary: str) -> dict[str, object]:
    return {
        "summary": summary,
        "op": WAIT_JOB_OP,
        "input": {"app_id": app_id, "job_id": job_id, "wait_seconds": WAIT_DEFAULT_SECONDS},
        "form": None,
    }


def test_wait_returns_the_state_of_the_callers_job(world: World) -> None:
    job_id = world.open_job(ids=JobIds(run_id=RUN_ID), ending=JobEnding(status=JobStatus.SUCCEEDED))
    world.results.runs[(world.client.workspace_id, RUN_ID)] = RunResult(status=JobStatus.SUCCEEDED, outputs={"x": 1})

    response = world.wait(job_id)

    assert response.status_code == 200
    body = response.get_json()
    assert body["id"] == job_id
    assert body["status"] == "succeeded"
    assert body["outputs"] == {"x": 1}
    assert body["hints"] == []


def test_wait_answers_404_for_a_job_of_another_caller(world: World) -> None:
    job_id = world.open_job(caller_id="someone-else")

    response = world.wait(job_id)

    assert response.status_code == 404
    assert response.get_json()["code"] == OpenApiErrorCode.JOB_NOT_FOUND


def test_a_running_job_hints_wait_job_with_its_ids(world: World) -> None:
    job_id = world.open_job()

    body = world.wait(job_id).get_json()

    assert body["status"] == "running"
    assert body["hints"] == [_wait_hint(job_id, world.client.app_id, jobs.WAIT_HINT_SUMMARY)]


def _pause_run(world: World, form: HumanInputRequiredResponse | None) -> None:
    world.results.runs[(world.client.workspace_id, RUN_ID)] = RunResult(status=JobStatus.PAUSED)
    if form is not None:
        world.results.forms[(world.client.workspace_id, world.client.app_id, RUN_ID, AppMode.WORKFLOW)] = form


def test_a_paused_job_hints_the_form_submit_op_then_wait(world: World) -> None:
    job_id = world.open_job(ids=JobIds(task_id=TASK_ID, run_id=RUN_ID))
    _pause_run(world, FORM)

    body = world.wait(job_id).get_json()

    assert body["status"] == "paused"
    submit_op = op_of(OpenApiWorkflowHumanInputFormSubmitApi.post)
    approve, reject, wait = body["hints"]
    assert approve["summary"] == "Approve"
    assert reject["summary"] == "reject"
    for hint, action in ((approve, "approve"), (reject, "reject")):
        assert hint["op"] == submit_op
        assert hint["input"] == {
            "app_id": world.client.app_id,
            "form_token": "ft-1",
            "action": action,
            "inputs": {"comment": None},
        }
        assert [field["output_variable_name"] for field in hint["form"]] == ["comment"]
    assert wait == _wait_hint(job_id, world.client.app_id, jobs.RESUMED_WAIT_HINT_SUMMARY)


def test_a_paused_job_without_a_form_hints_only_wait(world: World) -> None:
    job_id = world.open_job(ids=JobIds(task_id=TASK_ID, run_id=RUN_ID))
    _pause_run(world, None)

    body = world.wait(job_id).get_json()

    assert body["hints"] == [_wait_hint(job_id, world.client.app_id, jobs.WAIT_HINT_SUMMARY)]


@pytest.mark.parametrize("status", [JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.STOPPED])
def test_a_final_job_without_a_conversation_carries_no_hints(world: World, status: JobStatus) -> None:
    job_id = world.open_job(ending=JobEnding(status=status))

    body = world.wait(job_id).get_json()

    assert body["status"] == status.value
    assert body["hints"] == []


@pytest.mark.parametrize(
    ("mode", "route"),
    [
        (AppMode.CHAT, app_run.ChatRunApi),
        (AppMode.AGENT_CHAT, app_run.ChatRunApi),
        (AppMode.ADVANCED_CHAT, app_run.AdvancedChatRunApi),
        (AppMode.ADVANCED_CHAT, app_run.AdvancedChatDraftRunApi),
    ],
)
def test_a_finished_chat_job_hints_a_reply_in_the_same_conversation(world: World, mode: AppMode, route: type) -> None:
    op = op_of(route.post)
    job_id = world.open_job(
        mode=mode,
        op=op,
        ids=JobIds(conversation_id="c1"),
        ending=JobEnding(status=JobStatus.SUCCEEDED),
    )

    body = world.wait(job_id).get_json()

    assert body["hints"] == [
        {
            "summary": app_run.REPLY_HINT_SUMMARY,
            "op": op,
            "input": {"app_id": world.client.app_id, "conversation_id": "c1", "query": None, "inputs": {}},
            "form": None,
        }
    ]


def test_every_status_has_a_hint_builder() -> None:
    assert set(jobs.HINTS_BY_STATUS) == set(JobStatus)


def test_stop_marks_the_job_and_answers_its_state(world: World) -> None:
    job_id = world.open_job(ids=JobIds(run_id=RUN_ID))

    response = world.stop(job_id)

    assert response.status_code == 200
    assert response.get_json()["id"] == job_id
    stored = world.store.get(job_id)
    assert stored is not None
    assert stored.stop_requested is True
    assert [stop.run_id for stop in world.tasks.workflow_stops] == [RUN_ID]


def test_stop_answers_404_for_a_job_of_another_caller(world: World) -> None:
    job_id = world.open_job(caller_id="someone-else")

    response = world.stop(job_id)

    assert response.status_code == 404
    assert response.get_json()["code"] == OpenApiErrorCode.JOB_NOT_FOUND
    assert world.tasks.workflow_stops == []


@pytest.mark.parametrize("request_route", [World.wait, World.stop])
def test_handlers_end_the_read_transaction_before_calling_the_service(
    world: World, monkeypatch: pytest.MonkeyPatch, request_route: Callable[[World, str], TestResponse]
) -> None:
    job_id = world.open_job()
    order: list[str] = []

    def recording(name: str, call: Callable[..., object]) -> Callable[..., object]:
        def run(*args: object, **kwargs: object) -> object:
            order.append(name)
            return call(*args, **kwargs)

        return run

    monkeypatch.setattr(jobs, "end_read_transaction", lambda _session: order.append("end"))
    monkeypatch.setattr(world.service, "view", recording("view", world.service.view))
    monkeypatch.setattr(world.service, "wait", recording("wait", world.service.wait))
    monkeypatch.setattr(world.service, "stop", recording("stop", world.service.stop))

    request_route(world, job_id)

    assert order[0] == "end"
    assert len(order) >= 2


@pytest.mark.parametrize("request_route", [World.wait, World.stop])
def test_a_job_of_another_app_is_a_404_for_the_same_caller(
    world: World, request_route: Callable[[World, str], TestResponse]
) -> None:
    other_app = JobOwner(
        tenant_id=world.client.workspace_id,
        app_id="another-app",
        caller_role=CreatorUserRole.ACCOUNT,
        caller_id=world.caller_id,
    )
    record = _record(other_app)
    world.store.create(record)

    response = request_route(world, record.id)

    assert response.status_code == 404
    assert response.get_json()["code"] == OpenApiErrorCode.JOB_NOT_FOUND
    assert world.tasks.workflow_stops == []


def test_wait_and_stop_are_in_the_catalog_as_read_and_destructive(openapi_app: Flask) -> None:
    ops = build_catalog(openapi_app)["ops"]
    specs = {spec.catalog.op: spec for _, _, fn in iter_handlers(openapi_app) if (spec := spec_of(fn)) is not None}

    assert ops[WAIT_JOB_OP]["effect"] == Effect.READ.value
    assert ops[STOP_JOB_OP]["effect"] == Effect.DESTRUCTIVE.value
    for op in (WAIT_JOB_OP, STOP_JOB_OP):
        assert specs[op].pat_policy is PersonalAccessTokenPolicy.RESOURCE_CALLS


@pytest.mark.parametrize("seconds", [-1, WAIT_MAX_SECONDS + 1])
def test_wait_seconds_outside_its_bounds_is_a_422(world: World, seconds: int) -> None:
    assert world.wait(world.open_job(), f"wait_seconds={seconds}").status_code == 422


def test_wait_seconds_defaults_to_the_service_default() -> None:
    assert JobWaitQuery().wait_seconds == WAIT_DEFAULT_SECONDS


@pytest.mark.parametrize("suffix", ["", ":alive"])
def test_a_malformed_job_id_answers_404_on_wait_and_stop(world: World, suffix: str) -> None:
    bad_id = world.open_job() + suffix if suffix else "no-such-job"

    for response in (world.wait(bad_id), world.stop(bad_id)):
        assert response.status_code == 404
        assert response.get_json()["code"] == OpenApiErrorCode.JOB_NOT_FOUND


def test_a_finished_job_of_an_op_that_takes_no_conversation_offers_no_reply(world: World) -> None:
    job_id = world.open_job(
        mode=AppMode.ADVANCED_CHAT,
        op=op_of(OpenApiWorkflowEventsApi.get),
        ids=JobIds(conversation_id="c1"),
        ending=JobEnding(status=JobStatus.SUCCEEDED),
    )

    body = world.wait(job_id).get_json()

    assert (body["conversation_id"], body["hints"]) == ("c1", [])


def test_a_paused_job_whose_form_this_login_cannot_answer_says_a_human_must_answer_it(world: World) -> None:
    console_only = FORM.model_copy(update={"data": FORM.data.model_copy(update={"form_token": None})})
    job_id = world.open_job(ids=JobIds(task_id=TASK_ID, run_id=RUN_ID))
    _pause_run(world, console_only)

    body = world.wait(job_id).get_json()

    assert body["status"] == "paused"
    assert body["note"] == jobs.CONSOLE_FORM_NOTE
    assert body["hints"] == [_wait_hint(job_id, world.client.app_id, jobs.CONSOLE_FORM_WAIT_SUMMARY)]


def test_an_answerable_form_carries_no_note(world: World) -> None:
    job_id = world.open_job(ids=JobIds(task_id=TASK_ID, run_id=RUN_ID))
    _pause_run(world, FORM)

    assert world.wait(job_id).get_json()["note"] is None


def test_wait_and_stop_skip_the_web_access_check(openapi_app: Flask) -> None:
    specs = {spec.catalog.op: spec for _, _, fn in iter_handlers(openapi_app) if (spec := spec_of(fn)) is not None}

    for op in (WAIT_JOB_OP, STOP_JOB_OP):
        assert not any(isinstance(requirement, CheckAppAccess) for requirement in specs[op].requirements)
        assert specs[op].requirements == app_run.JOB_GUARDS
