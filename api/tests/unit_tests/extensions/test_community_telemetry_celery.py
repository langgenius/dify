from types import SimpleNamespace
from unittest.mock import Mock

from extensions.ext_celery import _enqueue_initial_community_telemetry_heartbeat


def test_beat_start_enqueues_community_telemetry_heartbeat() -> None:
    task = Mock()
    sender = SimpleNamespace(
        app=SimpleNamespace(
            conf=SimpleNamespace(beat_schedule={"community_telemetry_heartbeat": {}}),
            tasks={"community_telemetry.send_heartbeat": task},
        )
    )

    _enqueue_initial_community_telemetry_heartbeat(sender)

    task.apply_async.assert_called_once_with()


def test_beat_start_skips_community_telemetry_when_not_scheduled() -> None:
    task = Mock()
    sender = SimpleNamespace(
        app=SimpleNamespace(
            conf=SimpleNamespace(beat_schedule={}),
            tasks={"community_telemetry.send_heartbeat": task},
        )
    )

    _enqueue_initial_community_telemetry_heartbeat(sender)

    task.apply_async.assert_not_called()


def test_beat_start_skips_community_telemetry_when_task_is_unavailable() -> None:
    sender = SimpleNamespace(
        app=SimpleNamespace(
            conf=SimpleNamespace(beat_schedule={"community_telemetry_heartbeat": {}}),
            tasks={},
        )
    )

    _enqueue_initial_community_telemetry_heartbeat(sender)
