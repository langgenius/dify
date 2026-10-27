from datetime import UTC, datetime, timedelta
from decimal import Decimal

from dify_trace_sdk.ids import span_id_for, trace_id_for
from dify_trace_sdk.model import SpanKind, SpanStatus

from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from models.model import Message
from models.workflow import WorkflowRun
from services.tracing.canonical import CanonicalTraceBuilder, message_trace_id
from services.tracing.records import (
    MessageTraceInfo,
    PromptGenerationTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)

STARTED_AT = datetime(2026, 1, 1, 8, 0, 0)
MESSAGE_ID = "6f1c0b52-6ad4-4c4e-9d7c-2a3f0d0c7a11"
CONVERSATION_ID = "0b7f86a3-5f8e-4d51-a4c5-6a8b2f1b6e22"
WORKFLOW_RUN_ID = "4b4b8c2e-1a0f-4bd0-93c1-0f2f0e9d6a33"


def _message() -> Message:
    message = Message(
        id=MESSAGE_ID,
        app_id="app-1",
        conversation_id=CONVERSATION_ID,
        query="What is Dify?",
        answer="An LLM app platform.",
        model_provider="openai",
        model_id="gpt-4o",
        total_price=Decimal("0.0042"),
        currency="USD",
        error=None,
    )
    message.created_at = STARTED_AT
    return message


def _message_record(**metadata: object) -> MessageTraceInfo:
    return MessageTraceInfo(
        message_id=MESSAGE_ID,
        message_data=_message(),
        inputs=[{"role": "user", "text": "What is Dify?"}],
        outputs="An LLM app platform.",
        start_time=STARTED_AT,
        end_time=STARTED_AT + timedelta(seconds=2),
        metadata={"user_id": "account-1", **metadata},
        trace_id=None,
        conversation_model="chat",
        message_tokens=12,
        answer_tokens=8,
        total_tokens=20,
        error=None,
        file_list=[],
        conversation_mode="chat",
        gen_ai_server_time_to_first_token=0.4,
        llm_streaming_time_to_generate=1.2,
        is_streaming_request=True,
    )


def _node(execution_id: str, node_type: str, *, index: int, offset: int, **fields: object) -> WorkflowNodeExecution:
    return WorkflowNodeExecution.model_validate(
        {
            "id": execution_id,
            "workflow_id": "workflow-1",
            "workflow_execution_id": WORKFLOW_RUN_ID,
            "index": index,
            "node_id": f"node-{index}",
            "node_type": node_type,
            "title": node_type.upper(),
            "status": WorkflowNodeExecutionStatus.SUCCEEDED,
            "created_at": STARTED_AT + timedelta(seconds=offset),
            "finished_at": STARTED_AT + timedelta(seconds=offset + 1),
            **fields,
        }
    )


def _workflow_run() -> WorkflowRun:
    run = WorkflowRun(id=WORKFLOW_RUN_ID, finished_at=STARTED_AT + timedelta(seconds=3))
    run.created_at = STARTED_AT
    return run


def _workflow_record(*, message_id: str | None, metadata: dict[str, object]) -> WorkflowTraceInfo:
    llm = _node(
        "exec-llm",
        BuiltinNodeTypes.LLM,
        index=2,
        offset=1,
        process_data={
            "prompts": [{"role": "user", "text": "hi"}],
            "model_name": "gpt-4o",
            "model_provider": "openai",
            "usage": {"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12, "time_to_first_token": -1},
        },
        outputs={"text": "hello"},
        metadata={WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 0.01, WorkflowNodeExecutionMetadataKey.CURRENCY: "USD"},
    )
    start = _node("exec-start", BuiltinNodeTypes.START, index=1, offset=0, inputs={"query": "hi"})
    return WorkflowTraceInfo(
        message_id=message_id,
        workflow_data=_workflow_run(),
        node_executions=[llm, start],
        conversation_id=CONVERSATION_ID if message_id else None,
        message_started_at=STARTED_AT - timedelta(seconds=1) if message_id else None,
        workflow_app_log_id=None,
        workflow_id="workflow-1",
        tenant_id="tenant-1",
        workflow_run_id=WORKFLOW_RUN_ID,
        workflow_run_elapsed_time=3,
        workflow_run_status="succeeded",
        workflow_run_inputs={"query": "hi"},
        workflow_run_outputs={"answer": "hello"},
        workflow_run_version="1",
        error=None,
        total_tokens=12,
        prompt_tokens=5,
        completion_tokens=7,
        file_list=[],
        invoked_by=None,
        query="hi" if message_id else "",
        start_time=STARTED_AT,
        end_time=STARTED_AT + timedelta(seconds=3),
        metadata=metadata,
    )


def _tool_record(**metadata: object) -> ToolTraceInfo:
    return ToolTraceInfo(
        message_id=MESSAGE_ID,
        message_data=_message(),
        tool_name="web_search",
        tool_inputs={"q": "dify"},
        tool_outputs="results",
        error=None,
        tool_config={},
        time_cost=0.5,
        tool_parameters={"q": "dify"},
        file_url=None,
        start_time=STARTED_AT + timedelta(seconds=1),
        end_time=STARTED_AT + timedelta(seconds=2),
        metadata=dict(metadata),
    )


def test_message_record_becomes_a_root_span_with_one_llm_child() -> None:
    trace = CanonicalTraceBuilder().build(_message_record(end_user_session_id="customer-42"))

    assert trace is not None
    assert trace.trace_id == message_trace_id(None, MESSAGE_ID) == trace_id_for(MESSAGE_ID)
    assert trace.session_id == CONVERSATION_ID
    assert trace.user_id == "customer-42"
    root, llm = trace.spans
    assert (root.span_id, root.parent_span_id, root.name) == (span_id_for(MESSAGE_ID), None, "message")
    assert llm.parent_span_id == root.span_id
    assert llm.kind is SpanKind.LLM
    assert (llm.model_name, llm.model_provider) == ("gpt-4o", "openai")
    assert llm.usage is not None
    assert (llm.usage.prompt_tokens, llm.usage.completion_tokens) == (12, 8)
    assert llm.cost is not None
    assert llm.cost.currency == "USD"
    assert llm.time_to_first_token == 0.4
    assert root.start_time.tzinfo is UTC


def test_caller_trace_id_names_the_trace_and_is_kept_verbatim() -> None:
    record = _message_record().model_copy(update={"trace_id": "caller-trace"})

    trace = CanonicalTraceBuilder().build(record)

    assert trace is not None
    assert trace.trace_id == trace_id_for("caller-trace")
    assert trace.external_trace_id == "caller-trace"


def test_chatflow_run_hangs_under_its_message_and_orders_nodes_parent_first() -> None:
    record = _workflow_record(message_id=MESSAGE_ID, metadata={"trace_session_id": "session-1"})

    trace = CanonicalTraceBuilder().build(record)

    assert trace is not None
    names = [span.name for span in trace.spans]
    assert names == ["message", "workflow", "start_START", "llm_LLM"]
    message_span, workflow_span, _, llm = trace.spans
    assert trace.trace_id == trace_id_for(MESSAGE_ID)
    assert trace.session_id == "session-1"
    assert message_span.start_time == (STARTED_AT - timedelta(seconds=1)).replace(tzinfo=UTC)
    assert workflow_span.parent_span_id == message_span.span_id
    assert llm.parent_span_id == workflow_span.span_id
    assert llm.inputs == [{"role": "user", "text": "hi"}]
    assert llm.cost is not None
    assert llm.cost.amount == 0.01
    assert llm.time_to_first_token is None


def test_nested_workflow_is_its_own_trace_linked_by_attributes() -> None:
    record = _workflow_record(
        message_id=None,
        metadata={
            "parent_trace_context": {"parent_workflow_run_id": "outer-run", "parent_node_execution_id": "outer-node"}
        },
    )

    trace = CanonicalTraceBuilder().build(record)

    assert trace is not None
    assert trace.trace_id == trace_id_for(WORKFLOW_RUN_ID)
    assert trace.parent is None
    assert trace.session_id == "outer-run"
    root = trace.root
    assert root.name == "workflow"
    assert root.attributes["parent_workflow_run_id"] == "outer-run"
    assert root.attributes["parent_node_execution_id"] == "outer-node"


def test_failed_node_marks_its_span_as_error() -> None:
    record = _workflow_record(message_id=None, metadata={})
    failed = record.node_executions[0].model_copy(
        update={"status": WorkflowNodeExecutionStatus.FAILED, "error": "model timeout"}
    )
    record = record.model_copy(update={"node_executions": [failed, record.node_executions[1]]})

    trace = CanonicalTraceBuilder().build(record)

    assert trace is not None
    llm = next(span for span in trace.spans if span.kind is SpanKind.LLM)
    assert (llm.status, llm.error) == (SpanStatus.ERROR, "model timeout")


def test_tool_call_joins_its_message_trace_as_a_fragment() -> None:
    trace = CanonicalTraceBuilder().build(_tool_record(trace_event_id="event-1"))

    assert trace is not None
    assert trace.trace_id == trace_id_for(MESSAGE_ID)
    assert trace.parent is not None
    assert trace.parent.span_id == span_id_for(MESSAGE_ID)
    (span,) = trace.spans
    assert span.span_id == span_id_for("event:event-1")
    assert span.parent_span_id == trace.parent.span_id
    assert (span.name, span.kind, span.inputs, span.outputs) == ("web_search", SpanKind.TOOL, {"q": "dify"}, "results")


def test_auxiliary_record_without_event_id_is_not_exported() -> None:
    assert CanonicalTraceBuilder().build(_tool_record()) is None


def test_records_without_a_provider_mapping_are_not_exported() -> None:
    record = PromptGenerationTraceInfo(
        metadata={},
        tenant_id="tenant-1",
        user_id="account-1",
        app_id=None,
        operation_type="rule_generate",
        instruction="write a rule",
        prompt_tokens=1,
        completion_tokens=1,
        total_tokens=2,
        model_provider="openai",
        model_name="gpt-4o",
        latency=0.1,
        total_price=None,
        currency=None,
        error=None,
    )

    assert CanonicalTraceBuilder().build(record) is None
