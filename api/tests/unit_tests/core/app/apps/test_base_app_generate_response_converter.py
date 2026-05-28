from __future__ import annotations

from collections.abc import Generator

from core.app.apps.base_app_generate_response_converter import AppGenerateResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import (
    AppStreamResponse,
    PingStreamResponse,
    WorkflowAppBlockingResponse,
    WorkflowAppStreamResponse,
)
from graphon.enums import WorkflowExecutionStatus


class _DummyConverter(AppGenerateResponseConverter[WorkflowAppBlockingResponse]):
    blocking_full_calls: list[WorkflowAppBlockingResponse] = []
    blocking_simple_calls: list[WorkflowAppBlockingResponse] = []
    stream_full_calls: list[Generator[AppStreamResponse, None, None]] = []
    stream_simple_calls: list[Generator[AppStreamResponse, None, None]] = []

    @classmethod
    def reset(cls) -> None:
        cls.blocking_full_calls = []
        cls.blocking_simple_calls = []
        cls.stream_full_calls = []
        cls.stream_simple_calls = []

    @classmethod
    def convert_blocking_full_response(cls, blocking_response: WorkflowAppBlockingResponse) -> dict[str, object]:
        cls.blocking_full_calls.append(blocking_response)
        return {"kind": "blocking-full", "task_id": blocking_response.task_id}

    @classmethod
    def convert_blocking_simple_response(cls, blocking_response: WorkflowAppBlockingResponse) -> dict[str, object]:
        cls.blocking_simple_calls.append(blocking_response)
        return {"kind": "blocking-simple", "task_id": blocking_response.task_id}

    @classmethod
    def convert_stream_full_response(
        cls, stream_response: Generator[AppStreamResponse, None, None]
    ) -> Generator[dict | str, None, None]:
        cls.stream_full_calls.append(stream_response)
        yield {"kind": "stream-full"}

    @classmethod
    def convert_stream_simple_response(
        cls, stream_response: Generator[AppStreamResponse, None, None]
    ) -> Generator[dict | str, None, None]:
        cls.stream_simple_calls.append(stream_response)
        yield {"kind": "stream-simple"}


def _build_blocking_response() -> WorkflowAppBlockingResponse:
    return WorkflowAppBlockingResponse(
        task_id="task-1",
        workflow_run_id="run-1",
        data=WorkflowAppBlockingResponse.Data(
            id="run-1",
            workflow_id="workflow-1",
            status=WorkflowExecutionStatus.SUCCEEDED,
            outputs={"ok": True},
            error=None,
            elapsed_time=0.1,
            total_tokens=0,
            total_steps=1,
            created_at=1,
            finished_at=2,
        ),
    )


def _build_stream_response() -> Generator[AppStreamResponse, None, None]:
    yield WorkflowAppStreamResponse(
        workflow_run_id="run-1",
        stream_response=PingStreamResponse(task_id="task-1"),
    )


def test_convert_routes_blocking_response_by_invoke_from() -> None:
    _DummyConverter.reset()
    blocking_response = _build_blocking_response()

    full_result = _DummyConverter.convert(blocking_response, InvokeFrom.SERVICE_API)
    simple_result = _DummyConverter.convert(blocking_response, InvokeFrom.WEB_APP)

    assert full_result == {"kind": "blocking-full", "task_id": "task-1"}
    assert simple_result == {"kind": "blocking-simple", "task_id": "task-1"}
    assert _DummyConverter.blocking_full_calls == [blocking_response]
    assert _DummyConverter.blocking_simple_calls == [blocking_response]


def test_convert_routes_stream_response_by_invoke_from() -> None:
    _DummyConverter.reset()

    full_result = list(_DummyConverter.convert(_build_stream_response(), InvokeFrom.SERVICE_API))
    simple_result = list(_DummyConverter.convert(_build_stream_response(), InvokeFrom.WEB_APP))

    assert full_result == [{"kind": "stream-full"}]
    assert simple_result == [{"kind": "stream-simple"}]
    assert len(_DummyConverter.stream_full_calls) == 1
    assert len(_DummyConverter.stream_simple_calls) == 1
