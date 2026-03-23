from unittest.mock import MagicMock
from uuid import uuid4

from sqlalchemy.orm import sessionmaker

from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.workflow.entities.workflow_execution import WorkflowExecution
from core.workflow.enums import WorkflowExecutionStatus, WorkflowType
from libs.datetime_utils import naive_utc_now
from models import Account, CreatorUserRole, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom


def _build_repo() -> SQLAlchemyWorkflowExecutionRepository:
    session_factory = MagicMock(spec=sessionmaker)
    account = MagicMock(spec=Account)
    account.id = str(uuid4())
    account.current_tenant_id = str(uuid4())

    return SQLAlchemyWorkflowExecutionRepository(
        session_factory=session_factory,
        user=account,
        app_id="test-app-id",
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
    )


def test_to_db_model_preserves_result_replay() -> None:
    repo = _build_repo()
    execution = WorkflowExecution.new(
        id_=str(uuid4()),
        workflow_id=str(uuid4()),
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="1.0",
        graph={"nodes": [], "edges": []},
        inputs={"query": "hello"},
        started_at=naive_utc_now(),
    )
    execution.outputs = {"answer": "hello"}
    execution.result_replay = {
        "text": "hello",
        "llm_generation_items": [
            {"type": "text", "text": "hello", "text_completed": True},
            {"type": "tool", "tool_name": "bash", "tool_arguments": "ls", "tool_output": "output"},
        ],
        "files": [{"var_name": "files", "files": [{"id": "file-1"}]}],
    }
    execution.status = WorkflowExecutionStatus.SUCCEEDED

    db_model = repo._to_db_model(execution)

    assert db_model.result_replay_dict == execution.result_replay


def test_to_domain_model_preserves_result_replay() -> None:
    repo = _build_repo()
    workflow_run = WorkflowRun(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        workflow_id=str(uuid4()),
        type=WorkflowType.WORKFLOW.value,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING.value,
        version="1.0",
        graph='{"nodes":[],"edges":[]}',
        inputs='{"query":"hello"}',
        status=WorkflowExecutionStatus.SUCCEEDED,
        outputs='{"answer":"hello"}',
        result_replay='{"text":"hello","llm_generation_items":[{"type":"tool","tool_name":"bash"}],"files":[]}',
        error=None,
        elapsed_time=1.2,
        total_tokens=5,
        total_steps=1,
        exceptions_count=0,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        created_at=naive_utc_now(),
        finished_at=naive_utc_now(),
    )

    domain_model = repo._to_domain_model(workflow_run)

    assert domain_model.result_replay == {
        "text": "hello",
        "llm_generation_items": [{"type": "tool", "tool_name": "bash"}],
        "files": [],
    }
