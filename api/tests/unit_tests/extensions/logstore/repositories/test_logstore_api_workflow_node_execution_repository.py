import json
from unittest.mock import MagicMock, patch

from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    LogstoreAPIWorkflowNodeExecutionRepository,
)
from models.workflow import WorkflowNodeExecutionModel


def test_load_full_process_data_returns_logstore_mapping() -> None:
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    execution = WorkflowNodeExecutionModel()
    execution.process_data = '{"__dify_retry_history": [{"retry_index": 1}]}'

    assert repository.load_full_process_data(execution) == {"__dify_retry_history": [{"retry_index": 1}]}


def test_get_execution_by_id_keeps_process_data_from_highest_failed_log_version() -> None:
    with patch("extensions.logstore.repositories.logstore_api_workflow_node_execution_repository.AliyunLogStore"):
        repository = LogstoreAPIWorkflowNodeExecutionRepository(session_maker=None)
    repository.logstore_client = MagicMock(supports_pg_protocol=False)
    repository.logstore_client.get_logs.return_value = [
        {
            "id": "execution-1",
            "log_version": "1",
            "process_data": "{}",
        },
        {
            "id": "execution-1",
            "log_version": "2",
            "status": "failed",
            "process_data": json.dumps({"workflow_agent_binding_id": "binding-1"}),
        },
    ]

    execution = repository.get_execution_by_id("execution-1")

    assert execution is not None
    assert execution.status.value == "failed"
    assert execution.process_data_dict == {"workflow_agent_binding_id": "binding-1"}
