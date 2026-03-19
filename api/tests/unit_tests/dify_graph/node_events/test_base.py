from core.trigger.constants import TRIGGER_INFO_METADATA_KEY
from dify_graph.enums import WorkflowNodeExecutionStatus
from dify_graph.node_events.base import NodeRunResult


def test_node_run_result_accepts_trigger_info_metadata() -> None:
    result = NodeRunResult(
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        metadata={
            TRIGGER_INFO_METADATA_KEY: {
                "provider_id": "provider-id",
                "event_name": "event-name",
            }
        },
    )

    assert result.metadata[TRIGGER_INFO_METADATA_KEY] == {
        "provider_id": "provider-id",
        "event_name": "event-name",
    }
