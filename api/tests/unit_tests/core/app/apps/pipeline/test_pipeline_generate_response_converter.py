from collections.abc import Generator

from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus

from core.app.apps.pipeline.generate_response_converter import WorkflowAppGenerateResponseConverter
from core.app.entities.task_entities import (
    AppStreamResponse,
    ErrorStreamResponse,
    NodeFinishStreamResponse,
    NodeStartStreamResponse,
    PingStreamResponse,
    WorkflowAppBlockingResponse,
    WorkflowAppStreamResponse,
)


def test_convert_blocking_full_and_simple_response():
    blocking = WorkflowAppBlockingResponse(
        task_id="task",
        workflow_run_id="run",
        data=WorkflowAppBlockingResponse.Data(
            id="id",
            workflow_id="wf",
            status=WorkflowExecutionStatus.SUCCEEDED,
            outputs={"k": "v"},
            error=None,
            elapsed_time=0.1,
            total_tokens=10,
            total_steps=1,
            created_at=1,
            finished_at=2,
        ),
    )

    full = WorkflowAppGenerateResponseConverter.convert_blocking_full_response(blocking)
    simple = WorkflowAppGenerateResponseConverter.convert_blocking_simple_response(blocking)

    assert full == simple
    assert full["workflow_run_id"] == "run"
    assert full["data"]["status"] == WorkflowExecutionStatus.SUCCEEDED


def test_convert_stream_full_response():
    def stream() -> Generator[AppStreamResponse, None, None]:
        yield WorkflowAppStreamResponse(
            stream_response=PingStreamResponse(task_id="t"),
            workflow_run_id="run",
        )
        yield WorkflowAppStreamResponse(
            stream_response=ErrorStreamResponse(task_id="t", err=ValueError("bad")),
            workflow_run_id="run",
        )

    result = list(WorkflowAppGenerateResponseConverter.convert_stream_full_response(stream()))

    assert result[0] == "ping"
    assert result[1]["event"] == "error"
    assert result[1]["code"] == "invalid_param"


def test_convert_stream_simple_response_node_ignore_details():
    node_start = NodeStartStreamResponse(
        task_id="t",
        workflow_run_id="run",
        data=NodeStartStreamResponse.Data(
            id="nid",
            node_id="node",
            node_type="type",
            title="Title",
            index=1,
            predecessor_node_id=None,
            inputs={"a": 1},
            inputs_truncated=False,
            created_at=1,
        ),
    )
    node_finish = NodeFinishStreamResponse(
        task_id="t",
        workflow_run_id="run",
        data=NodeFinishStreamResponse.Data(
            id="nid",
            node_id="node",
            node_type="type",
            title="Title",
            index=1,
            predecessor_node_id=None,
            inputs={"a": 1},
            inputs_truncated=False,
            process_data=None,
            process_data_truncated=False,
            outputs={"b": 2},
            outputs_truncated=False,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            error=None,
            elapsed_time=0.1,
            execution_metadata=None,
            created_at=1,
            finished_at=2,
            files=[],
        ),
    )

    def stream() -> Generator[AppStreamResponse, None, None]:
        yield WorkflowAppStreamResponse(stream_response=node_start, workflow_run_id="run")
        yield WorkflowAppStreamResponse(stream_response=node_finish, workflow_run_id="run")

    result = list(WorkflowAppGenerateResponseConverter.convert_stream_simple_response(stream()))

    assert result[0]["event"] == "node_started"
    assert result[0]["data"]["inputs"] is None
    assert result[1]["event"] == "node_finished"
    assert result[1]["data"]["inputs"] is None
