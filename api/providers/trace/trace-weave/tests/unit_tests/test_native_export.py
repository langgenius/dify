from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
from dify_trace_weave.weave_trace import WeaveTraceClient

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


def make_client_with_transport(monkeypatch: pytest.MonkeyPatch) -> tuple[WeaveTraceClient, Mock]:
    client = WeaveTraceClient({"api_key": "secret", "entity": "entity", "project": "project"})
    request = Mock(return_value=httpx.Response(200, json={}))
    monkeypatch.setattr(client.http, "request", request)
    return client, request


@pytest.mark.parametrize("missing", [{"started_at": None, "ended_at": None}, {"ended_at": None}])
def test_weave_preserves_untimed_children_and_status_counts(missing: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    child = trace.spans[-1].model_copy(update={**missing, "status": "error", "error": "attempt failed"})
    trace = trace.model_copy(update={"spans": (trace.spans[0], child)})
    client, request = make_client_with_transport(monkeypatch)
    receipt = client.export_trace(trace)
    start = request.call_args_list[-2].kwargs["json"]["start"]
    end = request.call_args_list[-1].kwargs["json"]["end"]
    anchor = child.started_at or trace.spans[0].started_at
    assert anchor is not None
    assert start["started_at"] == end["ended_at"] == anchor.isoformat()
    assert start["attributes"]["dify.timing.estimated"] is True
    assert end["output"] == child.outputs
    assert end["exception"] == "attempt failed"
    assert end["summary"]["status_counts"] == {"success": 0, "error": 1}
    assert end["summary"]["usage"]["gpt-4o"]["total_tokens"] == 8
    assert start["parent_id"] == receipt.spans[trace.root_span_id]["span_id"]


def test_weave_preflight_happens_before_project_discovery(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    child = trace.spans[-1].model_copy(update={"ended_at": trace.spans[0].started_at})
    trace = trace.model_copy(update={"spans": (trace.spans[0], child)})
    client, request = make_client_with_transport(monkeypatch)
    discover = Mock()
    monkeypatch.setattr(client, "_project_id", discover)
    with pytest.raises(TraceExportError, match="time_invalid"):
        client.export_trace(trace)
    request.assert_not_called()
    discover.assert_not_called()


def test_weave_external_correlation_and_parent_take_precedence(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    trace = trace.model_copy(
        update={"source": trace.source.model_copy(update={"external_trace_id": "external-request"})}
    )
    client, request = make_client_with_transport(monkeypatch)
    receipt = client.export_trace(trace).spans[trace.root_span_id]
    assert receipt["trace_id"] == "external-request"
    assert request.call_args_list[0].kwargs["json"]["start"]["trace_id"] == "external-request"
    request.reset_mock()
    child = make_trace()
    assert client.export_trace(child, receipt).spans[child.root_span_id]["trace_id"] == receipt["trace_id"]


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
def test_weave_preserves_cancelled_workflow_reason_without_inventing_errors(
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

    end = request.call_args.kwargs["json"]["end"]
    assert end["exception"] == expected_error
    assert end["summary"]["status_counts"] == {"error": int(bool(expected_error)), "success": int(not expected_error)}
