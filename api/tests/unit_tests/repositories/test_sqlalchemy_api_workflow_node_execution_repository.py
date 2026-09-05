from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowNodeExecutionStatus
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)


def test_workflow_history_and_last_execution_exclude_recursive_tool_nodes(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    root_id, child_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add_all(
            WorkflowNodeExecutionModel(
                id=execution_id,
                tenant_id="tenant",
                app_id="app",
                workflow_id="workflow",
                workflow_run_id="run",
                node_id="same-node",
                node_type="code",
                title="Code",
                index=index,
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                triggered_from=origin,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="account",
                created_at=datetime(2026, 1, 1) + timedelta(seconds=index),
            )
            for execution_id, index, origin in (
                (root_id, 1, WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN),
                (child_id, 2, WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL),
            )
        )
    repository = DifyAPISQLAlchemyWorkflowNodeExecutionRepository(sqlite_session_factory)

    history = repository.get_executions_by_workflow_run(tenant_id="tenant", app_id="app", workflow_run_id="run")
    latest = repository.get_node_last_execution(
        tenant_id="tenant", app_id="app", workflow_id="workflow", node_id="same-node"
    )

    assert [execution.id for execution in history] == [root_id]
    assert latest is not None
    assert latest.id == root_id
