import json
from datetime import datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.node_execution_process_data import (
    WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY,
    WORKFLOW_TOOL_ROOT_APP_ID_KEY,
)
from graphon.enums import WorkflowNodeExecutionStatus
from models.enums import CreatorUserRole
from models.workflow import (
    ExecutionOffLoadType,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
)
from repositories.api_workflow_node_execution_repository import DifyAPIWorkflowNodeExecutionRepository
from repositories.factory import DifyAPIRepositoryFactory
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from tests.unit_tests.config_override import apply_config_overrides


@pytest.mark.parametrize("logstore", [False, True])
def test_app_deletion_removes_nested_caller_records_and_offloads(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, logstore: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        for execution_id, app_id, tenant_id, root_app_id, origin in (
            ("direct", "root-app", "tenant", None, WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN),
            ("child", "source-app", "tenant", "root-app", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL),
            ("other-app", "source-app", "tenant", "other-app", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL),
            (
                "other-tenant",
                "source-app",
                "other-tenant",
                "root-app",
                WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
            ),
            ("wrong-origin", "source-app", "tenant", "root-app", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN),
        ):
            session.add(
                WorkflowNodeExecutionModel(
                    id=execution_id,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    workflow_id="workflow",
                    workflow_run_id="run",
                    node_id="node",
                    node_type="agent",
                    title="Agent",
                    index=1,
                    triggered_from=origin,
                    status=WorkflowNodeExecutionStatus.PAUSED,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by="account",
                    process_data=json.dumps({WORKFLOW_TOOL_ROOT_APP_ID_KEY: root_app_id}) if root_app_id else None,
                )
            )
        session.add(
            WorkflowNodeExecutionOffload(
                tenant_id="tenant",
                app_id="source-app",
                node_execution_id="child",
                type_=ExecutionOffLoadType.PROCESS_DATA,
                file_id=str(uuid4()),
            )
        )
    repository: DifyAPIWorkflowNodeExecutionRepository
    if logstore:
        apply_config_overrides(
            monkeypatch,
            API_WORKFLOW_NODE_EXECUTION_REPOSITORY=(
                "extensions.logstore.repositories.logstore_api_workflow_node_execution_repository."
                "LogstoreAPIWorkflowNodeExecutionRepository"
            ),
        )
        with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
            repository = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(sqlite_session_factory)
    else:
        repository = DifyAPISQLAlchemyWorkflowNodeExecutionRepository(sqlite_session_factory)

    assert repository.delete_executions_by_app("tenant", "root-app", batch_size=1) == 2
    with sqlite_session_factory() as session:
        assert session.get(WorkflowNodeExecutionModel, "direct") is None
        assert session.get(WorkflowNodeExecutionModel, "child") is None
        for execution_id in ("other-app", "other-tenant", "wrong-origin"):
            assert session.get(WorkflowNodeExecutionModel, execution_id) is not None
        assert session.scalar(select(func.count()).select_from(WorkflowNodeExecutionOffload)) == 0


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
        session.add(
            WorkflowNodeExecutionOffload(
                tenant_id="tenant",
                app_id="source-app",
                node_execution_id="direct-child",
                type_=ExecutionOffLoadType.PROCESS_DATA,
                file_id=str(uuid4()),
            )
        )
    repository = DifyAPISQLAlchemyWorkflowNodeExecutionRepository(sqlite_session_factory)
    loaded_execution_ids: list[str] = []

    def record_loaded_execution(execution: WorkflowNodeExecutionModel, _context: object) -> None:
        loaded_execution_ids.append(execution.id)

    for requested_id in (parent_id, "parent-engine"):
        loaded_execution_ids.clear()
        event.listen(WorkflowNodeExecutionModel, "load", record_loaded_execution)
        try:
            children = repository.get_workflow_tool_executions("tenant", "run", requested_id)
        finally:
            event.remove(WorkflowNodeExecutionModel, "load", record_loaded_execution)
        assert [child.id for child in children] == ["direct-child"]
        assert loaded_execution_ids == ["direct-child"]
        assert children[0].app_id == "source-app"
        assert children[0].outputs_dict == {"answer": "approved"}
        assert children[0].status == WorkflowNodeExecutionStatus.PAUSED
        assert children[0].process_data_truncated
    assert [child.id for child in repository.get_workflow_tool_executions("tenant", "run", "direct-child")] == [
        "nested-child"
    ]
    assert repository.get_workflow_tool_executions("tenant", "run", "unknown") == []
