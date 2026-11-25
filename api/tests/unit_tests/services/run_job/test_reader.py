import json
import logging
import time
from collections.abc import Iterable, Iterator
from typing import override

import pytest

from configs import dify_config
from core.app.entities.task_entities import StreamEvent
from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.run_job.contracts import JobEnding, JobFailure, JobIds, JobOwner, JobRecord, JobStatus
from services.run_job.reader import StreamEndings, read_to_end
from services.run_job.service import family_of
from tests.unit_tests.services.run_job.fakes import (
    ClosableFrames,
    InMemoryRedis,
    RecordingJobStopper,
    workflow_finished,
)

JOB_ID = "job-1"
SAMPLE_OP = "run.sample"
IDS = {"task_id": "task-1", "workflow_run_id": "run-1", "message_id": "msg-1", "conversation_id": "conv-1"}


def _frame(event: StreamEvent, **fields: object) -> str:
    return f"data: {json.dumps({'event': event.value, **fields})}\n\n"


PING = f"event: {StreamEvent.PING.value}\n\n"


def _finished(status: WorkflowExecutionStatus, error: str | None = None) -> str:
    return f"data: {workflow_finished(status, error).model_dump_json()}\n\n"


class RaisingFrames:
    def __init__(self, frames: list[str]) -> None:
        self._frames = frames

    def __iter__(self) -> Iterator[str]:
        yield from self._frames
        raise ConnectionError("stream broke")


@pytest.fixture
def redis() -> InMemoryRedis:
    return InMemoryRedis()


@pytest.fixture
def store(redis: InMemoryRedis) -> RedisRunJobStore:
    return RedisRunJobStore(redis_client=redis, job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)


@pytest.fixture
def stopper() -> RecordingJobStopper:
    return RecordingJobStopper()


def _open(store: RedisRunJobStore, mode: AppMode) -> None:
    store.create(
        JobRecord(
            id=JOB_ID,
            owner=JobOwner(tenant_id="t1", app_id="app-1", caller_role=CreatorUserRole.ACCOUNT, caller_id="acct-1"),
            mode=mode,
            op=SAMPLE_OP,
        )
    )


def _endings(store: RedisRunJobStore) -> StreamEndings:
    record = store.get(JOB_ID)
    assert record is not None
    return family_of(record.mode)


def _read(store: RedisRunJobStore, stopper: RecordingJobStopper, frames: Iterable[str]) -> JobRecord:
    read_to_end(job_id=JOB_ID, frames=frames, store=store, stopper=stopper, endings=_endings(store))
    record = store.get(JOB_ID)
    assert record is not None
    return record


def test_ids_are_taken_from_the_first_data_frame(store: RedisRunJobStore, stopper: RecordingJobStopper) -> None:
    _open(store, AppMode.ADVANCED_CHAT)

    record = _read(store, stopper, [_frame(StreamEvent.WORKFLOW_STARTED, **IDS, data={})])

    assert (record.task_id, record.run_id, record.message_id, record.conversation_id) == (
        "task-1",
        "run-1",
        "msg-1",
        "conv-1",
    )
    assert record.status is JobStatus.RUNNING
    assert stopper.stopped == []


@pytest.mark.parametrize(
    ("run_status", "expected"),
    [
        (WorkflowExecutionStatus.SUCCEEDED, JobStatus.SUCCEEDED),
        (WorkflowExecutionStatus.PARTIAL_SUCCEEDED, JobStatus.SUCCEEDED),
        (WorkflowExecutionStatus.FAILED, JobStatus.FAILED),
        (WorkflowExecutionStatus.STOPPED, JobStatus.STOPPED),
    ],
)
def test_workflow_finished_maps_each_run_status(
    store: RedisRunJobStore,
    stopper: RecordingJobStopper,
    run_status: WorkflowExecutionStatus,
    expected: JobStatus,
) -> None:
    _open(store, AppMode.WORKFLOW)
    error = "boom" if run_status is WorkflowExecutionStatus.FAILED else None

    record = _read(store, stopper, [_finished(run_status, error)])

    assert record.status is expected
    assert record.error == error


def test_message_end_finishes_a_message_job_but_not_a_graph_job(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.CHAT)
    end = _frame(StreamEvent.MESSAGE_END, task_id="task-1", id="msg-1", metadata={})

    assert _read(store, stopper, [end]).status is JobStatus.SUCCEEDED

    store.discard(JOB_ID)
    _open(store, AppMode.WORKFLOW)

    assert (
        _read(store, stopper, [_frame(StreamEvent.WORKFLOW_STARTED, **IDS, data={}), end]).status is JobStatus.RUNNING
    )


def test_message_end_after_a_stop_request_marks_the_job_stopped(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.CHAT)
    store.request_stop(JOB_ID)

    record = _read(store, stopper, [_frame(StreamEvent.MESSAGE_END, task_id="task-1", id="msg-1", metadata={})])

    assert record.status is JobStatus.STOPPED


def test_an_error_event_without_a_message_is_not_read_as_an_ending(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.CHAT)

    record = _read(store, stopper, [_frame(StreamEvent.ERROR, code="invalid_param", status=400)])

    assert (record.status, record.failure) == (JobStatus.FAILED, JobFailure.NO_RESULT)


def test_a_graph_job_ends_with_workflow_finished_not_the_error_before_it(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    """Core's worker follows an error with a failed workflow_finished that carries the same message."""
    _open(store, AppMode.WORKFLOW)
    error = _frame(StreamEvent.ERROR, code="internal_server_error", status=500, message="boom")

    assert _read(store, stopper, [error]).failure is JobFailure.RUN_NOT_CONFIRMED

    store.discard(JOB_ID)
    _open(store, AppMode.WORKFLOW)
    record = _read(store, stopper, [error, _finished(WorkflowExecutionStatus.FAILED, "boom")])

    assert (record.status, record.error, record.failure) == (JobStatus.FAILED, "boom", None)


def test_a_message_job_takes_no_ending_from_workflow_finished(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.CHAT)

    record = _read(store, stopper, [_finished(WorkflowExecutionStatus.SUCCEEDED)])

    assert record.failure is JobFailure.NO_RESULT


@pytest.mark.parametrize(
    ("mode", "failure"), [(AppMode.WORKFLOW, JobFailure.RUN_NOT_CONFIRMED), (AppMode.CHAT, JobFailure.NO_RESULT)]
)
def test_a_stream_of_pings_records_no_ids_fails_the_job_for_its_family_and_drops_the_alive_key(
    store: RedisRunJobStore, stopper: RecordingJobStopper, mode: AppMode, failure: JobFailure
) -> None:
    _open(store, mode)

    record = _read(store, stopper, [PING])

    assert (record.task_id, record.run_id) == (None, None)
    assert (record.status, record.failure, record.error) == (JobStatus.FAILED, failure, failure.message)
    assert not store.is_alive(JOB_ID)


def test_a_stream_that_raises_fails_a_message_job_and_a_graph_job_without_a_run_id(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.CHAT)
    message_job = _read(store, stopper, RaisingFrames([PING]))

    store.discard(JOB_ID)
    _open(store, AppMode.WORKFLOW)
    graph_job = _read(store, stopper, RaisingFrames([PING]))

    assert message_job.status is JobStatus.FAILED
    assert message_job.failure is JobFailure.NO_RESULT
    assert graph_job.failure is JobFailure.RUN_NOT_CONFIRMED


def test_a_final_status_is_not_overwritten_when_the_stream_ends(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.CHAT)
    frames = [_frame(StreamEvent.MESSAGE_END, task_id="task-1", id="msg-1", metadata={}), PING]

    assert _read(store, stopper, frames).status is JobStatus.SUCCEEDED


def test_a_pending_stop_is_applied_once_the_task_id_arrives(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.WORKFLOW)
    store.request_stop(JOB_ID)
    frames = [
        _frame(StreamEvent.WORKFLOW_STARTED, **IDS, data={}),
        _frame(StreamEvent.NODE_STARTED, **IDS, data={}),
    ]

    _read(store, stopper, frames)

    assert [(record.task_id, record.run_id) for record in stopper.stopped] == [("task-1", "run-1")]


def test_a_stop_requested_after_the_ids_are_stored_is_not_sent_by_the_reader(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.WORKFLOW)
    frames = (
        frame
        for frame in [
            _frame(StreamEvent.WORKFLOW_STARTED, **IDS, data={}),
            _frame(StreamEvent.NODE_STARTED, **IDS, data={}),
        ]
    )

    def late_stop() -> Iterator[str]:
        for index, frame in enumerate(frames):
            if index == 1:
                store.request_stop(JOB_ID)
            yield frame

    _read(store, stopper, late_stop())

    assert stopper.stopped == []


def test_the_stream_is_closed_at_the_end(store: RedisRunJobStore, stopper: RecordingJobStopper) -> None:
    _open(store, AppMode.WORKFLOW)
    frames = ClosableFrames([PING])

    _read(store, stopper, frames)

    assert frames.closed


def test_an_event_core_does_not_name_records_nothing(store: RedisRunJobStore, stopper: RecordingJobStopper) -> None:
    _open(store, AppMode.WORKFLOW)

    unknown = 'data: {"event": "from_the_future", "task_id": "task-1", "workflow_run_id": "run-1"}\n\n'

    record = _read(store, stopper, [unknown])

    assert (record.task_id, record.run_id) == (None, None)


class TouchFailsOnceStore(RedisRunJobStore):
    def __init__(self, redis: InMemoryRedis) -> None:
        super().__init__(redis_client=redis, job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)
        self.failures_left = 0

    @override
    def touch(self, job_id: str) -> None:
        if self.failures_left > 0:
            self.failures_left -= 1
            raise ConnectionError("redis blip")
        super().touch(job_id)


class CountingStore(RedisRunJobStore):
    def __init__(self, redis: InMemoryRedis) -> None:
        super().__init__(redis_client=redis, job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)
        self.touches = 0
        self.gets = 0
        self.writes = 0

    @override
    def touch(self, job_id: str) -> None:
        self.touches += 1
        super().touch(job_id)

    @override
    def get(self, job_id: str) -> JobRecord | None:
        self.gets += 1
        return super().get(job_id)

    @override
    def record_ids(self, job_id: str, ids: JobIds) -> None:
        self.writes += 1
        super().record_ids(job_id, ids)

    @override
    def settle(self, job_id: str, ending: JobEnding) -> bool:
        self.writes += 1
        return super().settle(job_id, ending)


def _silent_for(seconds: float) -> Iterator[str]:
    """A stream that yields no frame for `seconds`, then ends - a run waiting in the worker queue."""
    time.sleep(seconds)
    yield from ()


def test_a_failed_alive_refresh_is_logged_and_does_not_stop_the_read(
    redis: InMemoryRedis, stopper: RecordingJobStopper, caplog: pytest.LogCaptureFixture
) -> None:
    store = TouchFailsOnceStore(redis)
    _open(store, AppMode.CHAT)
    store.failures_left = 1
    frames = [PING, _frame(StreamEvent.MESSAGE_END, task_id="task-1", id="msg-1", metadata={})]

    record = _read(store, stopper, frames)

    assert record.status is JobStatus.SUCCEEDED
    assert any(r.exc_info for r in caplog.records)


def test_the_alive_key_is_refreshed_while_no_frame_arrives(redis: InMemoryRedis, stopper: RecordingJobStopper) -> None:
    store = CountingStore(redis)
    _open(store, AppMode.WORKFLOW)
    store.touches = 0

    read_to_end(
        job_id=JOB_ID,
        frames=_silent_for(0.2),
        store=store,
        stopper=stopper,
        endings=_endings(store),
        alive_refresh_seconds=0.02,
    )

    assert store.touches >= 5


def test_the_alive_refresh_stops_when_the_reader_ends(redis: InMemoryRedis, stopper: RecordingJobStopper) -> None:
    store = CountingStore(redis)
    _open(store, AppMode.WORKFLOW)

    read_to_end(
        job_id=JOB_ID,
        frames=_silent_for(0.05),
        store=store,
        stopper=stopper,
        endings=_endings(store),
        alive_refresh_seconds=0.01,
    )
    after_end = store.touches
    time.sleep(0.1)

    assert store.touches == after_end


class IdsFailOnceStore(RedisRunJobStore):
    def __init__(self, redis: InMemoryRedis) -> None:
        super().__init__(redis_client=redis, job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)
        self.failures_left = 0

    @override
    def record_ids(self, job_id: str, ids: JobIds) -> None:
        if self.failures_left > 0:
            self.failures_left -= 1
            raise ConnectionError("redis blip")
        super().record_ids(job_id, ids)


class SettleFailsOnceStore(RedisRunJobStore):
    def __init__(self, redis: InMemoryRedis) -> None:
        super().__init__(redis_client=redis, job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)
        self.failures_left = 1

    @override
    def settle(self, job_id: str, ending: JobEnding) -> bool:
        if self.failures_left > 0:
            self.failures_left -= 1
            raise ConnectionError("redis blip")
        return super().settle(job_id, ending)


def test_a_chat_ending_whose_save_failed_is_saved_when_the_stream_ends(
    redis: InMemoryRedis, stopper: RecordingJobStopper
) -> None:
    store = SettleFailsOnceStore(redis)
    _open(store, AppMode.CHAT)
    end = _frame(StreamEvent.MESSAGE_END, task_id="task-1", id="msg-1", message_id="msg-1", metadata={})

    record = _read(store, stopper, [end, PING])

    assert (record.status, record.failure) == (JobStatus.SUCCEEDED, None)


def test_ids_whose_save_failed_are_saved_by_the_next_frame(redis: InMemoryRedis, stopper: RecordingJobStopper) -> None:
    store = IdsFailOnceStore(redis)
    _open(store, AppMode.WORKFLOW)
    store.failures_left = 1
    frames = [_frame(StreamEvent.WORKFLOW_STARTED, **IDS, data={}), _frame(StreamEvent.NODE_STARTED, **IDS, data={})]

    record = _read(store, stopper, frames)

    assert (record.task_id, record.run_id) == ("task-1", "run-1")


def test_a_pending_stop_is_sent_once_after_a_failed_id_save(redis: InMemoryRedis, stopper: RecordingJobStopper) -> None:
    store = IdsFailOnceStore(redis)
    _open(store, AppMode.WORKFLOW)
    store.request_stop(JOB_ID)
    store.failures_left = 1
    frames = [
        _frame(StreamEvent.WORKFLOW_STARTED, **IDS, data={}),
        _frame(StreamEvent.NODE_STARTED, **IDS, data={}),
        _frame(StreamEvent.NODE_FINISHED, **IDS, data={}),
    ]

    _read(store, stopper, frames)

    assert [(record.task_id, record.run_id) for record in stopper.stopped] == [("task-1", "run-1")]


def test_a_frame_that_does_not_fit_cores_model_is_logged_once_per_event(
    store: RedisRunJobStore, stopper: RecordingJobStopper, caplog: pytest.LogCaptureFixture
) -> None:
    _open(store, AppMode.CHAT)
    broken_end = _frame(StreamEvent.MESSAGE_END, id="msg-1", answer="secret answer")
    frames = [broken_end, broken_end, "data: not json\n\n", PING]

    with caplog.at_level(logging.ERROR, logger="services.run_job.reader"):
        record = _read(store, stopper, frames)

    misfits = [entry for entry in caplog.records if "does not fit" in entry.getMessage()]
    assert [entry.levelno for entry in misfits] == [logging.ERROR, logging.ERROR]
    assert JOB_ID in misfits[0].getMessage()
    assert "message_end" in misfits[0].getMessage()
    assert "task_id" in misfits[0].getMessage()
    assert "secret answer" not in caplog.text
    assert record.failure is JobFailure.NO_RESULT


CHAT_IDS = {"task_id": "task-1", "message_id": "msg-1", "conversation_id": "conv-1"}


def test_token_frames_with_known_ids_make_no_store_call(redis: InMemoryRedis, stopper: RecordingJobStopper) -> None:
    store = CountingStore(redis)
    _open(store, AppMode.CHAT)
    first = _frame(StreamEvent.MESSAGE, answer="a", **CHAT_IDS)
    tokens = [_frame(StreamEvent.MESSAGE, answer="t", **CHAT_IDS) for _ in range(50)]
    tokens += [_frame(StreamEvent.MESSAGE, answer="t") for _ in range(50)]
    counts_at_end: list[tuple[int, int]] = []

    def frames() -> Iterator[str]:
        yield first
        store.gets = store.writes = 0
        yield from tokens
        counts_at_end.append((store.gets, store.writes))

    read_to_end(job_id=JOB_ID, frames=frames(), store=store, stopper=stopper, endings=_endings(store))

    assert counts_at_end == [(0, 0)]
