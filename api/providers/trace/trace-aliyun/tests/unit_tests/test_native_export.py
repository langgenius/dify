"""Aliyun receives valid GenAI messages and agent/tool projections."""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import pytest
from dify_trace_aliyun.aliyun_trace import create_trace_client, gen_ai_messages
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from pydantic import JsonValue

from core.ops.trace_data import CompletedTrace, TraceSource, copy_trace_value
from core.ops.workflow_trace import WorkflowTraceRecorder
from core.rag.models.document import Document
from graphon.engine_events import GraphRunSucceededEvent, NodeRunSucceededEvent
from graphon.node_events import NodeRunResult
from graphon.variables.segments import ArrayObjectSegment
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace
from tests.unit_tests.core.ops.test_workflow_trace_limits import start_node, workflow_node

# Pytest importlib mode resolves these hyphenated provider packages.
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize("output_shape", ["workflow", "workflow_segment", "message"])
def test_workflow_and_message_retrieval_documents(output_shape: str) -> None:
    trace = make_completed_trace()
    metadata = {"document_id": "document-1", "score": 0.0, "_source": "knowledge", "doc_metadata": {"author": "Dify"}}
    workflow_result = ArrayObjectSegment(value=[{"content": "Retrieved text", "title": "Guide", "metadata": metadata}])
    outputs = copy_trace_value(
        {"result": workflow_result if output_shape == "workflow_segment" else workflow_result.value}
        if output_shape != "message"
        else {"documents": [Document(page_content="Retrieved text", metadata=metadata)]}
    )
    retrieval = trace.spans[1].model_copy(
        update={"span_type": "retrieval", "inputs": {"query": "Find guide"}, "outputs": outputs}
    )
    attributes = {
        item.key: item.value
        for item in create_trace_client(make_provider_config()).build_span(trace, retrieval).attributes
    }
    documents = json.loads(attributes["gen_ai.retrieval.documents"].string_value)
    assert len(documents) == 1
    document = documents[0]["document"] if output_shape != "message" else documents[0]
    assert document["content"] == "Retrieved text"
    assert document["id"] == "document-1"
    assert document["score"] == 0.0
    assert document["metadata"]["doc_metadata"] == {"author": "Dify"}
    if output_shape != "message":
        assert document["metadata"]["title"] == "Guide"
        assert document["metadata"]["source"] == "knowledge"
        assert document["metadata"]["author"] == "Dify"
    assert attributes["gen_ai.retrieval.query.text"].string_value == "Find guide"
    assert attributes["input.value"].string_value == attributes["retrieval.query"].string_value == "Find guide"
    if output_shape != "message":
        assert json.loads(attributes["output.value"].string_value) == workflow_result.value
        assert json.loads(attributes["retrieval.document"].string_value) == documents
    else:
        expected = [
            {
                "content": "Retrieved text",
                "metadata": {"dataset_id": None, "doc_id": None, "document_id": "document-1"},
                "score": 0.0,
            }
        ]
        assert json.loads(attributes["output.value"].string_value) == expected
        assert json.loads(attributes["retrieval.document"].string_value) == expected


@pytest.mark.parametrize("outputs", [{"result": []}, {"documents": []}, {}, None])
def test_retrieval_without_hits_has_no_documents(outputs: JsonValue) -> None:
    trace = make_completed_trace()
    retrieval = trace.spans[1].model_copy(update={"span_type": "retrieval", "outputs": outputs})
    attributes = {
        item.key: item.value
        for item in create_trace_client(make_provider_config()).build_span(trace, retrieval).attributes
    }
    assert json.loads(attributes["gen_ai.retrieval.documents"].string_value) == []


def test_llm_messages_model_parameters_usage_and_finish_reason() -> None:
    trace = make_completed_trace()
    model = trace.spans[-1].model_copy(
        update={
            "inputs": [
                {"role": "user", "text": "Find a document"},
                {
                    "role": "assistant",
                    "tool_calls": [
                        {"id": "call-1", "function": {"name": "search", "arguments": '{"query":"document"}'}}
                    ],
                },
                {"role": "tool", "tool_call_id": "call-1", "text": "Found"},
            ],
            "outputs": {"text": "Here it is", "finish_reason": "stop"},
            "attributes": {
                "model_name": "model",
                "model_provider": "provider",
                "model_parameters": {"temperature": 0.2},
            },
            "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8, "time_to_first_token": 0.25},
        }
    )
    attributes = {
        item.key: item.value for item in create_trace_client(make_provider_config()).build_span(trace, model).attributes
    }
    messages = json.loads(attributes["gen_ai.input.messages"].string_value)
    assert messages == [
        {"role": "user", "parts": [{"type": "text", "content": "Find a document"}]},
        {
            "role": "assistant",
            "parts": [{"type": "tool_call", "id": "call-1", "name": "search", "arguments": {"query": "document"}}],
        },
        {"role": "tool", "parts": [{"type": "tool_call_response", "id": "call-1", "result": "Found"}]},
    ]
    assert json.loads(attributes["gen_ai.output.messages"].string_value) == [
        {"role": "assistant", "parts": [{"type": "text", "content": "Here it is"}], "finish_reason": "stop"}
    ]
    assert attributes["gen_ai.request.model"].string_value == "model"
    assert attributes["gen_ai.provider.name"].string_value == "provider"
    assert attributes["gen_ai.request.temperature"].double_value == 0.2
    assert attributes["gen_ai.usage.input_tokens"].int_value == 3
    assert attributes["gen_ai.response.time_to_first_token"].int_value == 250_000_000
    assert attributes["gen_ai.response.finish_reasons"].array_value.values[0].string_value == "stop"


def test_existing_parts_are_not_mutated_when_projecting_tool_calls() -> None:
    messages: list[JsonValue] = [
        {
            "role": "assistant",
            "parts": [{"type": "text", "content": "Looking"}],
            "tool_calls": [{"id": "call", "function": {"name": "search", "arguments": "{}"}}],
        }
    ]
    original = json.dumps(messages)
    gen_ai_messages(messages, "assistant")
    assert json.dumps(messages) == original


def test_agent_round_tool_and_skill_fields_survive_generic_capture() -> None:
    trace = make_completed_trace()
    client = create_trace_client(make_provider_config())
    round_span = trace.spans[1].model_copy(
        update={"span_type": "agent", "span_name": "ROUND 2", "status": "error", "error": "failed"}
    )
    round_attributes = {item.key: item.value for item in client.build_span(trace, round_span).attributes}
    assert round_attributes["gen_ai.span.kind"].string_value == "STEP"
    assert round_attributes["gen_ai.operation.name"].string_value == "react"
    assert round_attributes["gen_ai.react.round"].int_value == 2
    assert round_attributes["gen_ai.react.finish_reason"].string_value == "error"
    tool = trace.spans[1].model_copy(
        update={
            "span_name": "CALL search",
            "inputs": None,
            "attributes": {"provider_type": "datastore", "skill_id": "skill-1", "skill_name": "research"},
            "outputs": {"tool_name": "search", "tool_call_args": {"query": "document"}, "output": "Found"},
        }
    )
    attributes = {item.key: item.value.string_value for item in client.build_span(trace, tool).attributes}
    assert attributes["gen_ai.tool.name"] == "search"
    assert attributes["gen_ai.tool.type"] == "datastore"
    assert json.loads(attributes["gen_ai.tool.call.arguments"]) == {"query": "document"}
    assert attributes["gen_ai.tool.call.result"] == attributes["output.value"] == "Found"
    assert attributes["gen_ai.skill.id"] == "skill-1"
    assert attributes["gen_ai.skill.name"] == "research"
    thought = trace.spans[-1].model_copy(
        update={
            "span_name": "model-name Thought",
            "attributes": {"provider": "plugin-provider", "metrics_from_parent": True},
            "outputs": {"thought": "Thinking"},
        }
    )
    thought_attributes = {item.key: item.value.string_value for item in client.build_span(trace, thought).attributes}
    assert thought_attributes["gen_ai.request.model"] == "model-name"
    assert thought_attributes["gen_ai.provider.name"] == "plugin-provider"


@pytest.mark.parametrize(
    ("data", "completion"),
    [
        ({"thought": "Thinking", "action": "search"}, "Thinking"),
        ({"thought": "", "action": "search"}, "search"),
        ({"action": {"tool": "search"}}, "{'tool': 'search'}"),
        ({"text": "Answer"}, "Answer"),
        ({}, ""),
    ],
)
def test_recorded_agent_thought_preserves_completion_aliases(
    data: dict[str, JsonValue], completion: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id="user")
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
                            "id": "thought",
                            "label": "model Thought",
                            "status": "success",
                            "data": data,
                            "metadata": {"provider": "plugin-provider"},
                        }
                    ]
                }
            ),
        )
    )
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    thought = next(span for span in trace.spans if span.span_type == "llm")
    assert thought.outputs == data

    client = create_trace_client(make_provider_config())
    send_traces = Mock()
    monkeypatch.setattr(client, "send_traces", send_traces)
    client.export_trace(trace)
    request = ExportTraceServiceRequest.FromString(send_traces.call_args.args[0].SerializeToString())
    exported = next(span for span in request.resource_spans[0].scope_spans[0].spans if span.name == "model Thought")
    attributes = {item.key: item.value.string_value for item in exported.attributes}
    assert attributes["gen_ai.completion"] == completion
    assert attributes["gen_ai.request.model"] == "model"
    assert attributes["gen_ai.provider.name"] == "plugin-provider"
