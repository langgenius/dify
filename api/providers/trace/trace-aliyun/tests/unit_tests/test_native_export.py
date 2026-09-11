"""Aliyun receives valid GenAI messages and agent/tool projections."""

import json

import pytest
from dify_trace_aliyun.aliyun_trace import create_trace_client, gen_ai_messages
from pydantic import JsonValue

from core.ops.trace_data import copy_trace_value
from core.rag.models.document import Document
from graphon.variables.segments import ArrayObjectSegment
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace, provider_config


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
        for item in create_trace_client(provider_config("aliyun")).build_span(trace, retrieval).attributes
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
    assert json.loads(attributes["output.value"].string_value) == outputs


@pytest.mark.parametrize("outputs", [{"result": []}, {"documents": []}, {}, None])
def test_retrieval_without_hits_has_no_documents(outputs: JsonValue) -> None:
    trace = make_completed_trace()
    retrieval = trace.spans[1].model_copy(update={"span_type": "retrieval", "outputs": outputs})
    attributes = {
        item.key: item.value
        for item in create_trace_client(provider_config("aliyun")).build_span(trace, retrieval).attributes
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
        item.key: item.value
        for item in create_trace_client(provider_config("aliyun")).build_span(trace, model).attributes
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
    client = create_trace_client(provider_config("aliyun"))
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
    assert json.loads(attributes["gen_ai.tool.call.result"]) == "Found"
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
