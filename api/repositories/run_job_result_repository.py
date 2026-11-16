"""Read stored app run results and pending human input forms for run jobs."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from types import MappingProxyType
from typing import Any, Final, Protocol, runtime_checkable

from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.task_entities import StreamEvent
from core.workflow.human_input_policy import HumanInputSurface
from graphon.enums import WorkflowExecutionStatus
from models.model import AppMode
from repositories.factory import DifyAPIRepositoryFactory
from services.run_job_contracts import JobStatus
from services.run_job_reader import RUN_STATUS_TO_JOB_STATUS, decode_frame
from services.run_job_service import RunResult
from services.workflow_event_snapshot_service import build_workflow_event_stream

PENDING_FORM_IDLE_TIMEOUT_SECONDS: Final = 2

STORED_STATUS_TO_JOB_STATUS: Final[Mapping[WorkflowExecutionStatus, JobStatus]] = MappingProxyType(
    {
        **RUN_STATUS_TO_JOB_STATUS,
        WorkflowExecutionStatus.RUNNING: JobStatus.RUNNING,
        WorkflowExecutionStatus.PAUSED: JobStatus.PAUSED,
    }
)

SNAPSHOT_GENERATORS: Final[Mapping[AppMode, type[BaseAppGenerator]]] = MappingProxyType(
    {
        AppMode.ADVANCED_CHAT: AdvancedChatAppGenerator,
        AppMode.WORKFLOW: WorkflowAppGenerator,
    }
)

_FORM_EVENT: Final = StreamEvent.HUMAN_INPUT_REQUIRED.value
_STOP_EVENTS: Final = frozenset({StreamEvent.WORKFLOW_PAUSED.value, StreamEvent.WORKFLOW_FINISHED.value})


@runtime_checkable
class _Closable(Protocol):
    def close(self) -> None: ...


def _last_form(frames: Iterable[str]) -> Mapping[str, Any] | None:
    """Read frames up to the first pause or finish and keep the last human input form.

    Precondition: none.
    Postcondition: the data of the last human_input_required frame read, or None; frames after the first
    workflow_paused or workflow_finished frame are not read.
    """
    form: Mapping[str, Any] | None = None
    for frame in frames:
        payload = decode_frame(frame) or {}
        event = payload.get("event")
        data = payload.get("data")
        if event == _FORM_EVENT and isinstance(data, Mapping):
            form = data
        if event in _STOP_EVENTS:
            return form
    return form


class SQLAlchemyRunResultReader:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        """Create the reader.

        Precondition: session_factory opens sessions on the application database.
        Postcondition: no session is held.
        """
        self._session_factory = session_factory
        self._runs = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_factory)

    def run(self, *, tenant_id: str, run_id: str) -> RunResult | None:
        """Read the stored result of a run.

        Precondition: none.
        Postcondition: the run's job status, outputs and error; None when the run is not stored for the tenant or
        its stored status has no job status.
        """
        row = self._runs.get_workflow_run_by_id_and_tenant_id(tenant_id=tenant_id, run_id=run_id)
        if row is None:
            return None
        status = STORED_STATUS_TO_JOB_STATUS.get(row.status)
        if status is None:
            return None
        return RunResult(status=status, outputs=row.outputs_dict, error=row.error)

    def pending_form(self, *, tenant_id: str, app_id: str, run_id: str, mode: AppMode) -> Mapping[str, Any] | None:
        """Read the human input form a paused run waits on.

        Precondition: the run is paused.
        Postcondition: the data of the last human_input_required event of the run's snapshot, or None when the run
        is absent, the mode has no snapshot, or no form is pending. The snapshot stream is closed.
        """
        generator = SNAPSHOT_GENERATORS.get(mode)
        if generator is None:
            return None
        row = self._runs.get_workflow_run_by_id_and_tenant_id(tenant_id=tenant_id, run_id=run_id)
        if row is None:
            return None
        source = build_workflow_event_stream(
            app_mode=mode,
            workflow_run=row,
            tenant_id=tenant_id,
            app_id=app_id,
            session_maker=self._session_factory,
            human_input_surface=HumanInputSurface.OPENAPI,
            close_on_pause=True,
            idle_timeout=PENDING_FORM_IDLE_TIMEOUT_SECONDS,
        )
        frames = generator.convert_to_event_stream(source)
        try:
            return _last_form(frames)
        finally:
            for stream in (frames, source):
                if isinstance(stream, _Closable):
                    stream.close()
