from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.moderation.moderation_coordinator import ModerationCoordinator
from core.moderation.output_moderation import ModerationRule, OutputModeration


class _DummyQueueManager(AppQueueManager):
    """Minimal AppQueueManager subclass suitable for OutputModeration tests.

    Avoids side effects by not calling super().__init__ and no-op publishing.
    """

    def __init__(self):
        # Intentionally skip base __init__ to avoid Redis and thread setup.
        self.moderation_coordinator = None

    def _publish(self, event, pub_from: PublishFrom):  # type: ignore[override]
        # No-op in unit tests
        pass


def test_ready_to_close_only_true_after_end_and_done():
    c = ModerationCoordinator()
    assert c.ready_to_close() is False

    c.mark_stream_end_seen()
    assert c.ready_to_close() is False

    c.async_done.set()
    assert c.ready_to_close() is True


def test_output_moderation_sets_async_done_when_no_thread(monkeypatch):
    c = ModerationCoordinator()
    om = OutputModeration(
        tenant_id="t1",
        app_id="a1",
        rule=ModerationRule(type="sensitive_word", config={}),
        queue_manager=_DummyQueueManager(),
        coordinator=c,
    )

    # Ensure no worker thread is started
    assert om.thread is None

    om.stop_thread()
    assert c.async_done.is_set() is True


def test_output_moderation_worker_signals_async_done(monkeypatch):
    c = ModerationCoordinator()
    om = OutputModeration(
        tenant_id="t1",
        app_id="a1",
        rule=ModerationRule(type="sensitive_word", config={}),
        queue_manager=_DummyQueueManager(),
        coordinator=c,
    )

    # Avoid real moderation work
    monkeypatch.setattr(om, "moderation", lambda **kwargs: None)

    # Start a worker thread by appending a token
    om.append_new_token("hello")
    assert om.thread is not None

    # Ask it to stop and wait for thread to finish
    om.flush_and_stop()

    # The worker's finally block should set async_done
    assert c.async_done.is_set() is True
