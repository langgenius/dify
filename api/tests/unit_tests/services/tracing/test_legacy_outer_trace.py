from datetime import UTC, datetime

import pytest
from dify_trace_sdk.ids import span_id_for
from dify_trace_sdk.model import SpanKind
from pydantic import ValidationError

from services.tracing.normalization import legacy_outer_trace

TRACE_ID = "0af7651916cd43dd8448eb211c80319c"


def _legacy(**span_overrides: object) -> dict[str, object]:
    root, llm = span_id_for("message-1"), span_id_for("message-1:llm")
    return {
        "trace_id": TRACE_ID,
        "session_id": "conversation-1",
        "root_span_id": root,
        "spans": [
            {
                "id": root,
                "parent_id": None,
                "name": "message",
                "kind": "chain",
                "start_time": "2026-01-01T08:00:00",
                "end_time": "2026-01-01T08:00:02",
                "inputs": {"query": "hi"},
                "outputs": "hello",
                "status": "ok",
                "error": None,
                "metadata": {"aggregate_total_tokens": 20},
                "synthetic": False,
                "can_parent_workflow": False,
                "publishes_parent_context": False,
                "links": [],
            },
            {
                "id": llm,
                "parent_id": root,
                "name": "llm",
                "kind": "llm",
                "start_time": "2026-01-01T08:00:00",
                "end_time": None,
                "inputs": None,
                "outputs": None,
                "status": "ok",
                "error": None,
                "metadata": {
                    "model_name": "gpt-4o",
                    "model_provider": "openai",
                    "prompt_tokens": 12,
                    "completion_tokens": 8,
                    "total_tokens": 20,
                    "total_price": "0.0042",
                    "currency": "USD",
                },
                "synthetic": False,
                "can_parent_workflow": False,
                "publishes_parent_context": False,
                "links": [],
                **span_overrides,
            },
        ],
        "external_parent": None,
        "required_parent_context_id": None,
    }


def test_outer_traces_stored_by_the_previous_release_still_export() -> None:
    trace = legacy_outer_trace(_legacy())

    assert (trace.trace_id, trace.session_id, trace.parent) == (TRACE_ID, "conversation-1", None)
    root, llm = trace.spans
    assert root.attributes == {"aggregate_total_tokens": 20}
    assert llm.kind is SpanKind.LLM
    assert (llm.model_name, llm.model_provider) == ("gpt-4o", "openai")
    assert llm.usage is not None
    assert (llm.usage.prompt_tokens, llm.usage.total_tokens) == (12, 20)
    assert llm.cost is not None
    assert (llm.cost.amount, llm.cost.currency) == (0.0042, "USD")
    assert llm.end_time == datetime(2026, 1, 1, 8, 0, tzinfo=UTC)


def test_malformed_legacy_traces_still_fail_validation() -> None:
    with pytest.raises(ValidationError, match="must follow its parent"):
        legacy_outer_trace(_legacy(parent_id="0000000000000abc"))
