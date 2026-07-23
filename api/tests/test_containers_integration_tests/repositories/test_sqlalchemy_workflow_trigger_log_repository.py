"""Integration tests for SQLAlchemyWorkflowTriggerLogRepository using testcontainers."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.enums import AppTriggerType, CreatorUserRole, WorkflowTriggerStatus
from models.trigger import WorkflowTriggerLog
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository


def _create_trigger_log(
    session: Session,
    *,
    tenant_id: str,
    app_id: str,
    workflow_id: str,
    workflow_run_id: str,
    created_by: str,
) -> WorkflowTriggerLog:
    trigger_log = WorkflowTriggerLog(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        workflow_run_id=workflow_run_id,
        root_node_id=None,
        trigger_metadata="{}",
        trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
        trigger_data="{}",
        inputs="{}",
        outputs=None,
        status=WorkflowTriggerStatus.SUCCEEDED,
        error=None,
        queue_name="default",
        celery_task_id=None,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=created_by,
        retry_count=0,
    )
    session.add(trigger_log)
    session.flush()
    return trigger_log


def test_delete_by_run_ids_executes_delete(container_db_transaction: Session) -> None:
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    workflow_id = str(uuid4())
    created_by = str(uuid4())

    run_id_1 = str(uuid4())
    run_id_2 = str(uuid4())
    untouched_run_id = str(uuid4())

    _create_trigger_log(
        container_db_transaction,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        workflow_run_id=run_id_1,
        created_by=created_by,
    )
    _create_trigger_log(
        container_db_transaction,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        workflow_run_id=run_id_2,
        created_by=created_by,
    )
    _create_trigger_log(
        container_db_transaction,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        workflow_run_id=untouched_run_id,
        created_by=created_by,
    )
    container_db_transaction.commit()

    repository = SQLAlchemyWorkflowTriggerLogRepository(container_db_transaction)

    deleted = repository.delete_by_run_ids([run_id_1, run_id_2])
    container_db_transaction.commit()

    assert deleted == 2
    remaining_logs = container_db_transaction.scalars(
        select(WorkflowTriggerLog).where(WorkflowTriggerLog.tenant_id == tenant_id)
    ).all()
    assert len(remaining_logs) == 1
    assert remaining_logs[0].workflow_run_id == untouched_run_id


def test_delete_by_run_ids_empty_short_circuits(container_db_transaction: Session) -> None:
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    workflow_id = str(uuid4())
    created_by = str(uuid4())
    run_id = str(uuid4())

    _create_trigger_log(
        container_db_transaction,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        workflow_run_id=run_id,
        created_by=created_by,
    )
    container_db_transaction.commit()

    repository = SQLAlchemyWorkflowTriggerLogRepository(container_db_transaction)

    deleted = repository.delete_by_run_ids([])
    container_db_transaction.commit()

    assert deleted == 0
    remaining_count = container_db_transaction.scalar(
        select(func.count())
        .select_from(WorkflowTriggerLog)
        .where(WorkflowTriggerLog.tenant_id == tenant_id)
        .where(WorkflowTriggerLog.workflow_run_id == run_id)
    )
    assert remaining_count == 1
