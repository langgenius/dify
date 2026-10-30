"""MySQL REPEATABLE READ coverage for workflow dispatch receipts."""

from __future__ import annotations

from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime
from threading import Event
from typing import Literal, cast
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from enums.creator import CreatorUserRole
from models.enums import AppTriggerType, WorkflowTriggerStatus
from models.trigger import WorkflowTriggerLog
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository


def _repeatable_read_sessions(mysql_session: Session) -> sessionmaker[Session]:
    engine = cast(Engine, mysql_session.get_bind().execution_options(isolation_level="REPEATABLE READ"))
    return sessionmaker(bind=engine, expire_on_commit=False)


@contextmanager
def _pending_log(sessions: sessionmaker[Session]) -> Generator[tuple[str, str]]:
    tenant_id = str(uuid4())
    trigger_log = WorkflowTriggerLog(
        tenant_id=tenant_id,
        app_id=str(uuid4()),
        workflow_id=str(uuid4()),
        workflow_run_id=None,
        root_node_id=None,
        trigger_metadata="{}",
        trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
        trigger_data="{}",
        inputs="{}",
        outputs=None,
        status=WorkflowTriggerStatus.PENDING,
        error=None,
        queue_name="default",
        celery_task_id=None,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        retry_count=0,
    )
    with sessions.begin() as session:
        session.add(trigger_log)
        session.flush()
    try:
        yield trigger_log.id, tenant_id
    finally:
        with sessions.begin() as cleanup:
            cleanup.execute(sa.delete(WorkflowTriggerLog).where(WorkflowTriggerLog.id == trigger_log.id))


@pytest.mark.parametrize("producer_result", ["receipt", "failure"])
def test_stale_producer_cannot_overwrite_worker_completion(
    mysql_session: Session, producer_result: Literal["receipt", "failure"]
) -> None:
    sessions = _repeatable_read_sessions(mysql_session)
    worker_triggered_at = datetime(2026, 1, 1, 12, 0)
    worker_finished_at = datetime(2026, 1, 1, 12, 1)
    worker_outputs = '{"answer":"worker"}'

    with _pending_log(sessions) as (trigger_log_id, tenant_id), sessions() as producer_session:
        producer_session.begin()
        stale_log = producer_session.scalar(
            select(WorkflowTriggerLog).where(
                WorkflowTriggerLog.id == trigger_log_id,
                WorkflowTriggerLog.tenant_id == tenant_id,
            )
        )
        assert stale_log is not None
        assert stale_log.status == WorkflowTriggerStatus.PENDING

        with sessions.begin() as worker_session:
            worker_log = worker_session.scalar(
                select(WorkflowTriggerLog)
                .where(
                    WorkflowTriggerLog.id == trigger_log_id,
                    WorkflowTriggerLog.tenant_id == tenant_id,
                )
                .with_for_update()
            )
            assert worker_log is not None
            worker_log.status = WorkflowTriggerStatus.SUCCEEDED
            worker_log.outputs = worker_outputs
            worker_log.triggered_at = worker_triggered_at
            worker_log.finished_at = worker_finished_at
            worker_log.celery_task_id = "worker-task"

        repository = SQLAlchemyWorkflowTriggerLogRepository(producer_session)
        if producer_result == "receipt":
            repository.record_dispatch(
                trigger_log_id=trigger_log_id,
                tenant_id=tenant_id,
                task_id="worker-task",
                triggered_at=datetime(2026, 1, 1, 12, 2),
            )
        else:
            repository.fail_pending_dispatch(
                trigger_log_id=trigger_log_id,
                tenant_id=tenant_id,
                error="producer failed after publish",
            )
        producer_session.commit()

        with sessions() as verification_session:
            persisted = verification_session.get(WorkflowTriggerLog, trigger_log_id)
            assert persisted is not None
            assert persisted.status == WorkflowTriggerStatus.SUCCEEDED
            assert persisted.outputs == worker_outputs
            assert persisted.triggered_at == worker_triggered_at
            assert persisted.finished_at == worker_finished_at
            assert persisted.celery_task_id == "worker-task"
            assert persisted.error is None


def test_dispatch_receipt_transitions_current_pending_log_to_queued(mysql_session: Session) -> None:
    sessions = _repeatable_read_sessions(mysql_session)
    triggered_at = datetime(2026, 1, 2, 8, 30)

    with _pending_log(sessions) as (trigger_log_id, tenant_id):
        with sessions.begin() as session:
            SQLAlchemyWorkflowTriggerLogRepository(session).record_dispatch(
                trigger_log_id=trigger_log_id,
                tenant_id=tenant_id,
                task_id="producer-task",
                triggered_at=triggered_at,
            )

        with sessions() as verification_session:
            persisted = verification_session.get(WorkflowTriggerLog, trigger_log_id)
            assert persisted is not None
            assert persisted.status == WorkflowTriggerStatus.QUEUED
            assert persisted.celery_task_id == "producer-task"
            assert persisted.triggered_at == triggered_at
            assert persisted.outputs is None
            assert persisted.finished_at is None
            assert persisted.error is None


def test_concurrent_execution_claims_allow_only_one_queued_consumer(mysql_session: Session) -> None:
    sessions = _repeatable_read_sessions(mysql_session)
    first_claimed = Event()
    duplicate_claim_started = Event()
    release_first = Event()

    with _pending_log(sessions) as (trigger_log_id, _tenant_id):

        def first_consumer() -> bool:
            with sessions.begin() as session:
                claimed = SQLAlchemyWorkflowTriggerLogRepository(session).claim_for_execution(
                    trigger_log_id=trigger_log_id,
                )
                first_claimed.set()
                assert release_first.wait(timeout=10)
                return claimed is not None

        def duplicate_consumer() -> bool:
            assert first_claimed.wait(timeout=10)
            with sessions.begin() as session:
                connection = session.connection()

                def before_cursor_execute(
                    _connection,
                    _cursor,
                    statement: str,
                    _parameters,
                    _context,
                    _executemany,
                ) -> None:
                    normalized = statement.lower()
                    if "workflow_trigger_logs" in normalized and "for update" in normalized:
                        duplicate_claim_started.set()

                event.listen(connection, "before_cursor_execute", before_cursor_execute)
                try:
                    claimed = SQLAlchemyWorkflowTriggerLogRepository(session).claim_for_execution(
                        trigger_log_id=trigger_log_id,
                    )
                    return claimed is not None
                finally:
                    event.remove(connection, "before_cursor_execute", before_cursor_execute)

        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(first_consumer)
            duplicate = executor.submit(duplicate_consumer)
            assert first_claimed.wait(timeout=10)
            try:
                assert duplicate_claim_started.wait(timeout=10)
                assert not duplicate.done()
            finally:
                release_first.set()
            assert first.result(timeout=10) is True
            assert duplicate.result(timeout=10) is False

        with sessions() as verification_session:
            persisted = verification_session.get(WorkflowTriggerLog, trigger_log_id)
            assert persisted is not None
            assert persisted.status == WorkflowTriggerStatus.RUNNING
