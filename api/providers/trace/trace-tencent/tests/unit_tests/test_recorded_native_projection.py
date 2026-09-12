"""Tencent's native values survive serialized workflow and message capture."""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import pytest
from dify_trace_tencent.tencent_trace import create_trace_client
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.trace.v1.trace_pb2 import Span
from pydantic import JsonValue

from core.ops.basic_chat_trace import record_basic_chat_result
from core.ops.completion_trace import record_completion_result
from core.ops.message_trace import MessageTraceRecorder
from core.ops.trace_data import CompletedTrace, TraceProviderSettings, TraceSource
from core.ops.workflow_trace import WorkflowTraceRecorder
from core.rag.models.document import Document
from graphon.engine_events import GraphRunSucceededEvent, NodeRunSucceededEvent
from graphon.enums import WorkflowNodeExecutionMetadataKey
from graphon.node_events import NodeRunResult
from tests.unit_tests.core.ops.test_message_trace import RecordingQueue, message_fields
from tests.unit_tests.core.ops.test_workflow_trace_limits import start_node, workflow_node

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


def export_spans(trace: CompletedTrace, monkeypatch: pytest.MonkeyPatch) -> list[Span]:
    original = trace.model_dump_json()
    client = create_trace_client(make_provider_config())
    send = Mock()
    monkeypatch.setattr(client, "send_traces", send)
    monkeypatch.setattr(client, "send_metrics", Mock())
    client.export_trace(trace)
    request = ExportTraceServiceRequest.FromString(send.call_args.args[0].SerializeToString())
    assert trace.model_dump_json() == original
    return list(request.resource_spans[0].scope_spans[0].spans)


def test_recorded_workflow_llm_retrieval_and_tool_native_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    results = {
        "llm": NodeRunResult(
            process_data={"prompts": [{"role": "user", "text": "hello"}]},
            outputs={"text": "world", "finish_reason": "stop"},
        ),
        "knowledge-retrieval": NodeRunResult(
            inputs={"query": "hello"},
            outputs={"result": [{"content": "world", "metadata": {"score": 0.0}}]},
        ),
        "tool": NodeRunResult(
            inputs={"query": "hello"},
            outputs={"text": "world"},
            metadata={
                WorkflowNodeExecutionMetadataKey.TOOL_INFO: {
                    "description": "Search documents",
                    "provider_type": "builtin",
                }
            },
        ),
    }
    for node_type in ("question-classifier", "parameter-extractor", "agent"):
        results[node_type] = NodeRunResult(
            inputs={"query": "hello"},
            process_data={"prompts": ["rendered"]},
            outputs={"text": "world"},
        )
    for node_type, result in results.items():
        node = workflow_node(source, node_type=node_type)
        node.id = node_type
        monkeypatch.setattr(node, "title", node_type)
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
    attributes = {
        span.name: {item.key: item.value.string_value for item in span.attributes}
        for span in export_spans(trace, monkeypatch)
    }
    llm = attributes["llm"]
    assert llm["gen_ai.completion"] == llm["gen_ai.entity.output"] == "world"
    assert json.loads(llm["gen_ai.prompt"]) == [{"role": "user", "text": "hello"}]
    assert llm["gen_ai.entity.input"] == llm["gen_ai.prompt"]
    retrieval = attributes["knowledge-retrieval"]
    assert retrieval["retrieval.query"] == retrieval["gen_ai.entity.input"] == "hello"
    assert retrieval["retrieval.document"] == retrieval["gen_ai.entity.output"]
    assert json.loads(retrieval["retrieval.document"]) == [{"content": "world", "metadata": {"score": 0.0}}]
    tool = attributes["tool"]
    assert json.loads(tool["tool.description"]) == {"description": "Search documents", "provider_type": "builtin"}
    assert json.loads(tool["gen_ai.entity.output"]) == {"text": "world"}
    for node_type in ("question-classifier", "parameter-extractor", "agent"):
        task = attributes[node_type]
        assert task["gen_ai.span.kind"] == "TASK"
        assert json.loads(task["gen_ai.entity.input"]) == {"query": "hello"}
        assert json.loads(task["gen_ai.entity.output"]) == {"text": "world"}
        assert "gen_ai.completion" not in task


@pytest.mark.parametrize("saved_inputs", ["hello", [{"role": "user", "text": "hello"}]])
@pytest.mark.parametrize("tool_output", ["found", {"result": "found"}])
def test_recorded_message_tool_and_dataset_retrieval_native_values(
    saved_inputs: object, tool_output: JsonValue, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    queue = RecordingQueue()
    recorder = MessageTraceRecorder(
        source,
        queue,
        (
            TraceProviderSettings(
                tenant_id=source.tenant_id, app_id=source.app_id, provider_name="tencent", config_id=str(uuid4())
            ),
        ),
    )
    recorder.bind_message(str(uuid4()), str(uuid4()))
    recorder.record_operation("search", span_type="tool", inputs={"query": "hello"}, outputs=tool_output)
    recorder.record_operation(
        "dataset_retrieval",
        span_type="retrieval",
        inputs="hello",
        outputs={"documents": [Document(page_content="world", metadata={"dataset_id": "dataset", "score": 0.0})]},
    )
    record_basic_chat_result(recorder, {**message_fields(recorder), "inputs": saved_inputs})
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    root, llm, tool, retrieval = export_spans(trace, monkeypatch)
    root_attributes = {item.key: item.value.string_value for item in root.attributes}
    assert root_attributes["gen_ai.entity.input"] == str(saved_inputs)
    assert root_attributes["gen_ai.entity.output"] == "answer"
    llm_attributes = {item.key: item.value.string_value for item in llm.attributes}
    assert llm_attributes["gen_ai.completion"] == llm_attributes["gen_ai.entity.output"] == "answer"
    assert {item.key: item.value.string_value for item in tool.attributes}["gen_ai.entity.output"] == str(tool_output)
    retrieval_attributes = {item.key: item.value.string_value for item in retrieval.attributes}
    assert retrieval_attributes["retrieval.query"] == retrieval_attributes["gen_ai.entity.input"] == "hello"
    assert retrieval_attributes["retrieval.document"] == retrieval_attributes["gen_ai.entity.output"]
    assert json.loads(retrieval_attributes["retrieval.document"]) == [
        {"content": "world", "metadata": {"dataset_id": "dataset", "doc_id": None, "document_id": None}, "score": 0.0}
    ]


@pytest.mark.parametrize("mode", ["basic", "completion"])
@pytest.mark.parametrize(
    ("stream", "ttft", "message_streaming", "generation_streaming"),
    [
        (True, None, True, True),
        (True, 0.0, True, True),
        (False, None, False, False),
        (False, 0.5, False, True),
        (False, 0.0, False, True),
        (False, False, False, False),
        (None, None, False, False),
        (None, 0.5, True, True),
        (None, 0.0, True, True),
        (None, False, True, True),
    ],
)
def test_recorded_message_streaming_marker_preserves_request_flag(
    mode: str,
    stream: bool | None,
    ttft: float | None,
    message_streaming: bool,
    generation_streaming: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    queue = RecordingQueue()
    recorder = MessageTraceRecorder(
        source,
        queue,
        (
            TraceProviderSettings(
                tenant_id=source.tenant_id, app_id=source.app_id, provider_name="tencent", config_id=str(uuid4())
            ),
        ),
        attributes={"is_streaming_request": stream} if stream is not None else {},
    )
    recorder.bind_message(str(uuid4()), str(uuid4()))
    record_result = record_basic_chat_result if mode == "basic" else record_completion_result
    record_result(recorder, {**message_fields(recorder), "metadata": {"usage": {"time_to_first_token": ttft}}})
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    root, generation = export_spans(trace, monkeypatch)
    root_attributes = {item.key: item.value for item in root.attributes}
    assert root_attributes["gen_ai.is_entry"].string_value == "true"
    assert trace.spans[0].attributes["is_streaming_request"] is message_streaming
    if message_streaming:
        assert root_attributes["llm.is_streaming"].WhichOneof("value") == "string_value"
        assert root_attributes["llm.is_streaming"].string_value == "true"
    else:
        assert "llm.is_streaming" not in root_attributes
    generation_attributes = {item.key: item.value for item in generation.attributes}
    assert generation_attributes["llm.is_streaming"].WhichOneof("value") == "bool_value"
    assert generation_attributes["llm.is_streaming"].bool_value is generation_streaming
