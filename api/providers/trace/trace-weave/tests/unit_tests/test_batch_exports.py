import json
from collections.abc import Callable
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_weave import weave_trace
from dify_trace_weave.weave_trace import WeaveTraceClient

from core.ops.provider_export import TraceExportError, basic_auth, export_span_id
from core.ops.trace_data import CompletedTrace, make_span_id
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


def make_trace(span_count: int, text: str = "hello") -> CompletedTrace:
    trace = make_completed_trace()
    root = trace.spans[0]
    return trace.model_copy(
        update={
            "spans": (
                root,
                *(
                    root.model_copy(
                        update={
                            "span_id": make_span_id(trace.source.tenant_id, trace.source.operation_id, str(index)),
                            "parent_span_id": root.span_id,
                            "span_name": f"Iteration {index}",
                            "span_type": "node",
                            "inputs": {"text": text},
                        }
                    )
                    for index in range(1, span_count)
                ),
            )
        }
    )


def make_client(
    monkeypatch: pytest.MonkeyPatch, respond: Callable[[httpx.Request], httpx.Response]
) -> WeaveTraceClient:
    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    client = WeaveTraceClient({"api_key": "saved-key", "entity": "team", "project": "project"})
    monkeypatch.setattr(
        client.account_http,
        "request",
        Mock(return_value=httpx.Response(200, json={"data": {"project": {"name": "project"}}})),
    )
    return client


def read_calls(requests: list[httpx.Request], legacy: bool) -> list[dict]:
    items = [item for request in requests for item in json.loads(request.content)["batch"]]
    if not legacy:
        return items
    calls = {}
    for event in items:
        call = event["req"][event["mode"]]
        calls.setdefault(call["id"], {}).update(call)
    return list(calls.values())


@pytest.mark.parametrize("legacy", [False, True])
def test_large_trace_completes_with_cloud_latency_and_repeatable_parent_ids(
    monkeypatch: pytest.MonkeyPatch, legacy: bool
) -> None:
    clock = 0.0
    requests: list[httpx.Request] = []
    accepted: list[httpx.Request] = []
    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: clock)

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal clock
        clock += 0.25
        requests.append(request)
        if legacy and request.url.path.endswith("/calls/complete"):
            return httpx.Response(404)
        accepted.append(request)
        return httpx.Response(200)

    trace = make_trace(401)
    original = trace.model_dump_json()
    attempts = []
    for _ in range(2):
        clock = 0.0
        requests.clear()
        accepted.clear()
        client = make_client(monkeypatch, respond)
        receipt = client.export_trace(trace)
        assert clock < 100
        assert len(requests) == (10 if legacy else 1)
        calls = read_calls(accepted, legacy)
        assert len(calls) == len(trace.spans)
        for span, call in zip(trace.spans, calls, strict=True):
            assert call["id"] == receipt.spans[span.span_id]["span_id"] == export_span_id(trace, span.span_id)
            assert call["parent_id"] == (calls[0]["id"] if span.parent_span_id else None)
            assert call["attributes"]["dify.tenant_id"] == trace.source.tenant_id
        assert all(request.headers["Authorization"] == basic_auth("api", "saved-key") for request in requests)
        attempts.append([request.content for request in requests])
    assert attempts[0] == attempts[1]
    assert trace.model_dump_json() == original


@pytest.mark.parametrize("legacy", [False, True])
@pytest.mark.parametrize("byte_limited", [False, True])
def test_batches_bound_counts_and_serialized_utf8_bytes(
    monkeypatch: pytest.MonkeyPatch, legacy: bool, byte_limited: bool
) -> None:
    accepted: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        if legacy and request.url.path.endswith("/calls/complete"):
            return httpx.Response(404)
        accepted.append(request)
        return httpx.Response(200)

    if byte_limited:
        monkeypatch.setattr(weave_trace, "MAX_BATCH_BYTES", 25_000)
    trace = make_trace(20 if byte_limited else 1001, text="你" * 1000 if byte_limited else "hello")
    make_client(monkeypatch, respond).export_trace(trace)
    assert len(accepted) > 1
    assert len(read_calls(accepted, legacy)) == len(trace.spans)
    for request in accepted:
        assert len(request.content) <= weave_trace.MAX_BATCH_BYTES
        assert len(json.loads(request.content)["batch"]) <= (100 if legacy else 1000)


@pytest.mark.parametrize("legacy", [False, True])
def test_413_splits_unsent_batches_in_order(monkeypatch: pytest.MonkeyPatch, legacy: bool) -> None:
    accepted: list[httpx.Request] = []
    rejected: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        if legacy and request.url.path.endswith("/calls/complete"):
            return httpx.Response(404)
        if len(json.loads(request.content)["batch"]) > 2:
            rejected.append(request)
            return httpx.Response(413)
        accepted.append(request)
        return httpx.Response(200)

    trace = make_trace(5)
    make_client(monkeypatch, respond).export_trace(trace)
    assert rejected
    calls = read_calls(accepted, legacy)
    assert [call["id"] for call in calls] == [export_span_id(trace, span.span_id) for span in trace.spans]


def test_404_after_accepted_batch_only_converts_remaining_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(weave_trace, "MAX_COMPLETE_CALLS", 2)
    accepted: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        if accepted and request.url.path.endswith("/calls/complete"):
            return httpx.Response(404)
        accepted.append(request)
        return httpx.Response(200)

    trace = make_trace(5)
    make_client(monkeypatch, respond).export_trace(trace)
    calls = read_calls(accepted[:1], False) + read_calls(accepted[1:], True)
    assert [call["id"] for call in calls] == [export_span_id(trace, span.span_id) for span in trace.spans]


@pytest.mark.parametrize("status", [200, 413])
def test_single_oversized_call_is_attempted_without_splitting(monkeypatch: pytest.MonkeyPatch, status: int) -> None:
    monkeypatch.setattr(weave_trace, "MAX_BATCH_BYTES", 1)
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status)

    client = make_client(monkeypatch, respond)
    if status == 200:
        client.export_trace(make_trace(1))
    else:
        with pytest.raises(TraceExportError, match="provider_http_413") as error:
            client.export_trace(make_trace(1))
        assert not error.value.retryable
    assert len(requests) == 1
