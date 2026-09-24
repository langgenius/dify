from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from core.repositories.factory import OrderConfig
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_workflow_node_execution_query_repository import (
    LogstoreWorkflowNodeExecutionQueryRepository,
)
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus


def test_query_does_not_initialize_a_writer_or_upload_service() -> None:
    client = MagicMock(spec=AliyunLogStore)
    rows: list[dict[str, object]] = []
    client.execute_sql.return_value = rows
    with (
        patch(
            "extensions.logstore.repositories.logstore_workflow_node_execution_write_repository."
            "LogstoreWorkflowNodeExecutionWriteRepository.__init__",
            side_effect=AssertionError("Read paths must not construct a LogStore writer"),
        ),
        patch(
            "core.repositories.sqlalchemy_workflow_node_execution_write_repository."
            "SQLAlchemyWorkflowNodeExecutionWriteRepository.__init__",
            side_effect=AssertionError("Read paths must not construct a SQL writer"),
        ),
        patch(
            "services.file_upload_service.FileUploadService.__init__",
            side_effect=AssertionError("Read paths must not construct an upload service"),
        ),
    ):
        repository = LogstoreWorkflowNodeExecutionQueryRepository(
            tenant_id="tenant-1", app_id="app-1", logstore_client=client
        )
        assert repository.get_by_workflow_execution("run-1") == []


@pytest.mark.parametrize(
    ("app_id", "order_config", "order_clause"),
    [
        (None, None, ""),
        (
            "app'1",
            OrderConfig(order_by=["index", "created_at"], order_direction="desc"),
            "ORDER BY index DESC, created_at DESC",
        ),
        ("app'1", OrderConfig(order_by=["created_at"]), "ORDER BY created_at ASC"),
    ],
)
def test_query_preserves_owner_filters_latest_versions_and_requested_order(
    app_id: str | None, order_config: OrderConfig | None, order_clause: str
) -> None:
    client = MagicMock(spec=AliyunLogStore)
    rows: list[dict[str, object]] = []
    client.execute_sql.return_value = rows
    repository = LogstoreWorkflowNodeExecutionQueryRepository(
        tenant_id="tenant'1", app_id=app_id, logstore_client=client
    )

    repository.get_by_workflow_execution("run'1", order_config)

    kwargs = client.execute_sql.call_args.kwargs
    sql = " ".join(kwargs["sql"].split())
    assert kwargs["query"] == "*"
    assert kwargs["logstore"] == AliyunLogStore.workflow_node_execution_logstore
    assert "ROW_NUMBER() OVER (PARTITION BY node_execution_id ORDER BY log_version DESC) AS rn" in sql
    assert "workflow_run_id='run''1'" in sql
    assert "tenant_id='tenant''1'" in sql
    if app_id is None:
        assert "app_id=" not in sql
    else:
        assert "app_id='app''1'" in sql
    assert sql.partition("WHERE rn = 1")[2].strip() == order_clause


def test_query_maps_valid_rows_and_skips_malformed_rows(caplog: pytest.LogCaptureFixture) -> None:
    client = MagicMock(spec=AliyunLogStore)
    client.execute_sql.return_value = [
        {"id": "invalid-row", "status": "unknown-status"},
        {
            "id": "execution-1",
            "node_execution_id": "node-execution-1",
            "workflow_id": "workflow-1",
            "workflow_run_id": "run-1",
            "index": "3",
            "node_id": "node-1",
            "node_type": "llm",
            "title": "LLM",
            "inputs": '{"question": "hello"}',
            "process_data": '{"model": "test"}',
            "outputs": '{"answer": "world"}',
            "execution_metadata": '{"total_tokens": 5, "unknown-key": 1}',
            "status": "succeeded",
            "elapsed_time": "1.25",
            "created_at": "2026-01-01T00:00:00",
            "finished_at": "2026-01-01T00:00:01.250000",
        },
    ]
    repository = LogstoreWorkflowNodeExecutionQueryRepository(
        tenant_id="tenant-1", app_id="app-1", logstore_client=client
    )

    executions = repository.get_by_workflow_execution("run-1")

    assert len(executions) == 1
    execution = executions[0]
    assert execution.id == "execution-1"
    assert execution.node_execution_id == "node-execution-1"
    assert execution.workflow_id == "workflow-1"
    assert execution.workflow_execution_id == "run-1"
    assert execution.index == 3
    assert execution.inputs == {"question": "hello"}
    assert execution.process_data == {"model": "test"}
    assert execution.outputs == {"answer": "world"}
    assert execution.metadata == {WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 5}
    assert execution.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert execution.elapsed_time == 1.25
    assert execution.created_at == datetime(2026, 1, 1)
    assert execution.finished_at == datetime(2026, 1, 1, 0, 0, 1, 250000)
    assert "Failed to convert row to WorkflowNodeExecution" in caplog.text


def test_query_propagates_logstore_errors() -> None:
    client = MagicMock(spec=AliyunLogStore)
    error = RuntimeError("LogStore is unavailable")
    client.execute_sql.side_effect = error
    repository = LogstoreWorkflowNodeExecutionQueryRepository(tenant_id="tenant-1", app_id=None, logstore_client=client)

    with pytest.raises(RuntimeError) as raised:
        repository.get_by_workflow_execution("run-1")

    assert raised.value is error


def test_query_rejects_missing_tenant_before_initializing_logstore() -> None:
    with patch(
        "extensions.logstore.repositories.logstore_workflow_node_execution_query_repository.AliyunLogStore"
    ) as client_type:
        with pytest.raises(ValueError, match="tenant_id is required"):
            LogstoreWorkflowNodeExecutionQueryRepository(tenant_id="", app_id=None)

    client_type.assert_not_called()
