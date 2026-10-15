from datetime import datetime
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from core.repositories.celery_workflow_execution_repository import CeleryWorkflowExecutionRepository
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from models import Account, CreatorUserRole, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom
from repositories.entities.workflow_execution import WorkflowExecution
from tasks.workflow_execution_tasks import save_workflow_execution_task

TABLES = (WorkflowRun,)


def test_celery_roundtrip_preserves_accumulated_duration_on_create_update_and_redelivery(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = Account(name="Test", email="test@example.com")
    account.id = str(uuid4())
    repository = CeleryWorkflowExecutionRepository(
        session_factory=sqlite_session_factory,
        tenant_id=str(uuid4()),
        user=account,
        app_id=str(uuid4()),
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )
    execution = WorkflowExecution(
        id_=str(uuid4()),
        workflow_id=str(uuid4()),
        workflow_version="1",
        workflow_type=WorkflowType.WORKFLOW,
        graph={},
        inputs={},
        started_at=datetime(2026, 1, 1),
        accumulated_elapsed_time=5.0,
    )

    for status, duration in [
        (WorkflowExecutionStatus.RUNNING, 5.0),
        (WorkflowExecutionStatus.PAUSED, 7.0),
        (WorkflowExecutionStatus.SUCCEEDED, 9.0),
    ]:
        execution.status = status
        execution.accumulated_elapsed_time = duration
        if status == WorkflowExecutionStatus.SUCCEEDED:
            execution.finished_at = datetime(2026, 1, 2)
        with patch("core.repositories.celery_workflow_execution_repository.save_workflow_execution_task") as task:
            repository.save(execution)
        payload = task.delay.call_args.kwargs
        assert payload["execution_data"]["accumulated_elapsed_time"] == duration
        assert payload["creator_user_role"] == CreatorUserRole.ACCOUNT
        for _ in range(2):
            assert save_workflow_execution_task.run(**payload) is True
        with sqlite_session_factory() as session:
            stored = session.get(WorkflowRun, execution.id_)
            assert stored is not None
            assert stored.elapsed_time == duration
            assert stored.created_at == execution.started_at
