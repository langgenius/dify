import json
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import httpx
import pytest
from dify_trace_opik.opik_trace import OpikTraceClient

from core.ops.message_trace import MessageTraceRecorder
from core.ops.provider_export import TraceExportError
from core.ops.trace_data import CompletedTrace, TraceSource, TraceSpan, make_span_id, make_trace_id
from core.ops.workflow_trace import WorkflowTraceRecorder
from graphon.engine_events import GraphRunSucceededEvent, NodeRunSucceededEvent
from graphon.enums import WorkflowNodeExecutionMetadataKey
from graphon.model_runtime.entities.llm_entities import LLMUsage
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


def make_client_with_transport(monkeypatch: pytest.MonkeyPatch) -> tuple[OpikTraceClient, Mock]:
    client = OpikTraceClient({"api_key": "secret", "workspace": "workspace", "project": "project"})
    request = Mock(return_value=httpx.Response(200, json={}))
    monkeypatch.setattr(client.http, "request", request)
    return client, request


@pytest.mark.parametrize(
    ("workspace_settings", "workspace"),
    [
        ({}, "default"),
        ({"workspace": None}, "default"),
        ({"workspace": ""}, "default"),
        ({"workspace": "default"}, "default"),
        ({"workspace": "team"}, "team"),
    ],
)
def test_opik_sends_workspace_for_verification_and_export(
    workspace_settings: dict[str, str | None], workspace: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200 if request.headers.get("Comet-Workspace") == workspace else 403, json={})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    client = OpikTraceClient({"api_key": "secret", **workspace_settings})

    assert client.verify_credentials()
    client.export_trace(make_trace())

    assert [(request.method, request.url.path) for request in requests] == [
        ("GET", "/opik/api/v1/private/projects"),
        ("POST", "/opik/api/v1/private/traces"),
        ("POST", "/opik/api/v1/private/spans/batch"),
    ]
    assert all(request.headers["Authorization"] == "secret" for request in requests)
    assert client.config.workspace == (
        workspace_settings["workspace"] if workspace_settings.get("workspace") is not None else "default"
    )


def test_opik_project_url_uses_configured_host_and_escapes_project_name(monkeypatch: pytest.MonkeyPatch) -> None:
    project = "Dify & traces/#?客户"
    client = OpikTraceClient({"url": "https://tracing.example/opik/api/", "workspace": "team/name", "project": project})
    request = Mock()
    monkeypatch.setattr(client.http, "request", request)

    url = urlsplit(client.get_project_url())

    assert url.netloc == "tracing.example"
    assert url.path == "/opik/team%2Fname/redirect/projects"
    assert parse_qs(url.query) == {"name": [project]}
    assert not url.fragment
    request.assert_not_called()


def test_opik_project_url_resolves_default_workspace_only_for_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    client = OpikTraceClient({"api_key": "secret"})
    request = Mock(return_value=httpx.Response(200, json={"workspace_name": "my/team"}))
    monkeypatch.setattr(client.http, "request", request)

    assert client.get_project_url() == "https://www.comet.com/opik/my%2Fteam/redirect/projects?name=Default+Project"
    request.assert_called_once_with("GET", "v1/private/auth/workspace")
    assert client.config.workspace == "default"

    request.reset_mock()
    client.export_trace(make_trace())
    assert all(call.args[0] == "POST" for call in request.call_args_list)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, text="invalid json"),
        httpx.Response(200, json=[]),
        httpx.Response(200, json={"workspace_name": None}),
        TraceExportError("provider_unreachable", retryable=True),
    ],
)
def test_opik_project_url_keeps_settings_readable_when_workspace_lookup_fails(
    response: httpx.Response | TraceExportError, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = OpikTraceClient({"workspace": "default", "project": "project"})
    request = Mock(side_effect=response) if isinstance(response, TraceExportError) else Mock(return_value=response)
    monkeypatch.setattr(client.http, "request", request)

    assert client.get_project_url() == "https://www.comet.com/opik/default/redirect/projects?name=project"
    request.assert_called_once_with("GET", "v1/private/auth/workspace")


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
    root = first_bodies[0]
    root_span, generation = first_bodies[1]["spans"]
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
    assert all(call.args[1] == "v1/private/spans/batch" for call in request.call_args_list)
    assert request.call_args_list[0].kwargs["json"]["spans"][0]["parent_span_id"] == receipt["span_id"]
    assert child_receipts.spans[child.root_span_id]["trace_id"] == receipt["trace_id"]


def test_opik_preserves_untimed_details_without_export_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    child = trace.spans[-1].model_copy(update={"started_at": None, "ended_at": None})
    trace = trace.model_copy(update={"spans": (trace.spans[0], child)})
    client, request = make_client_with_transport(monkeypatch)
    client.export_trace(trace)
    exported = request.call_args.kwargs["json"]["spans"][-1]
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


@pytest.mark.parametrize("mode", ["chat", "completion", "agent-chat", "advanced-chat"])
def test_opik_preserves_tags_on_captured_message_operations(mode: str, monkeypatch: pytest.MonkeyPatch) -> None:
    trace = make_trace()
    source = trace.source.model_copy(update={"workflow_run_id": str(uuid4()) if mode == "advanced-chat" else None})
    recorder = MessageTraceRecorder(source, Mock(), (), attributes={"app_mode": mode})
    submitted = Mock(return_value=True)
    monkeypatch.setattr(recorder, "submit_completed_trace", submitted)
    expected_tags = {
        "moderation": ["dify", "tool", "moderation"],
        "suggested_questions": ["dify", "llm", "suggested_question"],
        "generate_conversation_name": ["dify", "llm", "generate_name"],
        "dataset_retrieval": ["dify", "retrieval", "dataset_retrieval"],
        "Search": ["dify", "tool", "web_search"],
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
    captured = CompletedTrace.model_validate_json(submitted.call_args.args[0].model_dump_json())
    original = captured.model_dump_json()
    client, request = make_client_with_transport(monkeypatch)
    client.export_trace(captured)

    expected_tags["message"] = ["dify", "operation", "message", "workflow" if mode == "advanced-chat" else mode]
    expected_tags["gpt-4o"] = ["dify", "llm", mode]
    for exported in [request.call_args_list[0].kwargs["json"], *request.call_args.kwargs["json"]["spans"]]:
        assert exported["tags"] == expected_tags[exported["name"]]
        assert exported["metadata"]["created_from"] == "dify"
        assert exported["metadata"]["dify.tenant_id"] == source.tenant_id
        if "type" in exported:
            assert (
                exported["type"]
                == {
                    "message": "general",
                    "gpt-4o": "llm",
                    "moderation": "tool",
                    "suggested_questions": "tool",
                    "generate_conversation_name": "general",
                    "dataset_retrieval": "tool",
                    "Search": "tool",
                }[exported["name"]]
            )
    assert captured.model_dump_json() == original


@pytest.mark.parametrize("message_id", [None, "12345678-1234-4234-8234-123456789abc"])
@pytest.mark.parametrize("node_type", ["node", "llm", "tool"])
def test_opik_preserves_workflow_trace_and_node_tags(
    message_id: str | None, node_type: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    trace = make_trace()
    node = trace.spans[-1].model_copy(update={"span_type": node_type, "node_execution_id": str(uuid4())})
    trace = trace.model_copy(
        update={"source": trace.source.model_copy(update={"message_id": message_id}), "spans": (trace.spans[0], node)}
    )
    client, request = make_client_with_transport(monkeypatch)
    client.export_trace(trace)

    root = request.call_args_list[0].kwargs["json"]
    root_span, node_span = request.call_args.kwargs["json"]["spans"]
    assert root["tags"] == (["dify", "message", "workflow"] if message_id else ["dify", "workflow"])
    assert root_span["tags"] == ["dify", "workflow"]
    assert node_span["tags"] == ["dify", node_type, "node_execution"]
    assert all(exported["metadata"]["created_from"] == "dify" for exported in (root, root_span, node_span))


@pytest.mark.parametrize(
    ("node_type", "model_mode", "expected_type"),
    [
        ("code", None, "tool"),
        ("http-request", None, "tool"),
        ("knowledge-retrieval", None, "tool"),
        ("agent", None, "tool"),
        ("llm", "chat", "llm"),
        ("llm", "completion", "tool"),
        ("llm", None, "tool"),
        ("question-classifier", "chat", "llm"),
        ("question-classifier", "completion", "tool"),
        ("question-classifier", None, "tool"),
        ("parameter-extractor", "chat", "llm"),
        ("parameter-extractor", "completion", "tool"),
        ("parameter-extractor", None, "tool"),
    ],
)
def test_opik_captured_workflow_node_categories(
    node_type: str, model_mode: str | None, expected_type: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    original_inputs = {"query": "Original query"}
    prompts = [{"role": "user", "content": "Rendered prompt"}]
    source = make_trace().source
    submitted = Mock(return_value=True)
    recorder = WorkflowTraceRecorder(
        source=source, workflow_id="workflow", workflow_version="1", inputs={}, submit_completed_trace=submitted
    )
    node = workflow_node(source, node_type=node_type)
    start_node(recorder, node)
    recorder.on_event(
        NodeRunSucceededEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type=node_type,
            start_at=datetime.now(UTC),
            finished_at=datetime.now(UTC),
            node_run_result=NodeRunResult(
                inputs=original_inputs,
                outputs={"text": "Done"},
                process_data={"prompts": prompts, **({"model_mode": model_mode} if model_mode else {})},
            ),
        )
    )
    recorder.on_event(GraphRunSucceededEvent())
    recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted.call_args.args[0].model_dump_json())
    client, request = make_client_with_transport(monkeypatch)
    client.export_trace(trace)
    assert request.call_args.kwargs["json"]["spans"][-1]["type"] == expected_type
    assert request.call_args.kwargs["json"]["spans"][-1]["input"] == (
        {"messages": prompts} if node_type == "llm" else original_inputs
    )


@pytest.mark.parametrize("details", ["absent", "tokens", "partial", "empty", "sibling", "unaggregated"])
def test_opik_agent_usage_fallback_counts_tokens_once(details: str, monkeypatch: pytest.MonkeyPatch) -> None:
    source = make_trace().source
    submitted = Mock(return_value=True)
    recorder = WorkflowTraceRecorder(
        source=source, workflow_id="workflow", workflow_version="1", inputs={}, submit_completed_trace=submitted
    )
    usage = LLMUsage.empty_usage().model_copy(update={"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8})
    node_usage = LLMUsage.empty_usage() if details == "unaggregated" else usage
    nodes = [workflow_node(source, node_type="agent")]
    if details == "sibling":
        nodes.append(workflow_node(source, node_type="llm"))
    for node in nodes:
        start_node(recorder, node)
        recorder.on_event(
            NodeRunSucceededEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type=node.node_type,
                start_at=datetime.now(UTC),
                finished_at=datetime.now(UTC),
                node_run_result=NodeRunResult(
                    outputs={
                        "text": "Answer",
                        "usage": node_usage.model_dump(mode="json"),
                        "json": [
                            {
                                "id": "thought",
                                "label": "1 Thought",
                                "metadata": {
                                    "prompt_tokens": 1 if details == "partial" else 3,
                                    "completion_tokens": 2 if details == "partial" else 5,
                                    "total_tokens": 3 if details == "partial" else 8,
                                }
                                if details in {"tokens", "partial", "unaggregated"}
                                else {},
                            }
                        ]
                        if details in {"tokens", "partial", "empty", "unaggregated"}
                        else [],
                    },
                    metadata={WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: node_usage.total_tokens},
                    llm_usage=node_usage,
                ),
            )
        )
    recorder.on_event(GraphRunSucceededEvent())
    recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted.call_args.args[0].model_dump_json())
    original = trace.model_dump_json()
    client, request = make_client_with_transport(monkeypatch)
    client.export_trace(trace)
    spans = request.call_args.kwargs["json"]["spans"]
    assert sum(span["usage"].get("total_tokens", 0) for span in spans) == (16 if details == "sibling" else 8)
    assert spans[1]["usage"] == (
        {} if details == "unaggregated" else {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8}
    )
    if details in {"tokens", "partial"}:
        assert spans[2]["usage"] == {}
        assert spans[2]["metadata"]["dify.usage"]["total_tokens"] == (3 if details == "partial" else 8)
    assert trace.model_dump_json() == original


@pytest.mark.parametrize(
    ("span_count", "input_length", "batch_sizes"),
    [(401, 0, [401]), (1001, 0, [1000, 1]), (3, 800_000, [2, 1]), (2, 1_400_000, [1, 1])],
)
def test_opik_batches_large_traces_within_the_export_deadline(
    span_count: int, input_length: int, batch_sizes: list[int], monkeypatch: pytest.MonkeyPatch
) -> None:
    trace = make_trace()
    trace = trace.model_copy(
        update={
            "spans": (
                trace.spans[0],
                *(
                    trace.spans[-1].model_copy(
                        update={
                            "span_id": make_span_id(trace.source.tenant_id, trace.source.operation_id, f"node-{index}"),
                            "inputs": {"query": "λ" * input_length},
                        }
                    )
                    for index in range(span_count - 1)
                ),
            )
        }
    )
    original = trace.model_dump_json()
    now = 0.0
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal now
        requests.append(request)
        now += 0.25
        return httpx.Response(204)

    monkeypatch.setattr("core.ops.provider_export.monotonic", lambda: now)
    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    config = {"api_key": "tenant-secret", "workspace": "workspace", "project": "project"}
    first = OpikTraceClient(config).export_trace(trace)
    first_requests = list(requests)
    requests.clear()
    assert OpikTraceClient(config).export_trace(trace) == first
    assert [request.content for request in requests] == [request.content for request in first_requests]
    assert now == 2 * (len(batch_sizes) + 1) * 0.25
    assert requests[0].url.path.endswith("/traces")
    batches = [json.loads(request.content)["spans"] for request in requests[1:]]
    assert [len(batch) for batch in batches] == batch_sizes
    assert all(request.url.path.endswith("/spans/batch") for request in requests[1:])
    assert all(
        len(request.content) <= 5 * 1024 * 1024 or len(batch) == 1
        for request, batch in zip(requests[1:], batches, strict=True)
    )
    exported_spans = [span for batch in batches for span in batch]
    assert len({span["id"] for span in exported_spans}) == span_count
    assert all(span["parent_span_id"] == exported_spans[0]["id"] for span in exported_spans[1:])
    assert all(span["trace_id"] == first.spans[trace.root_span_id]["trace_id"] for span in exported_spans)
    assert all(request.headers["Authorization"] == "tenant-secret" for request in requests)
    assert trace.model_dump_json() == original


def test_opik_batch_failure_remains_retryable_without_receipts(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(503 if request.url.path.endswith("/batch") else 204)

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    trace = make_trace()
    for _ in range(2):
        with pytest.raises(TraceExportError, match="provider_http_503") as error:
            OpikTraceClient({"api_key": "tenant-secret"}).export_trace(trace)
        assert error.value.retryable
    assert len(requests) == 4
    assert requests[1].content == requests[3].content
