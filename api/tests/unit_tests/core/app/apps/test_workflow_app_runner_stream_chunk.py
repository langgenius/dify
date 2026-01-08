from unittest.mock import MagicMock

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.workflow.graph_events import NodeRunStreamChunkEvent
from core.workflow.nodes import NodeType


class DummyQueueManager:
    def __init__(self) -> None:
        self.published = []

    def publish(self, event, publish_from: PublishFrom) -> None:
        self.published.append((event, publish_from))


def test_skip_empty_final_chunk() -> None:
    queue_manager = DummyQueueManager()
    runner = WorkflowBasedAppRunner(queue_manager=queue_manager, app_id="app")

    empty_final_event = NodeRunStreamChunkEvent(
        id="exec",
        node_id="node",
        node_type=NodeType.LLM,
        selector=["node", "text"],
        chunk="",
        is_final=True,
    )

    runner._handle_event(workflow_entry=MagicMock(), event=empty_final_event)
    assert queue_manager.published == []

    normal_event = NodeRunStreamChunkEvent(
        id="exec",
        node_id="node",
        node_type=NodeType.LLM,
        selector=["node", "text"],
        chunk="hi",
        is_final=False,
    )

    runner._handle_event(workflow_entry=MagicMock(), event=normal_event)

    assert len(queue_manager.published) == 1
    published_event, publish_from = queue_manager.published[0]
    assert publish_from == PublishFrom.APPLICATION_MANAGER
    assert published_event.text == "hi"
