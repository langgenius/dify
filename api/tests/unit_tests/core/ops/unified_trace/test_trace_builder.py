from copy import deepcopy
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

from core.ops.entities.trace_entity import GenerateNameTraceInfo, MessageTraceInfo, WorkflowTraceInfo
from core.ops.unified_trace.entities import CanonicalSpanKind, CanonicalSpanStatus
from core.ops.unified_trace.trace_builder import (
    CanonicalTraceBuilder,
    RepositoryWorkflowExecutionLoader,
    resolve_session_id,
)


def make_workflow_trace_info(**overrides) -> WorkflowTraceInfo:
    values = {
        "workflow_data": SimpleNamespace(),
        "conversation_id": None,
        "workflow_id": "workflow-1",
        "tenant_id": "tenant-1",
        "workflow_run_id": "run-1",
        "workflow_run_elapsed_time": 1.0,
        "workflow_run_status": "succeeded",
        "workflow_run_inputs": {},
        "workflow_run_outputs": {},
        "workflow_run_version": "1",
        "total_tokens": 0,
        "file_list": [],
        "query": "",
        "metadata": {},
    }
    values.update(overrides)
    return WorkflowTraceInfo(**values)


def test_custom_session_id_wins_over_conversation_id():
    info = make_workflow_trace_info(
        conversation_id="conversation-1",
        metadata={"trace_session_id": "customer-session"},
    )

    assert resolve_session_id(info) == "customer-session"


def test_workflow_session_falls_back_to_conversation_then_run():
    assert resolve_session_id(make_workflow_trace_info(conversation_id="conversation-1")) == "conversation-1"
    assert resolve_session_id(make_workflow_trace_info()) == "run-1"


def test_nested_workflow_session_falls_back_to_parent_workflow():
    info = make_workflow_trace_info(
        metadata={
            "parent_trace_context": {
                "parent_workflow_run_id": "parent-run",
                "parent_node_execution_id": "parent-node-execution",
            }
        }
    )

    assert resolve_session_id(info) == "parent-run"


def test_message_session_falls_back_to_message_conversation():
    info = MessageTraceInfo(
        conversation_model="chat",
        message_tokens=0,
        answer_tokens=0,
        total_tokens=0,
        conversation_mode="chat",
        message_data=SimpleNamespace(conversation_id="conversation-1", created_at=datetime(2025, 1, 1)),
        metadata={},
    )

    assert resolve_session_id(info) == "conversation-1"


def node_execution(**overrides):
    values = {
        "id": "node-exec",
        "node_execution_id": None,
        "node_id": "node",
        "title": "Node",
        "node_type": "tool",
        "predecessor_node_id": None,
        "iteration_id": None,
        "iteration_index": None,
        "loop_id": None,
        "loop_index": None,
        "created_at": datetime(2025, 1, 1),
        "elapsed_time": 1.0,
        "status": "succeeded",
        "error": None,
        "inputs": {"input": "value"},
        "outputs": {"output": "value"},
        "process_data": {},
        "metadata": {},
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def workflow_info(**overrides) -> WorkflowTraceInfo:
    workflow_data = SimpleNamespace(
        created_at=datetime(2025, 1, 1),
        finished_at=datetime(2025, 1, 1) + timedelta(seconds=5),
        graph_dict={"nodes": []},
    )
    values = {
        "workflow_data": workflow_data,
        "start_time": workflow_data.created_at,
        "end_time": workflow_data.finished_at,
        "metadata": {"app_id": "app-1"},
    }
    values.update(overrides)
    return make_workflow_trace_info(**values)


CHATFLOW_INPUTS = {
    "sys.app_id": "19a6d372-b8bc-4ad4-9b83-7e6e7138de31",
    "sys.dialogue_count": 1,
    "sys.files": [],
    "sys.query": "hi",
    "sys.user_id": "ca877a63-4d75-4ba3-a417-3edffe5e545c",
    "sys.workflow_id": "8b81be9e-d7c1-4fa7-b90f-03791fa015ba",
    "sys.workflow_run_id": "4eec02ea-4ed5-47cc-87fd-7c3821dd935d",
}


def test_chatflow_message_uses_query_while_workflow_keeps_complete_inputs():
    builder = CanonicalTraceBuilder(lambda info: [])

    trace = builder.build(
        workflow_info(
            message_id="message-1",
            query="hi",
            workflow_run_inputs=CHATFLOW_INPUTS,
        )
    )

    assert trace is not None
    spans = {span.id: span for span in trace.spans}
    assert spans["message-1"].name == "chatflow_run-1"
    assert spans["message-1"].inputs == "hi"
    assert spans["message-1"].metadata["trace_entity_type"] == "message"
    assert spans["message-1"].publishes_parent_context is True
    assert spans["run-1"].name == "workflow_run-1"
    assert spans["run-1"].inputs == CHATFLOW_INPUTS


def test_chatflow_message_falls_back_to_complete_inputs_for_empty_query():
    builder = CanonicalTraceBuilder(lambda info: [])

    trace = builder.build(
        workflow_info(
            message_id="message-1",
            query="",
            workflow_run_inputs=CHATFLOW_INPUTS,
        )
    )

    assert trace is not None
    assert trace.spans[0].inputs == CHATFLOW_INPUTS


def test_workflow_without_message_keeps_complete_inputs_on_root():
    builder = CanonicalTraceBuilder(lambda info: [])

    trace = builder.build(workflow_info(query="hi", workflow_run_inputs=CHATFLOW_INPUTS))

    assert trace is not None
    assert trace.root_span_id == "run-1"
    assert trace.spans[0].inputs == CHATFLOW_INPUTS


def test_build_workflow_trace_is_parent_first_and_uses_wrappers():
    container = node_execution(id="iteration-exec", node_id="iteration", node_type="iteration", title="Items")
    child = node_execution(
        id="llm-exec",
        node_id="llm",
        node_type="llm",
        title="Summarize",
        iteration_id="iteration",
        iteration_index=0,
        process_data={
            "prompts": [{"role": "user", "text": "hello"}],
            "model_provider": "openai",
            "model_name": "gpt-4",
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        },
    )
    loader = MagicMock(return_value=[child, container])
    builder = CanonicalTraceBuilder(loader)

    trace = builder.build(workflow_info())

    assert trace is not None
    assert [span.id for span in trace.spans] == [
        "run-1",
        "iteration-exec",
        "iteration:iteration-exec:0",
        "llm-exec",
    ]
    spans = {span.id: span for span in trace.spans}
    assert spans["llm-exec"].parent_id == "iteration:iteration-exec:0"
    assert spans["llm-exec"].kind is CanonicalSpanKind.LLM
    assert spans["llm-exec"].metadata["total_tokens"] == 30
    loader.assert_called_once()


def test_workflow_tool_is_marked_as_nested_workflow_parent():
    builder = CanonicalTraceBuilder(lambda info: [node_execution(id="tool-exec")])

    trace = builder.build(workflow_info())

    assert trace is not None
    assert trace.spans[-1].can_parent_workflow is True


def retry_attempt(retry_index: object, **overrides):
    values = {
        "retry_index": retry_index,
        "inputs": {"attempt": retry_index},
        "process_data": {"request": f"attempt-{retry_index}"},
        "outputs": {"status_code": 500},
        "error": f"attempt {retry_index} failed",
        "elapsed_time": float(retry_index) if isinstance(retry_index, int) else 0.0,
        "execution_metadata": {"internal": True},
        "created_at": 1_700_000_000,
        "finished_at": 1_700_000_001,
    }
    values.update(overrides)
    return values


def test_node_metadata_contains_compact_retry_summary_and_skips_malformed_entries():
    history = [
        retry_attempt(1),
        "malformed",
        retry_attempt(True),
        retry_attempt(2, error="attempt 2 timed out", elapsed_time=2.5),
        retry_attempt(3),
    ]
    builder = CanonicalTraceBuilder(lambda info: [node_execution(process_data={"__dify_retry_history": history})])

    trace = builder.build(workflow_info())

    assert trace is not None
    metadata = trace.spans[-1].metadata
    assert metadata["retry_count"] == 3
    assert metadata["retry_attempts"] == [
        {
            "retry_index": 1,
            "error": "attempt 1 failed",
            "elapsed_time": 1.0,
            "created_at": 1_700_000_000,
            "finished_at": 1_700_000_001,
        },
        {
            "retry_index": 2,
            "error": "attempt 2 timed out",
            "elapsed_time": 2.5,
            "created_at": 1_700_000_000,
            "finished_at": 1_700_000_001,
        },
        {
            "retry_index": 3,
            "error": "attempt 3 failed",
            "elapsed_time": 3.0,
            "created_at": 1_700_000_000,
            "finished_at": 1_700_000_001,
        },
    ]
    assert all("inputs" not in attempt for attempt in metadata["retry_attempts"])
    assert all("process_data" not in attempt for attempt in metadata["retry_attempts"])
    assert all("outputs" not in attempt for attempt in metadata["retry_attempts"])
    assert all("execution_metadata" not in attempt for attempt in metadata["retry_attempts"])


def test_node_without_retry_history_has_no_retry_metadata():
    builder = CanonicalTraceBuilder(lambda info: [node_execution()])

    trace = builder.build(workflow_info())

    assert trace is not None
    assert "retry_count" not in trace.spans[-1].metadata
    assert "retry_attempts" not in trace.spans[-1].metadata


def test_failed_node_preserves_error_without_mutating_trace_metadata():
    metadata = {"app_id": "app-1", "custom": {"nested": True}}
    original = deepcopy(metadata)
    builder = CanonicalTraceBuilder(
        lambda info: [node_execution(status="failed", error="boom", metadata={"attempt": 1})]
    )

    trace = builder.build(workflow_info(metadata=metadata))

    assert trace is not None
    assert trace.spans[-1].status is CanonicalSpanStatus.ERROR
    assert trace.spans[-1].error == "boom"
    assert metadata == original


def test_nested_workflow_exposes_typed_external_parent():
    builder = CanonicalTraceBuilder(lambda info: [])
    info = workflow_info(
        metadata={
            "app_id": "app-1",
            "parent_trace_context": {
                "parent_workflow_run_id": "outer-run",
                "parent_node_execution_id": "outer-tool",
            },
        }
    )

    trace = builder.build(info)

    assert trace is not None
    assert trace.external_parent is not None
    assert trace.external_parent.parent_node_execution_id == "outer-tool"


def test_repository_loader_scopes_repository_to_trace(monkeypatch):
    repository = MagicMock()
    repository.get_by_workflow_execution.return_value = [node_execution()]
    factory = MagicMock()
    factory.create_workflow_node_execution_repository.return_value = repository
    monkeypatch.setattr("core.ops.unified_trace.trace_builder.DifyCoreRepositoryFactory", factory)
    monkeypatch.setattr("core.ops.unified_trace.trace_builder.db", MagicMock(engine="engine"))
    account = MagicMock()
    get_account = MagicMock(return_value=account)
    loader = RepositoryWorkflowExecutionLoader(get_account)
    info = workflow_info()

    result = loader(info)

    assert len(result) == 1
    get_account.assert_called_once_with("app-1")
    factory.create_workflow_node_execution_repository.assert_called_once()
    call = factory.create_workflow_node_execution_repository.call_args.kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["app_id"] == "app-1"
    repository.get_by_workflow_execution.assert_called_once_with(workflow_execution_id="run-1")


def test_message_trace_does_not_load_workflow_executions():
    loader = MagicMock()
    builder = CanonicalTraceBuilder(loader)
    info = MessageTraceInfo(
        conversation_model="chat",
        message_tokens=2,
        answer_tokens=3,
        total_tokens=5,
        conversation_mode="chat",
        message_id="message-1",
        message_data=SimpleNamespace(
            id="message-1",
            conversation_id="conversation-1",
            answer="hello",
            created_at=datetime(2025, 1, 1),
            updated_at=datetime(2025, 1, 1, 0, 0, 1),
        ),
        inputs="hi",
        metadata={},
    )

    trace = builder.build(info)

    assert trace is not None
    assert trace.root_span_id == "message-1"
    assert [span.name for span in trace.spans] == ["message", "llm"]
    assert trace.spans[0].outputs == "hello"
    assert trace.spans[0].metadata["trace_entity_type"] == "message"
    assert trace.spans[0].publishes_parent_context is True
    assert trace.spans[1].parent_id == "message-1"
    assert trace.spans[1].kind is CanonicalSpanKind.LLM
    assert trace.spans[1].metadata["total_tokens"] == 5
    loader.assert_not_called()


def test_generate_name_uses_message_parent_and_conversation_session():
    builder = CanonicalTraceBuilder(lambda info: [])
    info = GenerateNameTraceInfo(
        tenant_id="tenant-1",
        conversation_id="conversation-1",
        message_id="message-1",
        inputs="title prompt",
        outputs="title",
        metadata={},
    )

    trace = builder.build(info)

    assert trace is not None
    assert trace.trace_id == "message-1"
    assert trace.session_id == "conversation-1"
    assert trace.required_parent_context_id == "message-1"
    assert trace.spans[0].parent_id == "message-1"


def test_generate_name_without_message_remains_root_in_conversation_session():
    builder = CanonicalTraceBuilder(lambda info: [])
    info = GenerateNameTraceInfo(
        tenant_id="tenant-1",
        conversation_id="conversation-1",
        inputs="title prompt",
        outputs="title",
        metadata={},
    )

    trace = builder.build(info)

    assert trace is not None
    assert trace.session_id == "conversation-1"
    assert trace.required_parent_context_id is None
    assert trace.spans[0].parent_id is None
