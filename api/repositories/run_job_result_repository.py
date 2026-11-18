"""Read stored app run results and pending human input forms for run jobs."""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.task_entities import HumanInputRequiredResponse
from core.workflow.human_input_policy import HumanInputSurface
from graphon.enums import WorkflowExecutionStatus
from models.model import AppMode
from repositories.factory import DifyAPIRepositoryFactory
from services.run_job_contracts import JobStatus
from services.run_job_frames import pending_form
from services.run_job_reader import RUN_STATUS_TO_JOB_STATUS, close_frames
from services.run_job_service import RunResult
from services.workflow.graph_check import GRAPH_MODES
from services.workflow_event_snapshot_service import build_workflow_event_stream

PENDING_FORM_IDLE_TIMEOUT_SECONDS: Final = 2

STORED_STATUS_TO_JOB_STATUS: Final[Mapping[WorkflowExecutionStatus, JobStatus]] = MappingProxyType(
    {
        **RUN_STATUS_TO_JOB_STATUS,
        WorkflowExecutionStatus.RUNNING: JobStatus.RUNNING,
        WorkflowExecutionStatus.PAUSED: JobStatus.PAUSED,
    }
)


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

    def pending_form(
        self, *, tenant_id: str, app_id: str, run_id: str, mode: AppMode
    ) -> HumanInputRequiredResponse | None:
        """Read the human input form a paused run waits on.

        Precondition: the run is paused.
        Postcondition: the last human_input_required event of the run's snapshot, or None when the run is absent or
        no longer paused, the mode has no snapshot, or no form is pending. The snapshot stream is closed.
        """
        if mode not in GRAPH_MODES:
            return None
        row = self._runs.get_workflow_run_by_id_and_tenant_id(tenant_id=tenant_id, run_id=run_id)
        if row is None:
            return None
        if row.status is not WorkflowExecutionStatus.PAUSED:
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
        try:
            return pending_form(source)
        finally:
            close_frames(source)
