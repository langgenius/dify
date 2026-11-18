import json
import threading
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import override

import pytest
from flask import Flask

from core.app.entities.task_entities import StreamEvent
from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.app_task_service import WorkflowStopOutcome
from services.run_job_contracts import JobEnding, JobFailure, JobIds, JobOwner, JobRecord, JobStatus, OpenedJob
from services.run_job_service import (
    POLL_INTERVAL_SECONDS,
    READER_THREAD_NAME,
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


class BrokenStore(RedisRunJobStore):
    def __init__(self) -> None:
        super().__init__(redis_client=InMemoryRedis())

    @override
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
def request_context() -> Iterator[None]:
    with Flask(__name__).test_request_context():
        yield


def _record(mode: AppMode = AppMode.WORKFLOW) -> JobRecord:
    return JobRecord(id=str(uuid.uuid4()), owner=OWNER, mode=mode, op="start.test")


def _job(harness: Harness, mode: AppMode = AppMode.WORKFLOW) -> OpenedJob:
    """Store a running job as start would, without launching a run."""
    return harness.store.open(_record(mode), idempotency_key=None)


@dataclass
class Launches:
    """Counts launches and hands out a stream that holds until released."""

    release: threading.Event = field(default_factory=threading.Event)
    count: int = 0

    def __call__(self) -> Iterator[str]:
        self.count += 1
        return self._held()

    def _held(self) -> Iterator[str]:
        self.release.wait(THREAD_TIMEOUT)
        yield from ()


class ClosableFrames:
    def __init__(self) -> None:
        self.closed = False

    def __iter__(self) -> Iterator[str]:
        return iter(())

    def close(self) -> None:
        self.closed = True


def _join_readers() -> None:
    for thread in threading.enumerate():
        if thread.name == READER_THREAD_NAME:
            thread.join(THREAD_TIMEOUT)


@pytest.mark.usefixtures("request_context")
def test_start_fails_before_any_run_when_the_store_is_unavailable() -> None:
    broken = RunJobService(
        store=BrokenStore(),
        results=InMemoryRunResults(),
        tasks=RecordingTaskControl(),
        max_background_runs=1,
        max_waiters=1,
    )
    launches = Launches()

    with pytest.raises(ConnectionError):
        broken.start(_opening(), launches)

    assert launches.count == 0


@pytest.mark.usefixtures("request_context")
def test_start_reads_the_stream_on_a_daemon_thread_and_frees_its_slot() -> None:
    harness = _harness(max_background_runs=1)
    launches = Launches()

    harness.service.start(_opening(), launches)
    readers = [thread for thread in threading.enumerate() if thread.name == READER_THREAD_NAME]
    launches.release.set()
    _join_readers()
    harness.service.start(_opening(), launches)
    _join_readers()

    assert readers
    assert all(thread.daemon for thread in readers)
    assert launches.count == 2


@pytest.mark.usefixtures("request_context")
def test_start_records_what_the_reader_reads() -> None:
    harness = _harness(max_background_runs=1)
    frame = f"data: {json.dumps({'event': StreamEvent.MESSAGE_END.value, 'task_id': 'task-1'})}\n\n"

    record = harness.service.start(_opening(AppMode.CHAT), lambda: [frame])
    _join_readers()

    stored = harness.store.get(record.id)
    assert stored is not None
    assert (stored.status, stored.task_id) == (JobStatus.SUCCEEDED, "task-1")


@pytest.mark.usefixtures("request_context")
def test_start_at_the_cap_refuses_before_launching_and_leaves_no_job() -> None:
    harness = _harness(max_background_runs=1)
    launches = Launches()
    first = harness.service.start(_opening(), launches)
    try:
        with pytest.raises(JobCapacityError):
            harness.service.start(_opening(key="refused"), launches)
    finally:
        launches.release.set()
        _join_readers()

    assert launches.count == 1
    assert list(harness.redis.hashes) == [f"openapi:job:{first.id}"]
    harness.service.start(_opening(key="refused"), lambda: [])
    _join_readers()


@pytest.mark.usefixtures("request_context")
def test_start_with_a_used_key_returns_the_first_job_without_launching_or_a_slot() -> None:
    harness = _harness(max_background_runs=1)
    launches = Launches()
    try:
        first = harness.service.start(_opening(key="k"), launches)
        again = harness.service.start(_opening(key="k"), launches)
    finally:
        launches.release.set()
        _join_readers()

    assert again.id == first.id
    assert launches.count == 1


@pytest.mark.usefixtures("request_context")
def test_a_failed_launch_frees_the_slot_and_leaves_no_job() -> None:
    harness = _harness(max_background_runs=1)

    def fail() -> list[str]:
        raise ValueError("variable abc is bad")

    with pytest.raises(ValueError, match="abc"):
        harness.service.start(_opening(key="k"), fail)

    assert harness.redis.hashes == {}
    assert harness.redis.values == {}
    harness.service.start(_opening(key="k"), lambda: [])
    _join_readers()


def test_a_reader_that_cannot_start_closes_the_stream_frees_the_slot_and_leaves_no_job() -> None:
    harness = _harness(max_background_runs=1)
    frames = ClosableFrames()

    # Outside a request context the reader cannot copy the request context, so its thread never starts.
    with pytest.raises(RuntimeError):
        harness.service.start(_opening(), lambda: frames)

    assert frames.closed
    assert harness.redis.hashes == {}
    with Flask(__name__).test_request_context():
        harness.service.start(_opening(), lambda: [])
    _join_readers()


def test_view_of_a_graph_job_with_an_invisible_run_uses_the_record() -> None:
    harness = _harness()
    opened = _job(harness)
    harness.store.record_ids(opened.record.id, JobIds(run_id="run-1"))
    harness.store.settle(opened.record.id, JobEnding(status=JobStatus.STOPPED))

    view = harness.service.view(OWNER, opened.record.id)

    assert (view.status, view.form) == (JobStatus.STOPPED, None)


def test_stop_of_a_final_job_sends_nothing() -> None:
    harness = _harness()
    opened = _job(harness)
    harness.store.record_ids(opened.record.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED)

    view = harness.service.stop(OWNER, opened.record.id)

    assert view.status is JobStatus.SUCCEEDED
    assert harness.tasks.workflow_stops == []
    stored = harness.store.get(opened.record.id)
    assert stored is not None
    assert stored.stop_requested is False


def test_stop_of_a_paused_job_still_stops_the_run() -> None:
    harness = _harness()
    opened = _job(harness)
    harness.store.record_ids(opened.record.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)

    harness.service.stop(OWNER, opened.record.id)

    assert [stop.run_id for stop in harness.tasks.workflow_stops] == ["run-1"]


def test_view_hides_a_job_from_another_owner() -> None:
    harness = _harness()
    opened = _job(harness)

    with pytest.raises(JobNotFoundError):
        harness.service.view(OTHER, opened.record.id)
    with pytest.raises(JobNotFoundError):
        harness.service.view(OWNER, "missing")


def test_view_of_a_graph_job_reads_status_and_outputs_from_the_run() -> None:
    harness = _harness()
    opened = _job(harness)
    harness.store.record_ids(opened.record.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED, outputs={"text": "hi"})

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.SUCCEEDED
    assert view.outputs == {"text": "hi"}
    assert view.error is None


def test_view_of_a_paused_graph_job_carries_the_pending_form() -> None:
    harness = _harness()
    opened = _job(harness)
    harness.store.record_ids(opened.record.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)
    harness.results.forms[("t1", "a1", "run-1", AppMode.WORKFLOW)] = {"form_id": "f1"}

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.PAUSED
    assert view.form == {"form_id": "f1"}


def test_view_of_a_graph_job_without_a_run_id_uses_the_record() -> None:
    harness = _harness()
    opened = _job(harness)

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.RUNNING
    assert view.outputs is None


def _lapse_alive_key(harness: Harness, job_id: str) -> None:
    harness.redis.delete(f"openapi:job:{job_id}:alive")


def test_view_of_a_graph_job_without_a_run_id_and_without_a_reader_fails_and_is_saved() -> None:
    harness = _harness()
    opened = _job(harness)
    _lapse_alive_key(harness, opened.record.id)

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.FAILED
    assert view.error == JobFailure.RUN_NOT_CONFIRMED.message
    stored = harness.store.get(opened.record.id)
    assert stored is not None
    assert (stored.status, stored.failure) == (JobStatus.FAILED, JobFailure.RUN_NOT_CONFIRMED)


def test_view_of_a_graph_job_without_a_run_id_and_with_a_live_reader_keeps_running() -> None:
    harness = _harness()
    opened = _job(harness)

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.RUNNING
    assert view.error is None


def test_view_of_a_graph_job_with_a_run_id_ignores_the_alive_key() -> None:
    harness = _harness()
    opened = _job(harness)
    harness.store.record_ids(opened.record.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED, outputs={"x": 1})
    _lapse_alive_key(harness, opened.record.id)

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.SUCCEEDED
    assert view.outputs == {"x": 1}
    assert view.error is None


def test_wait_returns_at_once_for_a_graph_job_whose_run_start_was_not_confirmed() -> None:
    harness = _harness()
    opened = _job(harness)
    _lapse_alive_key(harness, opened.record.id)

    view = harness.service.wait(OWNER, opened.record.id, wait_seconds=10)

    assert view.status is JobStatus.FAILED
    assert harness.clock.slept == []


def test_a_graph_job_reported_not_confirmed_never_changes_when_its_run_appears_later() -> None:
    harness = _harness()
    opened = _job(harness)
    _lapse_alive_key(harness, opened.record.id)
    reported = harness.service.view(OWNER, opened.record.id)
    harness.store.record_ids(opened.record.id, JobIds(run_id="run-1"))
    harness.store.touch(opened.record.id)
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED, outputs={"x": 1})

    later = harness.service.view(OWNER, opened.record.id)

    not_confirmed = JobFailure.RUN_NOT_CONFIRMED.message
    assert (reported.status, reported.error) == (JobStatus.FAILED, not_confirmed)
    assert (later.status, later.error, later.outputs) == (JobStatus.FAILED, not_confirmed, None)


def test_a_run_error_with_the_not_confirmed_text_is_still_read_from_the_run() -> None:
    harness = _harness()
    opened = _job(harness)
    text = JobFailure.RUN_NOT_CONFIRMED.message
    harness.store.record_ids(opened.record.id, JobIds(run_id="run-1"))
    harness.store.settle(opened.record.id, JobEnding(status=JobStatus.FAILED, error=text))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.FAILED, outputs={"x": 1}, error=text)

    view = harness.service.view(OWNER, opened.record.id)

    assert (view.status, view.outputs, view.error) == (JobStatus.FAILED, {"x": 1}, text)


def test_view_of_a_message_job_uses_the_record() -> None:
    harness = _harness()
    opened = _job(harness, AppMode.CHAT)
    harness.store.settle(opened.record.id, JobEnding(status=JobStatus.FAILED, error="boom"))

    view = harness.service.view(OWNER, opened.record.id)

    assert view.status is JobStatus.FAILED
    assert view.error == "boom"


def test_wait_zero_never_sleeps() -> None:
    harness = _harness()
    opened = _job(harness)

    view = harness.service.wait(OWNER, opened.record.id, wait_seconds=0)

    assert view.status is JobStatus.RUNNING
    assert harness.clock.slept == []


def test_wait_returns_as_soon_as_the_job_is_final() -> None:
    harness = _harness()
    opened = _job(harness, AppMode.CHAT)
    harness.store.settle(opened.record.id, JobEnding(status=JobStatus.SUCCEEDED))

    view = harness.service.wait(OWNER, opened.record.id, wait_seconds=10)

    assert view.status is JobStatus.SUCCEEDED
    assert harness.clock.slept == []


def test_wait_gives_up_after_wait_seconds_and_reports_running() -> None:
    harness = _harness()
    opened = _job(harness)

    view = harness.service.wait(OWNER, opened.record.id, wait_seconds=3)

    assert view.status is JobStatus.RUNNING
    assert harness.clock.slept == [POLL_INTERVAL_SECONDS] * 3


def test_wait_is_clamped_to_the_cap() -> None:
    harness = _harness()
    opened = _job(harness)

    harness.service.wait(OWNER, opened.record.id, wait_seconds=600)

    assert sum(harness.clock.slept) == WAIT_MAX_SECONDS


def test_wait_returns_when_the_job_pauses() -> None:
    harness = _harness()
    opened = _job(harness)
    harness.store.record_ids(opened.record.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)
    harness.results.forms[("t1", "a1", "run-1", AppMode.WORKFLOW)] = {"form_id": "f"}

    view = harness.service.wait(OWNER, opened.record.id, wait_seconds=10)

    assert view.status is JobStatus.PAUSED
    assert view.form == {"form_id": "f"}
    assert harness.clock.slept == []


def test_wait_keeps_polling_a_paused_job_without_a_waiting_form() -> None:
    harness = _harness()
    opened = _job(harness)
    harness.store.record_ids(opened.record.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)

    view = harness.service.wait(OWNER, opened.record.id, wait_seconds=3)

    assert view.status is JobStatus.PAUSED
    assert harness.clock.slept == [POLL_INTERVAL_SECONDS] * 3


def test_wait_answers_at_once_when_the_waiter_cap_is_full() -> None:
    clock = FakeClock()
    nested: dict[str, object] = {}

    def sleep_then_wait_again(seconds: float) -> None:
        clock.sleep(seconds)
        if nested:
            return
        nested["before"] = clock.now
        nested["view"] = service.wait(OWNER, nested_id, wait_seconds=10)
        nested["after"] = clock.now

    store = RedisRunJobStore(redis_client=InMemoryRedis())
    service = RunJobService(
        store=store,
        results=InMemoryRunResults(),
        tasks=RecordingTaskControl(),
        max_background_runs=1,
        max_waiters=1,
        sleep=sleep_then_wait_again,
        monotonic=clock.monotonic,
    )
    nested_id = store.open(_record(), idempotency_key=None).record.id

    service.wait(OWNER, nested_id, wait_seconds=2)

    assert nested["before"] == nested["after"]


def test_wait_releases_its_waiter_slot() -> None:
    harness = _harness(max_waiters=1)
    opened = _job(harness)

    harness.service.wait(OWNER, opened.record.id, wait_seconds=1)
    harness.service.wait(OWNER, opened.record.id, wait_seconds=1)

    assert harness.clock.slept == [POLL_INTERVAL_SECONDS] * 2


def test_stop_before_the_ids_arrive_only_records_the_request() -> None:
    harness = _harness()
    opened = _job(harness)

    harness.service.stop(OWNER, opened.record.id)

    stored = harness.store.get(opened.record.id)
    assert stored is not None
    assert stored.stop_requested is True
    assert harness.tasks.workflow_stops == []
    assert harness.tasks.message_stops == []


def test_stop_of_a_graph_job_stops_the_run_and_of_a_message_job_the_task() -> None:
    harness = _harness()
    graph = _job(harness, AppMode.WORKFLOW)
    message = _job(harness, AppMode.CHAT)
    harness.store.record_ids(graph.record.id, JobIds(run_id="run-1", task_id="task-g"))
    harness.store.record_ids(message.record.id, JobIds(task_id="task-m"))

    harness.service.stop(OWNER, graph.record.id)
    view = harness.service.stop(OWNER, message.record.id)

    assert [stop.run_id for stop in harness.tasks.workflow_stops] == ["run-1"]
    assert harness.tasks.workflow_stops[0].caller_id == OWNER.caller_id
    assert harness.tasks.workflow_stops[0].app_mode is AppMode.WORKFLOW
    assert [stop.task_id for stop in harness.tasks.message_stops] == ["task-m"]
    assert view.record.stop_requested is True


def test_stop_hides_a_job_from_another_owner() -> None:
    harness = _harness()
    opened = _job(harness)

    with pytest.raises(JobNotFoundError):
        harness.service.stop(OTHER, opened.record.id)


class StopFlipsRunTaskControl(RecordingTaskControl):
    def __init__(self, results: InMemoryRunResults) -> None:
        super().__init__()
        self._results = results

    @override
    def stop_workflow_run(
        self,
        *,
        tenant_id: str,
        app_id: str,
        run_id: str,
        app_mode: AppMode,
        caller_role: CreatorUserRole,
        caller_id: str,
    ) -> WorkflowStopOutcome:
        self._results.runs[(tenant_id, run_id)] = RunResult(status=JobStatus.STOPPED)
        return super().stop_workflow_run(
            tenant_id=tenant_id,
            app_id=app_id,
            run_id=run_id,
            app_mode=app_mode,
            caller_role=caller_role,
            caller_id=caller_id,
        )


def test_stop_returns_the_view_after_the_stop() -> None:
    harness = _harness()
    harness.service._stopper = TaskControlStopper(StopFlipsRunTaskControl(harness.results))
    opened = _job(harness)
    harness.store.record_ids(opened.record.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)
    harness.results.forms[("t1", "a1", "run-1", AppMode.WORKFLOW)] = {"form_id": "f"}

    view = harness.service.stop(OWNER, opened.record.id)

    assert view.status is JobStatus.STOPPED
    assert view.form is None
    assert view.record.stop_requested is True


class IdsArriveWhileStoppingStore(RedisRunJobStore):
    """Stores the run ids right after the stop flag, as the reader thread would."""

    @override
    def request_stop(self, job_id: str) -> None:
        super().request_stop(job_id)
        self.record_ids(job_id, JobIds(run_id="run-1", task_id="task-1"))


def test_stop_sends_the_stop_when_the_ids_arrive_while_it_is_recording_the_request() -> None:
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
    opened = racing.open(_record(), idempotency_key=None)

    service.stop(OWNER, opened.record.id)

    assert [stop.run_id for stop in harness.tasks.workflow_stops] == ["run-1"]
