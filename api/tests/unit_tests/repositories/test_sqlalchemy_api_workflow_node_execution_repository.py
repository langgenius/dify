import json
from datetime import datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.node_execution_process_data import (
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
