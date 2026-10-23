"""Content policy and model-call accounting across all canonical tree layers."""

import json
from datetime import UTC, datetime

import pytest
from dify_trace_sdk.ids import span_id_for
from dify_trace_sdk.model import Cost, Span, SpanKind, SpanStatus, TokenUsage, Trace

from services.tracing.normalization import normalize_agent_span, order_spans, remap_outer_trace, safe_attributes


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
    assert normalized.error == "Agent operation failed"
    assert normalized.attributes["dify.app_id"] == "app-one"
    assert normalized.model_name == "model-one"
    assert normalized.usage == TokenUsage(prompt_tokens=3, completion_tokens=2, total_tokens=5)


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
    assert normalized.kind is SpanKind.TOOL
    assert normalized.inputs == {"api_key": "[redacted]", "query": "public query"}
    assert normalized.outputs == {"nested": {"authorization": "[redacted]"}, "result": "okay"}


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
                # The runtime reports its decimal price as a string.
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
    assert normalized.cost == Cost(amount=0.03, currency="USD")
    assert normalized.time_to_first_token == 0.2
    assert normalized.usage == TokenUsage(prompt_tokens=8, completion_tokens=4, total_tokens=12)
    assert normalized.attributes["dify.llm.time_to_first_token_source"] == "gateway_usage"
    assert normalized.inputs is None


@pytest.mark.parametrize("price", ["not-a-price", "-0.01", "nan", "inf", True])
def test_unusable_runtime_price_is_not_reported_as_cost(price: object) -> None:
    normalized = normalize_agent_span(
        agent_data({"gen_ai.operation.name": "chat", "dify.llm.total_price": price}), capture_content=True
    )
    assert normalized.kind is SpanKind.LLM
    assert normalized.cost is None


def test_agent_aggregate_usage_is_context_not_another_generation() -> None:
    normalized = normalize_agent_span(
        agent_data(
            {
                "gen_ai.operation.name": "invoke_agent",
                "gen_ai.request.model": "model",
                "gen_ai.usage.input_tokens": 30,
                "gen_ai.usage.output_tokens": 20,
                "dify.llm.total_price": "0.5",
            }
        ),
        capture_content=False,
    )
    assert normalized.kind is SpanKind.AGENT
    assert normalized.usage is None
    assert normalized.cost is None
    assert normalized.model_name is None
    assert normalized.attributes["aggregate_prompt_tokens"] == 30
    assert normalized.attributes["aggregate_completion_tokens"] == 20


def span(name: str, parent: str | None, kind: SpanKind) -> Span:
    return Span(
        span_id=span_id_for(name),
        parent_span_id=span_id_for(parent) if parent else None,
        name=name,
        kind=kind,
        start_time=datetime.fromtimestamp(0, UTC),
        end_time=datetime.fromtimestamp(3, UTC),
        status=SpanStatus.OK,
        inputs={"content": "private"},
        outputs="private",
        usage=TokenUsage(prompt_tokens=6, completion_tokens=4, total_tokens=10) if kind is SpanKind.LLM else None,
        cost=Cost(amount=0.03, currency="USD") if kind is SpanKind.LLM else None,
        attributes={"prompt": "private", "node_type": kind.value},
    )


def trace_of(*spans: Span) -> Trace:
    return Trace(
        trace_id=span_id_for("old") * 2,
        external_trace_id=None,
        session_id="session",
        user_id="user",
        parent=None,
        spans=spans,
    )


def test_two_native_model_calls_replace_synthetic_aggregate_generation() -> None:
    outer = trace_of(span("message", None, SpanKind.CHAIN), span("message:llm", "message", SpanKind.LLM))
    remapped = remap_outer_trace(
        outer, trace_id="1" * 32, capture_content=False, synthetic_span_ids=frozenset({span_id_for("message:llm")})
    )
    assert [item.span_id for item in remapped.spans] == [span_id_for("message")]
    assert remapped.trace_id == "1" * 32
    assert (remapped.session_id, remapped.user_id) == ("session", "user")
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
                parent_id=remapped.root.span_id,
            ),
            capture_content=False,
        )
        for identifier in ("2" * 16, "3" * 16)
    ]
    combined = order_spans(remapped.root.span_id, [calls[1], *remapped.spans, calls[0]])
    assert combined[0].span_id == remapped.root.span_id
    generations = [item for item in combined if item.kind is SpanKind.LLM]
    assert len(generations) == 2
    assert sum(item.usage.total_tokens for item in generations if item.usage is not None) == 10
    assert combined[0].usage is None
    assert "private" not in json.dumps([item.model_dump(mode="json") for item in combined])


def test_non_agent_workflow_retains_its_real_llm_node() -> None:
    trace = trace_of(span("workflow", None, SpanKind.CHAIN), span("llm-node", "workflow", SpanKind.LLM))
    remapped = remap_outer_trace(trace, trace_id="1" * 32, capture_content=True, synthetic_span_ids=frozenset())
    assert len(remapped.spans) == 2
    llm = remapped.spans[1]
    assert llm.kind is SpanKind.LLM
    assert llm.usage == TokenUsage(prompt_tokens=6, completion_tokens=4, total_tokens=10)
    assert llm.cost == Cost(amount=0.03, currency="USD")
    assert llm.inputs == {"content": "private"}
    assert llm.attributes["prompt"] == "private"


def test_content_off_outer_trace_keeps_only_identifiers_and_masks_errors() -> None:
    failed = span("workflow", None, SpanKind.CHAIN).model_copy(
        update={"status": SpanStatus.ERROR, "error": "private failure"}
    )
    remapped = remap_outer_trace(
        trace_of(failed), trace_id="1" * 32, capture_content=False, synthetic_span_ids=frozenset()
    )
    root = remapped.root
    assert root.error == "Application execution failed"
    assert root.status is SpanStatus.ERROR
    assert (root.inputs, root.outputs) == (None, None)
    assert root.attributes == {"node_type": "chain"}


def test_order_spans_rejects_orphans_cycles_and_conflicting_ids() -> None:
    root = span("root", None, SpanKind.CHAIN)
    with pytest.raises(ValueError, match="parent is missing"):
        order_spans(root.span_id, [root, span("orphan", "missing", SpanKind.TOOL)])
    with pytest.raises(ValueError, match="parent cycle"):
        order_spans(root.span_id, [root, span("one", "two", SpanKind.TOOL), span("two", "one", SpanKind.TOOL)])
    with pytest.raises(ValueError, match="Conflicting"):
        order_spans(root.span_id, [root, root.model_copy(update={"name": "other"})])
    with pytest.raises(ValueError, match="root is missing"):
        order_spans(root.span_id, [span("one", "root", SpanKind.TOOL)])
    with pytest.raises(ValueError, match="Unexpected trace root"):
        order_spans(root.span_id, [root, span("second-root", None, SpanKind.CHAIN)])


def test_managed_external_parent_is_preserved_as_explicit_link_when_content_off() -> None:
    root = span("workflow", None, SpanKind.CHAIN).model_copy(
        update={
            "attributes": {
                "parent_workflow_run_id": "outer-workflow",
                "parent_node_execution_id": "outer-tool",
                "prompt": "private",
            }
        }
    )
    outer = Trace(
        trace_id="2" * 32,
        external_trace_id="caller-trace",
        session_id="session",
        user_id=None,
        parent=None,
        spans=(root,),
    )
    remapped = remap_outer_trace(outer, trace_id="1" * 32, capture_content=False, synthetic_span_ids=frozenset())
    assert remapped.parent is None
    assert remapped.external_trace_id is None
    assert remapped.root.attributes == {
        "parent_workflow_run_id": "outer-workflow",
        "parent_node_execution_id": "outer-tool",
        "external_trace_id": "caller-trace",
    }
