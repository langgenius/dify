import json
import threading
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import override

import pytest

from configs import dify_config
from core.app.entities.task_entities import StreamEvent
from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.app_task_service import WorkflowStopOutcome
from services.run_job.contracts import JobEnding, JobFailure, JobIds, JobOwner, JobRecord, JobStatus
from services.run_job.service import (
    GRAPH_JOBS,
    MESSAGE_JOBS,
    POLL_INTERVAL_SECONDS,
    READER_THREAD_NAME,
    RUN_TIME_LIMIT_MARGIN,
    JobCapacityError,
    JobNotFoundError,
    JobOpening,
    MessageResult,
    ReaderStarter,
    RunJobService,
    RunResult,
    family_of,
)
from tests.unit_tests.services.run_job.fakes import (
    RUN_TIME_LIMIT,
    ClosableFrames,
    InMemoryRedis,
    InMemoryRunResults,
    RecordingTaskControl,
    human_input_form,
    start_reader_plainly,
)

OWNER = JobOwner(tenant_id="t1", app_id="a1", caller_role=CreatorUserRole.ACCOUNT, caller_id="u1")
OTHER = JobOwner(tenant_id="t1", app_id="a1", caller_role=CreatorUserRole.ACCOUNT, caller_id="u2")
THREAD_TIMEOUT = 5
SAMPLE_OP = "run.sample"


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.wall = datetime(2026, 11, 18, 12, 0, 0)
        self.slept: list[float] = []

    def utc_now(self) -> datetime:
        return self.wall

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


class BrokenStore(RedisRunJobStore):
    def __init__(self) -> None:
        super().__init__(redis_client=InMemoryRedis(), job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)

    @override
    def create(self, record: JobRecord) -> bool:
        raise ConnectionError(f"redis down for {record.id}")


@dataclass
class Harness:
    service: RunJobService
    store: RedisRunJobStore
    results: InMemoryRunResults
    tasks: RecordingTaskControl
    redis: InMemoryRedis
    clock: FakeClock = field(default_factory=FakeClock)


def _harness(
    *,
    max_background_runs: int = 10,
    max_waiters: int = 4,
    store: RedisRunJobStore | None = None,
    start_reader: ReaderStarter = start_reader_plainly,
) -> Harness:
    clock = FakeClock()
    redis = InMemoryRedis()
    store = store or RedisRunJobStore(redis_client=redis, job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)
    results = InMemoryRunResults()
    tasks = RecordingTaskControl()
    service = RunJobService(
        store=store,
        results=results,
        tasks=tasks,
        max_background_runs=max_background_runs,
        max_waiters=max_waiters,
        run_time_limit=RUN_TIME_LIMIT,
        start_reader=start_reader,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
        now=clock.utc_now,
    )
    return Harness(service=service, store=store, results=results, tasks=tasks, redis=redis, clock=clock)


def _opening(mode: AppMode = AppMode.WORKFLOW, key: str | None = None) -> JobOpening:
    return JobOpening(owner=OWNER, mode=mode, op=SAMPLE_OP, idempotency_key=key)


def _record(mode: AppMode = AppMode.WORKFLOW) -> JobRecord:
    return JobRecord(id=str(uuid.uuid4()), owner=OWNER, mode=mode, op=SAMPLE_OP)


def _job(harness: Harness, mode: AppMode = AppMode.WORKFLOW) -> JobRecord:
    """Store a running job as start would, without launching a run."""
    record = _record(mode)
    harness.store.create(record)
    return record


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


def _join_readers() -> None:
    for thread in threading.enumerate():
        if thread.name == READER_THREAD_NAME:
            thread.join(THREAD_TIMEOUT)


def test_start_fails_before_any_run_when_the_store_is_unavailable() -> None:
    launches = Launches()

    with pytest.raises(ConnectionError):
        _harness(store=BrokenStore()).service.start(_opening(), launches)

    assert launches.count == 0


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


def test_start_records_what_the_reader_reads() -> None:
    harness = _harness(max_background_runs=1)
    frame = f"data: {json.dumps({'event': StreamEvent.MESSAGE_END.value, 'task_id': 'task-1'})}\n\n"

    job_id = harness.service.start(_opening(AppMode.CHAT), lambda: [frame])
    _join_readers()

    stored = harness.store.get(job_id)
    assert stored is not None
    assert (stored.status, stored.task_id) == (JobStatus.SUCCEEDED, "task-1")


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
    assert list(harness.redis.hashes) == [f"run_job:{first}"]
    harness.service.start(_opening(key="refused"), lambda: [])
    _join_readers()


def test_start_with_a_used_key_returns_the_first_job_without_launching_or_a_slot() -> None:
    harness = _harness(max_background_runs=1)
    launches = Launches()
    try:
        first = harness.service.start(_opening(key="k"), launches)
        again = harness.service.start(_opening(key="k"), launches)
    finally:
        launches.release.set()
        _join_readers()

    assert again == first
    assert launches.count == 1


def test_a_keyed_job_id_follows_the_owner_and_the_key_and_an_unkeyed_one_is_new_each_time() -> None:
    harness = _harness()
    other_caller = JobOpening(owner=OTHER, mode=AppMode.WORKFLOW, op=SAMPLE_OP, idempotency_key="k")
    other_app = JobOpening(
        owner=JobOwner(tenant_id="t1", app_id="a2", caller_role=CreatorUserRole.ACCOUNT, caller_id="u1"),
        mode=AppMode.WORKFLOW,
        op=SAMPLE_OP,
        idempotency_key="k",
    )

    ids = [
        harness.service.start(opening, lambda: [])
        for opening in (_opening(key="k"), _opening(key="k"), other_caller, other_app, _opening(), _opening())
    ]
    _join_readers()

    assert ids[0] == ids[1]
    assert len(set(ids)) == 5
    assert all(str(uuid.UUID(job_id)) == job_id for job_id in ids)


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


@dataclass
class RefusesFirstStart:
    """A reader starter that cannot start its first reader and starts the rest plainly."""

    refused: bool = False

    def __call__(self, read: Callable[[], None]) -> None:
        if not self.refused:
            self.refused = True
            raise RuntimeError("cannot start a thread")
        start_reader_plainly(read)


def test_a_reader_that_cannot_start_closes_the_stream_frees_the_slot_and_leaves_no_job() -> None:
    harness = _harness(max_background_runs=1, start_reader=RefusesFirstStart())
    frames = ClosableFrames()

    with pytest.raises(RuntimeError, match="cannot start"):
        harness.service.start(_opening(), lambda: frames)

    assert frames.closed
    assert harness.redis.hashes == {}
    harness.service.start(_opening(), lambda: [])
    _join_readers()


def test_view_of_a_graph_job_with_an_invisible_run_uses_the_record() -> None:
    harness = _harness()
    job = _job(harness)
    harness.store.record_ids(job.id, JobIds(run_id="run-1"))
    harness.store.settle(job.id, JobEnding(status=JobStatus.STOPPED))

    view = harness.service.view(OWNER, job.id)

    assert (view.status, view.form) == (JobStatus.STOPPED, None)


def test_stop_of_a_final_job_sends_nothing() -> None:
    harness = _harness()
    job = _job(harness)
    harness.store.record_ids(job.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED)

    view = harness.service.stop(OWNER, job.id)

    assert view.status is JobStatus.SUCCEEDED
    assert harness.tasks.workflow_stops == []
    stored = harness.store.get(job.id)
    assert stored is not None
    assert stored.stop_requested is False


def test_view_hides_a_job_from_another_owner() -> None:
    harness = _harness()
    job = _job(harness)

    with pytest.raises(JobNotFoundError):
        harness.service.view(OTHER, job.id)
    with pytest.raises(JobNotFoundError):
        harness.service.view(OWNER, "missing")


def test_view_of_a_graph_job_reads_status_and_outputs_from_the_run() -> None:
    harness = _harness()
    job = _job(harness)
    harness.store.record_ids(job.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED, outputs={"text": "hi"})

    view = harness.service.view(OWNER, job.id)

    assert view.status is JobStatus.SUCCEEDED
    assert view.outputs == {"text": "hi"}
    assert view.error is None


def test_view_of_a_graph_job_without_a_run_id_uses_the_record() -> None:
    harness = _harness()
    job = _job(harness)

    view = harness.service.view(OWNER, job.id)

    assert view.status is JobStatus.RUNNING
    assert view.outputs is None
    assert view.error is None


def _lapse_alive_key(harness: Harness, job_id: str) -> None:
    harness.redis.delete(f"run_job:{job_id}:alive")


def test_view_of_a_chatflow_answered_without_a_run_carries_its_saved_answer() -> None:
    """An annotation reply or input moderation: the reader recorded success and the message, but no run id."""
    harness = _harness()
    job = _job(harness, AppMode.ADVANCED_CHAT)
    harness.store.record_ids(job.id, JobIds(task_id="task-1", message_id="msg-1", conversation_id="conv-1"))
    harness.store.settle(job.id, JobEnding(status=JobStatus.SUCCEEDED))
    _lapse_alive_key(harness, job.id)

    harness.results.messages[("a1", "msg-1")] = MessageResult(answer="a preset answer", error=None)

    view = harness.service.view(OWNER, job.id)

    assert (view.status, view.error, view.answer) == (JobStatus.SUCCEEDED, None, "a preset answer")
    stored = harness.store.get(job.id)
    assert stored is not None
    assert stored.failure is None


class ReaderEndsDuringGetStore(RedisRunJobStore):
    """The reader stores the run id and ends right after the view has read the record."""

    @override
    def get(self, job_id: str) -> JobRecord | None:
        record = super().get(job_id)
        self.record_ids(job_id, JobIds(run_id="run-1"))
        self.drop_alive(job_id)
        return record


def test_a_view_reads_the_alive_key_before_the_record_so_a_reader_that_just_ended_is_not_failed() -> None:
    racing = ReaderEndsDuringGetStore(redis_client=InMemoryRedis(), job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)
    harness = _harness(store=racing)
    job = _record()
    racing.create(job)

    view = harness.service.view(OWNER, job.id)

    assert view.status is JobStatus.RUNNING
    assert racing.get(job.id) == replace(job, run_id="run-1")


def test_a_graph_job_reported_not_confirmed_never_changes_when_its_run_appears_later() -> None:
    harness = _harness()
    job = _job(harness)
    _lapse_alive_key(harness, job.id)
    reported = harness.service.view(OWNER, job.id)
    harness.store.record_ids(job.id, JobIds(run_id="run-1"))
    harness.store.touch(job.id)
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED, outputs={"x": 1})

    later = harness.service.view(OWNER, job.id)

    not_confirmed = JobFailure.RUN_NOT_CONFIRMED.message
    assert (reported.status, reported.error) == (JobStatus.FAILED, not_confirmed)
    assert (later.status, later.error, later.outputs) == (JobStatus.FAILED, not_confirmed, None)


STALLED_AFTER = RUN_TIME_LIMIT + RUN_TIME_LIMIT_MARGIN
ONE_SECOND = timedelta(seconds=1)


def _running_since(
    harness: Harness, job: JobRecord, age: timedelta | None, status: JobStatus = JobStatus.RUNNING
) -> None:
    """Give the job a run that has been running (since its start or last resume) for age; None when not known."""
    harness.store.record_ids(job.id, JobIds(run_id="run-1"))
    since = None if age is None else harness.clock.wall - age
    harness.results.runs[("t1", "run-1")] = RunResult(status=status, running_since=since)


@pytest.mark.parametrize(
    ("status", "age"),
    [
        (JobStatus.RUNNING, STALLED_AFTER - ONE_SECOND),
        (JobStatus.PAUSED, STALLED_AFTER * 24),
        (JobStatus.RUNNING, None),
    ],
    ids=["inside the limit and margin", "paused", "running time not known"],
)
def test_a_graph_job_is_never_failed_by_the_time_limit_inside_it_while_paused_or_of_unknown_age(
    status: JobStatus, age: timedelta | None
) -> None:
    harness = _harness()
    job = _job(harness)
    _running_since(harness, job, age, status)

    view = harness.service.view(OWNER, job.id)

    assert view.status is status
    stored = harness.store.get(job.id)
    assert stored is not None
    assert stored.failure is None


def test_a_graph_job_running_past_the_time_limit_and_margin_fails_once_and_stays_failed() -> None:
    harness = _harness()
    job = _job(harness)
    _running_since(harness, job, STALLED_AFTER + ONE_SECOND)

    stalled = harness.service.view(OWNER, job.id)
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED, outputs={"x": 1})
    later = harness.service.view(OWNER, job.id)

    failed = (JobStatus.FAILED, JobFailure.RUN_STALLED.message)
    assert (stalled.status, stalled.error) == failed
    assert (later.status, later.error, later.outputs) == (*failed, None)
    stored = harness.store.get(job.id)
    assert stored is not None
    assert stored.failure is JobFailure.RUN_STALLED


@pytest.mark.parametrize(
    ("ending", "message_id", "message", "expected"),
    [
        (JobEnding(status=JobStatus.FAILED, error="boom"), None, None, (JobStatus.FAILED, None, "boom")),
        (
            JobEnding(status=JobStatus.SUCCEEDED),
            "m1",
            MessageResult(answer="hello", error=None),
            (JobStatus.SUCCEEDED, "hello", None),
        ),
        (
            JobEnding(status=JobStatus.FAILED),
            "m1",
            MessageResult(answer="partial", error="model failed"),
            (JobStatus.FAILED, "partial", "model failed"),
        ),
        (
            JobEnding(status=JobStatus.FAILED, error="from record"),
            "m1",
            MessageResult(answer="partial", error=None),
            (JobStatus.FAILED, "partial", "from record"),
        ),
        (JobEnding(status=JobStatus.SUCCEEDED), "m1", None, (JobStatus.SUCCEEDED, None, None)),
        (JobEnding(status=JobStatus.STOPPED), None, None, (JobStatus.STOPPED, None, None)),
    ],
    ids=[
        "record only",
        "saved answer",
        "message error",
        "record error as fallback",
        "message not visible",
        "no message id",
    ],
)
def test_a_final_message_job_takes_its_answer_and_error_from_the_saved_message(
    ending: JobEnding,
    message_id: str | None,
    message: MessageResult | None,
    expected: tuple[JobStatus, str | None, str | None],
) -> None:
    harness = _harness()
    job = _job(harness, AppMode.CHAT)
    harness.store.record_ids(job.id, JobIds(message_id=message_id))
    harness.store.settle(job.id, ending)
    if message is not None:
        harness.results.messages[("a1", "m1")] = message

    view = harness.service.view(OWNER, job.id)

    assert (view.status, view.answer, view.error) == expected


def test_wait_zero_never_sleeps() -> None:
    harness = _harness()
    job = _job(harness)

    view = harness.service.wait(OWNER, job.id, wait_seconds=0)

    assert view.status is JobStatus.RUNNING
    assert harness.clock.slept == []


def test_wait_returns_as_soon_as_the_job_is_final() -> None:
    harness = _harness()
    job = _job(harness, AppMode.CHAT)
    harness.store.settle(job.id, JobEnding(status=JobStatus.SUCCEEDED))

    view = harness.service.wait(OWNER, job.id, wait_seconds=10)

    assert view.status is JobStatus.SUCCEEDED
    assert harness.clock.slept == []


def test_wait_gives_up_after_wait_seconds_and_reports_running() -> None:
    harness = _harness()
    job = _job(harness)

    view = harness.service.wait(OWNER, job.id, wait_seconds=3)

    assert view.status is JobStatus.RUNNING
    assert harness.clock.slept == [POLL_INTERVAL_SECONDS] * 3


def test_wait_returns_when_the_job_pauses() -> None:
    harness = _harness()
    job = _job(harness)
    harness.store.record_ids(job.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)
    harness.results.forms[("t1", "a1", "run-1", AppMode.WORKFLOW)] = human_input_form("f")

    view = harness.service.wait(OWNER, job.id, wait_seconds=10)

    assert view.status is JobStatus.PAUSED
    assert view.form == human_input_form("f")
    assert harness.clock.slept == []


def test_wait_keeps_polling_a_paused_job_without_a_waiting_form() -> None:
    harness = _harness()
    job = _job(harness)
    harness.store.record_ids(job.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)

    view = harness.service.wait(OWNER, job.id, wait_seconds=3)

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

    store = RedisRunJobStore(redis_client=InMemoryRedis(), job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)
    service = RunJobService(
        store=store,
        results=InMemoryRunResults(),
        tasks=RecordingTaskControl(),
        max_background_runs=1,
        max_waiters=1,
        run_time_limit=RUN_TIME_LIMIT,
        start_reader=start_reader_plainly,
        sleep=sleep_then_wait_again,
        monotonic=clock.monotonic,
    )
    waited = _record()
    store.create(waited)
    nested_id = waited.id

    service.wait(OWNER, nested_id, wait_seconds=2)

    assert nested["before"] == nested["after"]


def test_wait_releases_its_waiter_slot() -> None:
    harness = _harness(max_waiters=1)
    job = _job(harness)

    harness.service.wait(OWNER, job.id, wait_seconds=1)
    harness.service.wait(OWNER, job.id, wait_seconds=1)

    assert harness.clock.slept == [POLL_INTERVAL_SECONDS] * 2


def test_stop_before_the_ids_arrive_only_records_the_request() -> None:
    harness = _harness()
    job = _job(harness)

    harness.service.stop(OWNER, job.id)

    stored = harness.store.get(job.id)
    assert stored is not None
    assert stored.stop_requested is True
    assert harness.tasks.workflow_stops == []
    assert harness.tasks.message_stops == []


def test_stop_of_a_graph_job_stops_the_run_and_of_a_message_job_the_task() -> None:
    harness = _harness()
    graph = _job(harness, AppMode.WORKFLOW)
    message = _job(harness, AppMode.CHAT)
    harness.store.record_ids(graph.id, JobIds(run_id="run-1", task_id="task-g"))
    harness.store.record_ids(message.id, JobIds(task_id="task-m"))

    harness.service.stop(OWNER, graph.id)
    view = harness.service.stop(OWNER, message.id)

    assert [stop.run_id for stop in harness.tasks.workflow_stops] == ["run-1"]
    assert harness.tasks.workflow_stops[0].caller_id == OWNER.caller_id
    assert harness.tasks.workflow_stops[0].app_mode is AppMode.WORKFLOW
    assert [stop.task_id for stop in harness.tasks.message_stops] == ["task-m"]
    assert view.record.stop_requested is True


def test_stop_hides_a_job_from_another_owner() -> None:
    harness = _harness()
    job = _job(harness)

    with pytest.raises(JobNotFoundError):
        harness.service.stop(OTHER, job.id)


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
    harness.service._tasks = StopFlipsRunTaskControl(harness.results)
    job = _job(harness)
    harness.store.record_ids(job.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.PAUSED)
    harness.results.forms[("t1", "a1", "run-1", AppMode.WORKFLOW)] = human_input_form("f")

    view = harness.service.stop(OWNER, job.id)

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
    racing = IdsArriveWhileStoppingStore(redis_client=InMemoryRedis(), job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)
    harness = _harness(store=racing)
    job = _record()
    racing.create(job)

    harness.service.stop(OWNER, job.id)

    assert [stop.run_id for stop in harness.tasks.workflow_stops] == ["run-1"]


def test_a_message_job_with_a_live_reader_keeps_running() -> None:
    harness = _harness()
    job = _job(harness, AppMode.CHAT)

    view = harness.service.view(OWNER, job.id)

    assert (view.status, view.error) == (JobStatus.RUNNING, None)


def test_a_graph_job_whose_reader_died_still_reads_the_run() -> None:
    harness = _harness()
    job = _job(harness, AppMode.ADVANCED_CHAT)
    harness.store.record_ids(job.id, JobIds(run_id="run-1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.RUNNING)
    _lapse_alive_key(harness, job.id)

    view = harness.service.view(OWNER, job.id)

    assert (view.status, view.error) == (JobStatus.RUNNING, None)


def test_a_finished_chatflow_job_returns_the_saved_answer_and_the_run_outputs() -> None:
    harness = _harness()
    job = _job(harness, AppMode.ADVANCED_CHAT)
    harness.store.record_ids(job.id, JobIds(run_id="run-1", message_id="m1"))
    harness.store.settle(job.id, JobEnding(status=JobStatus.SUCCEEDED))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED, outputs={"answer": "from run"})
    harness.results.messages[("a1", "m1")] = MessageResult(answer="from message", error="ignored")

    view = harness.service.view(OWNER, job.id)

    assert view.answer == "from message"
    assert view.outputs == {"answer": "from run"}
    assert (view.status, view.error) == (JobStatus.SUCCEEDED, None)


def test_a_running_chatflow_job_has_no_answer_yet() -> None:
    harness = _harness()
    job = _job(harness, AppMode.ADVANCED_CHAT)
    harness.store.record_ids(job.id, JobIds(run_id="run-1", message_id="m1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.RUNNING)
    harness.results.messages[("a1", "m1")] = MessageResult(answer="partial", error=None)

    view = harness.service.view(OWNER, job.id)

    assert view.answer is None


def test_a_chatflow_whose_run_finished_but_whose_reader_is_still_saving_the_answer_keeps_running() -> None:
    harness = _harness()
    job = _job(harness, AppMode.ADVANCED_CHAT)
    harness.store.record_ids(job.id, JobIds(run_id="run-1", message_id="m1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED, outputs={"answer": "x"})
    harness.results.messages[("a1", "m1")] = MessageResult(answer="", error=None)

    view = harness.service.view(OWNER, job.id)

    assert (view.status, view.answer, view.outputs) == (JobStatus.RUNNING, None, None)


def test_a_chatflow_that_resumed_after_a_pause_reads_the_answer_as_soon_as_its_reader_ended() -> None:
    harness = _harness()
    job = _job(harness, AppMode.ADVANCED_CHAT)
    harness.store.record_ids(job.id, JobIds(run_id="run-1", message_id="m1"))
    harness.results.runs[("t1", "run-1")] = RunResult(status=JobStatus.SUCCEEDED, outputs={"answer": "x"})
    harness.results.messages[("a1", "m1")] = MessageResult(answer="saved", error=None)
    harness.store.drop_alive(job.id)

    view = harness.service.view(OWNER, job.id)

    assert (view.status, view.answer, view.outputs) == (JobStatus.SUCCEEDED, "saved", {"answer": "x"})


def test_a_message_job_failed_as_interrupted_has_no_answer_even_when_a_message_row_exists() -> None:
    harness = _harness()
    job = _job(harness, AppMode.CHAT)
    harness.store.record_ids(job.id, JobIds(message_id="m1"))
    harness.results.messages[("a1", "m1")] = MessageResult(answer="", error=None)
    _lapse_alive_key(harness, job.id)

    view = harness.service.view(OWNER, job.id)

    assert (view.status, view.error, view.answer) == (JobStatus.FAILED, JobFailure.RUN_INTERRUPTED.message, None)
    stored = harness.store.get(job.id)
    assert stored is not None
    assert (stored.status, stored.failure) == (JobStatus.FAILED, JobFailure.RUN_INTERRUPTED)


@pytest.mark.parametrize("failure", list(JobFailure))
def test_a_message_job_failed_by_the_service_has_no_answer_even_when_a_message_row_exists(
    failure: JobFailure,
) -> None:
    harness = _harness()
    job = _job(harness, AppMode.CHAT)
    harness.store.record_ids(job.id, JobIds(message_id="m1"))
    harness.store.settle(job.id, JobEnding(status=JobStatus.FAILED, failure=failure))
    harness.results.messages[("a1", "m1")] = MessageResult(answer="", error=None)

    view = harness.service.view(OWNER, job.id)

    assert (view.status, view.error, view.answer) == (JobStatus.FAILED, failure.message, None)


def test_each_mode_that_runs_jobs_has_exactly_one_family() -> None:
    for mode in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT):
        assert family_of(mode) is GRAPH_JOBS
    for mode in (AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION):
        assert family_of(mode) is MESSAGE_JOBS
    with pytest.raises(ValueError, match="does not support run jobs"):
        family_of(AppMode.RAG_PIPELINE)
    assert {event for family in (GRAPH_JOBS, MESSAGE_JOBS) for event in family.ending_events} == {
        StreamEvent.WORKFLOW_FINISHED,
        StreamEvent.MESSAGE_END,
        StreamEvent.ERROR,
    }
