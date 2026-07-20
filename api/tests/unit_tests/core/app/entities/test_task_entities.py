import json

from core.app.entities.task_entities import (
    NodeFinishStreamResponse,
    NodeRetryStreamResponse,
    NodeStartStreamResponse,
    ReasoningChunkStreamResponse,
    StreamEvent,
    TaskStateMetadata,
)
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.model_runtime.utils.encoders import jsonable_encoder


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

    def test_reasoning_chunk_stream_response_shape(self):
        response = ReasoningChunkStreamResponse(
            task_id="task-1",
            data=ReasoningChunkStreamResponse.Data(
                message_id="msg-1",
                reasoning="let me think",
                node_id="llm",
                is_final=False,
            ),
        )

        payload = response.model_dump()

        assert payload["event"] == StreamEvent.REASONING_CHUNK
        assert payload["task_id"] == "task-1"
        assert payload["data"]["message_id"] == "msg-1"
        assert payload["data"]["reasoning"] == "let me think"
        assert payload["data"]["node_id"] == "llm"
        assert payload["data"]["is_final"] is False

    def test_task_state_metadata_reasoning_round_trips(self):
        # The persistence path serializes the whole metadata to message_metadata via
        # model_dump -> jsonable_encoder -> json.dumps, then reads back with json.loads.
        metadata = TaskStateMetadata()
        metadata.reasoning["llm"] = "first"
        metadata.reasoning["llm2"] = "second"

        serialized = json.dumps(jsonable_encoder(metadata.model_dump()))
        restored = json.loads(serialized)

        assert restored["reasoning"] == {"llm": "first", "llm2": "second"}

    def test_task_state_metadata_reasoning_defaults_empty(self):
        # Old rows / runs without reasoning serialize to an empty dict, never null.
        metadata = TaskStateMetadata()
        restored = json.loads(json.dumps(jsonable_encoder(metadata.model_dump())))
        assert restored["reasoning"] == {}
