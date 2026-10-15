"""Content policy and model-call accounting across all canonical tree layers."""

import json
from datetime import UTC, datetime

import pytest

from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from services.tracing.normalization import normalize_agent_span, order_spans, remap_outer_trace, safe_attributes
from services.tracing.provider_common import token_usage, usd_cost


def agent_data(
    attributes: dict[str, object], *, span_id: str = "2" * 16, parent_id: str = "1" * 16
) -> dict[str, object]:
    return {
        "span_id": span_id,
        "parent_span_id": parent_id,
        "name": "operation",
        "start_time_ns": 1_000_000_000,
        "end_time_ns": 2_000_000_000,
        "status": "error",
        "status_message": "sensitive error output",
        "attributes": attributes,
    }


def test_content_off_is_safe_for_all_metadata_namespaces() -> None:
    normalized = normalize_agent_span(
        agent_data(
            {
                "gen_ai.operation.name": "chat",
                "gen_ai.request.model": "model-one",
                "gen_ai.usage.input_tokens": 3,
                "gen_ai.usage.output_tokens": 2,
                "gen_ai.input.messages": [{"content": "private input"}],
                "gen_ai.output.messages": [{"content": "private output"}],
                "exception.message": "private exception",
                "dify.app_id": "app-one",
                "dify.custom_payload": {"prompt": "private metadata"},
                "gen_ai.request.messages": "private request metadata",
                "gen_ai.response.output": "private response metadata",
                "gen_ai.usage.custom_prompt": "private usage metadata",
            }
        ),
        capture_content=False,
    )
    assert normalized.inputs is None
    assert normalized.outputs is None
    assert "private" not in normalized.model_dump_json()
    assert "sensitive error" not in normalized.model_dump_json()
    assert normalized.metadata["dify.app_id"] == "app-one"
    assert normalized.metadata["model_name"] == "model-one"
    assert normalized.metadata["total_tokens"] == 5


def test_json_encoded_tool_credentials_are_redacted_from_inputs_and_metadata() -> None:
    normalized = normalize_agent_span(
        agent_data(
            {
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": "search",
                "gen_ai.tool.call.arguments": json.dumps({"api_key": "tool-secret-123", "query": "public query"}),
                "gen_ai.tool.call.result": json.dumps(
                    {"nested": {"authorization": "bearer-secret-123"}, "result": "okay"}
                ),
            }
        ),
        capture_content=True,
    )
    serialized = normalized.model_dump_json()
    assert "tool-secret-123" not in serialized
    assert "bearer-secret-123" not in serialized
    assert "public query" in serialized
    assert normalized.inputs["api_key"] == "[redacted]"


def test_content_off_drops_error_event_payload_and_keeps_numeric_usage() -> None:
    attrs = safe_attributes(
        {
            "input": "user text",
            "authorization": "secret",
            "exception.stacktrace": "sensitive",
            "gen_ai.usage.input_tokens": 10,
            "gen_ai.tool.name": "lookup",
        },
        capture_content=False,
    )
    assert attrs == {"gen_ai.usage.input_tokens": 10, "gen_ai.tool.name": "lookup"}


def test_real_runtime_accounting_attributes_survive_content_off() -> None:
    normalized = normalize_agent_span(
        agent_data(
            {
                "gen_ai.operation.name": "chat",
                "gen_ai.request.model": "gpt-4o-mini",
                "gen_ai.usage.input_tokens": 8,
                "gen_ai.usage.output_tokens": 4,
                "dify.llm.total_price": "0.03",
                "dify.llm.currency": "USD",
                "gen_ai.response.time_to_first_token": 0.2,
                "dify.llm.time_to_first_token_unit": "s",
                "dify.llm.time_to_first_token_source": "gateway_usage",
                "gen_ai.input.messages": "private input",
            }
        ),
        capture_content=False,
    )
    assert usd_cost(normalized) == 0.03
    assert normalized.metadata["currency"] == "USD"
    assert normalized.metadata["time_to_first_token"] == 0.2
    assert token_usage(normalized) == {"input": 8, "output": 4, "total": 12}
    assert normalized.inputs is None


def span(identifier: str, parent: str | None, kind: CanonicalSpanKind, *, synthetic: bool = False) -> CanonicalSpan:
    return CanonicalSpan(
        id=identifier,
        parent_id=parent,
        name=identifier,
        kind=kind,
        start_time=datetime.fromtimestamp(0, UTC),
        end_time=datetime.fromtimestamp(3, UTC),
        status=CanonicalSpanStatus.OK,
        inputs={"content": "private"},
        outputs="private",
        metadata={
            "prompt_tokens": 6,
            "completion_tokens": 4,
            "total_tokens": 10,
            "total_price": "0.03",
            "prompt": "private",
        },
        synthetic=synthetic,
    )


def test_two_native_model_calls_replace_synthetic_aggregate_generation() -> None:
    outer = CanonicalTrace(
        trace_id="old",
        session_id="session",
        root_span_id="message",
        spans=(
            span("message", None, CanonicalSpanKind.CHAIN),
            span("message:llm", "message", CanonicalSpanKind.LLM, synthetic=True),
        ),
    )
    remapped = remap_outer_trace(outer, trace_id="1" * 32, capture_content=False, agent_message=True)
    calls = [
        normalize_agent_span(
            agent_data(
                {
                    "gen_ai.operation.name": "chat",
                    "gen_ai.request.model": "model",
                    "gen_ai.usage.input_tokens": 3,
                    "gen_ai.usage.output_tokens": 2,
                },
                span_id=identifier,
                parent_id=remapped.root_span_id,
            ),
            capture_content=False,
        )
        for identifier in ("2" * 16, "3" * 16)
    ]
    combined = order_spans(remapped.root_span_id, [calls[1], *remapped.spans, calls[0]])
    assert combined[0].id == remapped.root_span_id
    generations = [item for item in combined if item.kind is CanonicalSpanKind.LLM]
    assert len(generations) == 2
    assert sum(token_usage(item)["total"] for item in generations) == 10
    assert token_usage(combined[0]) == {}
    assert combined[0].metadata["aggregate_total_tokens"] == 10
    assert "private" not in json.dumps([item.model_dump(mode="json") for item in combined])


def test_non_agent_workflow_retains_its_real_llm_node() -> None:
    trace = CanonicalTrace(
        trace_id="old",
        session_id="session",
        root_span_id="workflow",
        spans=(
            span("workflow", None, CanonicalSpanKind.CHAIN),
            span("llm-node", "workflow", CanonicalSpanKind.LLM),
        ),
    )
    remapped = remap_outer_trace(trace, trace_id="1" * 32, capture_content=True, agent_message=False)
    assert len(remapped.spans) == 2
    assert remapped.spans[1].kind is CanonicalSpanKind.LLM
    assert token_usage(remapped.spans[1])["total"] == 10


def test_order_spans_rejects_orphans_cycles_and_conflicting_ids() -> None:
    root = span("root", None, CanonicalSpanKind.CHAIN)
    with pytest.raises(ValueError, match="parent is missing"):
        order_spans("root", [root, span("orphan", "missing", CanonicalSpanKind.TOOL)])
    with pytest.raises(ValueError, match="parent cycle"):
        order_spans(
            "root", [root, span("one", "two", CanonicalSpanKind.TOOL), span("two", "one", CanonicalSpanKind.TOOL)]
        )
    with pytest.raises(ValueError, match="Conflicting"):
        order_spans("root", [root, root.model_copy(update={"name": "other"})])
