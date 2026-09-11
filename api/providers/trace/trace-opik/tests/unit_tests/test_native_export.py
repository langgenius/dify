from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import UUID, uuid4

import httpx
import pytest
from dify_trace_opik.opik_trace import OpikTraceClient

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


def make_client_with_transport(monkeypatch: pytest.MonkeyPatch) -> tuple[OpikTraceClient, Mock]:
    client = OpikTraceClient({"api_key": "secret", "workspace": "workspace", "project": "project"})
    request = Mock(return_value=httpx.Response(200, json={}))
    monkeypatch.setattr(client.http, "request", request)
    return client, request


def test_opik_uses_repeatable_uuid7_ids_and_native_cost(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    root = trace.spans[0].model_copy(update={"usage": {"total_tokens": 8, "total_price": "0.02"}})
    trace = trace.model_copy(update={"spans": (root, trace.spans[-1])})
    client, request = make_client_with_transport(monkeypatch)
    first = client.export_trace(trace)
    first_bodies = [call.kwargs["json"] for call in request.call_args_list]
    request.reset_mock()
    assert client.export_trace(trace) == first
    assert [call.kwargs["json"] for call in request.call_args_list] == first_bodies
    root, root_span, generation = first_bodies
    assert UUID(root["id"]).version == 7
    assert UUID(root_span["id"]).version == UUID(generation["id"]).version == 7
    assert generation["parent_span_id"] == root_span["id"]
    assert generation["trace_id"] == root["id"]
    assert first.spans[trace.root_span_id] == {"trace_id": root["id"], "span_id": root_span["id"]}
    assert generation["total_estimated_cost"] == 0.02
    assert "total_estimated_cost" not in root_span
    assert root_span["usage"] == {}
    assert root_span["metadata"]["dify.usage"] == {"total_tokens": 8, "total_price": "0.02"}
    assert "total_cost" not in generation
    assert isinstance(generation["input"], dict)
    assert generation["usage"] == {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8}
    assert trace.spans[-1].started_at is not None
    assert int.from_bytes(UUID(generation["id"]).bytes[:6]) == int(trace.spans[-1].started_at.timestamp() * 1000)


@pytest.mark.parametrize(
    "external_id", ["12345678-1234-4234-8234-123456789abc", "0192fa28-5c00-7234-8234-123456789abc"]
)
def test_opik_external_uuid_and_late_parent_remain_coherent(external_id: str, monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    trace = trace.model_copy(update={"source": trace.source.model_copy(update={"external_trace_id": external_id})})
    client, request = make_client_with_transport(monkeypatch)
    receipt = client.export_trace(trace).spans[trace.root_span_id]
    encoded = bytearray(UUID(external_id).bytes)
    if UUID(external_id).version != 7:
        assert trace.spans[0].started_at is not None
        encoded[:6] = int(trace.spans[0].started_at.timestamp() * 1000).to_bytes(6, "big")
        encoded[6] = encoded[6] & 15 | 0x70
    assert receipt["trace_id"] == str(UUID(bytes=bytes(encoded)))
    request.reset_mock()
    child = make_trace()
    child_receipts = client.export_trace(child, receipt)
    assert all(call.args[1] == "v1/private/spans" for call in request.call_args_list)
    assert request.call_args_list[0].kwargs["json"]["parent_span_id"] == receipt["span_id"]
    assert child_receipts.spans[child.root_span_id]["trace_id"] == receipt["trace_id"]


def test_opik_preserves_untimed_details_without_export_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    child = trace.spans[-1].model_copy(update={"started_at": None, "ended_at": None})
    trace = trace.model_copy(update={"spans": (trace.spans[0], child)})
    client, request = make_client_with_transport(monkeypatch)
    client.export_trace(trace)
    exported = request.call_args.kwargs["json"]
    assert trace.spans[0].started_at is not None
    assert exported["start_time"] == exported["end_time"] == trace.spans[0].started_at.isoformat()
    assert exported["metadata"]["dify.timing.estimated"] is True
    assert child.started_at is None
    assert exported["output"] == child.outputs


def test_opik_invalid_late_span_fails_before_any_write(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    child = trace.spans[-1].model_copy(update={"ended_at": trace.spans[0].started_at})
    trace = trace.model_copy(update={"spans": (trace.spans[0], child)})
    client, request = make_client_with_transport(monkeypatch)
    with pytest.raises(TraceExportError, match="time_invalid"):
        client.export_trace(trace)
    request.assert_not_called()
