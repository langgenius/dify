"""
SQLAlchemy implementation of WorkflowTriggerLogRepository.
"""

import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import cast, override

from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from models.enums import WorkflowRunTriggeredFrom, WorkflowTriggerStatus
from models.trigger import WorkflowTriggerLog
from models.workflow import WorkflowAppLog, WorkflowAppLogCreatedFrom, WorkflowRun
from repositories.workflow_trigger_log_repository import WorkflowTriggerLogRepository
from services.workflow.entities import TriggerActor, TriggerData, TriggerWorkflowSnapshot


class SQLAlchemyWorkflowTriggerLogRepository(WorkflowTriggerLogRepository):
    """
    SQLAlchemy implementation of WorkflowTriggerLogRepository.

    Optimized for large table operations with proper indexing and batch processing.
    """

    def __init__(self, session: Session):
        self.session = session

    @override
    def create(self, trigger_log: WorkflowTriggerLog) -> WorkflowTriggerLog:
        """Create a new trigger log entry."""
        self.session.add(trigger_log)
        self.session.flush()
        return trigger_log

    @override
    def update(self, trigger_log: WorkflowTriggerLog) -> WorkflowTriggerLog:
        """Update an existing trigger log entry."""
        self.session.merge(trigger_log)
        self.session.flush()
        return trigger_log

    @override
    def get_by_id(self, trigger_log_id: str, tenant_id: str | None = None) -> WorkflowTriggerLog | None:
        """Get a trigger log by its ID."""
        query = select(WorkflowTriggerLog).where(WorkflowTriggerLog.id == trigger_log_id)

        if tenant_id:
            query = query.where(WorkflowTriggerLog.tenant_id == tenant_id)

        return self.session.scalar(query)

    def list_by_run_id(self, run_id: str) -> Sequence[WorkflowTriggerLog]:
        """List trigger logs for a workflow run."""
        query = select(WorkflowTriggerLog).where(WorkflowTriggerLog.workflow_run_id == run_id)
        return list(self.session.scalars(query).all())

    @override
    def get_failed_for_retry(
        self, tenant_id: str, max_retry_count: int = 3, limit: int = 100
    ) -> Sequence[WorkflowTriggerLog]:
        """Get failed trigger logs eligible for retry."""
        query = (
            select(WorkflowTriggerLog)
            .where(
                and_(
                    WorkflowTriggerLog.tenant_id == tenant_id,
                    WorkflowTriggerLog.status.in_([WorkflowTriggerStatus.FAILED, WorkflowTriggerStatus.RATE_LIMITED]),
                    WorkflowTriggerLog.retry_count < max_retry_count,
                )
            )
            .order_by(WorkflowTriggerLog.created_at.asc())
            .limit(limit)
        )

        return list(self.session.scalars(query).all())

    @override
    def get_recent_logs(
        self, tenant_id: str, app_id: str, hours: int = 24, limit: int = 100, offset: int = 0
    ) -> Sequence[WorkflowTriggerLog]:
        """Get recent trigger logs within specified hours."""
        since = datetime.now(UTC) - timedelta(hours=hours)

        query = (
            select(WorkflowTriggerLog)
            .where(
                and_(
                    WorkflowTriggerLog.tenant_id == tenant_id,
                    WorkflowTriggerLog.app_id == app_id,
                    WorkflowTriggerLog.created_at >= since,
                )
            )
            .order_by(WorkflowTriggerLog.created_at.desc())
            .limit(limit)
            .offset(offset)
        )

        return list(self.session.scalars(query).all())

    @override
    def get_by_workflow_run_id(self, workflow_run_id: str) -> WorkflowTriggerLog | None:
        """Get the trigger log associated with a workflow run."""
        query = (
            select(WorkflowTriggerLog)
            .where(WorkflowTriggerLog.workflow_run_id == workflow_run_id)
            .order_by(WorkflowTriggerLog.created_at.desc())
            .limit(1)
        )
        return self.session.scalar(query)

    @override
    def delete_by_run_ids(self, run_ids: Sequence[str]) -> int:
        """
        Delete trigger logs associated with the given workflow run ids.

        Args:
            run_ids: Collection of workflow run identifiers.

        Returns:
            Number of rows deleted.
        """
        if not run_ids:
            return 0

        result = self.session.execute(delete(WorkflowTriggerLog).where(WorkflowTriggerLog.workflow_run_id.in_(run_ids)))
        return cast(CursorResult, result).rowcount or 0

    def count_by_run_ids(self, run_ids: Sequence[str]) -> int:
        """
        Count trigger logs associated with the given workflow run ids.

        Args:
            run_ids: Collection of workflow run identifiers.

        Returns:
            Number of rows matched.
        """
        if not run_ids:
            return 0

        count = self.session.scalar(
            select(func.count()).select_from(WorkflowTriggerLog).where(WorkflowTriggerLog.workflow_run_id.in_(run_ids))
        )
        return int(count or 0)


class SQLAlchemyWorkflowTriggerDispatchRepository:
    """Transaction-owning trigger log writes for producers.

    Runtime and retention code still borrow a caller session through the repository
    above. These producer operations close their sessions before broker or billing I/O.
    """

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def create_pending(self, *, actor: TriggerActor, trigger_data: TriggerData, workflow_id: str, queue: str) -> str:
        log = self._new_log(actor=actor, trigger_data=trigger_data, workflow_id=workflow_id, queue=queue)
        with self._session_factory.begin() as session:
            SQLAlchemyWorkflowTriggerLogRepository(session).create(log)
            log_id = log.id
        return log_id

    def mark_failed(
        self, *, tenant_id: str, app_id: str, log_id: str, status: WorkflowTriggerStatus, error: str
    ) -> None:
        with self._session_factory.begin() as session:
            session.execute(
                update(WorkflowTriggerLog)
                .where(
                    WorkflowTriggerLog.id == log_id,
                    WorkflowTriggerLog.tenant_id == tenant_id,
                    WorkflowTriggerLog.app_id == app_id,
                )
                .values(status=status, error=error)
            )

    def mark_queued(self, *, tenant_id: str, app_id: str, log_id: str, task_id: str) -> None:
        with self._session_factory.begin() as session:
            session.execute(
                update(WorkflowTriggerLog)
                .where(
                    WorkflowTriggerLog.id == log_id,
                    WorkflowTriggerLog.tenant_id == tenant_id,
                    WorkflowTriggerLog.app_id == app_id,
                )
                .values(status=WorkflowTriggerStatus.QUEUED, celery_task_id=task_id, triggered_at=datetime.now(UTC))
            )

    def record_invocation_failure(
        self,
        *,
        workflow: TriggerWorkflowSnapshot,
        actor: TriggerActor,
        trigger_data: TriggerData,
        failure_inputs: Mapping[str, str],
        error: str,
        queue: str,
    ) -> None:
        now = datetime.now(UTC)
        run = WorkflowRun(
            tenant_id=workflow.tenant_id,
            app_id=workflow.app_id,
            workflow_id=workflow.id,
            type=workflow.type,
            triggered_from=WorkflowRunTriggeredFrom.PLUGIN.value,
            version=workflow.version,
            graph=workflow.graph,
            inputs=json.dumps(dict(failure_inputs)),
            status=WorkflowExecutionStatus.FAILED.value,
            outputs="{}",
            error=error,
            elapsed_time=0.0,
            total_tokens=0,
            total_steps=0,
            created_by_role=actor.role,
            created_by=actor.id,
            created_at=now,
            finished_at=now,
            exceptions_count=0,
        )
        log = self._new_log(actor=actor, trigger_data=trigger_data, workflow_id=workflow.id, queue=queue)
        log.status = WorkflowTriggerStatus.FAILED
        log.error = error
        log.triggered_at = now
        log.finished_at = now
        log.elapsed_time = 0.0
        log.total_tokens = 0
        with self._session_factory.begin() as session:
            session.add(run)
            session.flush()
            session.add(
                WorkflowAppLog(
                    tenant_id=workflow.tenant_id,
                    app_id=workflow.app_id,
                    workflow_id=workflow.id,
                    workflow_run_id=run.id,
                    created_from=WorkflowAppLogCreatedFrom.SERVICE_API,
                    created_by_role=actor.role,
                    created_by=actor.id,
                )
            )
            log.workflow_run_id = run.id
            SQLAlchemyWorkflowTriggerLogRepository(session).create(log)

    @staticmethod
    def _new_log(*, actor: TriggerActor, trigger_data: TriggerData, workflow_id: str, queue: str) -> WorkflowTriggerLog:
        return WorkflowTriggerLog(
            tenant_id=trigger_data.tenant_id,
            app_id=trigger_data.app_id,
            workflow_id=workflow_id,
            root_node_id=trigger_data.root_node_id,
            trigger_metadata=trigger_data.trigger_metadata.model_dump_json() if trigger_data.trigger_metadata else "{}",
            trigger_type=trigger_data.trigger_type,
            workflow_run_id=None,
            outputs=None,
            trigger_data=trigger_data.model_dump_json(),
            inputs=json.dumps(dict(trigger_data.inputs)),
            status=WorkflowTriggerStatus.PENDING,
            queue_name=queue,
            retry_count=0,
            created_by_role=actor.role,
            created_by=actor.id,
            celery_task_id=None,
            error=None,
            elapsed_time=None,
            total_tokens=None,
        )
