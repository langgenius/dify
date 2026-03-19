from dify_graph.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from dify_graph.node_events.base import NodeRunResult


def test_node_run_result_accepts_trigger_info_metadata() -> None:
    result = NodeRunResult(
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        metadata={
            WorkflowNodeExecutionMetadataKey.TRIGGER_INFO: {
                "provider_id": "provider-id",
                "event_name": "event-name",
            }
        },
    )

    assert result.metadata[WorkflowNodeExecutionMetadataKey.TRIGGER_INFO] == {
        "provider_id": "provider-id",
        "event_name": "event-name",
    }
