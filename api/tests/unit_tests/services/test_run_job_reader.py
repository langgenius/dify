import json
import time
from collections.abc import Iterable, Iterator, Mapping
from typing import override

import pytest

from core.app.entities.task_entities import StreamEvent
from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.run_job_contracts import JobFailure, JobIds, JobOwner, JobRecord, JobStatus
from services.run_job_reader import RUN_STATUS_TO_JOB_STATUS, read_to_end
from tests.unit_tests.services.run_job_fakes import InMemoryRedis, RecordingJobStopper

JOB_ID = "job-1"
IDS = {"task_id": "task-1", "workflow_run_id": "run-1", "message_id": "msg-1", "conversation_id": "conv-1"}


def _frame(event: StreamEvent, **fields: object) -> str:
    return f"data: {json.dumps({'event': event.value, **fields})}\n\n"


PING = f"event: {StreamEvent.PING.value}\n\n"


def _finished(status: WorkflowExecutionStatus, error: str | None = None) -> str:
    return _frame(
        StreamEvent.WORKFLOW_FINISHED,
        task_id="task-1",
        workflow_run_id="run-1",
        data={"id": "run-1", "status": status.value, "error": error},
    )


class ClosableFrames:
    def __init__(self, frames: list[str]) -> None:
        self._frames = frames
        self.closed = False

    def __iter__(self) -> Iterator[str]:
        return iter(self._frames)

    def close(self) -> None:
        self.closed = True


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
    return RedisRunJobStore(redis_client=redis)


@pytest.fixture
def stopper() -> RecordingJobStopper:
    return RecordingJobStopper()


def _open(store: RedisRunJobStore, mode: AppMode) -> None:
    store.create(
        JobRecord(
            id=JOB_ID,
            owner=JobOwner(tenant_id="t1", app_id="app-1", caller_role=CreatorUserRole.ACCOUNT, caller_id="acct-1"),
            mode=mode,
            op="start.console_app.test",
        )
    )


def _read(store: RedisRunJobStore, stopper: RecordingJobStopper, frames: Iterable[str]) -> JobRecord:
    read_to_end(job_id=JOB_ID, frames=frames, store=store, stopper=stopper)
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


def test_a_ping_records_no_ids(store: RedisRunJobStore, stopper: RecordingJobStopper) -> None:
    _open(store, AppMode.WORKFLOW)

    record = _read(store, stopper, [PING])

    assert (record.task_id, record.run_id) == (None, None)


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


def test_a_pause_stores_only_the_ids_and_leaves_the_record_running(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.WORKFLOW)
    form: Mapping[str, object] = {"form_id": "f1", "node_id": "n1", "form_content": "hi"}
    frames = [
        _frame(StreamEvent.HUMAN_INPUT_REQUIRED, task_id="task-1", workflow_run_id="run-1", data=form),
        _frame(StreamEvent.WORKFLOW_PAUSED, task_id="task-1", workflow_run_id="run-1", data={"status": "paused"}),
    ]

    record = _read(store, stopper, frames)

    assert (record.status, record.task_id, record.run_id) == (JobStatus.RUNNING, "task-1", "run-1")


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


def test_an_error_event_fails_the_job_with_its_message(store: RedisRunJobStore, stopper: RecordingJobStopper) -> None:
    _open(store, AppMode.WORKFLOW)

    record = _read(store, stopper, [_frame(StreamEvent.ERROR, code="invalid_param", status=400, message="bad input")])

    assert record.status is JobStatus.FAILED
    assert record.error == "bad input"


def test_an_error_event_without_a_message_fails_the_job_with_no_error_text(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.WORKFLOW)

    record = _read(store, stopper, [_frame(StreamEvent.ERROR, code="invalid_param", status=400)])

    assert record.status is JobStatus.FAILED
    assert record.error is None


def test_the_first_final_status_wins(store: RedisRunJobStore, stopper: RecordingJobStopper) -> None:
    _open(store, AppMode.WORKFLOW)
    frames = [
        _finished(WorkflowExecutionStatus.SUCCEEDED),
        _frame(StreamEvent.ERROR, message="late"),
        _frame(StreamEvent.WORKFLOW_PAUSED, task_id="task-1", data={}),
    ]

    record = _read(store, stopper, frames)

    assert record.status is JobStatus.SUCCEEDED
    assert record.error is None
    assert record.task_id == "task-1"


def test_the_status_table_is_read_only() -> None:
    with pytest.raises(TypeError):
        RUN_STATUS_TO_JOB_STATUS[WorkflowExecutionStatus.RUNNING] = JobStatus.RUNNING  # type: ignore[index]


def test_a_stream_that_ends_without_a_result_fails_a_message_job(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.CHAT)

    record = _read(store, stopper, [PING])

    assert record.status is JobStatus.FAILED
    assert (record.failure, record.error) == (JobFailure.NO_RESULT, JobFailure.NO_RESULT.message)


def test_a_graph_stream_that_ends_without_a_run_id_is_not_confirmed_by_the_reader(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.WORKFLOW)

    record = _read(store, stopper, [PING])

    assert (record.status, record.failure) == (JobStatus.FAILED, JobFailure.RUN_NOT_CONFIRMED)


def test_a_graph_stream_that_ends_with_a_run_id_leaves_the_job_to_its_run(
    store: RedisRunJobStore, stopper: RecordingJobStopper
) -> None:
    _open(store, AppMode.WORKFLOW)

    record = _read(store, stopper, [_frame(StreamEvent.WORKFLOW_STARTED, **IDS, data={})])

    assert (record.status, record.run_id) == (JobStatus.RUNNING, "run-1")


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.CHAT])
def test_the_alive_key_is_gone_once_the_reader_has_recorded_its_ending(
    store: RedisRunJobStore, stopper: RecordingJobStopper, mode: AppMode
) -> None:
    _open(store, mode)

    record = _read(store, stopper, [PING])

    assert record.status is JobStatus.FAILED
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


def test_no_stop_is_applied_without_a_request(store: RedisRunJobStore, stopper: RecordingJobStopper) -> None:
    _open(store, AppMode.WORKFLOW)

    _read(store, stopper, [_frame(StreamEvent.WORKFLOW_STARTED, **IDS, data={})])

    assert stopper.stopped == []


def test_the_stream_is_closed_at_the_end(store: RedisRunJobStore, stopper: RecordingJobStopper) -> None:
    _open(store, AppMode.WORKFLOW)
    frames = ClosableFrames([PING])

    _read(store, stopper, frames)

    assert frames.closed


def test_frames_that_are_not_json_objects_are_ignored(store: RedisRunJobStore, stopper: RecordingJobStopper) -> None:
    _open(store, AppMode.WORKFLOW)

    started = _frame(StreamEvent.WORKFLOW_STARTED, **IDS, data={})
    frames = [started, "data: not json\n\n", "data: [1, 2]\n\n", _frame(StreamEvent.TEXT_CHUNK, data={})]

    record = _read(store, stopper, frames)

    assert record.status is JobStatus.RUNNING


def test_an_unknown_event_name_changes_nothing(store: RedisRunJobStore, stopper: RecordingJobStopper) -> None:
    _open(store, AppMode.WORKFLOW)

    unknown = 'data: {"event": "from_the_future", "task_id": "task-1", "workflow_run_id": "run-1"}\n\n'

    record = _read(store, stopper, [unknown])

    assert record.status is JobStatus.RUNNING
    assert (record.task_id, record.run_id) == ("task-1", "run-1")


class TouchFailsOnceStore(RedisRunJobStore):
    def __init__(self, redis: InMemoryRedis) -> None:
        super().__init__(redis_client=redis)
        self.failures_left = 0

    @override
    def touch(self, job_id: str) -> None:
        if self.failures_left > 0:
            self.failures_left -= 1
            raise ConnectionError("redis blip")
        super().touch(job_id)


class CountingTouchStore(RedisRunJobStore):
    def __init__(self, redis: InMemoryRedis) -> None:
        super().__init__(redis_client=redis)
        self.touches = 0

    @override
    def touch(self, job_id: str) -> None:
        self.touches += 1
        super().touch(job_id)


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
    store = CountingTouchStore(redis)
    _open(store, AppMode.WORKFLOW)
    store.touches = 0

    read_to_end(job_id=JOB_ID, frames=_silent_for(0.2), store=store, stopper=stopper, alive_refresh_seconds=0.02)

    assert store.touches >= 5


def test_the_alive_refresh_stops_when_the_reader_ends(redis: InMemoryRedis, stopper: RecordingJobStopper) -> None:
    store = CountingTouchStore(redis)
    _open(store, AppMode.WORKFLOW)

    read_to_end(job_id=JOB_ID, frames=_silent_for(0.05), store=store, stopper=stopper, alive_refresh_seconds=0.01)
    after_end = store.touches
    time.sleep(0.1)

    assert store.touches == after_end


class IdsFailOnceStore(RedisRunJobStore):
    def __init__(self, redis: InMemoryRedis) -> None:
        super().__init__(redis_client=redis)
        self.failures_left = 0

    @override
    def record_ids(self, job_id: str, ids: JobIds) -> None:
        if self.failures_left > 0:
            self.failures_left -= 1
            raise ConnectionError("redis blip")
        super().record_ids(job_id, ids)


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
