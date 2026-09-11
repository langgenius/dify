"""Recorded Dify operations retain Aliyun's established native fields."""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import pytest
from dify_trace_aliyun.aliyun_trace import create_trace_client
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.trace.v1.trace_pb2 import Span
from pydantic import JsonValue

from core.ops.basic_chat_trace import record_basic_chat_result
from core.ops.message_trace import MessageTraceRecorder
from core.ops.trace_data import CompletedTrace, TraceProviderSettings, TraceSource
from core.ops.workflow_trace import WorkflowTraceRecorder
from core.rag.models.document import Document
from graphon.engine_events import GraphRunFailedEvent, GraphRunSucceededEvent, NodeRunFailedEvent, NodeRunSucceededEvent
from graphon.node_events import NodeRunResult
from tests.unit_tests.core.ops.test_message_trace import RecordingQueue, message_fields
from tests.unit_tests.core.ops.test_workflow_trace_limits import start_node, workflow_node

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


def export_spans(trace: CompletedTrace, monkeypatch: pytest.MonkeyPatch) -> list[Span]:
    original = trace.model_dump_json()
    client = create_trace_client(make_provider_config())
    send = Mock()
    monkeypatch.setattr(client, "send_traces", send)
    client.export_trace(trace)
    request = ExportTraceServiceRequest.FromString(send.call_args.args[0].SerializeToString())
    assert trace.model_dump_json() == original
    return list(request.resource_spans[0].scope_spans[0].spans)


@pytest.mark.parametrize(
    ("node_type", "result", "kind", "output"),
    [
        ("code", NodeRunResult(inputs={"x": 1}, outputs={"answer": 2}), "TASK", '{"answer":2}'),
        (
            "question-classifier",
            NodeRunResult(
                inputs={"query": "hello"}, process_data={"prompts": ["rendered"]}, outputs={"class_name": "A"}
            ),
            "TASK",
            '{"class_name":"A"}',
        ),
        (
            "parameter-extractor",
            NodeRunResult(inputs={"query": "hello"}, process_data={"prompts": ["rendered"]}, outputs={"name": "Ada"}),
            "TASK",
            '{"name":"Ada"}',
        ),
        (
            "llm",
            NodeRunResult(
                process_data={"prompts": [{"role": "user", "text": "hello"}]},
                outputs={"text": "world", "finish_reason": "stop"},
            ),
            "LLM",
            "world",
        ),
        ("agent", NodeRunResult(inputs={"query": "hello"}, outputs={"text": "world", "json": []}), "AGENT", "world"),
        (
            "knowledge-retrieval",
            NodeRunResult(inputs={"query": "hello"}, outputs={"result": [{"content": "world", "metadata": {}}]}),
            "RETRIEVER",
            '[{"content":"world","metadata":{}}]',
        ),
    ],
)
@pytest.mark.parametrize("node_title", ["Node", "Model Thought"])
def test_recorded_workflow_native_kind_and_output(
    node_type: str, result: NodeRunResult, kind: str, output: str, node_title: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    node = workflow_node(source, node_type=node_type)
    monkeypatch.setattr(node, "title", node_title)
    start_node(recorder, node)
    started = datetime.now(UTC)
    recorder.on_event(
        NodeRunSucceededEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type=node_type,
            start_at=started,
            finished_at=started + timedelta(seconds=1),
            node_run_result=result,
        )
    )
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    root, exported = export_spans(trace, monkeypatch)
    assert root.kind == Span.SPAN_KIND_SERVER
    assert exported.kind == Span.SPAN_KIND_INTERNAL
    attributes = {item.key: item.value.string_value for item in exported.attributes}
    assert attributes["gen_ai.span.kind"] == kind
    assert attributes["output.value"] == output
    if node_type == "llm":
        assert attributes["gen_ai.completion"] == output
        assert "gen_ai.request.model" not in attributes
    elif node_type in {"question-classifier", "parameter-extractor"}:
        assert json.loads(attributes["input.value"]) == {"query": "hello"}
        assert "gen_ai.completion" not in attributes
    elif node_type == "knowledge-retrieval":
        assert attributes["input.value"] == attributes["retrieval.query"] == "hello"
        assert json.loads(attributes["retrieval.document"])[0]["document"]["content"] == "world"


@pytest.mark.parametrize("outputs", [{"error_message": "rate limited", "error_type": "RateLimitError"}, {}, None])
@pytest.mark.parametrize("node_title", ["Node", "Model Thought"])
def test_recorded_failed_llm_retains_prepared_model_and_node_error(
    outputs: dict[str, JsonValue] | None, node_title: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    node = workflow_node(source, node_type="llm")
    monkeypatch.setattr(node, "title", node_title)
    start_node(recorder, node)
    if outputs is not None:
        recorder.on_event(
            NodeRunFailedEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type="llm",
                start_at=datetime.now(UTC),
                error="node failed",
                node_run_result=NodeRunResult(
                    inputs={"model_name": "prepared-model", "model_provider": "prepared-provider"}, outputs=outputs
                ),
            )
        )
    recorder.on_event(GraphRunFailedEvent(error="node failed"))
    assert recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    attributes = {item.key: item.value.string_value for item in export_spans(trace, monkeypatch)[1].attributes}
    if outputs is not None:
        assert attributes["gen_ai.request.model"] == "prepared-model"
        assert attributes["gen_ai.provider.name"] == "prepared-provider"
    else:
        assert trace.spans[1].outputs is None
    assert (
        attributes["gen_ai.completion"]
        == attributes["output.value"]
        == (outputs or {}).get("error_message", "node failed")
    )
    if outputs:
        assert attributes["gen_ai.response.finish_reason"] == "RateLimitError"


@pytest.mark.parametrize("tool_output", ["found", {"result": "found"}])
def test_recorded_message_and_retrieval_keep_scalar_and_document_aliases(
    tool_output: JsonValue, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    queue = RecordingQueue()
    recorder = MessageTraceRecorder(
        source,
        queue,
        (
            TraceProviderSettings(
                tenant_id=source.tenant_id, app_id=source.app_id, provider_name="aliyun", config_id=str(uuid4())
            ),
        ),
    )
    recorder.bind_message(str(uuid4()), str(uuid4()))
    recorder.record_operation(
        "dataset_retrieval",
        span_type="retrieval",
        inputs="hello",
        outputs={"documents": [Document(page_content="world", metadata={"dataset_id": "dataset", "score": 0.0})]},
    )
    recorder.record_operation("search", span_type="tool", inputs={"query": "hello"}, outputs=tool_output)
    record_basic_chat_result(recorder, message_fields(recorder))
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    root, _, retrieval, tool = export_spans(trace, monkeypatch)
    assert root.kind == Span.SPAN_KIND_SERVER
    assert {item.key: item.value.string_value for item in root.attributes}["output.value"] == "answer"
    attributes = {item.key: item.value.string_value for item in retrieval.attributes}
    assert attributes["input.value"] == attributes["retrieval.query"] == "hello"
    assert attributes["output.value"] == attributes["retrieval.document"]
    assert json.loads(attributes["retrieval.document"]) == [
        {"content": "world", "metadata": {"dataset_id": "dataset", "doc_id": None, "document_id": None}, "score": 0.0}
    ]
    tool_attributes = {item.key: item.value.string_value for item in tool.attributes}
    assert tool_attributes["output.value"] == tool_attributes["gen_ai.tool.call.result"] == str(tool_output)


def test_recorded_plugin_call_projects_arguments_and_raw_result(monkeypatch: pytest.MonkeyPatch) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    node = workflow_node(source, node_type="agent")
    start_node(recorder, node)
    started = datetime.now(UTC)
    recorder.on_event(
        NodeRunSucceededEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type="agent",
            start_at=started,
            finished_at=started + timedelta(seconds=1),
            node_run_result=NodeRunResult(
                outputs={
                    "json": [
                        {
                            "id": "call",
                            "label": "CALL search",
                            "status": "success",
                            "data": {"tool_call_args": {"query": "hello"}, "output": "world"},
                            "metadata": {"tool_call_id": "native-call"},
                        }
                    ]
                }
            ),
        )
    )
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    call = next(span for span in export_spans(trace, monkeypatch) if span.name == "CALL search")
    attributes = {item.key: item.value.string_value for item in call.attributes}
    assert json.loads(attributes["input.value"]) == {"query": "hello"}
    assert attributes["input.value"] == attributes["gen_ai.tool.call.arguments"]
    assert attributes["output.value"] == attributes["gen_ai.tool.call.result"] == "world"
    assert attributes["gen_ai.tool.call.id"] == "native-call"
