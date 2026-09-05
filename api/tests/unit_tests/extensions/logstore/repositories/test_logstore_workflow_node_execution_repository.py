from collections.abc import Callable
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

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
    with sqlite_engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE workflow_node_execution AS SELECT *, 1 AS log_version FROM workflow_node_executions"
        )
        connection.exec_driver_sql("UPDATE workflow_node_execution SET triggered_from = NULL WHERE id = 'legacy-exec'")

    def execute_query(*, sql: str, **_kwargs: object) -> list[dict[str, object]]:
        with sqlite_engine.connect() as connection:
            return [dict(row) for row in connection.exec_driver_sql(sql).mappings()]

    logstore.return_value.execute_sql.side_effect = execute_query
    assert {execution.id for execution in caller.get_by_workflow_execution("caller-run")} == {
        "caller-exec",
        "legacy-exec",
    }
    assert [execution.id for execution in source.get_by_workflow_execution("caller-run")] == ["source-exec"]


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
