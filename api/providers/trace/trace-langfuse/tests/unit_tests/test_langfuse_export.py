"""Protocol fixtures for complete trees, fixed destinations and synchronous acceptance."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Unpack
from unittest.mock import Mock
from uuid import UUID, uuid4

import httpx
import pytest
from opentelemetry import trace as otel_trace
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)

from core.ops.provider_export import (
    TraceExportError,
    basic_auth,
    create_provider_client,
    export_span_id,
    export_trace,
    span_id_bytes,
    timestamp_ns,
)
from core.ops.trace_data import (
    CompletedTrace,
    make_span_id,
    make_trace_id,
)
from tests.unit_tests.core.ops.test_provider_export import (
    RequestArguments,
    make_completed_trace,
    provider_config,
    settings_for,
)


@pytest.mark.parametrize("session_id", ["explicit-session", None, "session-" + "x" * 504])
def test_langfuse_exports_observation_attributes_and_attaches_late_children(
    session_id: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    request = Mock(return_value=httpx.Response(200, content=b""))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    monkeypatch.setenv("LANGFUSE_RELEASE", "ambient-release")
    monkeypatch.setenv("LANGFUSE_TRACING_ENVIRONMENT", "ambient-environment")
    trace = make_completed_trace()
    conversation_id = str(uuid4())
    actor_id = "actor-" + "x" * 250
    trace_name = "Workflow " + "x" * 210
    trace = trace.model_copy(
        update={
            "source": trace.source.model_copy(
                update={"actor_id": actor_id, "session_id": session_id, "conversation_id": conversation_id}
            ),
            "spans": tuple(
                span.model_copy(
                    update={
                        "source_workflow_version": "2026-09-09",
                        **(
                            {
                                "span_name": trace_name,
                                "attributes": {"evaluation_dimension": "canary", "external_number": 2**64},
                            }
                            if span.span_id == trace.root_span_id
                            else {}
                        ),
                    }
                )
                for span in trace.spans
            ),
        }
    )
    settings = settings_for(trace, "langfuse")
    environment, tracer_provider = dict(os.environ), otel_trace.get_tracer_provider()
    with otel_trace.use_span(
        otel_trace.NonRecordingSpan(otel_trace.SpanContext(trace_id=1, span_id=2, is_remote=False))
    ):
        receipts = export_trace(trace, settings, provider_config("langfuse"))
        assert otel_trace.get_current_span().get_span_context().trace_id == 1
    assert request.call_count == 1
    assert request.call_args.args == ("POST", "https://langfuse.example/api/public/otel/v1/traces")
    sent = request.call_args.kwargs
    assert sent["headers"]["Authorization"] == basic_auth("public", "tenant-secret")
    assert sent["headers"]["x-langfuse-ingestion-version"] == "4"
    assert sent["headers"]["Content-Type"] == "application/x-protobuf"
    spans = ExportTraceServiceRequest.FromString(sent["content"]).resource_spans[0].scope_spans[0].spans
    assert not spans[0].parent_span_id
    for original, span in zip(trace.spans, spans, strict=True):
        attributes = {item.key: item.value.string_value for item in span.attributes}
        assert span.trace_id == UUID(trace.trace_id).bytes
        assert span.span_id == span_id_bytes(export_span_id(trace, original.span_id))
        assert span.start_time_unix_nano == timestamp_ns(original.started_at)
        assert span.end_time_unix_nano == timestamp_ns(original.ended_at)
        assert attributes["langfuse.trace.name"] == trace_name
        assert attributes["langfuse.version"] == "2026-09-09"
        assert attributes["user.id"] == actor_id
        assert attributes["session.id"] == (session_id or conversation_id)
        assert attributes["langfuse.observation.metadata.dify.tenant_id"] == trace.source.tenant_id
        assert attributes["langfuse.observation.metadata.dify.workflow.version"] == "2026-09-09"
        assert attributes["langfuse.observation.metadata.evaluation_dimension"] == "canary"
        assert attributes["langfuse.observation.metadata.external_number"] == str(2**64)
        assert json.loads(attributes["langfuse.observation.input"]) == original.inputs
        assert attributes["langfuse.observation.output"] == (
            original.outputs if isinstance(original.outputs, str) else json.dumps(original.outputs)
        )
        assert (
            not {
                "langfuse.trace.input",
                "langfuse.trace.output",
                "langfuse.trace.public",
                "langfuse.release",
                "langfuse.environment",
            }
            & attributes.keys()
        )
        is_app_root = next(
            (item.value.bool_value for item in span.attributes if item.key == "langfuse.internal.is_app_root"), False
        )
        assert is_app_root is (original.span_id == trace.root_span_id)
        if original.span_type == "llm":
            assert attributes["langfuse.observation.type"] == "generation"
            assert attributes["langfuse.observation.model.name"] == "model"
            assert json.loads(attributes["langfuse.observation.usage_details"]) == {"input": 3, "output": 5, "total": 8}
            assert json.loads(attributes["langfuse.observation.cost_details"]) == {"total": 0.02}
        else:
            assert "langfuse.observation.cost_details" not in attributes
        assert receipts.spans[original.span_id]["trace_id"] == span.trace_id.hex()
        assert receipts.spans[original.span_id]["span_id"] == span.span_id.hex()

    parent = receipts.spans[trace.root_span_id]
    assert parent["trace_name"] == trace_name
    assert parent["version"] == "2026-09-09"
    late_operation_id = str(uuid4())
    late_root = trace.spans[0].model_copy(
        update={"span_id": make_span_id(trace.source.tenant_id, late_operation_id, "late"), "span_name": "Late tool"}
    )
    late = CompletedTrace(
        source=trace.source.model_copy(update={"operation_id": late_operation_id}),
        trace_id=make_trace_id(trace.source.tenant_id, late_operation_id),
        root_span_id=late_root.span_id,
        spans=(late_root,),
    )
    export_trace(late, settings, provider_config("langfuse"), parent)
    late_spans = (
        ExportTraceServiceRequest.FromString(request.call_args.kwargs["content"]).resource_spans[0].scope_spans[0].spans
    )
    assert len(late_spans) == 1
    assert late_spans[0].trace_id.hex() == parent["trace_id"]
    assert late_spans[0].parent_span_id.hex() == parent["span_id"]
    late_attributes = {item.key: item.value for item in late_spans[0].attributes}
    assert late_attributes["langfuse.trace.name"].string_value == trace_name
    assert late_attributes["langfuse.version"].string_value == "2026-09-09"
    assert not late_attributes["langfuse.internal.is_app_root"].bool_value
    legacy_parent = {**parent, "trace_id": str(uuid4()), "span_id": str(uuid4())}
    with pytest.raises(TraceExportError, match="langfuse_legacy_parent_receipt") as rejected:
        export_trace(late, settings, provider_config("langfuse"), legacy_parent)
    assert not rejected.value.retryable
    assert request.call_count == 2
    assert dict(os.environ) == environment
    assert otel_trace.get_tracer_provider() is tracer_provider


def test_langfuse_overlapping_exports_isolate_same_public_key_destinations(monkeypatch: pytest.MonkeyPatch) -> None:
    from threading import Barrier

    barrier = Barrier(2)
    requests: list[tuple[str, RequestArguments]] = []

    def request(_method: str, url: str, **kwargs: Unpack[RequestArguments]) -> httpx.Response:
        barrier.wait(timeout=5)
        requests.append((url, kwargs))
        return httpx.Response(200, content=b"")

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    traces = [make_completed_trace(), make_completed_trace()]
    configs = [
        {**provider_config("langfuse", f"secret-{index}"), "host": f"https://tenant-{index}.example"}
        for index in range(2)
    ]
    with ThreadPoolExecutor(2) as pool:
        jobs = [
            pool.submit(export_trace, trace, settings_for(trace, "langfuse"), config)
            for trace, config in zip(traces, configs, strict=True)
        ]
        assert all(len(job.result().spans) == 3 for job in jobs)
    assert len(requests) == 2
    for index, trace in enumerate(traces):
        url, sent = next(item for item in requests if item[0].startswith(configs[index]["host"]))
        assert url == f"{configs[index]['host']}/api/public/otel/v1/traces"
        assert sent["headers"]["Authorization"] == basic_auth("public", f"secret-{index}")
        spans = ExportTraceServiceRequest.FromString(sent["content"]).resource_spans[0].scope_spans[0].spans
        assert all(span.trace_id == UUID(trace.trace_id).bytes for span in spans)
        for span in spans:
            attributes = {item.key: item.value.string_value for item in span.attributes}
            assert attributes["langfuse.observation.metadata.dify.tenant_id"] == trace.source.tenant_id


@pytest.mark.parametrize(("status", "retryable"), [(401, False), (429, True), (503, True)])
def test_langfuse_http_errors_reach_delivery_retry_policy(
    status: int, retryable: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    request = Mock(return_value=httpx.Response(status, headers={"retry-after": "60"}))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    with pytest.raises(TraceExportError, match=f"provider_http_{status}") as failed:
        create_provider_client("langfuse", provider_config("langfuse")).export_trace(make_completed_trace())
    assert failed.value.retryable is retryable
    assert failed.value.retry_after == 60
    assert request.call_count == 1


def test_langfuse_partial_acceptance_is_not_a_successful_delivery(monkeypatch: pytest.MonkeyPatch) -> None:
    rejected = ExportTraceServiceResponse()
    rejected.partial_success.rejected_spans = 1
    rejected.partial_success.error_message = "sensitive observation rejected"
    request = Mock(return_value=httpx.Response(200, content=rejected.SerializeToString()))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    with pytest.raises(TraceExportError) as failed:
        create_provider_client("langfuse", provider_config("langfuse")).export_trace(make_completed_trace())
    assert not failed.value.retryable
    assert "sensitive" not in str(failed.value)
    assert request.call_count == 1


def test_langfuse_preserves_missing_timestamps_and_generation_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    request = Mock(return_value=httpx.Response(200, content=b""))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    trace = make_completed_trace()
    failed_model = trace.spans[-1].model_copy(
        update={"started_at": None, "ended_at": None, "status": "error", "error": "model failed"}
    )
    trace = trace.model_copy(update={"spans": (*trace.spans[:-1], failed_model)})
    create_provider_client("langfuse", provider_config("langfuse")).export_trace(trace)
    model = (
        ExportTraceServiceRequest.FromString(request.call_args.kwargs["content"])
        .resource_spans[0]
        .scope_spans[0]
        .spans[-1]
    )
    assert model.start_time_unix_nano == model.end_time_unix_nano == timestamp_ns(trace.spans[0].started_at)
    assert any(attribute.key == "langfuse.observation.metadata.dify.timing.estimated" for attribute in model.attributes)
    assert model.status.code == 2
    assert model.status.message == "model failed"
    attributes = {item.key: item.value.string_value for item in model.attributes}
    assert attributes["langfuse.observation.level"] == "ERROR"
    assert attributes["langfuse.observation.status_message"] == "model failed"


@pytest.mark.parametrize("fail_flush", [False, True])
def test_langfuse_drains_large_trees_and_shuts_down_sdk_resources(
    fail_flush: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    from dify_trace_langfuse import langfuse_trace

    shutdown = langfuse_trace.TracerProvider.shutdown
    shutdown_count = 0

    def shutdown_provider(provider: langfuse_trace.TracerProvider) -> None:
        nonlocal shutdown_count
        shutdown_count += 1
        shutdown(provider)

    monkeypatch.setattr(langfuse_trace.TracerProvider, "shutdown", shutdown_provider)
    if fail_flush:
        monkeypatch.setattr(langfuse_trace.TracerProvider, "force_flush", Mock(return_value=False))
    request = Mock(return_value=httpx.Response(200, content=b""))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)
    trace = make_completed_trace()
    trace = trace.model_copy(
        update={
            "spans": (
                trace.spans[0],
                *(
                    trace.spans[1].model_copy(
                        update={"span_id": make_span_id(trace.source.tenant_id, trace.source.operation_id, str(index))}
                    )
                    for index in range(2049)
                ),
            )
        }
    )
    if fail_flush:
        with pytest.raises(TraceExportError, match="langfuse_flush_failed"):
            create_provider_client("langfuse", provider_config("langfuse")).export_trace(trace)
        request.assert_not_called()
    else:
        receipts = create_provider_client("langfuse", provider_config("langfuse")).export_trace(trace)
        assert len(receipts.spans) == 2050
        assert request.call_count == 1
        spans = (
            ExportTraceServiceRequest.FromString(request.call_args.kwargs["content"])
            .resource_spans[0]
            .scope_spans[0]
            .spans
        )
        assert len(spans) == len({span.span_id for span in spans}) == 2050
        assert all(span.parent_span_id == spans[0].span_id for span in spans[1:])
    assert shutdown_count == 1
