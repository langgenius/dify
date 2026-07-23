from datetime import datetime
from unittest.mock import MagicMock

import pytest
from dify_trace_langsmith.config import LangSmithConfig
from dify_trace_langsmith.unified_trace import UnifiedLangSmithAdapter

from core.ops.exceptions import InvalidTraceParentContextError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from core.ops.unified_trace.parent_context import ParentResolution, ProviderParentContext, destination_scope

ROOT_ID = "00000000-0000-0000-0000-000000000001"
CHILD_ID = "00000000-0000-0000-0000-000000000002"
TOOL_ID = "00000000-0000-0000-0000-000000000003"


def span(**overrides) -> CanonicalSpan:
    values = {
        "id": ROOT_ID,
        "parent_id": None,
        "name": "root",
        "kind": CanonicalSpanKind.CHAIN,
        "start_time": datetime(2025, 1, 1),
        "end_time": datetime(2025, 1, 1, 0, 0, 1),
        "inputs": {"input": "value"},
        "outputs": {"output": "value"},
        "status": CanonicalSpanStatus.OK,
        "metadata": {"external_trace_id": "customer-trace"},
    }
    values.update(overrides)
    return CanonicalSpan(**values)


def trace(*spans: CanonicalSpan, session_id: str = "session-1") -> CanonicalTrace:
    values = spans or (span(),)
    return CanonicalTrace(
        trace_id="customer-trace",
        session_id=session_id,
        root_span_id=values[0].id,
        spans=values,
    )


def test_client_disables_async_batching_before_parent_coordination(monkeypatch: pytest.MonkeyPatch):
    client_class = MagicMock()
    monkeypatch.setattr("dify_trace_langsmith.unified_trace.Client", client_class)
    config = LangSmithConfig(api_key="secret", project="project-a", endpoint="https://smith.example")

    UnifiedLangSmithAdapter(config)

    client_class.assert_called_once_with(
        api_key="secret",
        api_url="https://smith.example",
        auto_batch_tracing=False,
    )


@pytest.fixture
def adapter(monkeypatch: pytest.MonkeyPatch):
    client = MagicMock()
    monkeypatch.setattr("dify_trace_langsmith.unified_trace.Client", lambda **kwargs: client)
    subject = UnifiedLangSmithAdapter(
        LangSmithConfig(api_key="secret", project="project-a", endpoint="https://smith.example")
    )
    return subject, client


def test_root_trace_id_equals_root_run_id_and_sets_thread_session(adapter):
    subject, client = adapter

    subject.emit(trace(session_id="customer-session"), None, MagicMock())

    root = client.create_run.call_args.kwargs
    assert root["id"] == ROOT_ID
    assert root["trace_id"] == ROOT_ID
    assert root["extra"]["metadata"]["session_id"] == "customer-session"
    assert root["extra"]["metadata"]["external_trace_id"] == "customer-trace"


def test_message_span_uses_explicit_langsmith_human_message_schema(adapter):
    subject, client = adapter
    message = span(
        name="message",
        inputs="hi",
        metadata={"trace_entity_type": "message"},
    )

    subject.emit(trace(message), None, MagicMock())

    assert client.create_run.call_args.kwargs["inputs"] == {"messages": [{"role": "user", "content": "hi"}]}


def test_mapping_inputs_remain_unchanged(adapter):
    subject, client = adapter
    raw_inputs = {"sys.app_id": "app-1", "sys.files": []}
    message = span(
        name="message",
        inputs=raw_inputs,
        metadata={"trace_entity_type": "message"},
    )

    subject.emit(trace(message), None, MagicMock())

    assert client.create_run.call_args.kwargs["inputs"] == raw_inputs


def test_empty_session_is_not_written_to_root_metadata(adapter):
    subject, client = adapter

    subject.emit(trace(session_id=""), None, MagicMock())

    metadata = client.create_run.call_args.kwargs["extra"]["metadata"]
    assert "session_id" not in metadata


def test_child_uses_actual_parent_run_and_dotted_order(adapter):
    subject, client = adapter
    root = span()
    child = span(id=CHILD_ID, parent_id=ROOT_ID, name="llm", kind=CanonicalSpanKind.LLM)

    subject.emit(trace(root, child), None, MagicMock())

    root_run = client.create_run.call_args_list[0].kwargs
    child_run = client.create_run.call_args_list[1].kwargs
    assert child_run["parent_run_id"] == ROOT_ID
    assert child_run["trace_id"] == ROOT_ID
    assert child_run["dotted_order"].startswith(f"{root_run['dotted_order']}.")
    assert child_run["run_type"] == "llm"


def test_synthetic_ids_are_mapped_consistently(adapter):
    subject, client = adapter
    root = span()
    wrapper = span(id="iteration:container:0", parent_id=ROOT_ID, name="iteration[0]")
    child = span(id=CHILD_ID, parent_id=wrapper.id)

    subject.emit(trace(root, wrapper, child), None, MagicMock())

    wrapper_run = client.create_run.call_args_list[1].kwargs
    child_run = client.create_run.call_args_list[2].kwargs
    assert wrapper_run["id"] != wrapper.id
    assert child_run["parent_run_id"] == wrapper_run["id"]


def test_nested_workflow_restores_parent_trace_and_order(adapter):
    subject, client = adapter
    parent = ProviderParentContext(
        provider="langsmith",
        scope=subject.scope,
        trace_id="00000000-0000-0000-0000-000000000010",
        parent_id="00000000-0000-0000-0000-000000000011",
        provider_context={"dotted_order": "parent.order"},
    )

    subject.emit(trace(), ParentResolution.restored(parent), MagicMock())

    root = client.create_run.call_args.kwargs
    assert root["trace_id"] == parent.trace_id
    assert root["parent_run_id"] == parent.parent_id
    assert root["dotted_order"].startswith("parent.order.")


def test_nested_workflow_rejects_parent_without_dotted_order(adapter):
    subject, _ = adapter
    parent = ProviderParentContext(
        provider="langsmith",
        scope=subject.scope,
        trace_id="00000000-0000-0000-0000-000000000010",
        parent_id="00000000-0000-0000-0000-000000000011",
        provider_context={},
    )

    with pytest.raises(InvalidTraceParentContextError):
        subject.emit(trace(), ParentResolution.restored(parent), MagicMock())


def test_tool_context_is_published_only_after_create_run_succeeds(adapter):
    subject, client = adapter
    publish = MagicMock()
    tool = span(id=TOOL_ID, kind=CanonicalSpanKind.TOOL, can_parent_workflow=True)

    subject.emit(trace(tool), None, publish)

    assert client.create_run.called
    node_execution_id, context = publish.call_args.args
    assert node_execution_id == TOOL_ID
    assert context.parent_id == TOOL_ID
    assert context.provider_context["dotted_order"]

    client.reset_mock()
    publish.reset_mock()
    client.create_run.side_effect = RuntimeError("rejected")
    with pytest.raises(RuntimeError, match="rejected"):
        subject.emit(trace(tool), None, publish)
    publish.assert_not_called()


def test_retry_metadata_is_forwarded_to_langsmith(adapter):
    subject, client = adapter
    retry_metadata = {
        "retry_count": 1,
        "retry_attempts": [
            {
                "retry_index": 1,
                "error": "HTTP 500",
                "elapsed_time": 1.2,
                "created_at": 1_700_000_000,
                "finished_at": 1_700_000_001,
            }
        ],
    }
    node = span(metadata=retry_metadata)

    subject.emit(trace(node), None, MagicMock())

    assert client.create_run.call_args.kwargs["extra"]["metadata"] == {
        **retry_metadata,
        "session_id": "session-1",
        "external_trace_id": "customer-trace",
    }


def test_message_context_is_published_after_create_run(adapter):
    subject, client = adapter
    publish = MagicMock()
    message = span(name="message", publishes_parent_context=True)

    subject.emit(trace(message), None, publish)

    assert client.create_run.called
    parent_id, context = publish.call_args.args
    assert parent_id == ROOT_ID
    assert context.parent_id == ROOT_ID
    assert context.provider_context["dotted_order"]


def test_scope_does_not_include_api_key(adapter):
    subject, _ = adapter

    assert subject.scope == destination_scope("langsmith", "https://smith.example", "project-a")
    assert "secret" not in subject.scope
