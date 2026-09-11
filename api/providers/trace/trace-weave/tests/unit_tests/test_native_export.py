import json
import os
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
from dify_trace_weave.config import WeaveConfig
from dify_trace_weave.weave_trace import WeaveTraceClient

from core.ops.message_trace import MessageTraceRecorder
from core.ops.provider_export import TraceExportError, basic_auth
from core.ops.trace_data import CompletedTrace, TraceSource, TraceSpan, make_span_id, make_trace_id
from core.ops.workflow_trace import WorkflowTraceRecorder
from graphon.engine_events import GraphRunSucceededEvent, NodeRunSucceededEvent
from graphon.node_events import NodeRunResult
from tests.unit_tests.core.ops.test_workflow_trace_limits import start_node, workflow_node


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
    monkeypatch.setattr(
        client.account_http,
        "request",
        Mock(return_value=httpx.Response(200, json={"data": {"project": {"name": "project"}}})),
    )
    return client, request


@pytest.mark.parametrize("entity", [None, "entity"])
@pytest.mark.parametrize(
    ("host", "endpoint", "trace_endpoint"),
    [
        (None, None, "https://trace.wandb.ai"),
        ("", "https://trace.wandb.ai", "https://trace.wandb.ai"),
        ("https://api.wandb.ai/", "https://trace.wandb.ai/", "https://trace.wandb.ai"),
        ("https://wandb.example", None, "https://wandb.example/traces"),
        ("https://wandb.example/", "https://trace.wandb.ai", "https://wandb.example/traces"),
        ("http://wandb.example:8080/prefix/", "https://trace.wandb.ai/", "http://wandb.example:8080/prefix/traces"),
        ("https://api.wandb.ai/prefix/", None, "https://api.wandb.ai/prefix/traces"),
        ("https://wandb.example/prefix/", "https://ingest.example/weave/", "https://ingest.example/weave"),
        (None, "https://ingest.example/weave/", "https://ingest.example/weave"),
    ],
)
def test_weave_verification_and_export_use_saved_destination(
    monkeypatch: pytest.MonkeyPatch, entity: str | None, host: str | None, endpoint: str | None, trace_endpoint: str
) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200, json={"data": {"viewer": {"defaultEntity": {"name": "entity"}}, "project": {"name": "project"}}}
        )

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    config: dict[str, Any] = {"api_key": "saved-key", "entity": entity, "project": "project", "host": host}
    if endpoint is not None:
        config["endpoint"] = endpoint
    config["_runtime_settings"] = WeaveConfig.load_runtime_settings(config)
    for name in ("WANDB_BASE_URL", "WANDB_PUBLIC_BASE_URL", "WF_TRACE_SERVER_URL"):
        monkeypatch.setenv(name, "https://unrelated.example")
    monkeypatch.setenv("WANDB_API_KEY", "unrelated-key")
    environment = dict(os.environ)
    client = WeaveTraceClient(config)

    assert client.verify_credentials() is True
    trace = make_trace()
    client.export_trace(trace)

    discovery = [f"{(host or 'https://api.wandb.ai').rstrip('/')}/graphql"] if entity is None else []
    assert [str(request.url) for request in requests] == [
        *discovery,
        f"{(host or 'https://api.wandb.ai').rstrip('/')}/graphql",
        f"{trace_endpoint}/calls/query_stats",
        *[f"{trace_endpoint}/v2/entity/project/calls/complete" for _span in trace.spans],
    ]
    assert all(request.headers["Authorization"] == basic_auth("api", "saved-key") for request in requests)
    assert dict(os.environ) == environment


def test_weave_native_usage_counts_generations_without_container_aggregates(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    root, generation = trace.spans
    root = root.model_copy(update={"usage": generation.usage})
    wrapper = generation.model_copy(
        update={
            "span_id": make_span_id(trace.source.tenant_id, trace.source.operation_id, "retry-wrapper"),
            "span_type": "node",
            "usage": {},
            "attributes": {"aggregate_usage": generation.usage},
        }
    )
    generation = generation.model_copy(
        update={
            "parent_span_id": wrapper.span_id,
            "attributes": {
                **generation.attributes,
                "metrics_from_parent": True,
            },
        }
    )
    trace = trace.model_copy(update={"spans": (root, wrapper, generation)})
    client, request = make_client_with_transport(monkeypatch)
    client.export_trace(trace)
    calls = [call.kwargs["json"]["batch"][0] for call in request.call_args_list]
    assert "usage" not in calls[0]["summary"]
    assert "usage" not in calls[1]["summary"]
    assert calls[0]["attributes"]["dify.usage"]["total_tokens"] == 8
    assert calls[2]["summary"]["usage"]["gpt-4o"]["total_tokens"] == 8
    request.reset_mock()
    client.export_trace(
        trace.model_copy(
            update={
                "root_span_id": generation.span_id,
                "spans": (generation.model_copy(update={"parent_span_id": None}),),
            }
        )
    )
    assert request.call_args.kwargs["json"]["batch"][0]["summary"]["usage"]["gpt-4o"]["total_tokens"] == 8


@pytest.mark.parametrize("operation", ["verify_credentials", "export_trace"])
def test_weave_self_hosted_failure_never_falls_back_to_cloud(monkeypatch: pytest.MonkeyPatch, operation: str) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(503)

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    client = WeaveTraceClient(
        {"api_key": "saved-key", "entity": "entity", "project": "project", "host": "https://wandb.example"}
    )
    send_to_provider = (
        client.verify_credentials if operation == "verify_credentials" else lambda: client.export_trace(make_trace())
    )
    with pytest.raises(TraceExportError, match="provider_http_503"):
        send_to_provider()
    assert len(requests) == 1
    assert requests[0].url.host == "wandb.example"
    assert requests[0].url.path == "/graphql"


@pytest.mark.parametrize("missing", [{"started_at": None, "ended_at": None}, {"ended_at": None}])
def test_weave_preserves_untimed_children_and_status_counts(missing: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    child = trace.spans[-1].model_copy(update={**missing, "status": "error", "error": "attempt failed"})
    trace = trace.model_copy(update={"spans": (trace.spans[0], child)})
    client, request = make_client_with_transport(monkeypatch)
    receipt = client.export_trace(trace)
    call = request.call_args.kwargs["json"]["batch"][0]
    anchor = child.started_at or trace.spans[0].started_at
    assert anchor is not None
    assert call["started_at"] == call["ended_at"] == anchor.isoformat()
    assert call["attributes"]["dify.timing.estimated"] is True
    assert isinstance(child.outputs, dict)
    assert call["output"] == {
        **child.outputs,
        "usage_metadata": {"input_tokens": 3, "output_tokens": 5, "total_tokens": 8},
        "file_list": [],
    }
    assert call["exception"] == "attempt failed"
    assert call["summary"]["status_counts"] == {"success": 0, "error": 1}
    assert call["summary"]["usage"]["gpt-4o"]["total_tokens"] == 8
    assert call["parent_id"] == receipt.spans[trace.root_span_id]["span_id"]


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
    assert request.call_args_list[0].kwargs["json"]["batch"][0]["trace_id"] == "external-request"
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

    call = request.call_args.kwargs["json"]["batch"][0]
    assert call["exception"] == expected_error
    assert call["summary"]["status_counts"] == {"error": int(bool(expected_error)), "success": int(not expected_error)}


@pytest.mark.parametrize("legacy_server", [False, True])
def test_weave_exports_complete_calls_and_falls_back_for_legacy_servers(
    monkeypatch: pytest.MonkeyPatch, legacy_server: bool
) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/graphql":
            return httpx.Response(200, json={"data": {"project": {"name": "project"}}})
        if request.url.path.endswith("/calls/complete"):
            return httpx.Response(404 if legacy_server else 200, json={})
        if not legacy_server:
            return httpx.Response(400, json={"error_code": "CALLS_COMPLETE_MODE_REQUIRED"})
        return httpx.Response(200, json={})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    trace = make_trace()
    client = WeaveTraceClient(
        {"api_key": "saved-key", "entity": "team", "project": "project", "host": "https://wandb.example"}
    )

    first_receipts = client.export_trace(trace)
    first_requests = list(requests)
    requests.clear()
    second_receipts = WeaveTraceClient(client.config.model_dump()).export_trace(trace)

    assert second_receipts == first_receipts
    assert [request.content for request in requests] == [request.content for request in first_requests]
    assert requests[0].url.path == "/graphql"
    requests = requests[1:]
    paths = [request.url.path for request in requests]
    if legacy_server:
        assert paths == ["/traces/v2/team/project/calls/complete"] + [
            f"/traces/call/{event}" for _span in trace.spans for event in ("start", "end")
        ]
        payloads = [json.loads(request.content) for request in requests[1:]]
        calls = [{**payloads[index]["start"], **payloads[index + 1]["end"]} for index in range(0, len(payloads), 2)]
    else:
        assert paths == ["/traces/v2/team/project/calls/complete"] * len(trace.spans)
        calls = [json.loads(request.content)["batch"][0] for request in requests]
    assert all(request.headers["Authorization"] == basic_auth("api", "saved-key") for request in requests)
    assert calls[1]["parent_id"] == calls[0]["id"]
    for span, call in zip(trace.spans, calls, strict=True):
        assert span.started_at is not None
        assert span.ended_at is not None
        assert call["id"] == first_receipts.spans[span.span_id]["span_id"]
        assert call["trace_id"] == first_receipts.spans[span.span_id]["trace_id"]
        assert call["started_at"] == span.started_at.isoformat()
        assert call["ended_at"] == span.ended_at.isoformat()
        assert isinstance(call["output"], dict)
        assert isinstance(span.outputs, dict)
        assert call["output"].items() >= span.outputs.items()


@pytest.mark.parametrize("entity", [None, ""])
def test_weave_qualified_project_skips_default_entity_discovery(
    monkeypatch: pytest.MonkeyPatch, entity: str | None
) -> None:
    client = WeaveTraceClient({"api_key": "saved-key", "entity": entity, "project": "team/project"})
    request = Mock(return_value=httpx.Response(200, json={"data": {"project": {"name": "project"}}}))
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)

    assert client.verify_credentials() is True
    assert client.get_project_url() == "https://wandb.ai/team/project/weave"
    client.export_trace(make_trace())

    assert request.call_args_list[0].args[1] == "https://api.wandb.ai/graphql"
    assert "viewer" not in request.call_args_list[0].kwargs["json"]["query"]
    assert request.call_args_list[1].args[1] == "https://trace.wandb.ai/calls/query_stats"
    assert request.call_args_list[1].kwargs["json"] == {"project_id": "team/project"}
    assert all(call.args[1].endswith("/v2/team/project/calls/complete") for call in request.call_args_list[2:])


@pytest.mark.parametrize("status", [400, 401, 403, 429, 503])
def test_weave_complete_call_failure_does_not_fall_back(monkeypatch: pytest.MonkeyPatch, status: int) -> None:
    client = WeaveTraceClient({"api_key": "saved-key", "entity": "team", "project": "project"})
    request = Mock(return_value=httpx.Response(status))
    monkeypatch.setattr(
        client.account_http,
        "request",
        Mock(return_value=httpx.Response(200, json={"data": {"project": {"name": "project"}}})),
    )
    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.make_request", request)

    with pytest.raises(TraceExportError, match=f"provider_http_{status}"):
        client.export_trace(make_trace())

    request.assert_called_once()


@pytest.mark.parametrize("mode", ["chat", "completion", "agent-chat", "advanced-chat"])
def test_weave_preserves_tags_on_captured_message_operations(mode: str, monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    source = trace.source.model_copy(update={"workflow_run_id": str(uuid4()) if mode == "advanced-chat" else None})
    recorder = MessageTraceRecorder(source, Mock(), (), attributes={"app_mode": mode})
    submitted = Mock(return_value=True)
    monkeypatch.setattr(recorder, "submit_completed_trace", submitted)
    expected_tags = {
        "moderation": ["moderation"],
        "suggested_questions": ["suggested_question"],
        "generate_conversation_name": ["generate_name"],
        "dataset_retrieval": ["dataset_retrieval"],
        "Search": ["tool", "web_search"],
    }
    for name, span_type, attributes in (
        ("moderation", "tool", {"operation_type": "moderation"}),
        ("suggested_questions", "llm", {"operation_type": "suggested_question"}),
        ("generate_conversation_name", "llm", {"operation_type": "generate_name"}),
        ("dataset_retrieval", "retrieval", {}),
        ("Search", "tool", {"tool_name": "web_search"}),
    ):
        recorder.record_operation(name, span_type=span_type, attributes=attributes)
    recorder.finish_message_trace(
        {
            "message_id": source.message_id,
            "conversation_id": str(uuid4()),
            "started_at": trace.spans[0].started_at,
            "ended_at": trace.spans[0].ended_at,
            "model_name": "gpt-4o",
            "metadata": {"conversation_mode": mode},
        },
        include_llm=mode != "advanced-chat",
    )
    captured = submitted.call_args.args[0]
    original = captured.model_dump_json()
    client, request = make_client_with_transport(monkeypatch)
    client.export_trace(captured)

    expected_tags["message"] = ["message", "workflow" if mode == "advanced-chat" else mode]
    expected_tags["gpt-4o"] = ["message", mode]
    for call in request.call_args_list:
        exported = call.kwargs["json"]["batch"][0]
        assert exported["attributes"]["tags"] == expected_tags[exported["op_name"]]
        assert exported["attributes"]["dify.tenant_id"] == source.tenant_id
    assert captured.model_dump_json() == original


@pytest.mark.parametrize("node_type", ["node", "llm", "tool"])
def test_weave_preserves_workflow_node_and_captured_tags(node_type: str, monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    node = trace.spans[-1].model_copy(
        update={
            "span_type": node_type,
            "node_execution_id": str(uuid4()),
            "attributes": {"tags": ["custom", "node_execution"], "custom_field": "preserved"},
        }
    )
    trace = trace.model_copy(update={"spans": (trace.spans[0], node)})
    client, request = make_client_with_transport(monkeypatch)
    client.export_trace(trace)

    workflow, node_call = [call.kwargs["json"]["batch"][0] for call in request.call_args_list]
    assert workflow["attributes"]["tags"] == ["dify_workflow"]
    assert node_call["attributes"]["tags"] == ["node_execution", "custom"]
    assert node_call["attributes"]["custom_field"] == "preserved"


@pytest.mark.parametrize("legacy_server", [False, True])
@pytest.mark.parametrize("node_type", ["llm", "question-classifier", "parameter-extractor"])
def test_recorded_model_nodes_preserve_native_inputs(
    node_type: str, legacy_server: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id=str(uuid4()))
    submitted: list[CompletedTrace] = []

    def submit_trace(trace: CompletedTrace) -> bool:
        submitted.append(trace)
        return True

    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=submit_trace,
    )
    node = workflow_node(source, node_type=node_type)
    start_node(recorder, node)
    started = datetime.now(UTC)
    original_inputs = {"query": "Original query"}
    prompts = [{"role": "user", "text": "Rendered prompt"}]
    recorder.on_event(
        NodeRunSucceededEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type=node_type,
            start_at=started,
            finished_at=started + timedelta(seconds=1),
            node_run_result=NodeRunResult(
                inputs=original_inputs,
                process_data={"model_mode": "chat", "prompts": prompts},
                outputs={"result": "answer"},
            ),
        )
    )
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    assert trace.spans[1].inputs == prompts
    original_trace = trace.model_dump_json()
    client, request = make_client_with_transport(monkeypatch)
    if legacy_server:
        request.side_effect = [TraceExportError("provider_http_404"), *[httpx.Response(200)] * 4]
    client.export_trace(trace)
    if legacy_server:
        calls = [call.kwargs["json"]["start"] for call in request.call_args_list if call.args[1] == "call/start"]
    else:
        calls = [call.kwargs["json"]["batch"][0] for call in request.call_args_list]
    metadata = {"usage_metadata": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}, "file_list": []}
    assert calls[1]["inputs"] == (
        {"messages": [{"role": "user", "content": "Rendered prompt", **metadata}]}
        if node_type == "llm"
        else {**original_inputs, **metadata}
    )
    assert calls[1]["attributes"]["dify.tenant_id"] == source.tenant_id
    assert trace.model_dump_json() == original_trace
