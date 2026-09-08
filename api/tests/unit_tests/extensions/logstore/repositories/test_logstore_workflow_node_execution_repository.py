from collections.abc import Callable
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.node_execution_process_data import WORKFLOW_TOOL_ROOT_APP_ID_KEY
from extensions.logstore.repositories.logstore_workflow_node_execution_repository import (
    LogstoreWorkflowNodeExecutionRepository,
)
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.account import Account
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom


def _make_account() -> Account:
    account = Account(name="Logstore User", email="logstore@example.com")
    account.id = "account-1"
    return account


@pytest.mark.parametrize("source_app", ["caller-app", "source-app"])
def test_workflow_tool_scope_preserves_logstore_and_source_scoped_synchronous_agent_rows(
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    source_app: str,
) -> None:
    config_overrides(LOGSTORE_DUAL_WRITE_ENABLED=False)
    with patch(
        "extensions.logstore.repositories.logstore_workflow_node_execution_repository.AliyunLogStore"
    ) as logstore:
        caller = LogstoreWorkflowNodeExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=_make_account(),
            app_id="caller-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        source = caller.for_workflow_tool(source_app)

    node = WorkflowNodeExecution(
        id="source-exec",
        node_execution_id="source-exec",
        workflow_id="source-workflow",
        workflow_execution_id="caller-run",
        index=1,
        node_id="agent",
        node_type=BuiltinNodeTypes.AGENT,
        title="Agent",
        created_at=naive_utc_now(),
        process_data={WORKFLOW_TOOL_ROOT_APP_ID_KEY: "caller-app"},
    )
    source.save_synchronously(node)
    with sqlite_session_factory() as session:
        row = session.get(WorkflowNodeExecutionModel, "source-exec")
        assert row is not None
        assert (row.app_id, row.tenant_id, row.created_by, row.workflow_run_id) == (
            source_app,
            "tenant-1",
            "account-1",
            "caller-run",
        )
        assert row.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL

    node.status = WorkflowNodeExecutionStatus.SUCCEEDED
    source.save(node)
    logstore.return_value.put_log.assert_called_once()
    payload = dict(logstore.return_value.put_log.call_args.args[1])
    assert (payload["app_id"], payload["tenant_id"], payload["created_by"], payload["status"]) == (
        source_app,
        "tenant-1",
        "account-1",
        "succeeded",
    )
    assert payload["triggered_from"] == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL

    caller.save_synchronously(node.model_copy(update={"id": "caller-exec", "node_execution_id": "caller-exec"}))
    caller.save_synchronously(node.model_copy(update={"id": "legacy-exec", "node_execution_id": "legacy-exec"}))
    for execution_id in ("foreign-root", "foreign-run", "foreign-tenant"):
        source.save_synchronously(node.model_copy(update={"id": execution_id, "node_execution_id": execution_id}))
    with sqlite_session_factory() as session:
        foreign_root = session.get(WorkflowNodeExecutionModel, "foreign-root")
        foreign_run = session.get(WorkflowNodeExecutionModel, "foreign-run")
        foreign_tenant = session.get(WorkflowNodeExecutionModel, "foreign-tenant")
        assert foreign_root is not None
        assert foreign_run is not None
        assert foreign_tenant is not None
        foreign_root.process_data = '{"workflow_tool_root_app_id": "other-app"}'
        foreign_run.workflow_run_id = "other-run"
        foreign_tenant.tenant_id = "other-tenant"
        session.commit()
    with sqlite_engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE workflow_node_execution AS SELECT *, 1 AS log_version FROM workflow_node_executions"
        )
        connection.exec_driver_sql("UPDATE workflow_node_execution SET triggered_from = NULL WHERE id = 'legacy-exec'")

    def execute_query(*, sql: str, **_kwargs: object) -> list[dict[str, object]]:
        with sqlite_engine.connect() as connection:
            return [
                dict(row)
                for row in connection.exec_driver_sql(sql.replace("json_extract_scalar", "json_extract")).mappings()
            ]

    logstore.return_value.execute_sql.side_effect = execute_query
    assert {execution.id for execution in caller.get_by_workflow_execution("caller-run")} == {
        "caller-exec",
        "legacy-exec",
    }
    assert {execution.id for execution in source.get_by_workflow_execution("caller-run")} == {
        "source-exec",
        "foreign-root",
    }
    assert {
        execution.id for execution in caller.get_by_workflow_execution("caller-run", include_workflow_tools=True)
    } == {"caller-exec", "legacy-exec", "source-exec"}
    assert {execution.id for execution in caller.get_by_workflow_execution("caller-run")} == {
        "caller-exec",
        "legacy-exec",
    }
    caller._app_id = None
    with pytest.raises(ValueError, match="app_id is required"):
        caller.get_by_workflow_execution("caller-run", include_workflow_tools=True)


def test_save_synchronously_writes_sql_when_dual_write_is_disabled(
    config_overrides: Callable[..., None], sqlite_session_factory: sessionmaker[Session]
) -> None:
    config_overrides(LOGSTORE_DUAL_WRITE_ENABLED=False)
    with (
        patch("extensions.logstore.repositories.logstore_workflow_node_execution_repository.AliyunLogStore"),
        patch(
            "extensions.logstore.repositories.logstore_workflow_node_execution_repository."
            "SQLAlchemyWorkflowNodeExecutionRepository"
        ) as sql_repository_type,
    ):
        repository = LogstoreWorkflowNodeExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=_make_account(),
            app_id="app-1",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

    execution = MagicMock()
    repository.save_synchronously(execution)

    assert repository._enable_dual_write is False
    sql_repository_type.return_value.save_synchronously.assert_called_once_with(execution)
