"""Recoverable retirement and draft-signal handoff, outside the draft transaction.

Only execution claims a lease. Discovery and publication never acknowledge work.
Tokens fence SQL acknowledgments, not the existing at-least-once side effects.
"""

import logging
from collections.abc import Iterable
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from events.app_event import app_draft_workflow_was_synced
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.model import App
from models.workflow import Workflow
from models.workflow_draft_coordination import WorkflowDraftCoordination
from services.agent.retirement_service import WorkflowAgentRetirementService

logger = logging.getLogger(__name__)
LEASE_SECONDS = 120


class WorkflowDraftCoordinationService:
    @staticmethod
    def stage(
        session: Session,
        *,
        coordination_id: str,
        workflow: Workflow,
        account_id: str | None,
        retirement_agent_ids: Iterable[str],
        emit_draft_event: bool,
    ) -> None:
        """Insert or union the exact operation in the caller's still-open transaction."""
        row = session.get(WorkflowDraftCoordination, coordination_id)
        owner = (workflow.tenant_id, workflow.app_id, workflow.id, workflow.version)
        if row is None:
            session.add(
                WorkflowDraftCoordination(
                    id=coordination_id,
                    tenant_id=owner[0],
                    app_id=owner[1],
                    workflow_id=owner[2],
                    workflow_version=owner[3],
                    account_id=account_id,
                    retirement_agent_ids=sorted(set(retirement_agent_ids)),
                    emit_draft_event=emit_draft_event,
                )
            )
        else:
            if (row.tenant_id, row.app_id, row.workflow_id, row.workflow_version, row.account_id) != (
                *owner,
                account_id,
            ):
                raise ValueError("Draft coordination owner mismatch")
            row.retirement_agent_ids = sorted(set(row.retirement_agent_ids).union(retirement_agent_ids))
            row.emit_draft_event = row.emit_draft_event or emit_draft_event
        session.flush()

    @classmethod
    def kick(cls, coordination_id: str) -> None:
        """A committed receipt survives operational failures, including ack/broker outages."""
        try:
            if cls.execute(coordination_id):
                return
        except Exception as exc:
            cls._log_failure(coordination_id, "execute", exc)
        try:
            from tasks.workflow_draft_coordination_task import process_workflow_draft_coordination

            process_workflow_draft_coordination.delay(coordination_id)
        except Exception as exc:
            cls._log_failure(coordination_id, "enqueue", exc)

    @staticmethod
    def _log_failure(coordination_id: str, category: str, exc: Exception) -> str:
        # Never use str(exc), traceback payloads or SQL parameters at this boundary.
        error = f"{category}:{type(exc).__name__}"[:255]
        logger.warning("Draft coordination %s %s", coordination_id, error)
        return error

    @classmethod
    def execute(cls, coordination_id: str) -> bool:
        factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        now = naive_utc_now()
        token = str(uuid4())
        with factory.begin() as session:
            row = session.scalar(
                select(WorkflowDraftCoordination)
                .where(
                    WorkflowDraftCoordination.id == coordination_id,
                    WorkflowDraftCoordination.available_at <= now,
                )
                .with_for_update(skip_locked=True)
            )
            if row is None:
                return True
            row.claim_token = token
            row.attempt_count += 1
            row.available_at = now + timedelta(seconds=LEASE_SECONDS)
        errors: list[str] = []
        try:
            WorkflowAgentRetirementService.retire_unowned(
                tenant_id=row.tenant_id,
                agent_ids=set(row.retirement_agent_ids),
                account_id=row.account_id,
            )
        except Exception as exc:
            errors.append(cls._log_failure(coordination_id, "retirement", exc))
        if row.emit_draft_event:
            try:
                with factory() as session:
                    app = session.scalar(select(App).where(App.id == row.app_id, App.tenant_id == row.tenant_id))
                    workflow = session.scalar(
                        select(Workflow).where(
                            Workflow.id == row.workflow_id,
                            Workflow.tenant_id == row.tenant_id,
                            Workflow.app_id == row.app_id,
                            Workflow.version == row.workflow_version,
                        )
                    )
                    session.expunge_all()
                if app is not None and workflow is not None:
                    app_draft_workflow_was_synced.send(
                        app,
                        synced_draft_workflow=workflow,
                        reconcile_current_draft=True,
                    )
            except Exception as exc:
                errors.append(cls._log_failure(coordination_id, "signal", exc))
        with factory.begin() as session:
            predicate = (
                WorkflowDraftCoordination.id == coordination_id,
                WorkflowDraftCoordination.claim_token == token,
            )
            if errors:
                session.execute(
                    update(WorkflowDraftCoordination)
                    .where(*predicate)
                    .values(
                        claim_token=None,
                        last_error=";".join(errors)[:255],
                        available_at=naive_utc_now() + timedelta(seconds=min(300, 2 ** min(row.attempt_count, 8))),
                    )
                )
            else:
                session.execute(delete(WorkflowDraftCoordination).where(*predicate))
        return not errors

    @staticmethod
    def due_ids(limit: int) -> list[str]:
        with sessionmaker(bind=db.engine)() as session:
            return list(
                session.scalars(
                    select(WorkflowDraftCoordination.id)
                    .where(
                        WorkflowDraftCoordination.available_at <= naive_utc_now(),
                    )
                    .order_by(
                        WorkflowDraftCoordination.available_at,
                        WorkflowDraftCoordination.created_at,
                        WorkflowDraftCoordination.id,
                    )
                    .limit(limit)
                )
            )
