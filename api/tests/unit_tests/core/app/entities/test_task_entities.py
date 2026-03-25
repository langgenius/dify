from core.app.entities.task_entities import (
    NodeFinishStreamResponse,
    NodeRetryStreamResponse,
    NodeStartStreamResponse,
    StreamEvent,
)
from dify_graph.enums import WorkflowNodeExecutionStatus


class TestTaskEntities:
    def test_node_start_to_ignore_detail_dict(self):
        data = NodeStartStreamResponse.Data(
            id="exec-1",
            node_id="node-1",
            node_type="answer",
            title="Answer",
            index=1,
            predecessor_node_id=None,
            inputs={"foo": "bar"},
            created_at=1,
        )
        response = NodeStartStreamResponse(task_id="task-1", workflow_run_id="run-1", data=data)

        payload = response.to_ignore_detail_dict()

        assert payload["event"] == StreamEvent.NODE_STARTED.value
        assert payload["data"]["inputs"] is None
        assert payload["data"]["extras"] == {}

    def test_node_finish_to_ignore_detail_dict(self):
        data = NodeFinishStreamResponse.Data(
            id="exec-1",
            node_id="node-1",
            node_type="answer",
            title="Answer",
            index=1,
            predecessor_node_id=None,
            inputs={"foo": "bar"},
            process_data={"step": 1},
            outputs={"answer": "ok"},
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            elapsed_time=0.1,
            created_at=1,
            finished_at=2,
        )
        response = NodeFinishStreamResponse(task_id="task-1", workflow_run_id="run-1", data=data)

        payload = response.to_ignore_detail_dict()

        assert payload["event"] == StreamEvent.NODE_FINISHED.value
        assert payload["data"]["inputs"] is None
        assert payload["data"]["outputs"] is None
        assert payload["data"]["files"] == []

    def test_node_retry_to_ignore_detail_dict(self):
        data = NodeRetryStreamResponse.Data(
            id="exec-1",
            node_id="node-1",
            node_type="answer",
            title="Answer",
            index=1,
            predecessor_node_id=None,
            inputs={"foo": "bar"},
            process_data={"step": 1},
            outputs={"answer": "ok"},
            status=WorkflowNodeExecutionStatus.RETRY,
            elapsed_time=0.1,
            created_at=1,
            finished_at=2,
            retry_index=2,
        )
        response = NodeRetryStreamResponse(task_id="task-1", workflow_run_id="run-1", data=data)

        payload = response.to_ignore_detail_dict()

        assert payload["event"] == StreamEvent.NODE_RETRY.value
        assert payload["data"]["retry_index"] == 2
        assert payload["data"]["outputs"] is None
