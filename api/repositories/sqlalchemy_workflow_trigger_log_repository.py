"""
SQLAlchemy implementation of WorkflowTriggerLogRepository.
"""

import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, cast, override

from pydantic import TypeAdapter
from sqlalchemy import and_, case, delete, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from models.account import Account, Tenant, TenantAccountJoin
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom, WorkflowTriggerStatus
from models.model import App, EndUser
from models.trigger import WorkflowTriggerLog
from models.workflow import Workflow, WorkflowAppLog, WorkflowAppLogCreatedFrom, WorkflowRun, WorkflowType
from repositories.workflow_trigger_log_repository import WorkflowTriggerLogRepository
from services.errors.app import WorkflowNotFoundError
from services.trigger.execution_store import TriggerExecution, TriggerExecutionRef
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


class SQLAlchemyWorkflowTriggerExecutionRepository:
    """Transaction-owning producer and worker lifecycle operations.

    Retention code still borrows a caller session through the repository above.
    All operations close their sessions before broker, billing or runtime I/O.
    TODO: Remove the borrowed-session implementation when retention migrates.
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
                    WorkflowTriggerLog.status == WorkflowTriggerStatus.PENDING,
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
                .values(
                    # Publication may return after the worker has already advanced the log.
                    status=case(
                        (WorkflowTriggerLog.status == WorkflowTriggerStatus.PENDING, WorkflowTriggerStatus.QUEUED),
                        else_=WorkflowTriggerLog.status,
                    ),
                    celery_task_id=func.coalesce(WorkflowTriggerLog.celery_task_id, task_id),
                    triggered_at=func.coalesce(WorkflowTriggerLog.triggered_at, datetime.now(UTC)),
                )
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
            type=WorkflowType(workflow.type),
            triggered_from=WorkflowRunTriggeredFrom.PLUGIN,
            version=workflow.version,
            graph=workflow.graph,
            inputs=json.dumps(dict(failure_inputs)),
            status=WorkflowExecutionStatus.FAILED,
            outputs="{}",
            error=error,
            elapsed_time=0.0,
            total_tokens=0,
            total_steps=0,
            created_by_role=actor.role,
            created_by=actor.id,
            finished_at=now,
            exceptions_count=0,
        )
        run.created_at = now
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

    def start(self, log_id: str) -> TriggerExecution | None:
        """Claim a pending task once; missing or already claimed logs return None."""
        with self._session_factory.begin() as session:
            result = session.execute(
                update(WorkflowTriggerLog)
                .where(
                    WorkflowTriggerLog.id == log_id,
                    WorkflowTriggerLog.status.in_([WorkflowTriggerStatus.PENDING, WorkflowTriggerStatus.QUEUED]),
                )
                .values(status=WorkflowTriggerStatus.RUNNING)
            )
            assert isinstance(result, CursorResult)
            if not result.rowcount:
                return None
            row = session.get(WorkflowTriggerLog, log_id)
            assert row is not None
            data = TriggerData.model_validate_json(row.trigger_data)
            execution = TriggerExecution(
                log=self._ref(row),
                workflow_id=row.workflow_id,
                actor=TriggerActor(id=row.created_by, role=row.created_by_role),
                data=data,
            )
            return execution

    def find_for_run(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> TriggerExecutionRef | None:
        with self._session_factory() as session:
            row = session.scalar(
                select(WorkflowTriggerLog)
                .where(
                    WorkflowTriggerLog.tenant_id == tenant_id,
                    WorkflowTriggerLog.app_id == app_id,
                    WorkflowTriggerLog.workflow_run_id == workflow_run_id,
                )
                .order_by(WorkflowTriggerLog.created_at.desc())
                .limit(1)
            )
            return self._ref(row) if row else None

    def fail(self, *, log: TriggerExecutionRef, error: str, finished_at: datetime, elapsed_time: float) -> None:
        with self._session_factory.begin() as session:
            session.execute(
                update(WorkflowTriggerLog)
                .where(
                    WorkflowTriggerLog.id == log.id,
                    WorkflowTriggerLog.tenant_id == log.tenant_id,
                    WorkflowTriggerLog.app_id == log.app_id,
                    WorkflowTriggerLog.status == WorkflowTriggerStatus.RUNNING,
                )
                .values(
                    status=WorkflowTriggerStatus.FAILED, error=error, finished_at=finished_at, elapsed_time=elapsed_time
                )
            )

    def finish(
        self,
        *,
        log: TriggerExecutionRef,
        status: WorkflowTriggerStatus,
        workflow_run_id: str,
        outputs: Mapping[str, Any],
        total_tokens: int,
        finished_at: datetime,
        elapsed_time: float,
        abort_reason: str | None,
    ) -> bool:
        # Serialize before acquiring a database connection.
        serialized_outputs = TypeAdapter(dict[str, Any]).dump_json(dict(outputs)).decode()
        statement = (
            update(WorkflowTriggerLog)
            .where(
                WorkflowTriggerLog.id == log.id,
                WorkflowTriggerLog.tenant_id == log.tenant_id,
                WorkflowTriggerLog.app_id == log.app_id,
                # HITL resumes the same run without invoking start() again.
                WorkflowTriggerLog.status.in_([WorkflowTriggerStatus.RUNNING, WorkflowTriggerStatus.PAUSED]),
            )
            .values(
                status=status,
                workflow_run_id=workflow_run_id,
                outputs=serialized_outputs,
                total_tokens=total_tokens,
                finished_at=finished_at,
                elapsed_time=func.coalesce(WorkflowTriggerLog.elapsed_time, 0) + elapsed_time,
            )
        )
        if abort_reason is not None:
            statement = statement.values(error=abort_reason)
        with self._session_factory.begin() as session:
            result = session.execute(statement)
            assert isinstance(result, CursorResult)
            return bool(result.rowcount)

    def get_execution_models(self, execution: TriggerExecution) -> tuple[App, Workflow, Account | EndUser]:
        """Load the legacy generator's scalar ORM fields, then detach before runtime I/O.

        This compatibility return is consumed only by the generator gateway; application
        services and graph layers receive the immutable execution identity instead.
        """
        log = execution.log
        with self._session_factory() as session:
            app = session.scalar(select(App).where(App.id == log.app_id, App.tenant_id == log.tenant_id))
            if app is None:
                raise WorkflowNotFoundError(f"App not found: {log.app_id}")
            workflow = session.scalar(
                select(Workflow).where(
                    Workflow.id == execution.workflow_id,
                    Workflow.tenant_id == log.tenant_id,
                    Workflow.app_id == log.app_id,
                )
            )
            if workflow is None:
                raise WorkflowNotFoundError(f"Workflow not found: {execution.workflow_id}")
            tenant = session.get(Tenant, log.tenant_id)
            if tenant is None:
                raise WorkflowNotFoundError(f"Tenant not found: {log.tenant_id}")
            actor: Account | EndUser | None
            if execution.actor.role == CreatorUserRole.ACCOUNT:
                actor = session.scalar(
                    select(Account)
                    .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                    .where(Account.id == execution.actor.id, TenantAccountJoin.tenant_id == log.tenant_id)
                )
                if actor is not None:
                    actor.set_current_tenant_with_session(tenant, session=session)
            else:
                actor = session.scalar(
                    select(EndUser).where(
                        EndUser.id == execution.actor.id,
                        EndUser.tenant_id == log.tenant_id,
                        EndUser.app_id == log.app_id,
                    )
                )
            if actor is None:
                raise WorkflowNotFoundError(f"User not found: {execution.actor.id}")
            return app, workflow, actor

    @staticmethod
    def _ref(row: WorkflowTriggerLog) -> TriggerExecutionRef:
        return TriggerExecutionRef(id=row.id, tenant_id=row.tenant_id, app_id=row.app_id, queue_name=row.queue_name)
