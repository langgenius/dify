from collections.abc import Generator

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
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus


def test_convert_blocking_full_and_simple_response() -> None:
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
    assert isinstance(full, dict)
    assert full["workflow_run_id"] == "run"
    full_data = full["data"]
    assert isinstance(full_data, dict)
    assert full_data["status"] == WorkflowExecutionStatus.SUCCEEDED


def test_convert_stream_full_response() -> None:
    def stream() -> Generator[AppStreamResponse]:
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
    assert isinstance(result[1], dict)
    assert result[1]["event"] == "error"
    assert result[1]["code"] == "invalid_param"


def test_convert_stream_simple_response_node_ignore_details() -> None:
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

    def stream() -> Generator[AppStreamResponse]:
        yield WorkflowAppStreamResponse(stream_response=node_start, workflow_run_id="run")
        yield WorkflowAppStreamResponse(stream_response=node_finish, workflow_run_id="run")

    result = list(WorkflowAppGenerateResponseConverter.convert_stream_simple_response(stream()))

    assert isinstance(result[0], dict)
    assert result[0]["event"] == "node_started"
    start_data = result[0]["data"]
    assert isinstance(start_data, dict)
    assert start_data["inputs"] is None
    assert isinstance(result[1], dict)
    assert result[1]["event"] == "node_finished"
    finish_data = result[1]["data"]
    assert isinstance(finish_data, dict)
    assert finish_data["inputs"] is None
