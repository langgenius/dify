"""Real HTTP serialization preserves native batch limits and retry identities."""

import json
from typing import Any

import httpx
import pytest
from dify_trace_langsmith.langsmith_trace import LangSmithTraceClient

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import TraceExportError
from core.ops.trace_data import CompletedTrace, make_span_id
from core.ops.trace_export_state import TraceExportState
from tests.unit_tests.core.ops.test_provider_export import settings_for
from tests.unit_tests.core.ops.test_trace_export_state import make_export_state

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]
from .test_native_export import make_trace  # pyrefly: ignore[missing-import]


def make_many_span_trace(span_count: int = 401) -> CompletedTrace:
    trace = make_trace()
    root = trace.spans[0]
    children = tuple(
        root.model_copy(
            update={
                "span_id": make_span_id(trace.source.tenant_id, trace.source.operation_id, str(index)),
                "parent_span_id": root.span_id,
                "span_name": f"Tool {index}",
                "span_type": "tool",
            }
        )
        for index in range(1, span_count)
    )
    return trace.model_copy(update={"spans": (root, *children)})


@pytest.mark.parametrize("mode", ["langsmith", "hybrid"])
def test_many_spans_finish_within_deadline_with_stable_ids_and_parents(
    mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", mode)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example/traces")
    clock = [0.0]
    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: clock[0])
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        clock[0] += 0.25
        return httpx.Response(200, content=b"")

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    trace = make_many_span_trace()
    original = trace.model_dump_json()
    config = resolve_provider_config("langsmith", make_provider_config())
    receipt = LangSmithTraceClient(config).export_trace(trace)
    native = [request for request in requests if request.url.host == "langsmith.example"]
    batches = [json.loads(request.content)["post"] for request in native]
    assert [len(batch) for batch in batches] == [100, 100, 100, 100, 1]
    assert len(requests) == (6 if mode == "hybrid" else 5)
    assert clock[0] <= 1.5
    assert all(request.url.path == "/runs/batch" for request in native)
    runs = [run for batch in batches for run in batch]
    assert [run["id"] for run in runs] == [receipt.spans[span.span_id]["span_id"] for span in trace.spans]
    assert runs[0]["parent_run_id"] is None
    for run in runs[1:]:
        assert run["trace_id"] == run["parent_run_id"] == runs[0]["id"]
        assert run["dotted_order"].startswith(runs[0]["dotted_order"] + ".")
    first_requests = [request.content for request in requests]
    requests.clear()
    assert LangSmithTraceClient(config).export_trace(trace) == receipt
    assert [request.content for request in requests] == first_requests
    assert trace.model_dump_json() == original


def test_batch_byte_limit_counts_utf8_and_json_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(202)

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    runs: list[dict[str, Any]] = [{"id": str(index), "inputs": {"text": "é" * (512 * 1024)}} for index in range(21)]
    LangSmithTraceClient(make_provider_config())._send_runs(runs)
    assert [len(json.loads(request.content)["post"]) for request in requests] == [19, 2]
    assert all(len(request.content) <= 20 * 1024 * 1024 for request in requests)
    assert [run for request in requests for run in json.loads(request.content)["post"]] == runs


@pytest.mark.parametrize("failed_route", ["native", "otel"])
def test_hybrid_batch_failure_retries_stable_ids_and_only_marks_complete_routes(
    failed_route: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING_MODE", "hybrid")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example/traces")
    trace = make_many_span_trace()
    state = make_export_state(trace, settings_for(trace, "langsmith"))
    requests: list[httpx.Request] = []
    failure_index = 2 if failed_route == "native" else 6

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(503 if len(requests) == failure_index else 200, content=b"")

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    config = resolve_provider_config("langsmith", make_provider_config())
    client = LangSmithTraceClient(config)
    client.export_state = state
    with pytest.raises(TraceExportError, match="provider_http_503"):
        client.export_trace(trace)
    assert len(requests) == failure_index
    assert state.has_completed_signal("langsmith_native") is (failed_route == "otel")
    assert not state.has_completed_signal("langsmith_otel")
    retry = LangSmithTraceClient(config)
    retry.export_state = TraceExportState(state.repository, state.delivery)
    assert len(retry.export_trace(trace).spans) == len(trace.spans)
    if failed_route == "native":
        assert [request.content for request in requests[:2]] == [request.content for request in requests[2:4]]
        assert len(requests) == 8
    else:
        assert [request.url.host for request in requests[6:]] == ["collector.example"]
        assert requests[-1].content == requests[-2].content
    assert retry.export_state.has_completed_signal("langsmith_native")
    assert retry.export_state.has_completed_signal("langsmith_otel")


def test_smaller_receiver_body_limit_splits_batches_in_parent_order(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[httpx.Request] = []
    accepted: list[dict[str, Any]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        runs = json.loads(request.content)["post"]
        if len(runs) > 2:
            return httpx.Response(413)
        accepted.extend(runs)
        return httpx.Response(202)

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    trace = make_many_span_trace(5)
    receipt = LangSmithTraceClient(make_provider_config()).export_trace(trace)
    assert [len(json.loads(request.content)["post"]) for request in requests] == [5, 2, 3, 1, 2]
    assert [run["id"] for run in accepted] == [receipt.spans[span.span_id]["span_id"] for span in trace.spans]


def test_single_run_rejection_propagates_without_retry_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(413)

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(transport=httpx.MockTransport(respond), trust_env=False),
    )
    with pytest.raises(TraceExportError, match="provider_http_413"):
        LangSmithTraceClient(make_provider_config()).export_trace(make_many_span_trace(1))
    assert len(requests) == 1
