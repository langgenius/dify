"""OpenInference's native message and model fields are provider-owned."""

import json
from datetime import UTC, datetime
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from dify_trace_arize_phoenix.arize_phoenix_trace import create_trace_client
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from pydantic import JsonValue

from core.ops.message_trace import MessageTraceRecorder
from core.ops.provider_config import decrypt_provider_config, mask_provider_config
from core.ops.trace_data import CompletedTrace, copy_trace_value
from core.ops.workflow_trace import WorkflowTraceRecorder
from core.rag.models.document import Document
from graphon.engine_events import GraphRunSucceededEvent, NodeRunSucceededEvent
from graphon.node_events import NodeRunResult
from graphon.variables.segments import ArrayObjectSegment
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace
from tests.unit_tests.core.ops.test_workflow_trace_limits import start_node, workflow_node

# Pytest importlib mode resolves these hyphenated provider packages.
from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize("output_shape", ["workflow", "workflow_segment", "message"])
def test_workflow_and_message_retrieval_documents(provider: str, output_shape: str) -> None:
    trace = make_completed_trace()
    metadata = {"document_id": "document-1", "score": 0.0, "_source": "knowledge", "doc_metadata": {"author": "Dify"}}
    workflow_result = ArrayObjectSegment(value=[{"content": "Retrieved text", "title": "Guide", "metadata": metadata}])
    outputs = copy_trace_value(
        {"result": workflow_result if output_shape == "workflow_segment" else workflow_result.value}
        if output_shape != "message"
        else {"documents": [Document(page_content="Retrieved text", metadata=metadata)]}
    )
    retrieval = trace.spans[1].model_copy(update={"span_type": "retrieval", "outputs": outputs})
    attributes = {
        item.key: item.value
        for item in create_trace_client(provider, make_provider_config(provider))
        .build_span(trace, retrieval)
        .attributes
    }
    assert attributes["openinference.span.kind"].string_value == "RETRIEVER"
    assert attributes["retrieval.documents.0.document.id"].string_value == "document-1"
    assert attributes["retrieval.documents.0.document.content"].string_value == "Retrieved text"
    assert attributes["retrieval.documents.0.document.score"].double_value == 0.0
    assert json.loads(attributes["retrieval.documents.0.document.metadata"].string_value) == metadata
    assert "retrieval.documents.1.document.id" not in attributes
    assert json.loads(attributes["output.value"].string_value) == outputs


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize("outputs", [{"result": []}, {"documents": []}, {}, None])
def test_retrieval_without_hits_has_no_documents(provider: str, outputs: JsonValue) -> None:
    trace = make_completed_trace()
    retrieval = trace.spans[1].model_copy(update={"span_type": "retrieval", "outputs": outputs})
    attributes = create_trace_client(provider, make_provider_config(provider)).build_span(trace, retrieval).attributes
    assert not any(item.key.startswith("retrieval.documents.") for item in attributes)


def test_existing_encrypted_space_id_is_decrypted_for_export_and_masked_for_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    decrypt = Mock(return_value=["plain-api-key", "plain-space-id"])
    monkeypatch.setattr("core.helper.encrypter.batch_decrypt_token", decrypt)
    saved_config = {**make_provider_config("arize"), "api_key": "encrypted-api-key", "space_id": "encrypted-space-id"}

    settings = decrypt_provider_config("tenant-a", "arize", saved_config)
    client = create_trace_client("arize", settings)

    decrypt.assert_called_once_with("tenant-a", ["encrypted-api-key", "encrypted-space-id"])
    assert client.http.headers["api_key"] == "plain-api-key"
    assert client.http.headers["space_id"] == "plain-space-id"
    masked = mask_provider_config("arize", settings)
    assert masked["api_key"] != settings["api_key"]
    assert masked["space_id"] != settings["space_id"]


@pytest.mark.parametrize(
    ("provider", "expected_location"),
    [("arize", "https://app.arize.com/"), ("phoenix", "https://phoenix.example/projects/")],
)
def test_project_link_redirects_by_project_name(provider: str, expected_location: str) -> None:
    project = "Support / production & 研发"
    client = create_trace_client(provider, {**make_provider_config(provider), "project": project})
    url = urlsplit(client.get_project_url())
    assert f"{url.scheme}://{url.netloc}{url.path}" == expected_location
    assert parse_qs(url.query) == {"redirect_project_name": [project]}
    assert not url.fragment


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
def test_messages_tool_calls_parameters_metadata_and_text_mime_types(provider: str) -> None:
    trace = make_completed_trace()
    model = trace.spans[-1].model_copy(
        update={
            "inputs": [
                {"role": "system", "text": "Help the user"},
                {
                    "role": "assistant",
                    "tool_calls": [{"id": "call-1", "function": {"name": "search", "arguments": '{"q":"dify"}'}}],
                },
                {"role": "tool", "tool_call_id": "call-1", "text": "Found"},
            ],
            "outputs": "Answer",
            "source_workflow_version": "v2",
            "attributes": {
                "model_name": "model",
                "model_provider": "provider",
                "model_parameters": {"temperature": 0.2},
                "tags": ["production"],
            },
        }
    )
    attributes = {
        item.key: item.value
        for item in create_trace_client(provider, make_provider_config(provider)).build_span(trace, model).attributes
    }
    assert attributes["openinference.span.kind"].string_value == "LLM"
    assert attributes["llm.input_messages.0.message.role"].string_value == "system"
    assert attributes["llm.input_messages.0.message.content"].string_value == "Help the user"
    assert attributes["llm.input_messages.1.message.tool_calls.0.tool_call.id"].string_value == "call-1"
    assert attributes["llm.input_messages.1.message.tool_calls.0.tool_call.function.name"].string_value == "search"
    assert json.loads(
        attributes["llm.input_messages.1.message.tool_calls.0.tool_call.function.arguments"].string_value
    ) == {"q": "dify"}
    assert attributes["llm.input_messages.2.message.tool_call_id"].string_value == "call-1"
    assert attributes["llm.output_messages.0.message.content"].string_value == "Answer"
    assert attributes["llm.provider"].string_value == "provider"
    assert attributes["llm.model_name"].string_value == "model"
    assert json.loads(attributes["llm.invocation_parameters"].string_value) == {"temperature": 0.2}
    assert attributes["output.mime_type"].string_value == "text/plain"
    assert attributes["tag.tags"].array_value.values[0].string_value == "production"
    metadata = json.loads(attributes["metadata"].string_value)
    assert metadata["dify.tenant_id"] == trace.source.tenant_id
    assert metadata["dify.workflow.version"] == "v2"
    assert attributes["llm.cost.total"].double_value == 0.02


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
def test_captured_auxiliary_operation_categories(provider: str, monkeypatch: pytest.MonkeyPatch) -> None:
    source = make_completed_trace().source.model_copy(update={"message_id": str(uuid4())})
    submitted = Mock(return_value=True)
    recorder = MessageTraceRecorder(source, Mock(), ())
    monkeypatch.setattr(recorder, "submit_completed_trace", submitted)
    now = datetime.now(UTC)
    for operation in ("moderation", "suggested_question", "generate_name"):
        recorder.record_operation(
            operation,
            span_type="tool" if operation == "moderation" else "llm",
            inputs="Prompt",
            outputs="Answer",
            attributes={"operation_type": operation},
            timer={"start": now, "end": now},
            usage={"total_tokens": 8},
        )
    recorder.finish_message_trace(
        {
            "message_id": source.message_id,
            "conversation_id": str(uuid4()),
            "started_at": now,
            "ended_at": now,
        }
    )
    trace = CompletedTrace.model_validate_json(submitted.call_args.args[0].model_dump_json())
    client = create_trace_client(provider, make_provider_config(provider))
    send = Mock(return_value=b"")
    monkeypatch.setattr(client, "_send", send)
    client.export_trace(trace)
    spans = ExportTraceServiceRequest.FromString(send.call_args.args[1]).resource_spans[0].scope_spans[0].spans
    assert len(spans) == 4
    for span in spans[1:]:
        attrs = {item.key: item.value for item in span.attributes}
        assert attrs["openinference.span.kind"].string_value == ("CHAIN" if span.name == "generate_name" else "TOOL")
        assert attrs["llm.token_count.total"].int_value == 8


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize(
    ("session_id", "conversation_id"), [(None, None), (None, "conversation"), ("session", "conversation")]
)
def test_captured_workflow_session_fallback(
    provider: str,
    session_id: str | None,
    conversation_id: str | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_id = str(uuid4())
    conversation_id = str(uuid4()) if conversation_id else None
    source = make_completed_trace().source.model_copy(
        update={
            "operation_id": run_id,
            "workflow_run_id": run_id,
            "message_id": None,
            "session_id": session_id,
            "conversation_id": conversation_id,
        }
    )
    submitted = Mock(return_value=True)
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=submitted,
    )
    start_node(recorder, workflow_node(source))
    recorder.on_event(GraphRunSucceededEvent())
    recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted.call_args.args[0].model_dump_json())
    client = create_trace_client(provider, make_provider_config(provider))
    send = Mock(return_value=b"")
    monkeypatch.setattr(client, "_send", send)
    client.export_trace(trace)
    spans = ExportTraceServiceRequest.FromString(send.call_args.args[1]).resource_spans[0].scope_spans[0].spans
    assert len(spans) == 2
    for span in spans:
        attrs = {item.key: item.value for item in span.attributes}
        assert attrs["session.id"].string_value == (session_id or conversation_id or run_id)


@pytest.mark.parametrize("provider", ["arize", "phoenix"])
@pytest.mark.parametrize("node_type", ["llm", "question-classifier", "parameter-extractor"])
@pytest.mark.parametrize("model_mode", ["chat", "completion", None])
def test_captured_workflow_model_categories(
    provider: str, node_type: str, model_mode: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    original_inputs = {"query": "Original query"}
    prompts = [{"role": "user", "content": "Rendered prompt"}]
    source = make_completed_trace().source
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
    assert trace.spans[-1].inputs == prompts
    client = create_trace_client(provider, make_provider_config(provider))
    send = Mock(return_value=b"")
    monkeypatch.setattr(client, "_send", send)
    client.export_trace(trace)
    spans = ExportTraceServiceRequest.FromString(send.call_args.args[1]).resource_spans[0].scope_spans[0].spans
    assert len(spans) == 2
    attrs = {item.key: item.value.string_value for item in spans[-1].attributes}
    assert attrs["openinference.span.kind"] == ("LLM" if node_type == "llm" else "CHAIN")
    assert json.loads(attrs["input.value"]) == (prompts if node_type == "llm" else original_inputs)
