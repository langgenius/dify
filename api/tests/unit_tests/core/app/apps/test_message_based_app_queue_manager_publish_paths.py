from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import (
    QueueAdvancedChatMessageEndEvent,
    QueueErrorEvent,
    QueueMessageEndEvent,
    QueueStopEvent,
)


def test_publish_calls_stop_when_ready_on_end_events(monkeypatch):
    mgr = MessageBasedAppQueueManager(
        task_id="t1",
        user_id="u1",
        invoke_from=InvokeFrom.SERVICE_API,
        conversation_id="c1",
        app_mode="chat",
        message_id="m1",
    )

    called = {"stop_when_ready": 0, "stop_listen": 0}
    monkeypatch.setattr(
        mgr, "stop_when_ready", lambda **kw: called.__setitem__("stop_when_ready", called["stop_when_ready"] + 1)
    )
    monkeypatch.setattr(mgr, "stop_listen", lambda: called.__setitem__("stop_listen", called["stop_listen"] + 1))

    mgr.publish(QueueMessageEndEvent(), pub_from=PublishFrom.TASK_PIPELINE)
    mgr.publish(QueueAdvancedChatMessageEndEvent(), pub_from=PublishFrom.TASK_PIPELINE)

    assert called["stop_when_ready"] == 2
    assert called["stop_listen"] == 0


def test_publish_calls_stop_listen_on_stop_and_error(monkeypatch):
    mgr = MessageBasedAppQueueManager(
        task_id="t1",
        user_id="u1",
        invoke_from=InvokeFrom.SERVICE_API,
        conversation_id="c1",
        app_mode="chat",
        message_id="m1",
    )

    called = {"stop_when_ready": 0, "stop_listen": 0}
    monkeypatch.setattr(
        mgr, "stop_when_ready", lambda **kw: called.__setitem__("stop_when_ready", called["stop_when_ready"] + 1)
    )
    monkeypatch.setattr(mgr, "stop_listen", lambda: called.__setitem__("stop_listen", called["stop_listen"] + 1))

    mgr.publish(QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL), pub_from=PublishFrom.TASK_PIPELINE)
    mgr.publish(QueueErrorEvent(error=ValueError("boom")), pub_from=PublishFrom.TASK_PIPELINE)

    assert called["stop_listen"] == 2
    assert called["stop_when_ready"] == 0
