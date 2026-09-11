"""Native categories, saved chat prompts and usage ownership on real recordings."""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, Mock
from uuid import uuid4

import httpx
import pytest
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from pydantic import JsonValue

from core.ops.basic_chat_trace import record_basic_chat_result
from core.ops.completion_trace import record_completion_result
from core.ops.legacy_agent_trace import record_legacy_agent_result
from core.ops.message_trace import MessageTraceRecorder
from core.ops.otlp_trace import OtlpTraceClient
from core.ops.trace_data import CompletedTrace, TraceProviderSettings, TraceSource
from core.ops.workflow_trace import WorkflowTraceRecorder
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from extensions import ext_database
from graphon.engine_events import GraphRunSucceededEvent, NodeRunFailedEvent, NodeRunRetryEvent, NodeRunSucceededEvent
from graphon.model_runtime.entities import AssistantPromptMessage, ToolPromptMessage, UserPromptMessage
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult
from models.enums import CreatorUserRole
from models.model import MessageAgentThought
from tests.unit_tests.core.ops.test_message_trace import RecordingQueue, message_fields
from tests.unit_tests.core.ops.test_workflow_trace_limits import start_node, workflow_node

from .test_export_contract import make_provider_config  # pyrefly: ignore[missing-import]
from .test_native_export import read_attribute_value  # pyrefly: ignore[missing-import]


def export_attributes(
    provider: str, trace: CompletedTrace, monkeypatch: pytest.MonkeyPatch
) -> list[dict[str, JsonValue]]:
    original = trace.model_dump_json()
    client = MLflowTraceClient(provider, make_provider_config(provider))
    if provider == "databricks":
        request = Mock(
            side_effect=[
                httpx.Response(200, json={}),
                httpx.Response(200, json={"credential_info": {"signed_uri": "https://storage.example/trace"}}),
            ]
        )
        upload = Mock()
        monkeypatch.setattr(client.http, "request", request)
        monkeypatch.setattr(client, "_upload_spans", upload)
        client.export_trace(trace)
        spans = json.loads(upload.call_args.args[1])["spans"]
        attributes = [{key: json.loads(value) for key, value in span["attributes"].items()} for span in spans]
        native_total = sum(
            usage.get("total_tokens", 0)
            for span in attributes
            if isinstance(usage := span.get("mlflow.chat.tokenUsage"), dict)
        )
        metadata = request.call_args_list[0].kwargs["json"]["trace"]["trace_info"]["trace_metadata"]
        assert json.loads(metadata.get("mlflow.trace.tokenUsage", "{}")).get("total_tokens", 0) == native_total
    else:
        send = Mock()
        monkeypatch.setattr(client, "_register_trace_metadata", Mock())
        monkeypatch.setattr(OtlpTraceClient, "send_traces", send)
        client.export_trace(trace)
        request = ExportTraceServiceRequest.FromString(send.call_args.args[0].SerializeToString())
        attributes = [
            {item.key: read_attribute_value(item.value) for item in span.attributes}
            for span in request.resource_spans[0].scope_spans[0].spans
        ]
    assert trace.model_dump_json() == original
    return attributes


def message_recorder(provider: str) -> tuple[MessageTraceRecorder, RecordingQueue]:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    queue = RecordingQueue()
    recorder = MessageTraceRecorder(
        source,
        queue,
        (
            TraceProviderSettings(
                tenant_id=source.tenant_id, app_id=source.app_id, provider_name=provider, config_id=str(uuid4())
            ),
        ),
    )
    recorder.bind_message(str(uuid4()), str(uuid4()))
    return recorder, queue


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
def test_recorded_concrete_node_and_auxiliary_categories(provider: str, monkeypatch: pytest.MonkeyPatch) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    expected_types = {
        "llm": "LLM",
        "question-classifier": "LLM",
        "knowledge-retrieval": "RETRIEVER",
        "tool": "TOOL",
        "code": "TOOL",
        "http-request": "TOOL",
        "agent": "AGENT",
        "parameter-extractor": "CHAIN",
        "template-transform": "CHAIN",
    }
    for node_type in expected_types:
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
                node_run_result=NodeRunResult(outputs={"text": "answer"}),
            )
        )
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    attributes = export_attributes(provider, trace, monkeypatch)
    assert [span["mlflow.spanType"] for span in attributes] == ["CHAIN", *expected_types.values()]

    message, queue = message_recorder(provider)
    for operation in ("suggested_question", "generate_name"):
        message.record_operation(
            operation,
            span_type="llm",
            inputs="hello",
            outputs="answer",
            attributes={"operation_type": operation},
        )
    message.finish_message_trace(message_fields(message))
    operations = export_attributes(provider, CompletedTrace.model_validate_json(queue.items[0].trace_json), monkeypatch)
    assert [span["mlflow.spanType"] for span in operations] == ["LLM", "TOOL", "CHAIN"]


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
@pytest.mark.parametrize("mode", ["basic", "completion", "legacy"])
@pytest.mark.parametrize("existing_id", [False, True])
def test_recorded_messages_preserve_chat_and_count_parent_usage_once(
    provider: str, mode: str, existing_id: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    recorder, queue = message_recorder(provider)
    saved = PromptMessageUtil.prompt_messages_to_prompt_for_saving(
        "chat",
        [
            UserPromptMessage(content="hello"),
            AssistantPromptMessage.model_validate(
                {
                    "content": "",
                    "tool_calls": [
                        {"id": "call-1", "type": "function", "function": {"name": "first", "arguments": "{}"}},
                        {"id": "call-2", "type": "function", "function": {"name": "second", "arguments": "{}"}},
                    ],
                }
            ),
            ToolPromptMessage(content="first result", tool_call_id="call-1"),
            ToolPromptMessage(content="second result", tool_call_id="call-2"),
        ],
    )
    assert "tool_call_id" not in saved[2]
    prompts = [dict(message) for message in saved]
    if existing_id:
        prompts[2]["tool_call_id"] = "call-2"
    fields = {
        **message_fields(recorder),
        "inputs": prompts,
        "prompt_tokens": 3,
        "completion_tokens": 5,
        "total_price": "0.02",
        "currency": "USD",
    }
    if mode == "legacy":
        assert recorder.source.message_id is not None
        thought = MessageAgentThought(
            message_id=recorder.source.message_id,
            position=1,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid4()),
            message="",
            thought="reasoning",
            answer="answer",
            tool="search",
            tool_input="{}",
            observation="found",
            message_files="[]",
            latency=0.1,
            message_token=3,
            answer_token=5,
            tokens=8,
            total_price=Decimal("0.02"),
            currency="USD",
        )
        thought.created_at = datetime.now(UTC)
        session_scope = MagicMock()
        session_scope.__enter__.return_value.scalars.return_value = [thought]
        monkeypatch.setattr("sqlalchemy.orm.Session", Mock(return_value=session_scope))
        monkeypatch.setattr(ext_database, "db", Mock(engine=Mock()))
        record_legacy_agent_result(recorder, fields)
    elif mode == "basic":
        record_basic_chat_result(recorder, fields)
    else:
        record_completion_result(recorder, fields)
    trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    assert len(trace.spans) == 2
    attributes = export_attributes(provider, trace, monkeypatch)
    root, child = attributes
    assert root["mlflow.spanType"] == "LLM"
    assert root["mlflow.message.format"] == "openai"
    inputs = root["mlflow.spanInputs"]
    assert isinstance(inputs, dict)
    messages = inputs["messages"]
    assert isinstance(messages, list)
    assert len(messages) == 4
    assert [message["tool_call_id"] for message in messages[2:] if isinstance(message, dict)] == (
        ["call-2", "call-1"] if existing_id else ["call-1", "call-2"]
    )
    assert "tool_call_id" not in prompts[3]
    assert root["mlflow.spanOutputs"] == {
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "answer"}}]
    }
    assert root["mlflow.chat.tokenUsage"] == {"input_tokens": 3, "output_tokens": 5, "total_tokens": 8}
    assert root["mlflow.llm.cost"] == {"total_cost": 0.02}
    assert "mlflow.chat.tokenUsage" not in child
    assert "mlflow.llm.cost" not in child
    assert child["dify.usage"] == trace.spans[1].usage


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
def test_recorded_chatflow_workflow_owns_message_aggregate_usage(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    message, queue = message_recorder(provider)
    workflow = message.create_workflow_trace(
        workflow_id="workflow",
        workflow_version="1",
        workflow_run_id=str(uuid4()),
        inputs={},
    )
    node = workflow_node(workflow.source, node_type="llm")
    start_node(workflow, node)
    started = datetime.now(UTC)
    workflow.on_event(
        NodeRunSucceededEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type="llm",
            start_at=started,
            finished_at=started + timedelta(seconds=1),
            node_run_result=NodeRunResult(
                llm_usage=LLMUsage.empty_usage().model_copy(
                    update={
                        "prompt_tokens": 3,
                        "completion_tokens": 5,
                        "total_tokens": 8,
                        "total_price": Decimal("0.02"),
                    }
                ),
                outputs={"text": "answer"},
            ),
        )
    )
    workflow.on_event(GraphRunSucceededEvent())
    assert workflow.finish_workflow_trace()
    message.finish_message_trace(
        {**message_fields(message), "prompt_tokens": 3, "completion_tokens": 5, "total_price": "0.02"}
    )
    workflow_trace, message_trace = [CompletedTrace.model_validate_json(item.trace_json) for item in queue.items]
    root = export_attributes(provider, message_trace, monkeypatch)[0]
    assert root["mlflow.spanType"] == "LLM"
    assert "mlflow.chat.tokenUsage" not in root
    assert "mlflow.llm.cost" not in root
    model = export_attributes(provider, workflow_trace, monkeypatch)[1]
    assert model["mlflow.chat.tokenUsage"] == {"input_tokens": 3, "output_tokens": 5, "total_tokens": 8}
    costs = model["mlflow.llm.cost"]
    assert isinstance(costs, dict)
    assert costs["total_cost"] == 0.02


@pytest.mark.parametrize("provider", ["mlflow", "databricks"])
def test_recorded_llm_retries_count_calls_without_counting_the_node_container(
    provider: str, monkeypatch: pytest.MonkeyPatch
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
    start_node(recorder, node)
    started = datetime.now(UTC)
    result = NodeRunResult(
        llm_usage=LLMUsage.empty_usage().model_copy(
            update={
                "prompt_tokens": 3,
                "completion_tokens": 5,
                "total_tokens": 8,
                "total_price": Decimal("0.02"),
            }
        ),
        outputs={"text": "answer"},
    )
    recorder.on_event(
        NodeRunFailedEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type="llm",
            start_at=started,
            error="retry",
            node_run_result=result,
        )
    )
    recorder.on_event(
        NodeRunRetryEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type="llm",
            node_title=node.title,
            start_at=started,
            retry_index=1,
            error="retry",
            node_run_result=result,
        )
    )
    recorder.on_event(
        NodeRunSucceededEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type="llm",
            start_at=started,
            finished_at=started + timedelta(seconds=1),
            node_run_result=result,
        )
    )
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    root, node_span, failed, succeeded = export_attributes(provider, trace, monkeypatch)
    assert [span["mlflow.spanType"] for span in (root, node_span, failed, succeeded)] == ["CHAIN", "LLM", "LLM", "LLM"]
    assert "mlflow.chat.tokenUsage" not in node_span
    assert "mlflow.llm.cost" not in node_span
    for span in (failed, succeeded):
        assert span["mlflow.chat.tokenUsage"] == {"input_tokens": 3, "output_tokens": 5, "total_tokens": 8}
        costs = span["mlflow.llm.cost"]
        assert isinstance(costs, dict)
        assert costs["total_cost"] == 0.02
