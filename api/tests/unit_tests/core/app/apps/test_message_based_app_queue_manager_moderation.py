import threading
import time

from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.moderation.moderation_coordinator import ModerationCoordinator


def test_stop_when_ready_blocks_until_coordinator_ready(monkeypatch):
    mgr = MessageBasedAppQueueManager(
        task_id="t1",
        user_id="u1",
        invoke_from=InvokeFrom.SERVICE_API,
        conversation_id="c1",
        app_mode="chat",
        message_id="m1",
    )

    coord = ModerationCoordinator()
    mgr.set_moderation_coordinator(coord)

    stopped = {"called": False}

    def fake_stop_listen():
        stopped["called"] = True

    monkeypatch.setattr(mgr, "stop_listen", fake_stop_listen)

    # Run the stop_when_ready in a background thread (it should block initially)
    t = threading.Thread(target=mgr.stop_when_ready, kwargs={"poll_ms": 10})
    t.start()

    # While not ready, stop_listen must not be called
    time.sleep(0.1)
    assert stopped["called"] is False

    # Now make the coordinator ready
    coord.mark_stream_end_seen()
    coord.async_done.set()

    # Thread should finish and stop_listen should be called
    t.join(timeout=2)
    assert stopped["called"] is True
