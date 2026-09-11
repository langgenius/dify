import json
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import UUID, uuid4

import pytest
from dify_trace_langfuse.langfuse_trace import LangfuseTraceClient

from core.ops.otlp_trace import OtlpTraceClient
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


def export_request(trace: CompletedTrace, monkeypatch: pytest.MonkeyPatch, parent: dict | None = None):
    send = Mock()
    monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
    client = LangfuseTraceClient({"public_key": "public", "secret_key": "secret", "host": "https://langfuse.example"})
    receipts = client.export_trace(trace, parent)
    return receipts, send.call_args.args[0].resource_spans[0].scope_spans[0].spans


def test_langfuse_v4_keeps_native_ttft_tags_version_prompt_and_model(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    original = trace.model_dump_json()
    _, spans = export_request(trace, monkeypatch)
    generation = next(span for span in spans if span.name == "Model")
    attributes = {item.key: item.value for item in generation.attributes}
    assert attributes["langfuse.observation.model.name"].string_value == "gpt-4o"
    assert json.loads(attributes["langfuse.observation.model.parameters"].string_value) == {"temperature": 0.2}
    assert json.loads(attributes["langfuse.observation.input"].string_value) == [
        {"role": "user", "content": "Rendered prompt"},
    ]
    assert json.loads(attributes["langfuse.observation.usage_details"].string_value) == {
        "input": 3,
        "output": 5,
        "total": 8,
    }
    completion_start = json.loads(attributes["langfuse.observation.completion_start_time"].string_value)
    assert trace.spans[-1].started_at is not None
    assert datetime.fromisoformat(completion_start) == trace.spans[-1].started_at + timedelta(seconds=0.25)
    assert attributes["langfuse.version"].string_value == "2026-09-09"
    assert [tag.string_value for tag in attributes["langfuse.trace.tags"].array_value.values] == ["message", "workflow"]
    assert attributes["user.id"].string_value == "customer-7"
    assert attributes["session.id"].string_value == "session-5"
    assert trace.model_dump_json() == original


@pytest.mark.parametrize(("status", "workflow_failed"), [("handled_error", False), ("cancelled", True)])
def test_langfuse_keeps_handled_node_and_cancelled_workflow_error_filtering(
    status: str,
    workflow_failed: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    trace = make_trace()
    trace = trace.model_copy(
        update={
            "spans": tuple(
                span.model_copy(update={"status": status, "error": "model timed out"}) for span in trace.spans
            )
        }
    )
    _, spans = export_request(trace, monkeypatch)
    for span in spans:
        attributes = {item.key: item.value.string_value for item in span.attributes}
        failed = span.name == "Model" or workflow_failed
        assert span.status.code == (2 if failed else 0)
        assert attributes["langfuse.observation.level"] == ("ERROR" if failed else "DEFAULT")
        assert attributes["langfuse.observation.metadata.dify.span.status"] == status


def test_langfuse_native_external_trace_id_and_late_parent(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    external_id = str(uuid4())
    trace = trace.model_copy(update={"source": trace.source.model_copy(update={"external_trace_id": external_id})})
    receipts, spans = export_request(trace, monkeypatch)
    receipt = receipts.spans[trace.root_span_id]
    assert receipt["trace_id"] == UUID(external_id).hex
    assert all(span.trace_id == UUID(external_id).bytes for span in spans)
    child = make_trace()
    child_receipts, child_spans = export_request(child, monkeypatch, receipt)
    root = next(span for span in child_spans if span.name == "Workflow")
    assert root.parent_span_id.hex() == receipt["span_id"]
    assert child_receipts.spans[child.root_span_id]["trace_id"] == receipt["trace_id"]
    assert child_receipts.spans[child.root_span_id]["tags"] == receipt["tags"]


def test_langfuse_untimed_child_has_marked_zero_duration_without_fake_ttft(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    child = trace.spans[-1].model_copy(update={"started_at": None, "ended_at": None})
    trace = trace.model_copy(update={"spans": (trace.spans[0], child)})
    _, spans = export_request(trace, monkeypatch)
    root = next(span for span in spans if span.name == "Workflow")
    generation = next(span for span in spans if span.name == "Model")
    assert generation.start_time_unix_nano == generation.end_time_unix_nano == root.start_time_unix_nano
    attributes = {item.key: item.value for item in generation.attributes}
    assert "langfuse.observation.metadata.dify.timing.estimated" in attributes
    assert "langfuse.observation.completion_start_time" not in attributes


def test_langfuse_preflight_rejects_invalid_times_before_export(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    child = trace.spans[-1].model_copy(update={"ended_at": trace.spans[0].started_at})
    trace = trace.model_copy(update={"spans": (trace.spans[0], child)})
    send = Mock()
    monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
    client = LangfuseTraceClient({"public_key": "public", "secret_key": "secret"})
    with pytest.raises(TraceExportError, match="time_invalid"):
        client.export_trace(trace)
    send.assert_not_called()


def test_langfuse_basic_chat_tags_use_captured_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    root = trace.spans[0].model_copy(
        update={
            "span_type": "operation",
            "attributes": {"operation_type": "message", "app_mode": "chat"},
        }
    )
    trace = trace.model_copy(update={"spans": (root, trace.spans[-1])})
    receipts, spans = export_request(trace, monkeypatch)
    assert receipts.spans[trace.root_span_id]["tags"] == ["message", "chat"]
    for span in spans:
        tags = next(item.value for item in span.attributes if item.key == "langfuse.trace.tags")
        assert [tag.string_value for tag in tags.array_value.values] == ["message", "chat"]
