from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
from dify_trace_langsmith.langsmith_trace import LangSmithTraceClient
from pydantic import JsonValue

from core.ops.provider_export import TraceExportError
from core.ops.trace_data import CompletedTrace, TraceSource, TraceSpan, make_span_id, make_trace_id


def make_trace() -> CompletedTrace:
    tenant_id, operation_id, app_id = (str(uuid4()) for _ in range(3))
    root_id, child_id = (make_span_id(tenant_id, operation_id, name) for name in ("root", "llm"))
    started_at = datetime(2026, 9, 9, 8, tzinfo=UTC)
    return CompletedTrace(
        source=TraceSource(
            tenant_id=tenant_id,
            operation_id=operation_id,
            app_id=app_id,
            actor_id="customer-7",
            session_id="session-5",
            message_id=str(uuid4()),
        ),
        trace_id=make_trace_id(tenant_id, operation_id),
        root_span_id=root_id,
        spans=(
            TraceSpan(
                span_id=root_id,
                span_name="Workflow",
                span_type="workflow",
                source_workflow_version="2026-09-09",
                started_at=started_at,
                ended_at=started_at + timedelta(seconds=3),
                inputs={"query": "Hello"},
                outputs={"answer": "World"},
            ),
            TraceSpan(
                span_id=child_id,
                parent_span_id=root_id,
                span_name="Model",
                span_type="llm",
                started_at=started_at + timedelta(seconds=1),
                ended_at=started_at + timedelta(seconds=2),
                inputs=[{"role": "human", "text": "Rendered prompt"}],
                outputs={"text": "World", "finish_reason": "stop"},
                attributes={
                    "model_name": "gpt-4o",
                    "model_provider": "openai",
                    "model_parameters": {"temperature": 0.2},
                },
                usage={
                    "prompt_tokens": 3,
                    "completion_tokens": 5,
                    "total_tokens": 8,
                    "total_price": "0.02",
                    "time_to_first_token": 0.25,
                },
            ),
        ),
    )


def make_client_with_transport(monkeypatch: pytest.MonkeyPatch) -> tuple[LangSmithTraceClient, Mock]:
    client = LangSmithTraceClient({"api_key": "secret", "project": "project"})
    request = Mock(return_value=httpx.Response(202, json={}))
    monkeypatch.setattr(client.http, "request", request)
    return client, request


def test_langsmith_native_llm_prompt_usage_cost_and_model(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    original = trace.model_dump_json()
    client, request = make_client_with_transport(monkeypatch)
    client.export_trace(trace)
    run = request.call_args.kwargs["json"]["post"][0]
    assert run["inputs"] == {"messages": [{"role": "user", "content": "Rendered prompt"}]}
    assert run["outputs"]["choices"][0] == {
        "index": 0,
        "message": {"role": "assistant", "content": "World"},
        "finish_reason": "stop",
    }
    assert run["outputs"]["usage_metadata"] == {
        "input_tokens": 3,
        "output_tokens": 5,
        "total_tokens": 8,
        "total_cost": 0.02,
    }
    assert run["extra"]["metadata"]["ls_model_name"] == "gpt-4o"
    assert run["extra"]["metadata"]["ls_provider"] == "openai"
    assert run["extra"]["invocation_params"] == {"temperature": 0.2}
    assert trace.model_dump_json() == original


def test_langsmith_external_root_matches_trace_id_and_parent_receipts(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    external_id = str(uuid4())
    trace = trace.model_copy(update={"source": trace.source.model_copy(update={"external_trace_id": external_id})})
    client, request = make_client_with_transport(monkeypatch)
    receipt = client.export_trace(trace).spans[trace.root_span_id]
    root = request.call_args_list[0].kwargs["json"]["post"][0]
    child = request.call_args.kwargs["json"]["post"][0]
    assert root["id"] == root["trace_id"] == receipt["span_id"] == external_id
    assert child["trace_id"] == child["parent_run_id"] == external_id
    parent_order = receipt["dotted_order"]
    assert isinstance(parent_order, str)
    assert child["dotted_order"].startswith(parent_order + ".")
    request.reset_mock()
    late = make_trace()
    client.export_trace(late, receipt)
    assert request.call_args_list[0].kwargs["json"]["post"][0]["parent_run_id"] == external_id


@pytest.mark.parametrize("missing", [{"started_at": None, "ended_at": None}, {"ended_at": None}])
def test_langsmith_untimed_children_are_marked_instants(missing: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    child = trace.spans[-1].model_copy(update=missing)
    trace = trace.model_copy(update={"spans": (trace.spans[0], child)})
    client, request = make_client_with_transport(monkeypatch)
    client.export_trace(trace)
    run = request.call_args.kwargs["json"]["post"][0]
    anchor = child.started_at or trace.spans[0].started_at
    assert anchor is not None
    assert run["start_time"] == run["end_time"] == anchor.isoformat()
    assert run["extra"]["metadata"]["dify.timing.estimated"] is True


def test_langsmith_preflight_rejects_invalid_late_span_and_parent_before_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    trace = make_trace()
    child = trace.spans[-1].model_copy(update={"ended_at": trace.spans[0].started_at})
    invalid = trace.model_copy(update={"spans": (trace.spans[0], child)})
    client, request = make_client_with_transport(monkeypatch)
    with pytest.raises(TraceExportError, match="time_invalid"):
        client.export_trace(invalid)
    with pytest.raises(TraceExportError, match="parent_order_missing"):
        client.export_trace(trace, {"trace_id": str(uuid4()), "span_id": str(uuid4())})
    request.assert_not_called()


def test_langsmith_keeps_multimodal_blocks_and_tool_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    content = [{"type": "text", "text": "Describe"}, {"type": "image_url", "image_url": {"url": "image-ref"}}]
    tool_calls = [{"id": "call-1", "type": "function", "function": {"name": "search", "arguments": "{}"}}]
    child = trace.spans[-1].model_copy(
        update={
            "inputs": [{"role": "user", "content": content}],
            "outputs": {"text": "", "tool_calls": tool_calls, "finish_reason": "tool_calls"},
        }
    )
    trace = trace.model_copy(update={"spans": (trace.spans[0], child)})
    client, request = make_client_with_transport(monkeypatch)
    client.export_trace(trace)
    run = request.call_args.kwargs["json"]["post"][0]
    assert run["inputs"]["messages"][0]["content"] == content
    assert run["outputs"]["choices"][0]["message"]["tool_calls"] == tool_calls
    assert run["outputs"]["choices"][0]["finish_reason"] == "tool_calls"


@pytest.mark.parametrize(
    ("span_type", "attributes", "node_execution_id", "expected_run_type", "expected_tags"),
    [
        ("workflow", {}, None, "tool", ["workflow"]),
        ("node", {}, "node-run", "tool", ["node", "node_execution"]),
        ("agent", {}, "agent-run", "tool", ["agent", "node_execution"]),
        ("llm", {}, "model-run", "llm", ["llm", "node_execution"]),
        ("retrieval", {}, "retrieval-run", "retriever", ["retrieval", "node_execution"]),
        (
            "code",
            {"operation_type": "draft_node_execution", "node_execution_id": "draft-run"},
            None,
            "tool",
            ["code", "draft_node_execution", "node_execution"],
        ),
        (
            "operation",
            {"operation_type": "message", "conversation_mode": "chat"},
            None,
            "chain",
            ["operation", "message", "chat"],
        ),
        (
            "operation",
            {"operation_type": "message", "app_mode": "completion"},
            None,
            "chain",
            ["operation", "message", "completion"],
        ),
        ("llm", {"operation_type": "llm", "conversation_mode": "chat"}, None, "llm", ["llm", "chat"]),
        ("tool", {"operation_type": "moderation"}, None, "tool", ["tool", "moderation"]),
        ("llm", {"operation_type": "suggested_question"}, None, "llm", ["llm", "suggested_question"]),
        ("llm", {"operation_type": "generate_name"}, None, "llm", ["llm", "generate_name"]),
        ("operation", {"operation_type": "generate_name"}, None, "tool", ["operation", "generate_name"]),
        ("retrieval", {"operation_type": "dataset_retrieval"}, None, "retriever", ["retrieval", "dataset_retrieval"]),
        ("tool", {"operation_type": "tool", "tool_name": "web_search"}, None, "tool", ["tool", "web_search"]),
    ],
)
def test_langsmith_preserves_operation_tags_and_native_run_types(
    monkeypatch: pytest.MonkeyPatch,
    span_type: str,
    attributes: dict[str, JsonValue],
    node_execution_id: str | None,
    expected_run_type: str,
    expected_tags: list[str],
) -> None:
    trace = make_trace()
    span = trace.spans[0].model_copy(
        update={
            "span_type": span_type,
            "attributes": attributes,
            "node_execution_id": node_execution_id,
            "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8},
        }
    )
    trace = trace.model_copy(update={"spans": (span,)})
    client, request = make_client_with_transport(monkeypatch)

    client.export_trace(trace)

    run = request.call_args.kwargs["json"]["post"][0]
    assert run["run_type"] == expected_run_type
    assert run["tags"] == ["dify", *expected_tags]
    if span_type == "llm":
        assert run["outputs"]["usage_metadata"]["total_tokens"] == 8


@pytest.mark.parametrize(
    ("span_type", "status", "error", "expected_error"),
    [
        ("workflow", "cancelled", "User stopped workflow", "User stopped workflow"),
        ("workflow", "cancelled", None, None),
        ("llm", "cancelled", "User stopped workflow", None),
        ("workflow", "handled_error", None, None),
        ("llm", "handled_error", "Node failure was handled", None),
        ("workflow", "incomplete", None, None),
        ("workflow", "ok", None, None),
    ],
)
def test_langsmith_preserves_cancelled_workflow_reason_without_inventing_errors(
    monkeypatch: pytest.MonkeyPatch,
    span_type: str,
    status: str,
    error: str | None,
    expected_error: str | None,
) -> None:
    trace = make_trace()
    span = trace.spans[0].model_copy(update={"span_type": span_type, "status": status, "error": error})
    trace = trace.model_copy(update={"spans": (span,), "complete": False, "truncation": {"reasons": ["capture_error"]}})
    client, request = make_client_with_transport(monkeypatch)

    client.export_trace(trace)

    run = request.call_args.kwargs["json"]["post"][0]
    assert run["error"] == expected_error
