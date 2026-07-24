from datetime import datetime
from unittest.mock import MagicMock
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from dify_graph.entities.workflow_execution import WorkflowExecution, WorkflowType
from models import Account, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom


def _build_repository_with_mocked_session(session: MagicMock) -> SQLAlchemyWorkflowExecutionRepository:
    engine = create_engine("sqlite:///:memory:")
    real_session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    user = MagicMock(spec=Account)
    user.id = str(uuid4())
    user.current_tenant_id = str(uuid4())

    repository = SQLAlchemyWorkflowExecutionRepository(
        session_factory=real_session_factory,
        user=user,
        app_id="app-id",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )

    session_context = MagicMock()
    session_context.__enter__.return_value = session
    session_context.__exit__.return_value = False
    repository._session_factory = MagicMock(return_value=session_context)
    return repository


def _build_execution(*, execution_id: str, started_at: datetime) -> WorkflowExecution:
    return WorkflowExecution.new(
        id_=execution_id,
        workflow_id="workflow-id",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="1.0.0",
        graph={"nodes": [], "edges": []},
        inputs={"query": "hello"},
        started_at=started_at,
    )


def test_save_uses_execution_started_at_when_record_does_not_exist():
    session = MagicMock()
    session.get.return_value = None
    repository = _build_repository_with_mocked_session(session)

    started_at = datetime(2026, 1, 1, 12, 0, 0)
    execution = _build_execution(execution_id=str(uuid4()), started_at=started_at)

    repository.save(execution)

    saved_model = session.merge.call_args.args[0]
    assert saved_model.created_at == started_at
    session.commit.assert_called_once()


def test_save_preserves_existing_created_at_when_record_already_exists():
    session = MagicMock()
    repository = _build_repository_with_mocked_session(session)

    execution_id = str(uuid4())
    existing_created_at = datetime(2026, 1, 1, 12, 0, 0)
    existing_run = WorkflowRun()
    existing_run.id = execution_id
    existing_run.tenant_id = repository._tenant_id
    existing_run.created_at = existing_created_at
    session.get.return_value = existing_run

    execution = _build_execution(
        execution_id=execution_id,
        started_at=datetime(2026, 1, 1, 12, 30, 0),
    )

    repository.save(execution)

    saved_model = session.merge.call_args.args[0]
    assert saved_model.created_at == existing_created_at
    session.commit.assert_called_once()
