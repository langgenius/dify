"""Integration tests for DifyAPISQLAlchemyWorkflowNodeExecutionRepository using testcontainers."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

from sqlalchemy import Engine, delete
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.enums import WorkflowNodeExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)


def _create_node_execution(
    session: Session,
    *,
    tenant_id: str,
    app_id: str,
    workflow_id: str,
    workflow_run_id: str,
    status: WorkflowNodeExecutionStatus,
    index: int,
    created_by: str,
    created_at_offset_seconds: int,
) -> WorkflowNodeExecutionModel:
    now = naive_utc_now()
    node_execution = WorkflowNodeExecutionModel(
        id=str(uuid4()),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        triggered_from="workflow-run",
        workflow_run_id=workflow_run_id,
        index=index,
        predecessor_node_id=None,
        node_execution_id=None,
        node_id=f"node-{index}",
        node_type="llm",
        title=f"Node {index}",
        inputs="{}",
        process_data="{}",
        outputs="{}",
        status=status,
        error=None,
        elapsed_time=0.0,
        execution_metadata="{}",
        created_at=now + timedelta(seconds=created_at_offset_seconds),
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=created_by,
        finished_at=None,
    )
    session.add(node_execution)
    session.flush()
    return node_execution


class TestDifyAPISQLAlchemyWorkflowNodeExecutionRepository:
    def test_get_executions_by_workflow_run_keeps_paused_records(self, db_session_with_containers: Session) -> None:
        tenant_id = str(uuid4())
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        workflow_run_id = str(uuid4())
        created_by = str(uuid4())

        other_tenant_id = str(uuid4())
        other_app_id = str(uuid4())

        included_paused = _create_node_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            status=WorkflowNodeExecutionStatus.PAUSED,
            index=1,
            created_by=created_by,
            created_at_offset_seconds=0,
        )
        included_succeeded = _create_node_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            index=2,
            created_by=created_by,
            created_at_offset_seconds=1,
        )
        _create_node_execution(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=str(uuid4()),
            status=WorkflowNodeExecutionStatus.PAUSED,
            index=3,
            created_by=created_by,
            created_at_offset_seconds=2,
        )
        _create_node_execution(
            db_session_with_containers,
            tenant_id=other_tenant_id,
            app_id=other_app_id,
            workflow_id=str(uuid4()),
            workflow_run_id=workflow_run_id,
            status=WorkflowNodeExecutionStatus.PAUSED,
            index=4,
            created_by=str(uuid4()),
            created_at_offset_seconds=3,
        )
        db_session_with_containers.commit()

        engine = db_session_with_containers.get_bind()
        assert isinstance(engine, Engine)
        repository = DifyAPISQLAlchemyWorkflowNodeExecutionRepository(sessionmaker(bind=engine, expire_on_commit=False))

        try:
            results = repository.get_executions_by_workflow_run(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_run_id=workflow_run_id,
            )

            assert len(results) == 2
            assert [result.id for result in results] == [included_paused.id, included_succeeded.id]
            assert any(result.status == WorkflowNodeExecutionStatus.PAUSED for result in results)
            assert all(result.tenant_id == tenant_id for result in results)
            assert all(result.app_id == app_id for result in results)
            assert all(result.workflow_run_id == workflow_run_id for result in results)
        finally:
            db_session_with_containers.execute(
                delete(WorkflowNodeExecutionModel).where(
                    WorkflowNodeExecutionModel.tenant_id.in_([tenant_id, other_tenant_id])
                )
            )
            db_session_with_containers.commit()
