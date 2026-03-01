import threading
import time
from datetime import datetime
from types import SimpleNamespace

from core.app.entities.queue_entities import MessageQueueMessage, QueueMessageEndEvent
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.moderation.moderation_coordinator import ModerationCoordinator
from models.model import AppMode


class _FakeQueueManager:
    def __init__(self):
        self.moderation_coordinator = None
        self._messages = []

    def set_moderation_coordinator(self, c):
        self.moderation_coordinator = c

    def listen(self):
        # Yield a single message-end event
        yield from self._messages

    def publish(self, *args, **kwargs):
        pass


class _DummySession:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def commit(self):
        pass


def test_pipeline_marks_end_and_waits_before_yield(monkeypatch):
    # Arrange minimal app entity, conversation, and message
    app_entity = SimpleNamespace(
        task_id="t1",
        app_config=SimpleNamespace(
            tenant_id="tenant", app_id="app", app_model_config_dict={}, sensitive_word_avoidance=None
        ),
        model_conf=SimpleNamespace(model="dummy-model"),
    )

    conversation = SimpleNamespace(id="c1", mode=AppMode.CHAT)
    message = SimpleNamespace(id="m1", created_at=datetime.utcnow())

    qm = _FakeQueueManager()

    # Build the message end event envelope the pipeline expects from listen()
    end_event = QueueMessageEndEvent()
    qm._messages = [
        MessageQueueMessage(task_id="t1", app_mode="chat", event=end_event, message_id="m1", conversation_id="c1")
    ]

    # Patch DB Session and db.engine used in the pipeline to avoid real DB access
    import core.app.task_pipeline.easy_ui_based_generate_task_pipeline as mod

    monkeypatch.setattr(mod, "Session", _DummySession)
    monkeypatch.setattr(mod, "db", SimpleNamespace(engine=None))
    # Avoid DB fetch/update logic entirely in this unit test
    monkeypatch.setattr(mod.EasyUIBasedGenerateTaskPipeline, "_save_message", lambda self, **kwargs: None)

    # Act
    pipeline = EasyUIBasedGenerateTaskPipeline(
        application_generate_entity=app_entity,
        queue_manager=qm,
        conversation=conversation,
        message=message,
        stream=True,
    )

    # The coordinator should have been set on the queue manager by the pipeline's __init__
    coord: ModerationCoordinator = pipeline.moderation_coordinator
    assert qm.moderation_coordinator is coord

    results = []

    def consume():
        for item in pipeline._process_stream_response(publisher=None, trace_manager=None):
            results.append(item)
            break  # Stop after the first (MessageEnd) response

    t = threading.Thread(target=consume)
    t.start()

    # Give the generator a moment to reach the wait point
    time.sleep(0.1)

    # Before signaling async_done, no response should have been yielded
    assert results == []
    # And the coordinator should have seen the end already
    assert coord.ready_to_close() is False  # end seen but async_done not set

    # Now allow completion of moderation background work
    coord.async_done.set()

    t.join(timeout=2)

    # After async_done, the MessageEndStreamResponse should be yielded
    assert len(results) == 1
