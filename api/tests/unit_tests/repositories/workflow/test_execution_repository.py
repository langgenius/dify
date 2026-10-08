"""Delayed execution persistence must not resurrect released runtime references."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from graphon.entities import WorkflowExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from models.workflow import WorkflowRun, WorkflowRunTriggeredFrom
from tests.unit_tests.model_factories import make_account


def test_delayed_start_write_does_not_revive_a_completed_execution(
    sqlite_session_factory: sessionmaker[Session], sqlite_session: Session
) -> None:
    repository = SQLAlchemyWorkflowExecutionRepository(
        session_factory=sqlite_session_factory,
        tenant_id="tenant-1",
        user=make_account(),
        app_id="app-1",
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
    )
    execution = WorkflowExecution(
        id_=str(uuid4()),
        workflow_id=str(uuid4()),
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="draft",
        graph={"nodes": [], "edges": []},
        inputs={},
        outputs={"result": "done"},
        status=WorkflowExecutionStatus.SUCCEEDED,
        error_message="",
        total_tokens=1,
        total_steps=1,
        exceptions_count=0,
        started_at=datetime.now(UTC),
        finished_at=datetime.now(UTC),
    )
    repository.save(execution)
    execution.status = WorkflowExecutionStatus.RUNNING
    execution.finished_at = None
    execution.outputs = {}
    repository.save(execution)
    persisted = sqlite_session.get(WorkflowRun, execution.id_)
    assert persisted is not None
    assert persisted.status == WorkflowExecutionStatus.SUCCEEDED
    assert persisted.finished_at is not None
    assert persisted.outputs_dict == {"result": "done"}
