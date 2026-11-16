import json
from collections.abc import Iterator, Mapping
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole
from models.model import AppMode
from models.workflow import WorkflowRun, WorkflowRunTriggeredFrom, WorkflowType
from repositories import run_job_result_repository
from repositories.run_job_result_repository import SQLAlchemyRunResultReader
from services.run_job_contracts import JobStatus
from services.run_job_service import RunJobService


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


_FORM_FRAME = {"event": "human_input_required", "data": {"form_token": "t1"}}
_PAUSED_FRAME = {"event": "workflow_paused", "data": {"form_token": "t1"}}
_PING_FRAME = {"event": "node_started", "data": {}}


def _patch_stream(monkeypatch: pytest.MonkeyPatch, frames: _RecordedFrames) -> list[dict[str, object]]:
    calls: list[dict[str, object]] = []

    def build(**kwargs: object) -> _RecordedFrames:
        calls.append(kwargs)
        return frames

    monkeypatch.setattr(run_job_result_repository, "build_workflow_event_stream", build)
    return calls


def _read_form(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], mode: AppMode = AppMode.WORKFLOW
) -> Mapping[str, object] | None:
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

    assert form == {"form_token": "t1"}
    assert calls[0]["idle_timeout"] == 2
    assert calls[0]["close_on_pause"] is True


def test_pending_form_stops_at_the_pause_and_closes_the_stream(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    later_form = {"event": "human_input_required", "data": {"form_token": "t2"}}
    frames = _RecordedFrames([_PING_FRAME, _FORM_FRAME, _PAUSED_FRAME, later_form])
    _patch_stream(monkeypatch, frames)

    form = _read_form(sqlite_session, sqlite_session_factory, AppMode.ADVANCED_CHAT)

    assert form == {"form_token": "t1"}
    assert frames.read == 3
    assert frames.closed


class _RaisingFrames(_RecordedFrames):
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


def test_pending_form_is_none_for_an_absent_run_or_a_mode_without_a_snapshot(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _patch_stream(monkeypatch, _RecordedFrames([_FORM_FRAME, _PAUSED_FRAME]))
    reader = SQLAlchemyRunResultReader(session_factory=sqlite_session_factory)

    absent = reader.pending_form(
        tenant_id=str(uuid4()), app_id=str(uuid4()), run_id=str(uuid4()), mode=AppMode.WORKFLOW
    )
    chat = reader.pending_form(tenant_id=str(uuid4()), app_id=str(uuid4()), run_id=str(uuid4()), mode=AppMode.CHAT)

    assert absent is None
    assert chat is None
    assert calls == []


def test_the_built_services_carry_a_run_job_service(account_application_services) -> None:
    assert isinstance(account_application_services.run_jobs, RunJobService)
