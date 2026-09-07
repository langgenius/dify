import json
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from core.workflow.node_execution_process_data import WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY
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


def test_workflow_tool_children_are_scoped_to_exact_parent_and_run(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    parent_id = str(uuid4())
    records = [
        (parent_id, "tenant", "run", "caller-app", "tool", None, "parent-engine"),
        ("direct-child", "tenant", "run", "source-app", "tool", "parent-engine", "child-engine"),
        ("nested-child", "tenant", "run", "nested-app", "start", "child-engine", None),
        ("other-call", "tenant", "run", "source-app", "start", "other-engine", None),
        ("other-run", "tenant", "other-run", "source-app", "start", "parent-engine", None),
        ("other-tenant", "other-tenant", "run", "source-app", "start", "parent-engine", None),
        ("legacy-child", "tenant", "run", "source-app", "start", None, None),
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all(
            WorkflowNodeExecutionModel(
                id=execution_id,
                tenant_id=tenant,
                app_id=app,
                workflow_id=f"{app}-workflow",
                workflow_run_id=run,
                node_execution_id=engine_id,
                node_id="same-node",
                node_type=node_type,
                title="Node",
                index=index,
                process_data=json.dumps({WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY: owner}) if owner else None,
                outputs='{"answer":"approved"}',
                status=WorkflowNodeExecutionStatus.PAUSED
                if execution_id == "direct-child"
                else WorkflowNodeExecutionStatus.SUCCEEDED,
                triggered_from=(
                    WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
                    if execution_id == parent_id
                    else WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
                ),
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="account",
                created_at=datetime(2026, 1, 1) + timedelta(seconds=index),
            )
            for index, (execution_id, tenant, run, app, node_type, owner, engine_id) in enumerate(records)
        )
    repository = DifyAPISQLAlchemyWorkflowNodeExecutionRepository(sqlite_session_factory)
    for requested_id in (parent_id, "parent-engine"):
        children = repository.get_workflow_tool_executions("tenant", "run", requested_id)
        assert [child.id for child in children] == ["direct-child"]
        assert children[0].app_id == "source-app"
        assert children[0].outputs_dict == {"answer": "approved"}
        assert children[0].status == WorkflowNodeExecutionStatus.PAUSED
    assert [child.id for child in repository.get_workflow_tool_executions("tenant", "run", "direct-child")] == [
        "nested-child"
    ]
    assert repository.get_workflow_tool_executions("tenant", "run", "unknown") == []
