from collections.abc import Generator

import pytest

from core.app.apps.workflow.generate_response_converter import WorkflowAppGenerateResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import (
    ErrorStreamResponse,
    NodeFinishStreamResponse,
    NodeRetryStreamResponse,
    NodeStartStreamResponse,
    PingStreamResponse,
    WorkflowAppBlockingResponse,
    WorkflowAppStreamResponse,
)
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus


class TestWorkflowGenerateResponseConverter:
    @pytest.mark.parametrize(
        ("invoke_from", "redacted"),
        [
            (InvokeFrom.WEB_APP, True),
            (InvokeFrom.EXPLORE, True),
            (InvokeFrom.DEBUGGER, False),
            (InvokeFrom.SERVICE_API, False),
            (InvokeFrom.OPENAPI, False),
        ],
    )
    def test_retry_details_follow_response_visibility(self, invoke_from: InvokeFrom, redacted: bool) -> None:
        """Given a retry with private data, redact public streams without mutating the event."""
        retry = NodeRetryStreamResponse(
            task_id="task-1",
            workflow_run_id="run-1",
            data=NodeRetryStreamResponse.Data(
                id="execution-1",
                node_id="llm-1",
                node_type="llm",
                title="LLM",
                index=2,
                inputs={"query": "private-user-input"},
                process_data={
                    "model_provider": "private-provider",
                    "model_name": "private-model",
                    "prompts": [
                        {"role": "system", "text": "private-system-prompt"},
                        {"role": "user", "text": "private-user-input"},
                    ],
                },
                outputs={"text": "private-output"},
                status=WorkflowNodeExecutionStatus.RETRY,
                error="private-error",
                execution_metadata={WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 42},
                files=[{"url": "https://example.com/private-file"}],
                elapsed_time=0.5,
                created_at=1,
                finished_at=2,
                retry_index=1,
            ),
        )
        original = retry.model_dump(mode="json")

        def stream() -> Generator[WorkflowAppStreamResponse]:
            yield WorkflowAppStreamResponse(workflow_run_id="run-1", stream_response=retry)

        response = WorkflowAppGenerateResponseConverter.convert(stream(), invoke_from)
        assert isinstance(response, Generator)
        chunks = list(response)
        assert len(chunks) == 1
        chunk = chunks[0]
        assert isinstance(chunk, dict)
        assert chunk["event"] == "node_retry"
        assert chunk["task_id"] == "task-1"
        assert chunk["workflow_run_id"] == "run-1"
        assert chunk["data"]["retry_index"] == 1
        assert chunk["data"]["status"] == "retry"
        if redacted:
            for field in ("inputs", "process_data", "outputs", "error", "execution_metadata"):
                assert chunk["data"][field] is None
            assert chunk["data"]["files"] == []
        else:
            assert chunk["data"] == original["data"]
        assert retry.model_dump(mode="json") == original

    def test_blocking_full_response(self):
        blocking = WorkflowAppBlockingResponse(
            task_id="t1",
            workflow_run_id="r1",
            data=WorkflowAppBlockingResponse.Data(
                id="exec-1",
                workflow_id="wf-1",
                status=WorkflowExecutionStatus.SUCCEEDED,
                outputs={"ok": True},
                error=None,
                elapsed_time=1.2,
                total_tokens=10,
                total_steps=2,
                created_at=1,
                finished_at=2,
            ),
        )
        response = WorkflowAppGenerateResponseConverter.convert_blocking_full_response(blocking)
        assert response["workflow_run_id"] == "r1"

    def test_stream_simple_response_node_events(self):
        node_start = NodeStartStreamResponse(
            task_id="t1",
            workflow_run_id="r1",
            data=NodeStartStreamResponse.Data(
                id="e1",
                node_id="n1",
                node_type="answer",
                title="Answer",
                index=1,
                created_at=1,
            ),
        )
        node_finish = NodeFinishStreamResponse(
            task_id="t1",
            workflow_run_id="r1",
            data=NodeFinishStreamResponse.Data(
                id="e1",
                node_id="n1",
                node_type="answer",
                title="Answer",
                index=1,
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                elapsed_time=0.1,
                created_at=1,
                finished_at=2,
            ),
        )

        def stream() -> Generator[WorkflowAppStreamResponse]:
            yield WorkflowAppStreamResponse(workflow_run_id="r1", stream_response=PingStreamResponse(task_id="t1"))
            yield WorkflowAppStreamResponse(workflow_run_id="r1", stream_response=node_start)
            yield WorkflowAppStreamResponse(workflow_run_id="r1", stream_response=node_finish)
            yield WorkflowAppStreamResponse(
                workflow_run_id="r1", stream_response=ErrorStreamResponse(task_id="t1", err=ValueError("boom"))
            )

        converted = list(WorkflowAppGenerateResponseConverter.convert_stream_simple_response(stream()))
        assert converted[0] == "ping"
        assert converted[1]["event"] == "node_started"
        assert converted[2]["event"] == "node_finished"
        assert converted[3]["event"] == "error"

    def test_convert_stream_simple_response_handles_ping_and_nodes(self):
        def _gen():
            yield WorkflowAppStreamResponse(stream_response=PingStreamResponse(task_id="task"))
            yield WorkflowAppStreamResponse(
                workflow_run_id="run",
                stream_response=NodeStartStreamResponse(
                    task_id="task",
                    workflow_run_id="run",
                    data=NodeStartStreamResponse.Data(
                        id="node-exec",
                        node_id="node",
                        node_type="start",
                        title="Start",
                        index=1,
                        created_at=1,
                    ),
                ),
            )
            yield WorkflowAppStreamResponse(
                workflow_run_id="run",
                stream_response=NodeFinishStreamResponse(
                    task_id="task",
                    workflow_run_id="run",
                    data=NodeFinishStreamResponse.Data(
                        id="node-exec",
                        node_id="node",
                        node_type="start",
                        title="Start",
                        index=1,
                        status=WorkflowNodeExecutionStatus.SUCCEEDED,
                        outputs={},
                        created_at=1,
                        finished_at=2,
                        elapsed_time=1.0,
                        error=None,
                    ),
                ),
            )

        chunks = list(WorkflowAppGenerateResponseConverter.convert_stream_simple_response(_gen()))

        assert chunks[0] == "ping"
        assert chunks[1]["event"] == "node_started"
        assert chunks[2]["event"] == "node_finished"

    def test_convert_stream_full_response_handles_error(self):
        def _gen():
            yield WorkflowAppStreamResponse(
                workflow_run_id="run",
                stream_response=ErrorStreamResponse(task_id="task", err=ValueError("boom")),
            )

        chunks = list(WorkflowAppGenerateResponseConverter.convert_stream_full_response(_gen()))

        assert chunks[0]["event"] == "error"
