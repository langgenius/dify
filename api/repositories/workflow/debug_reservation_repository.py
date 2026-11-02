"""Claim and expire debug reservations under the same execution row lock."""

import json
import uuid
from dataclasses import replace
from datetime import datetime, timedelta
from itertools import starmap

from sqlalchemy import delete, select, tuple_
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enums.agent import WorkflowAgentBindingType
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models import App
from models.agent import WORKFLOW_EXECUTION_BINDING_VERSION, WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowDebugReservation, WorkflowRun, WorkflowType
from repositories.agent.workflow_binding_repository import WorkflowAgentBindingRepository
from repositories.workflow.definition_repository import WorkflowDefinitionStore, workflow_snapshot
from repositories.workflow.execution_write_repository import (
    DebugLease,
    lock_workflow_run,
    read_debug_lease,
    write_debug_lease,
)
from services.errors.app import WorkflowNotFoundError
from services.errors.workflow_service import (
    WorkflowDebugReservationAlreadyClaimedError,
    WorkflowDebugReservationExpiredError,
)
from services.workflow.contracts import DebugReservationCursor, ExpiredDebugReservation, WorkflowSnapshot


class WorkflowDebugReservationRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def reserve_trigger_debug(self, context: RequestContext, app_id: str) -> tuple[App, WorkflowSnapshot]:
        with self._sessions.begin() as session:
            app = WorkflowDefinitionStore.lock_app(session, context, app_id)
            workflow = WorkflowDefinitionStore.get_draft_workflow(app, session=session, for_update=True)
            if workflow is None:
                raise WorkflowNotFoundError("Workflow not found")
            snapshot = workflow_snapshot(workflow)
            bindings = WorkflowAgentBindingRepository(session).execution_bindings(snapshot)
            if not bindings:
                session.expunge(app)
                return app, snapshot
            execution_id = str(uuid.uuid4())
            graph = dict(snapshot.graph_dict)
            graph["_agent_bindings"] = {"execution_id": execution_id, "bindings": bindings}
            snapshot = replace(snapshot, graph=json.dumps(graph), execution_id=execution_id)
            run = WorkflowRun(
                id=execution_id,
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                type=WorkflowType(workflow.type),
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                version=workflow.version,
                graph=snapshot.graph,
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=context.account_id,
            )
            session.add(run)
            write_debug_lease(
                session,
                run,
                DebugLease(naive_utc_now() + timedelta(seconds=dify_config.WORKFLOW_DEBUG_RESERVATION_TIMEOUT)),
            )
            session.add_all(
                WorkflowAgentNodeBinding(
                    tenant_id=app.tenant_id,
                    app_id=app.id,
                    workflow_id=execution_id,
                    workflow_version=WORKFLOW_EXECUTION_BINDING_VERSION,
                    node_id=node_id,
                    binding_type=WorkflowAgentBindingType(binding["binding_type"]),
                    agent_id=binding["agent_id"],
                    current_snapshot_id=binding["current_snapshot_id"],
                    node_job_config=WorkflowNodeJobConfig.model_validate(binding["node_job_config"]),
                    created_by=context.account_id,
                )
                for node_id, binding in bindings.items()
            )
            session.expunge(app)
            return app, snapshot

    @staticmethod
    def claim(session: Session, run: WorkflowRun, now: datetime) -> bool:
        """Claim engine work under the caller's run lock; return False for a terminal run.

        Cleanup may already have removed a terminal run's reservation. Its
        persisted outcome remains authoritative when the task is redelivered.
        """
        if run.status.is_ended():
            return False
        reservation = read_debug_lease(session, run)
        if (
            reservation is not None and reservation.started_at is not None
        ) or run.status == WorkflowExecutionStatus.PAUSED:
            raise WorkflowDebugReservationAlreadyClaimedError("Trigger debug reservation was already claimed")
        if (
            reservation is None
            or reservation.expires_at is None
            or reservation.expires_at <= now
            or run.status != WorkflowExecutionStatus.RUNNING
        ):
            raise WorkflowDebugReservationExpiredError("Trigger debug reservation expired before worker startup")
        write_debug_lease(
            session, run, DebugLease(now + timedelta(seconds=dify_config.WORKFLOW_DEBUG_RESERVATION_TIMEOUT), now)
        )
        return True

    def renew(self, *, tenant_id: str, app_id: str, workflow_id: str, execution_id: str, now: datetime) -> bool:
        """Refresh a live worker's lease, serialized with expiry and terminal writes.

        Paused runs have no deadline until they resume. Refreshing one prepares
        its lease before the asynchronous RUNNING write arrives on resumption.
        An expired running lease cannot be revived by a late heartbeat.
        False means the worker is no longer allowed to execute under this lease.
        """
        with self._sessions.begin() as session:
            run = lock_workflow_run(
                session, tenant_id=tenant_id, app_id=app_id, workflow_id=workflow_id, execution_id=execution_id
            )
            if run is None or run.status.is_ended():
                return False
            reservation = read_debug_lease(session, run)
            if reservation is None or reservation.started_at is None:
                return False
            if run.status != WorkflowExecutionStatus.PAUSED and (
                reservation.expires_at is None or reservation.expires_at <= now
            ):
                return False
            write_debug_lease(
                session,
                run,
                DebugLease(
                    now + timedelta(seconds=dify_config.WORKFLOW_DEBUG_RESERVATION_TIMEOUT), reservation.started_at
                ),
            )
            return True

    def pending_batch(
        self, now: datetime, *, limit: int, after: DebugReservationCursor | None = None
    ) -> list[DebugReservationCursor]:
        """Range-scan only due leases, using the covering deadline/execution index."""
        query = select(WorkflowDebugReservation.workflow_run_id, WorkflowDebugReservation.expires_at).where(
            WorkflowDebugReservation.expires_at <= now,
        )
        if after is not None:
            query = query.where(
                tuple_(WorkflowDebugReservation.expires_at, WorkflowDebugReservation.workflow_run_id)
                > (after.expires_at, after.execution_id)
            )
        with self._sessions() as session:
            return list(
                starmap(
                    DebugReservationCursor,
                    session.execute(
                        query.order_by(
                            WorkflowDebugReservation.expires_at, WorkflowDebugReservation.workflow_run_id
                        ).limit(limit)
                    ),
                )
            )

    def expire(self, execution_id: str, now: datetime) -> ExpiredDebugReservation | None:
        """Fail an abandoned handoff or worker; retain retry evidence until cleanup is published."""
        with self._sessions.begin() as session:
            run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == execution_id).with_for_update())
            if run is None:
                return None
            reservation = read_debug_lease(session, run)
            if reservation is None or reservation.expires_at is None or reservation.expires_at > now:
                return None
            if run.status == WorkflowExecutionStatus.PAUSED:
                return None
            if not run.status.is_ended():
                run.status = WorkflowExecutionStatus.FAILED
                run.error = (
                    "Trigger debug reservation expired before worker startup"
                    if reservation.started_at is None
                    else "Trigger debug worker lease expired"
                )
                run.finished_at = now
            return ExpiredDebugReservation(run.id, run.tenant_id, run.app_id, run.workflow_id, run.created_by)

    def complete_cleanup(
        self, *, tenant_id: str, app_id: str, workflow_id: str, execution_id: str, delete_unstarted: bool
    ) -> None:
        """Acknowledge published cleanup; only cancelled, unclaimed runs are deleted.

        Callers explicitly distinguish cancellation of an unclaimed handoff
        from execution completion. References survive until cleanup succeeds;
        completed and expired runs retain their execution history.
        """
        with self._sessions.begin() as session:
            run = session.scalar(
                select(WorkflowRun)
                .where(
                    WorkflowRun.id == execution_id,
                    WorkflowRun.tenant_id == tenant_id,
                    WorkflowRun.app_id == app_id,
                    WorkflowRun.workflow_id == workflow_id,
                )
                .with_for_update()
            )
            reservation = read_debug_lease(session, run) if run is not None else None
            if run is not None and run.status.is_ended() and reservation is not None:
                write_debug_lease(session, run, None)
                session.execute(
                    delete(WorkflowAgentNodeBinding).where(
                        WorkflowAgentNodeBinding.workflow_version == WORKFLOW_EXECUTION_BINDING_VERSION,
                        WorkflowAgentNodeBinding.tenant_id == tenant_id,
                        WorkflowAgentNodeBinding.app_id == app_id,
                        WorkflowAgentNodeBinding.workflow_id == execution_id,
                    )
                )
                if (
                    delete_unstarted
                    and run.status == WorkflowExecutionStatus.STOPPED
                    and reservation.started_at is None
                ):
                    session.delete(run)
