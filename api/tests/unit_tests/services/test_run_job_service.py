import json
import threading
from dataclasses import dataclass, field

import pytest
from flask import Flask

from core.app.entities.task_entities import StreamEvent
from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.run_job_contracts import JobOwner, JobPatch, JobRecord, JobStatus, OpenedJob
from services.run_job_service import (
    POLL_INTERVAL_SECONDS,
    RUN_NOT_CONFIRMED,
    WAIT_MAX_SECONDS,
    JobCapacityError,
    JobNotFoundError,
    JobOpening,
    RunJobService,
    RunResult,
    TaskControlStopper,
)
from tests.unit_tests.services.run_job_fakes import InMemoryRedis, InMemoryRunResults, RecordingTaskControl

OWNER = JobOwner(tenant_id="t1", app_id="a1", caller_role=CreatorUserRole.ACCOUNT, caller_id="u1")
OTHER = JobOwner(tenant_id="t1", app_id="a1", caller_role=CreatorUserRole.ACCOUNT, caller_id="u2")
THREAD_TIMEOUT = 5


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


class DiscardFailsStore:
    def __init__(self, inner: RedisRunJobStore) -> None:
        self._inner = inner
        self.fail = True

    def open(self, record: JobRecord, *, idempotency_key: str | None) -> OpenedJob:
        return self._inner.open(record, idempotency_key=idempotency_key)

    def discard(self, job_id: str, *, idempotency_key: str | None) -> None:
        if self.fail:
            raise ConnectionError("redis down")
        self._inner.discard(job_id, idempotency_key=idempotency_key)


class BrokenStore:
    def open(self, record: JobRecord, *, idempotency_key: str | None) -> OpenedJob:
        raise ConnectionError(f"redis down for {record.id} {idempotency_key}")


@dataclass
class Harness:
    service: RunJobService
    store: RedisRunJobStore
    results: InMemoryRunResults
    tasks: RecordingTaskControl
    redis: InMemoryRedis
    clock: FakeClock = field(default_factory=FakeClock)


def _harness(*, max_background_runs: int = 10, max_waiters: int = 4) -> Harness:
    clock = FakeClock()
    redis = InMemoryRedis()
    store = RedisRunJobStore(redis_client=redis)
    results = InMemoryRunResults()
    tasks = RecordingTaskControl()
    service = RunJobService(
        store=store,
        results=results,
        tasks=tasks,
        max_background_runs=max_background_runs,
        max_waiters=max_waiters,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
    )
    return Harness(service=service, store=store, results=results, tasks=tasks, redis=redis, clock=clock)


def _opening(mode: AppMode = AppMode.WORKFLOW, key: str | None = None) -> JobOpening:
    return JobOpening(owner=OWNER, mode=mode, op="start.test", idempotency_key=key)


@pytest.fixture
def request_context():
    with Flask(__name__).test_request_context():
        yield


@pytest.mark.usefixtures("request_context")
def test_open_fails_before_any_run_when_the_store_is_unavailable():
    broken = RunJobService(
        store=BrokenStore(),
        results=InMemoryRunResults(),
        tasks=RecordingTaskControl(),
        max_background_runs=1,
        max_waiters=1,
    )
    threads_before = threading.active_count()

    with pytest.raises(ConnectionError):
        broken.open(_opening())

    assert threading.active_count() == threads_before
    working = _harness(max_background_runs=1)
    assert working.service.open(_opening()).created is True


def test_discard_releases_the_slot_even_when_the_store_raises():
    store = DiscardFailsStore(RedisRunJobStore(redis_client=InMemoryRedis()))
    service = RunJobService(
        store=store, results=InMemoryRunResults(), tasks=RecordingTaskControl(), max_background_runs=1, max_waiters=1
    )
    opened = service.open(_opening())

    with pytest.raises(ConnectionError):
        service.discard(opened, idempotency_key=None)
    store.fail = False

    assert service.open(_opening()).created is True


@pytest.mark.usefixtures("request_context")
def test_attach_refuses_a_job_it_holds_no_slot_for():
    harness = _harness(max_background_runs=1)
    first = harness.service.open(_opening(key="k"))
    again = harness.service.open(_opening(key="k"))

    with pytest.raises(ValueError, match="reserved"):
        harness.service.attach(again.record.id + "-unknown", [])
    harness.service.attach(first.record.id, []).join(THREAD_TIMEOUT)

    assert harness.service.open(_opening()).created is True


def test_view_of_a_finished_graph_run_drops_the_stale_record_form():
    harness = _harness()
    opened = harness.service.open(_opening())
    harness.store.patch(opened.record.id, JobPatch(run_id="run-1", form={"form_id": "old"}))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED)

    view = harness.service.view(OWNER, opened.record.id)

    assert view.form is None


def test_view_of_a_graph_job_with_an_invisible_run_uses_the_record():
    harness = _harness()
    opened = harness.service.open(_opening())
    harness.store.patch(opened.record.id, JobPatch(run_id="run-1", status=JobStatus.PAUSED, form={"form_id": "f"}))

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.PAUSED
    assert view.form == {"form_id": "f"}


def test_stop_of_a_final_job_sends_nothing():
    harness = _harness()
    opened = harness.service.open(_opening())
    harness.store.patch(opened.record.id, JobPatch(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED)

    view = harness.service.stop(OWNER, opened.record.id)

    assert view.status is JobStatus.SUCCEEDED
    assert harness.tasks.workflow_stops == []
    stored = harness.store.get(opened.record.id)
    assert stored is not None
    assert stored.stop_requested is False


def test_stop_of_a_paused_job_still_stops_the_run():
    harness = _harness()
    opened = harness.service.open(_opening())
    harness.store.patch(opened.record.id, JobPatch(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)

    harness.service.stop(OWNER, opened.record.id)

    assert [stop.run_id for stop in harness.tasks.workflow_stops] == ["run-1"]


def test_open_refuses_a_new_job_at_the_background_cap():
    harness = _harness(max_background_runs=1)
    first = harness.service.open(_opening())

    with pytest.raises(JobCapacityError):
        harness.service.open(_opening())

    assert harness.store.get(first.record.id) is not None


def test_open_with_a_used_key_does_not_take_a_slot():
    harness = _harness(max_background_runs=1)
    first = harness.service.open(_opening(key="k"))

    again = harness.service.open(_opening(key="k"))

    assert again.created is False
    assert again.record.id == first.record.id
    harness.service.discard(first, idempotency_key="k")
    assert harness.service.open(_opening()).created is True


def test_discard_releases_the_reserved_slot():
    harness = _harness(max_background_runs=1)
    first = harness.service.open(_opening())
    harness.service.discard(first, idempotency_key=None)

    assert harness.store.get(first.record.id) is None
    assert harness.service.open(_opening()).created is True


def test_refused_open_leaves_no_job_and_no_slot_behind():
    harness = _harness(max_background_runs=1)
    first = harness.service.open(_opening())
    with pytest.raises(JobCapacityError):
        harness.service.open(_opening(key="refused"))

    harness.service.discard(first, idempotency_key=None)

    assert harness.service.open(_opening(key="refused")).created is True


@pytest.mark.usefixtures("request_context")
def test_attach_reads_the_stream_on_another_thread_and_frees_its_slot():
    harness = _harness(max_background_runs=1)
    opened = harness.service.open(_opening(AppMode.CHAT))
    frame = f"data: {json.dumps({'event': StreamEvent.MESSAGE_END.value, 'task_id': 'task-1'})}\n\n"

    thread = harness.service.attach(opened.record.id, [frame])
    thread.join(THREAD_TIMEOUT)

    assert not thread.is_alive()
    assert thread.daemon is True
    stored = harness.store.get(opened.record.id)
    assert stored is not None
    assert stored.status is JobStatus.SUCCEEDED
    assert stored.task_id == "task-1"
    assert harness.service.open(_opening()).created is True


def test_view_hides_a_job_from_another_owner():
    harness = _harness()
    opened = harness.service.open(_opening())

    with pytest.raises(JobNotFoundError):
        harness.service.view(OTHER, opened.record.id)
    with pytest.raises(JobNotFoundError):
        harness.service.view(OWNER, "missing")


def test_view_of_a_graph_job_reads_status_and_outputs_from_the_run():
    harness = _harness()
    opened = harness.service.open(_opening())
    harness.store.patch(opened.record.id, JobPatch(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED, outputs={"text": "hi"})

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.SUCCEEDED
    assert view.outputs == {"text": "hi"}
    assert view.error is None


def test_view_of_a_paused_graph_job_carries_the_pending_form():
    harness = _harness()
    opened = harness.service.open(_opening())
    harness.store.patch(opened.record.id, JobPatch(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)
    harness.results.forms[("t1", "a1", "run-1", AppMode.WORKFLOW)] = {"form_id": "f1"}

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.PAUSED
    assert view.form == {"form_id": "f1"}


def test_view_of_a_graph_job_without_a_run_id_uses_the_record():
    harness = _harness()
    opened = harness.service.open(_opening())

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.RUNNING
    assert view.outputs is None


def _lapse_alive_key(harness: Harness, job_id: str) -> None:
    harness.redis.delete(f"openapi:job:{job_id}:alive")


def test_view_of_a_graph_job_without_a_run_id_and_without_a_reader_fails_and_is_saved():
    harness = _harness()
    opened = harness.service.open(_opening())
    _lapse_alive_key(harness, opened.record.id)

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.FAILED
    assert view.error == RUN_NOT_CONFIRMED
    stored = harness.store.get(opened.record.id)
    assert stored is not None
    assert (stored.status, stored.error) == (JobStatus.FAILED, RUN_NOT_CONFIRMED)


def test_view_of_a_graph_job_without_a_run_id_and_with_a_live_reader_keeps_running():
    harness = _harness()
    opened = harness.service.open(_opening())

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.RUNNING
    assert view.error is None


def test_view_of_a_graph_job_with_a_run_id_ignores_the_alive_key():
    harness = _harness()
    opened = harness.service.open(_opening())
    harness.store.patch(opened.record.id, JobPatch(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED, outputs={"x": 1})
    _lapse_alive_key(harness, opened.record.id)

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.SUCCEEDED
    assert view.outputs == {"x": 1}
    assert view.error is None


def test_wait_returns_at_once_for_a_graph_job_whose_run_start_was_not_confirmed():
    harness = _harness()
    opened = harness.service.open(_opening())
    _lapse_alive_key(harness, opened.record.id)

    view = harness.service.wait(OWNER, opened.record.id, wait_seconds=10)

    assert view.status is JobStatus.FAILED
    assert harness.clock.slept == []


def test_view_of_a_message_job_uses_the_record():
    harness = _harness()
    opened = harness.service.open(_opening(AppMode.CHAT))
    harness.store.patch(opened.record.id, JobPatch(status=JobStatus.FAILED, error="boom"))

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.FAILED
    assert view.error == "boom"


def test_wait_zero_never_sleeps():
    harness = _harness()
    opened = harness.service.open(_opening())

    view = harness.service.wait(OWNER, opened.record.id, wait_seconds=0)

    assert view.status is JobStatus.RUNNING
    assert harness.clock.slept == []


def test_wait_returns_as_soon_as_the_job_is_final():
    harness = _harness()
    opened = harness.service.open(_opening(AppMode.CHAT))
    harness.store.patch(opened.record.id, JobPatch(status=JobStatus.SUCCEEDED))

    view = harness.service.wait(OWNER, opened.record.id, wait_seconds=10)

    assert view.status is JobStatus.SUCCEEDED
    assert harness.clock.slept == []


def test_wait_gives_up_after_wait_seconds_and_reports_running():
    harness = _harness()
    opened = harness.service.open(_opening())

    view = harness.service.wait(OWNER, opened.record.id, wait_seconds=3)

    assert view.status is JobStatus.RUNNING
    assert harness.clock.slept == [POLL_INTERVAL_SECONDS] * 3


def test_wait_is_clamped_to_the_cap():
    harness = _harness()
    opened = harness.service.open(_opening())

    harness.service.wait(OWNER, opened.record.id, wait_seconds=600)

    assert sum(harness.clock.slept) == WAIT_MAX_SECONDS


def test_wait_returns_when_the_job_pauses():
    harness = _harness()
    opened = harness.service.open(_opening())
    harness.store.patch(opened.record.id, JobPatch(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)
    harness.results.forms[("t1", "a1", "run-1", AppMode.WORKFLOW)] = {"form_id": "f"}

    view = harness.service.wait(OWNER, opened.record.id, wait_seconds=10)

    assert view.status is JobStatus.PAUSED
    assert view.form == {"form_id": "f"}
    assert harness.clock.slept == []


def test_wait_keeps_polling_a_paused_job_without_a_waiting_form():
    harness = _harness()
    opened = harness.service.open(_opening())
    harness.store.patch(opened.record.id, JobPatch(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)

    view = harness.service.wait(OWNER, opened.record.id, wait_seconds=3)

    assert view.status is JobStatus.PAUSED
    assert harness.clock.slept == [POLL_INTERVAL_SECONDS] * 3


def test_wait_answers_at_once_when_the_waiter_cap_is_full():
    clock = FakeClock()
    nested: dict[str, object] = {}

    def sleep_then_wait_again(seconds: float) -> None:
        clock.sleep(seconds)
        if nested:
            return
        nested["before"] = clock.now
        nested["view"] = service.wait(OWNER, nested_id, wait_seconds=10)
        nested["after"] = clock.now

    service = RunJobService(
        store=RedisRunJobStore(redis_client=InMemoryRedis()),
        results=InMemoryRunResults(),
        tasks=RecordingTaskControl(),
        max_background_runs=1,
        max_waiters=1,
        sleep=sleep_then_wait_again,
        monotonic=clock.monotonic,
    )
    nested_id = service.open(_opening()).record.id

    service.wait(OWNER, nested_id, wait_seconds=2)

    assert nested["before"] == nested["after"]


def test_wait_releases_its_waiter_slot():
    harness = _harness(max_waiters=1)
    opened = harness.service.open(_opening())

    harness.service.wait(OWNER, opened.record.id, wait_seconds=1)
    harness.service.wait(OWNER, opened.record.id, wait_seconds=1)

    assert harness.clock.slept == [POLL_INTERVAL_SECONDS] * 2


def test_stop_before_the_ids_arrive_only_records_the_request():
    harness = _harness()
    opened = harness.service.open(_opening())

    harness.service.stop(OWNER, opened.record.id)

    stored = harness.store.get(opened.record.id)
    assert stored is not None
    assert stored.stop_requested is True
    assert harness.tasks.workflow_stops == []
    assert harness.tasks.message_stops == []


def test_stop_of_a_graph_job_stops_the_run_and_of_a_message_job_the_task():
    harness = _harness()
    graph = harness.service.open(_opening(AppMode.WORKFLOW))
    message = harness.service.open(_opening(AppMode.CHAT))
    harness.store.patch(graph.record.id, JobPatch(run_id="run-1", task_id="task-g"))
    harness.store.patch(message.record.id, JobPatch(task_id="task-m"))

    harness.service.stop(OWNER, graph.record.id)
    view = harness.service.stop(OWNER, message.record.id)

    assert [stop.run_id for stop in harness.tasks.workflow_stops] == ["run-1"]
    assert harness.tasks.workflow_stops[0].caller_id == OWNER.caller_id
    assert harness.tasks.workflow_stops[0].app_mode is AppMode.WORKFLOW
    assert [stop.task_id for stop in harness.tasks.message_stops] == ["task-m"]
    assert view.record.stop_requested is True


def test_stop_hides_a_job_from_another_owner():
    harness = _harness()
    opened = harness.service.open(_opening())

    with pytest.raises(JobNotFoundError):
        harness.service.stop(OTHER, opened.record.id)


class StopFlipsRunTaskControl(RecordingTaskControl):
    def __init__(self, results: InMemoryRunResults) -> None:
        super().__init__()
        self._results = results

    def stop_workflow_run(self, **kwargs):
        self._results.runs[(kwargs["tenant_id"], kwargs["run_id"])] = RunResult(status=JobStatus.STOPPED)
        return super().stop_workflow_run(**kwargs)


def test_stop_returns_the_view_after_the_stop():
    harness = _harness()
    harness.service._stopper = TaskControlStopper(StopFlipsRunTaskControl(harness.results))
    opened = harness.service.open(_opening())
    harness.store.patch(opened.record.id, JobPatch(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)
    harness.results.forms[("t1", "a1", "run-1", AppMode.WORKFLOW)] = {"form_id": "f"}

    view = harness.service.stop(OWNER, opened.record.id)

    assert view.status is JobStatus.STOPPED
    assert view.form is None
    assert view.record.stop_requested is True


class IdsArriveWhileStoppingStore(RedisRunJobStore):
    """Stores the run ids right after the stop flag, as the reader thread would."""

    def patch(self, job_id: str, patch: JobPatch) -> None:
        super().patch(job_id, patch)
        if patch.stop_requested:
            super().patch(job_id, JobPatch(run_id="run-1", task_id="task-1"))


def test_stop_sends_the_stop_when_the_ids_arrive_while_it_is_recording_the_request():
    harness = _harness()
    racing = IdsArriveWhileStoppingStore(redis_client=InMemoryRedis())
    service = RunJobService(
        store=racing,
        results=harness.results,
        tasks=harness.tasks,
        max_background_runs=1,
        max_waiters=1,
        sleep=harness.clock.sleep,
        monotonic=harness.clock.monotonic,
    )
    opened = service.open(_opening())

    service.stop(OWNER, opened.record.id)

    assert [stop.run_id for stop in harness.tasks.workflow_stops] == ["run-1"]
