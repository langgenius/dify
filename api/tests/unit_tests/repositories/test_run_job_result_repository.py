import json
import logging
from collections.abc import Callable, Iterator, Mapping
from datetime import datetime
from typing import override
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.task_entities import HumanInputRequiredResponse
from core.tools.signature import sign_tool_file_uri
from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole
from models.model import AppMode, ConversationFromSource, Message
from models.workflow import WorkflowPause, WorkflowRun, WorkflowRunTriggeredFrom, WorkflowType
from repositories import run_job_result_repository
from repositories.run_job_result_repository import SQLAlchemyRunResultReader
from services.run_job import JobStatus, MessageResult
from tests.unit_tests.services.run_job.fakes import human_input_form


def _add_run(
    session: Session,
    *,
    tenant_id: str,
    status: WorkflowExecutionStatus,
    outputs: Mapping[str, object] | None = None,
    error: str | None = None,
) -> WorkflowRun:
    run = WorkflowRun(
        id=str(uuid4()),
        tenant_id=tenant_id,
        app_id=str(uuid4()),
        workflow_id=str(uuid4()),
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=status,
        outputs=json.dumps(outputs) if outputs is not None else "{}",
        error=error,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
    )
    session.add(run)
    session.commit()
    return run


@pytest.mark.parametrize(
    ("stored", "expected"),
    [
        (WorkflowExecutionStatus.RUNNING, JobStatus.RUNNING),
        (WorkflowExecutionStatus.PAUSED, JobStatus.PAUSED),
        (WorkflowExecutionStatus.SUCCEEDED, JobStatus.SUCCEEDED),
        (WorkflowExecutionStatus.PARTIAL_SUCCEEDED, JobStatus.SUCCEEDED),
        (WorkflowExecutionStatus.FAILED, JobStatus.FAILED),
        (WorkflowExecutionStatus.STOPPED, JobStatus.STOPPED),
    ],
)
def test_run_maps_each_stored_status(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    stored: WorkflowExecutionStatus,
    expected: JobStatus,
) -> None:
    tenant_id = str(uuid4())
    row = _add_run(sqlite_session, tenant_id=tenant_id, status=stored)

    result = SQLAlchemyRunResultReader(session_factory=sqlite_session_factory).run(tenant_id=tenant_id, run_id=row.id)

    assert result is not None
    assert result.status is expected


def test_run_with_a_status_that_has_no_job_status_is_none(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    tenant_id = str(uuid4())
    row = _add_run(sqlite_session, tenant_id=tenant_id, status=WorkflowExecutionStatus.SCHEDULED)

    reader = SQLAlchemyRunResultReader(session_factory=sqlite_session_factory)

    assert reader.run(tenant_id=tenant_id, run_id=row.id) is None


def test_run_returns_outputs_and_error_from_the_row(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    tenant_id = str(uuid4())
    row = _add_run(
        sqlite_session,
        tenant_id=tenant_id,
        status=WorkflowExecutionStatus.FAILED,
        outputs={"text": "partial"},
        error="boom",
    )

    result = SQLAlchemyRunResultReader(session_factory=sqlite_session_factory).run(tenant_id=tenant_id, run_id=row.id)

    assert result is not None
    assert result.outputs == {"text": "partial"}
    assert result.error == "boom"


def test_run_of_an_unknown_id_or_another_tenant_is_none(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    tenant_id = str(uuid4())
    row = _add_run(sqlite_session, tenant_id=tenant_id, status=WorkflowExecutionStatus.SUCCEEDED)
    reader = SQLAlchemyRunResultReader(session_factory=sqlite_session_factory)

    assert reader.run(tenant_id=tenant_id, run_id=str(uuid4())) is None
    assert reader.run(tenant_id=str(uuid4()), run_id=row.id) is None


STARTED_AT = datetime(2026, 11, 18, 8, 0, 0)
RESUMED_AT = datetime(2026, 11, 18, 11, 30, 0)


def _started_at(session: Session, row: WorkflowRun, at: datetime) -> None:
    row.created_at = at
    session.commit()


def _add_pause(session: Session, row: WorkflowRun, *, resumed_at: datetime | None) -> None:
    pause = WorkflowPause(workflow_id=row.workflow_id, workflow_run_id=row.id, state_object_key="state.json")
    pause.resumed_at = resumed_at
    session.add(pause)
    session.commit()


def _running_since(sqlite_session_factory: sessionmaker[Session], row: WorkflowRun) -> datetime | None:
    result = SQLAlchemyRunResultReader(session_factory=sqlite_session_factory).run(
        tenant_id=row.tenant_id, run_id=row.id
    )
    assert result is not None
    return result.running_since


def test_a_running_run_that_never_paused_has_run_since_it_started(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    row = _add_run(sqlite_session, tenant_id=str(uuid4()), status=WorkflowExecutionStatus.RUNNING)
    _started_at(sqlite_session, row, STARTED_AT)

    assert _running_since(sqlite_session_factory, row) == STARTED_AT


def test_a_running_run_resumed_after_a_pause_has_run_since_it_resumed(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """Paused time does not count: core's own time limit restarts when a run resumes."""
    row = _add_run(sqlite_session, tenant_id=str(uuid4()), status=WorkflowExecutionStatus.RUNNING)
    _started_at(sqlite_session, row, STARTED_AT)
    _add_pause(sqlite_session, row, resumed_at=RESUMED_AT)

    assert _running_since(sqlite_session_factory, row) == RESUMED_AT


def test_a_running_run_with_a_pause_not_marked_resumed_has_no_known_running_time(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    row = _add_run(sqlite_session, tenant_id=str(uuid4()), status=WorkflowExecutionStatus.RUNNING)
    _add_pause(sqlite_session, row, resumed_at=None)

    assert _running_since(sqlite_session_factory, row) is None


@pytest.mark.parametrize(
    "stored",
    [WorkflowExecutionStatus.PAUSED, WorkflowExecutionStatus.SUCCEEDED, WorkflowExecutionStatus.FAILED],
)
def test_a_run_that_is_not_running_has_no_running_time(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], stored: WorkflowExecutionStatus
) -> None:
    row = _add_run(sqlite_session, tenant_id=str(uuid4()), status=stored)
    _add_pause(sqlite_session, row, resumed_at=RESUMED_AT)

    assert _running_since(sqlite_session_factory, row) is None


class _RecordedFrames:
    def __init__(self, frames: list[Mapping[str, object]]) -> None:
        self._frames = frames
        self.read = 0
        self.closed = False

    def __iter__(self) -> Iterator[Mapping[str, object]]:
        for frame in self._frames:
            self.read += 1
            yield frame

    def close(self) -> None:
        self.closed = True


_FORM = human_input_form("f1")
_FORM_FRAME = _FORM.model_dump(mode="json")
_PAUSED_FRAME: dict[str, object] = {"event": "workflow_paused", "data": {}}
_PING_FRAME: dict[str, object] = {"event": "node_started", "data": {}}


def _patch_stream(monkeypatch: pytest.MonkeyPatch, frames: _RecordedFrames) -> list[dict[str, object]]:
    calls: list[dict[str, object]] = []

    def build(**kwargs: object) -> _RecordedFrames:
        calls.append(kwargs)
        return frames

    monkeypatch.setattr(run_job_result_repository, "build_workflow_event_stream", build)
    return calls


def _read_form(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], mode: AppMode = AppMode.WORKFLOW
) -> HumanInputRequiredResponse | None:
    tenant_id = str(uuid4())
    row = _add_run(sqlite_session, tenant_id=tenant_id, status=WorkflowExecutionStatus.PAUSED)
    return SQLAlchemyRunResultReader(session_factory=sqlite_session_factory).pending_form(
        tenant_id=tenant_id, app_id=row.app_id, run_id=row.id, mode=mode
    )


def test_pending_form_returns_the_last_human_input_event(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    frames = _RecordedFrames([_FORM_FRAME, _PAUSED_FRAME])
    calls = _patch_stream(monkeypatch, frames)

    form = _read_form(sqlite_session, sqlite_session_factory)

    assert form == _FORM
    assert calls[0]["idle_timeout"] == 2
    assert calls[0]["close_on_pause"] is True


def test_pending_form_stops_at_the_pause_and_closes_the_stream(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    later_form = human_input_form("f2").model_dump(mode="json")
    frames = _RecordedFrames([_PING_FRAME, _FORM_FRAME, _PAUSED_FRAME, later_form])
    _patch_stream(monkeypatch, frames)

    form = _read_form(sqlite_session, sqlite_session_factory, AppMode.ADVANCED_CHAT)

    assert form == _FORM
    assert frames.read == 3
    assert frames.closed


def test_pending_form_is_none_when_the_last_form_does_not_fit_cores_model(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    unreadable = {"event": "human_input_required", "data": {"form_token": "t2"}}
    _patch_stream(monkeypatch, _RecordedFrames([_FORM_FRAME, unreadable, _PAUSED_FRAME]))

    with caplog.at_level(logging.ERROR, logger="services.run_job.frames"):
        assert _read_form(sqlite_session, sqlite_session_factory) is None

    assert "human_input_required" in caplog.text
    assert "t2" not in caplog.text


class _RaisingFrames(_RecordedFrames):
    @override
    def __iter__(self) -> Iterator[Mapping[str, object]]:
        yield self._frames[0]
        raise RuntimeError("stream broke")


def test_pending_form_closes_the_stream_when_reading_raises(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    frames = _RaisingFrames([_FORM_FRAME])
    _patch_stream(monkeypatch, frames)

    with pytest.raises(RuntimeError, match="stream broke"):
        _read_form(sqlite_session, sqlite_session_factory)

    assert frames.closed


def test_pending_form_is_none_when_the_run_is_not_waiting_on_a_form(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    frames = _RecordedFrames([_PING_FRAME, {"event": "workflow_finished", "data": {"status": "succeeded"}}])
    _patch_stream(monkeypatch, frames)

    assert _read_form(sqlite_session, sqlite_session_factory) is None
    assert frames.closed


def test_pending_form_is_none_for_an_absent_run(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _patch_stream(monkeypatch, _RecordedFrames([_FORM_FRAME, _PAUSED_FRAME]))
    reader = SQLAlchemyRunResultReader(session_factory=sqlite_session_factory)

    absent = reader.pending_form(
        tenant_id=str(uuid4()), app_id=str(uuid4()), run_id=str(uuid4()), mode=AppMode.WORKFLOW
    )

    assert absent is None
    assert calls == []


def test_pending_form_is_none_once_the_run_has_resumed(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _patch_stream(monkeypatch, _RecordedFrames([_FORM_FRAME, _PAUSED_FRAME]))
    tenant_id = str(uuid4())
    row = _add_run(sqlite_session, tenant_id=tenant_id, status=WorkflowExecutionStatus.RUNNING)

    form = SQLAlchemyRunResultReader(session_factory=sqlite_session_factory).pending_form(
        tenant_id=tenant_id, app_id=row.app_id, run_id=row.id, mode=AppMode.WORKFLOW
    )

    assert form is None
    assert calls == []


def _add_message(session: Session, *, app_id: str, answer: str, error: str | None = None) -> Message:
    message = Message(
        app_id=app_id,
        conversation_id=str(uuid4()),
        query="q",
        message={},
        answer=answer,
        from_source=ConversationFromSource.API,
        error=error,
    )
    session.add(message)
    session.commit()
    return message


def test_message_reads_answer_and_error_by_id_and_app(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    app_id = str(uuid4())
    row = _add_message(sqlite_session, app_id=app_id, answer="hello", error="late failure")

    result = SQLAlchemyRunResultReader(session_factory=sqlite_session_factory).message(app_id=app_id, message_id=row.id)

    assert result == MessageResult(answer="hello", error="late failure")


def test_message_of_another_app_is_not_found(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    row = _add_message(sqlite_session, app_id=str(uuid4()), answer="hello")
    reader = SQLAlchemyRunResultReader(session_factory=sqlite_session_factory)

    assert reader.message(app_id=str(uuid4()), message_id=row.id) is None
    assert reader.message(app_id=row.app_id, message_id=str(uuid4())) is None


def test_message_answer_file_links_are_re_signed(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(SECRET_KEY="unit-secret", FILES_URL="https://files.example.com")
    tool_file_id = str(uuid4())
    stored_url = sign_tool_file_uri(tool_file_id, ".png")
    app_id = str(uuid4())
    row = _add_message(sqlite_session, app_id=app_id, answer=f"see [file]({stored_url}) here")

    result = SQLAlchemyRunResultReader(session_factory=sqlite_session_factory).message(app_id=app_id, message_id=row.id)

    assert result is not None
    assert stored_url not in result.answer
    returned = urlsplit(result.answer.split("(")[1].split(")")[0])
    assert returned.path == f"/files/tools/{tool_file_id}.png"
    assert parse_qs(returned.query)["sign"] != parse_qs(urlsplit(stored_url).query)["sign"]
