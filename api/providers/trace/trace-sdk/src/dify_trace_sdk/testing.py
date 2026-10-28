"""Test support for provider packages: a recording egress and representative traces."""

import json
from collections import deque
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import grpc  # type: ignore[import-untyped]

from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import EgressBlockedError
from dify_trace_sdk.ids import span_id_for, trace_id_for
from dify_trace_sdk.model import Cost, Span, SpanKind, SpanRef, SpanStatus, TokenUsage, Trace

MESSAGE_ID = "7b3c6c0e-38a1-4b52-9a7e-3ad8f3a1c001"
WORKFLOW_RUN_ID = "7b3c6c0e-38a1-4b52-9a7e-3ad8f3a1c002"
NESTED_WORKFLOW_RUN_ID = "7b3c6c0e-38a1-4b52-9a7e-3ad8f3a1c003"
STARTED_AT = datetime(2026, 10, 1, 8, 0, 0, tzinfo=UTC)


@dataclass(frozen=True)
class RecordedRequest:
    method: str
    url: str
    headers: Mapping[str, str]
    content: bytes | None
    timeout: float
    sensitive_url: bool

    def json(self) -> object:
        return json.loads(self.content or b"null")


class RecordingEgress:
    """Answers requests from a script and records what a provider sent."""

    def __init__(self, responses: Iterable[EgressResponse | Exception], *, grpc_target: str | None) -> None:
        self._responses = deque(responses)
        self._grpc_target = grpc_target
        self.requests: list[RecordedRequest] = []
        self.grpc_endpoints: list[str] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        content: bytes | None,
        timeout: float,
        sensitive_url: bool,
    ) -> EgressResponse:
        self.requests.append(
            RecordedRequest(
                method=method,
                url=url,
                headers=dict(headers),
                content=content,
                timeout=timeout,
                sensitive_url=sensitive_url,
            )
        )
        if not self._responses:
            raise AssertionError(f"unexpected request: {method} {url}")
        response = self._responses.popleft()
        if isinstance(response, Exception):
            raise response
        return response

    def grpc_channel(self, endpoint: str) -> grpc.Channel:
        self.grpc_endpoints.append(endpoint)
        if self._grpc_target is None:
            raise EgressBlockedError("gRPC is not available in this test")
        return grpc.insecure_channel(self._grpc_target)


def response(status_code: int, body: object) -> EgressResponse:
    content = body if isinstance(body, bytes) else json.dumps(body).encode()
    content_type = "application/octet-stream" if isinstance(body, bytes) else "application/json"
    return EgressResponse(status_code=status_code, headers={"content-type": content_type}, content=content)


def message_trace() -> Trace:
    """A chat message: the message root and the LLM call that answered it."""
    message_span_id = span_id_for(MESSAGE_ID)
    return Trace(
        trace_id=trace_id_for(MESSAGE_ID),
        external_trace_id=None,
        session_id="conversation-1",
        user_id="end-user-1",
        parent=None,
        trace_root=None,
        spans=(
            Span(
                span_id=message_span_id,
                parent_span_id=None,
                name="message",
                kind=SpanKind.CHAIN,
                start_time=STARTED_AT,
                end_time=STARTED_AT + timedelta(seconds=2),
                status=SpanStatus.OK,
                inputs={"query": "What is Dify?"},
                outputs="An LLM application platform.",
                attributes={"message_id": MESSAGE_ID, "app_id": "app-1", "tenant_id": "tenant-1"},
            ),
            Span(
                span_id=span_id_for(f"{MESSAGE_ID}:llm"),
                parent_span_id=message_span_id,
                name="llm",
                kind=SpanKind.LLM,
                start_time=STARTED_AT,
                end_time=STARTED_AT + timedelta(seconds=2),
                status=SpanStatus.OK,
                inputs=[{"role": "user", "content": "What is Dify?"}],
                outputs="An LLM application platform.",
                model_name="gpt-4o",
                model_provider="openai",
                usage=TokenUsage(prompt_tokens=12, completion_tokens=8, total_tokens=20),
                cost=Cost(amount=0.0004, currency="USD"),
                time_to_first_token=0.25,
                attributes={"message_id": MESSAGE_ID},
            ),
        ),
    )


def workflow_trace() -> Trace:
    """A workflow run with a failed tool node under a successful LLM node."""
    run_span_id = span_id_for(WORKFLOW_RUN_ID)
    llm_span_id = span_id_for("node-execution-llm")
    return Trace(
        trace_id=trace_id_for(WORKFLOW_RUN_ID),
        external_trace_id=None,
        session_id=WORKFLOW_RUN_ID,
        user_id="account-1",
        parent=None,
        trace_root=None,
        spans=(
            Span(
                span_id=run_span_id,
                parent_span_id=None,
                name="workflow",
                kind=SpanKind.CHAIN,
                start_time=STARTED_AT,
                end_time=STARTED_AT + timedelta(seconds=5),
                status=SpanStatus.ERROR,
                error="Tool failed",
                inputs={"topic": "tracing"},
                outputs={},
                attributes={"workflow_run_id": WORKFLOW_RUN_ID, "app_id": "app-1"},
            ),
            Span(
                span_id=llm_span_id,
                parent_span_id=run_span_id,
                name="llm_Summarize",
                kind=SpanKind.LLM,
                start_time=STARTED_AT + timedelta(seconds=1),
                end_time=STARTED_AT + timedelta(seconds=3),
                status=SpanStatus.OK,
                inputs=[{"role": "user", "content": "Summarize tracing"}],
                outputs={"text": "Tracing records execution."},
                model_name="gpt-4o",
                model_provider="openai",
                usage=TokenUsage(prompt_tokens=30, completion_tokens=10, total_tokens=40),
                attributes={"node_execution_id": "node-execution-llm", "node_type": "llm"},
            ),
            Span(
                span_id=span_id_for("node-execution-tool"),
                parent_span_id=llm_span_id,
                name="tool_Search",
                kind=SpanKind.TOOL,
                start_time=STARTED_AT + timedelta(seconds=3),
                end_time=STARTED_AT + timedelta(seconds=5),
                status=SpanStatus.ERROR,
                error="Tool failed",
                inputs={"query": "tracing"},
                outputs={},
                attributes={"node_execution_id": "node-execution-tool", "node_type": "tool"},
            ),
        ),
    )


def tool_fragment() -> Trace:
    """A tool call sent separately and attached under the message of ``message_trace``."""
    return Trace(
        trace_id=trace_id_for(MESSAGE_ID),
        external_trace_id=None,
        session_id="conversation-1",
        user_id="end-user-1",
        parent=SpanRef(span_id=span_id_for(MESSAGE_ID), start_time=STARTED_AT),
        trace_root=SpanRef(span_id=span_id_for(MESSAGE_ID), start_time=STARTED_AT),
        spans=(
            Span(
                span_id=span_id_for("tool-event-1"),
                parent_span_id=span_id_for(MESSAGE_ID),
                name="weather",
                kind=SpanKind.TOOL,
                start_time=STARTED_AT + timedelta(milliseconds=500),
                end_time=STARTED_AT + timedelta(seconds=1),
                status=SpanStatus.OK,
                inputs={"city": "Berlin"},
                outputs="Sunny",
                attributes={"message_id": MESSAGE_ID},
            ),
        ),
    )


def nested_workflow_fragment() -> Trace:
    """A nested workflow run sent separately and attached under the tool node of ``workflow_trace``."""
    tool_span_id = span_id_for("node-execution-tool")
    run_span_id = span_id_for(NESTED_WORKFLOW_RUN_ID)
    return Trace(
        trace_id=trace_id_for(WORKFLOW_RUN_ID),
        external_trace_id=None,
        session_id=WORKFLOW_RUN_ID,
        user_id="account-1",
        parent=SpanRef(span_id=tool_span_id, start_time=STARTED_AT + timedelta(seconds=3)),
        trace_root=SpanRef(span_id=span_id_for(WORKFLOW_RUN_ID), start_time=STARTED_AT),
        spans=(
            Span(
                span_id=run_span_id,
                parent_span_id=tool_span_id,
                name="workflow",
                kind=SpanKind.CHAIN,
                start_time=STARTED_AT + timedelta(seconds=3, milliseconds=100),
                end_time=STARTED_AT + timedelta(seconds=4),
                status=SpanStatus.OK,
                inputs={"query": "tracing"},
                outputs={"answer": "Tracing records execution."},
                attributes={
                    "workflow_run_id": NESTED_WORKFLOW_RUN_ID,
                    "parent_workflow_run_id": WORKFLOW_RUN_ID,
                    "parent_node_execution_id": "node-execution-tool",
                },
            ),
            Span(
                span_id=span_id_for("nested-node-execution-code"),
                parent_span_id=run_span_id,
                name="code_Lookup",
                kind=SpanKind.CHAIN,
                start_time=STARTED_AT + timedelta(seconds=3, milliseconds=200),
                end_time=STARTED_AT + timedelta(seconds=3, milliseconds=900),
                status=SpanStatus.OK,
                inputs={"query": "tracing"},
                outputs={"answer": "Tracing records execution."},
                attributes={"node_execution_id": "nested-node-execution-code", "node_type": "code"},
            ),
        ),
    )
