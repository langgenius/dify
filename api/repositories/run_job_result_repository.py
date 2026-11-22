"""Read stored app run results and pending human input forms for run jobs."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from types import MappingProxyType
from typing import Final

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.task_entities import HumanInputRequiredResponse
from core.workflow.human_input_policy import HumanInputSurface
from factories.file_url_factory import re_sign_file_urls
from graphon.enums import WorkflowExecutionStatus
from libs.stream import close_stream
from models.model import AppMode, Message
from models.workflow import WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from services.run_job import RUN_STATUS_TO_JOB_STATUS, JobStatus, MessageResult, RunResult, pending_form
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

        Postcondition: the run's job status, outputs and error, and for a running run when it started or last
        resumed (see _running_since); None when the run is not stored for the tenant or its stored status has no job
        status.
        """
        row = self._runs.get_workflow_run_by_id_and_tenant_id(tenant_id=tenant_id, run_id=run_id)
        if row is None:
            return None
        status = STORED_STATUS_TO_JOB_STATUS.get(row.status)
        if status is None:
            return None
        running_since = self._running_since(row) if status is JobStatus.RUNNING else None
        return RunResult(status=status, outputs=row.outputs_dict, error=row.error, running_since=running_since)

    def _running_since(self, row: WorkflowRun) -> datetime | None:
        """Read when a running run started or last resumed.

        Precondition: row is a running run.
        Postcondition: the run's created_at when it has no pause row (core writes it when the run starts); the pause
        row's resumed_at when it has one (core keeps a run's latest pause row until the resumed run ends, and its
        time limit restarts at the resume); None for a pause row not marked resumed, as the time is then not known.
        """
        pause = self._runs.get_workflow_pause(row.id)
        if pause is None:
            return row.created_at
        return pause.resumed_at

    def message(self, *, app_id: str, message_id: str) -> MessageResult | None:
        """Read the saved answer and error of a message.

        Precondition: ownership of the message was proven by the job that points at it.
        Postcondition: the message's answer, with its file links re-signed, and error; None when no message has
        that id in the app. The session is closed.
        """
        stmt = sa.select(Message.answer, Message.error).where(Message.id == message_id, Message.app_id == app_id)
        with self._session_factory() as session:
            row = session.execute(stmt).one_or_none()
        if row is None:
            return None
        return MessageResult(answer=re_sign_file_urls(row.answer), error=row.error)

    def pending_form(
        self, *, tenant_id: str, app_id: str, run_id: str, mode: AppMode
    ) -> HumanInputRequiredResponse | None:
        """Read the human input form a paused run waits on.

        Precondition: the run is paused; mode is a graph mode.
        Postcondition: the last human_input_required event of the run's snapshot, or None when the run is absent or
        no longer paused, or no form is pending. The snapshot stream is closed.
        """
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
            close_stream(source)
