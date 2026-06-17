from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.completion.graph_event_adapter import CompletionGraphEventAdapter
from core.app.entities.queue_entities import (
    QueueErrorEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
)
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.graph_events import (
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunSucceededEvent,
    NodeRunFailedEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult


def _adapter() -> tuple[CompletionGraphEventAdapter, MagicMock]:
    queue_manager = MagicMock()
    entity = SimpleNamespace(model_conf=SimpleNamespace(model="model"))
    return (
        CompletionGraphEventAdapter(application_generate_entity=entity, queue_manager=queue_manager),
        queue_manager,
    )


def test_stream_chunk_event_publishes_llm_chunk() -> None:
    adapter, queue_manager = _adapter()

    adapter.handle_event(
        NodeRunStreamChunkEvent(
            id="run",
            node_id="llm",
            node_type=BuiltinNodeTypes.LLM,
            selector=["llm", "text"],
            chunk="hello",
        )
    )

    event = queue_manager.publish.call_args.args[0]
    assert isinstance(event, QueueLLMChunkEvent)
    assert event.chunk.delta.message.content == "hello"
    assert queue_manager.publish.call_args.args[1] == PublishFrom.APPLICATION_MANAGER


def test_stream_chunk_event_skips_final_empty_chunk() -> None:
    adapter, queue_manager = _adapter()

    adapter.handle_event(
        NodeRunStreamChunkEvent(
            id="run",
            node_id="llm",
            node_type=BuiltinNodeTypes.LLM,
            selector=["llm", "text"],
            chunk="",
            is_final=True,
        )
    )

    queue_manager.publish.assert_not_called()


def test_retriever_resource_event_publishes_legacy_retriever_resources() -> None:
    adapter, queue_manager = _adapter()

    adapter.handle_event(
        NodeRunRetrieverResourceEvent(
            id="run",
            node_id="knowledge_retrieval",
            node_type=BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
            retriever_resources=[{"dataset_id": "dataset", "content": "hit"}],
            context="hit",
        )
    )

    event = queue_manager.publish.call_args.args[0]
    assert isinstance(event, QueueRetrieverResourcesEvent)
    assert event.retriever_resources[0].dataset_id == "dataset"


def test_llm_success_then_graph_success_publishes_message_end_with_saved_prompt() -> None:
    adapter, queue_manager = _adapter()
    usage = LLMUsage.empty_usage()
    saved_prompt = [{"role": "user", "text": "saved prompt"}]
    adapter.handle_event(
        NodeRunSucceededEvent(
            id="run",
            node_id="llm",
            node_type=BuiltinNodeTypes.LLM,
            start_at=datetime.now(UTC),
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={"text": "final"},
                process_data={"prompts": saved_prompt},
                llm_usage=usage,
            ),
        )
    )

    adapter.handle_event(GraphRunSucceededEvent(outputs={"result": "final"}))

    event = queue_manager.publish.call_args.args[0]
    assert isinstance(event, QueueMessageEndEvent)
    assert event.llm_result is not None
    assert event.llm_result.message.content == "final"
    assert event.llm_result.usage is usage
    assert event.saved_prompt == saved_prompt


def test_graph_success_uses_outputs_result_when_llm_success_was_not_seen() -> None:
    adapter, queue_manager = _adapter()

    adapter.handle_event(GraphRunSucceededEvent(outputs={"result": "final from graph"}))

    event = queue_manager.publish.call_args.args[0]
    assert isinstance(event, QueueMessageEndEvent)
    assert event.llm_result is not None
    assert event.llm_result.message.content == "final from graph"
    assert event.saved_prompt == []


def test_failed_node_publishes_error() -> None:
    adapter, queue_manager = _adapter()

    adapter.handle_event(
        NodeRunFailedEvent(
            id="run",
            node_id="llm",
            node_type=BuiltinNodeTypes.LLM,
            error="node boom",
            start_at=datetime.now(UTC),
        )
    )

    event = queue_manager.publish.call_args.args[0]
    assert isinstance(event, QueueErrorEvent)
    assert str(event.error) == "node boom"


def test_failed_graph_publishes_error() -> None:
    adapter, queue_manager = _adapter()

    adapter.handle_event(GraphRunFailedEvent(error="boom"))

    event = queue_manager.publish.call_args.args[0]
    assert isinstance(event, QueueErrorEvent)
    assert str(event.error) == "boom"


def test_user_abort_publishes_legacy_stop() -> None:
    adapter, queue_manager = _adapter()

    adapter.handle_event(GraphRunAbortedEvent(reason="Stopped by user."))

    event = queue_manager.publish.call_args.args[0]
    assert isinstance(event, QueueStopEvent)
    assert event.stopped_by == QueueStopEvent.StopBy.USER_MANUAL
