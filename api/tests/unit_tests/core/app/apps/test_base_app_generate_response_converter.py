from __future__ import annotations

from collections.abc import Generator
from typing import ClassVar

import pytest

from clients.agent_backend.errors import (
    AgentBackendHTTPError,
    AgentBackendRequestBuildError,
    AgentBackendStreamError,
    AgentBackendTransportError,
    AgentBackendValidationError,
)
from core.app.apps.base_app_generate_response_converter import AppGenerateResponseConverter
from core.app.apps.exc import AppGenerateError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import (
    AppStreamResponse,
    PingStreamResponse,
    WorkflowAppBlockingResponse,
    WorkflowAppStreamResponse,
)
from graphon.enums import WorkflowExecutionStatus
from graphon.model_runtime.errors.invoke import InvokeError


class _DummyConverter(AppGenerateResponseConverter[WorkflowAppBlockingResponse]):
    blocking_full_calls: ClassVar[list[WorkflowAppBlockingResponse]] = []
    blocking_simple_calls: ClassVar[list[WorkflowAppBlockingResponse]] = []
    stream_full_calls: ClassVar[list[Generator[AppStreamResponse]]] = []
    stream_simple_calls: ClassVar[list[Generator[AppStreamResponse]]] = []

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
        cls, stream_response: Generator[AppStreamResponse]
    ) -> Generator[dict[str, object] | str]:
        cls.stream_full_calls.append(stream_response)
        yield {"kind": "stream-full"}

    @classmethod
    def convert_stream_simple_response(
        cls, stream_response: Generator[AppStreamResponse]
    ) -> Generator[dict[str, object] | str]:
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


def _build_stream_response() -> Generator[AppStreamResponse]:
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


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (
            AgentBackendHTTPError("backend unavailable", status_code=503, detail={"code": "backend_unavailable"}),
            503,
            "backend_unavailable",
        ),
        (AgentBackendHTTPError("bad request", status_code=422, detail={"code": ""}), 422, "agent_backend_error"),
        (AgentBackendHTTPError("invalid DTO", status_code=200, detail=[]), 502, "agent_backend_error"),
        (AgentBackendTransportError("timeout"), 502, "agent_backend_error"),
        (AgentBackendStreamError("incomplete SSE"), 502, "agent_backend_error"),
        (AgentBackendValidationError("invalid DTO", detail=[]), 502, "agent_backend_error"),
        (AgentBackendRequestBuildError("invalid config"), 400, "completion_request_error"),
        (ValueError("invalid input"), 400, "invalid_param"),
        (InvokeError(), 400, "completion_request_error"),
    ],
)
def test_stream_error_mapping(error: Exception, status: int, code: str) -> None:
    data = AppGenerateResponseConverter._error_to_stream_response(error)

    assert data == {"status": status, "code": code, "message": str(error)}
    data["message"] = "changed by caller"
    assert AppGenerateResponseConverter._error_to_stream_response(error)["message"] == str(error)


def test_stream_error_preserves_app_generate_contract() -> None:
    error = AppGenerateError("draft conflict")
    error.error_code = "draft_conflict"
    error.status_code = 409

    assert AppGenerateResponseConverter._error_to_stream_response(error) == {
        "code": "draft_conflict",
        "status": 409,
        "message": "draft conflict",
    }


@pytest.mark.parametrize("has_cause", [False, True])
def test_unhandled_stream_error_logs_original_exception(caplog: pytest.LogCaptureFixture, has_cause: bool) -> None:
    error = RuntimeError("internal failure")
    cause = OSError("original failure")
    if has_cause:
        error.__cause__ = cause

    assert AppGenerateResponseConverter._error_to_stream_response(error) == {
        "code": "internal_server_error",
        "status": 500,
        "message": "Internal Server Error, please contact support.",
    }
    record = caplog.records[-1]
    assert record.message == "Unhandled error in app generate stream"
    assert record.exc_info
    assert record.exc_info[1] is (cause if has_cause else error)
