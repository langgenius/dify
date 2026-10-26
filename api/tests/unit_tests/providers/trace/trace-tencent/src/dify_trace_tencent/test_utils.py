"""Pure legacy Tencent session regressions; IDs here are builder-local IDs."""

from datetime import UTC, datetime, timedelta

import pytest
from dify_trace_tencent.entities.tencent_trace_entity import SpanData
from dify_trace_tencent.span_builder import TencentSpanBuilder
from dify_trace_tencent.utils import TencentTraceUtils
from opentelemetry.trace import StatusCode
from pydantic import ValidationError

from core.ops.entities.trace_entity import WorkflowTraceInfo
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus

RUN_ID = "00000000-0000-4000-8000-000000000001"
WORKFLOW_ID = "00000000-0000-4000-8000-000000000002"
TENANT_ID = "00000000-0000-4000-8000-000000000003"
STARTED = datetime(2026, 10, 17, tzinfo=UTC)


def workflow_trace(metadata: dict[str, object]) -> WorkflowTraceInfo:
    session_id = metadata.get("conversation_id")
    return WorkflowTraceInfo(
        workflow_id=WORKFLOW_ID,
        tenant_id=TENANT_ID,
        workflow_run_id=RUN_ID,
        workflow_run_elapsed_time=3.0,
        workflow_run_status="succeeded",
        workflow_run_inputs={"query": "synthetic input"},
        workflow_run_outputs={"answer": "synthetic answer"},
        workflow_run_version="1",
        error="",
        total_tokens=32,
        prompt_tokens=13,
        completion_tokens=19,
        file_list=[],
        query="synthetic input",
        metadata=metadata,
        conversation_id=session_id if isinstance(session_id, str) else None,
        start_time=STARTED,
        end_time=STARTED + timedelta(seconds=3),
    )


def workflow_node(node_type: str, index: int = 1) -> WorkflowNodeExecution:
    return WorkflowNodeExecution(
        id=f"00000000-0000-4000-8000-{index + 10:012d}",
        workflow_id=WORKFLOW_ID,
        workflow_execution_id=RUN_ID,
        index=index,
        node_id=f"node-{index}",
        node_type=node_type,
        title={BuiltinNodeTypes.START: "Start", BuiltinNodeTypes.END: "End"}.get(node_type, "Synthetic node"),
        inputs={"query": "synthetic input"},
        process_data={"model_name": "synthetic-model", "model_provider": "synthetic-provider"},
        outputs={
            "text": "synthetic answer",
            "usage": {"prompt_tokens": 13, "completion_tokens": 19, "total_tokens": 32},
            "finish_reason": "stop",
        },
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        created_at=STARTED + timedelta(seconds=index - 1),
        finished_at=STARTED + timedelta(seconds=index),
    )


def build_node_span(trace: WorkflowTraceInfo, node: WorkflowNodeExecution) -> SpanData:
    trace_id = TencentTraceUtils.convert_to_trace_id(trace.workflow_run_id)
    workflow_span_id = TencentTraceUtils.convert_to_span_id(trace.workflow_run_id, "workflow")
    if node.node_type == BuiltinNodeTypes.LLM:
        return TencentSpanBuilder.build_workflow_llm_span(trace_id, workflow_span_id, trace, node)
    if node.node_type == BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL:
        return TencentSpanBuilder.build_workflow_retrieval_span(trace_id, workflow_span_id, trace, node)
    return TencentSpanBuilder.build_workflow_task_span(trace_id, workflow_span_id, trace, node)


@pytest.mark.parametrize(
    "node_type", [BuiltinNodeTypes.START, BuiltinNodeTypes.LLM, BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL]
)
@pytest.mark.parametrize(
    ("metadata", "expected_session"),
    [
        pytest.param({}, "", id="missing"),
        pytest.param({"conversation_id": None}, "", id="none"),
        pytest.param({"conversation_id": ""}, "", id="empty"),
        pytest.param({"conversation_id": "owned-conversation"}, "owned-conversation", id="conversation"),
    ],
)
def test_workflow_builders_accept_optional_sessions_without_rewriting_metadata(
    node_type: str, metadata: dict[str, object], expected_session: str
) -> None:
    trace = workflow_trace(metadata)
    before = dict(trace.metadata)

    span = build_node_span(trace, workflow_node(node_type))

    assert span.attributes["gen_ai.session.id"] == expected_session
    assert trace.metadata == before


def complete_workflow_spans(trace: WorkflowTraceInfo) -> list[SpanData]:
    spans = TencentSpanBuilder.build_workflow_spans(
        trace, TencentTraceUtils.convert_to_trace_id(trace.workflow_run_id), "synthetic-user"
    )
    spans.extend(
        build_node_span(trace, workflow_node(node_type, index))
        for index, node_type in enumerate((BuiltinNodeTypes.START, BuiltinNodeTypes.LLM, BuiltinNodeTypes.END), start=1)
    )
    return spans


def assert_usage_is_not_duplicated(spans: list[SpanData]) -> None:
    generations = [span for span in spans if span.attributes.get("gen_ai.span.kind") == "GENERATION"]
    assert len(generations) == 1
    generation = generations[0]
    assert generation.attributes["gen_ai.usage.input_tokens"] == "13"
    assert generation.attributes["gen_ai.usage.output_tokens"] == "19"
    assert generation.attributes["gen_ai.usage.total_tokens"] == "32"
    assert sum(int(span.attributes.get("gen_ai.usage.total_tokens", "0")) for span in spans) == 32


def test_workflow_without_conversation_keeps_start_llm_end_under_one_root() -> None:
    trace = workflow_trace({"conversation_id": None})

    spans = complete_workflow_spans(trace)

    assert [span.name for span in spans] == ["workflow", "Start", "GENERATION", "End"]
    root = spans[0]
    assert root.parent_span_id is None
    assert all(span.parent_span_id == root.span_id for span in spans[1:])
    assert all(span.trace_id == root.trace_id for span in spans)
    assert len({span.span_id for span in spans}) == 4
    assert all(span.attributes["gen_ai.session.id"] == "" for span in spans[1:])
    assert trace.metadata["conversation_id"] is None
    assert_usage_is_not_duplicated(spans)


def test_chatflow_keeps_conversation_and_message_workflow_parent_layer() -> None:
    trace = workflow_trace({"conversation_id": "owned-conversation"})

    spans = complete_workflow_spans(trace)

    assert [span.name for span in spans] == ["message", "workflow", "Start", "GENERATION", "End"]
    message, workflow = spans[:2]
    assert message.parent_span_id is None
    assert workflow.parent_span_id == message.span_id
    assert all(span.parent_span_id == workflow.span_id for span in spans[2:])
    assert all(span.trace_id == message.trace_id for span in spans)
    assert len({span.span_id for span in spans}) == 5
    assert message.attributes["gen_ai.session.id"] == "owned-conversation"
    assert all(span.attributes["gen_ai.session.id"] == "owned-conversation" for span in spans[2:])
    assert_usage_is_not_duplicated(spans)


@pytest.mark.parametrize("status", [WorkflowNodeExecutionStatus.FAILED, WorkflowNodeExecutionStatus.EXCEPTION])
def test_error_status_and_description_survive_missing_session(status: WorkflowNodeExecutionStatus) -> None:
    trace = workflow_trace({"conversation_id": None})
    trace.error = "synthetic workflow failure"
    trace.workflow_run_status = "failed"
    node = workflow_node(BuiltinNodeTypes.LLM)
    node.status = status
    node.error = "synthetic node failure"

    root = TencentSpanBuilder.build_workflow_spans(
        trace, TencentTraceUtils.convert_to_trace_id(trace.workflow_run_id), "synthetic-user"
    )[0]
    span = build_node_span(trace, node)

    assert root.status.status_code == StatusCode.ERROR
    assert root.status.description == "synthetic workflow failure"
    assert span.status.status_code == StatusCode.ERROR
    assert span.status.description == "synthetic node failure"
    assert span.parent_span_id == root.span_id
    assert span.attributes["gen_ai.session.id"] == ""
    assert_usage_is_not_duplicated([root, span])


@pytest.mark.parametrize(
    "node_type", [BuiltinNodeTypes.START, BuiltinNodeTypes.LLM, BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL]
)
@pytest.mark.parametrize(
    "invalid_session", [0, False, [], {}, 123], ids=["zero", "false", "empty-list", "empty-map", "int"]
)
def test_non_string_sessions_remain_validation_errors(node_type: str, invalid_session: object) -> None:
    trace = workflow_trace({"conversation_id": invalid_session})

    with pytest.raises(ValidationError) as caught:
        build_node_span(trace, workflow_node(node_type))

    errors = caught.value.errors(include_input=False, include_url=False)
    assert len(errors) == 1
    assert errors[0]["loc"] == ("attributes", "gen_ai.session.id")
    assert errors[0]["type"] == "string_type"
