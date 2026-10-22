"""验证定时 group 派发仅关闭本批独占的结果 backend。"""

from collections.abc import Generator
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from celery.backends.redis import RedisBackend

import schedule.workflow_schedule_task as schedule_task
from models.trigger import WorkflowSchedulePlan


def make_backend(events: list[str]) -> MagicMock:
    backend = MagicMock(spec=RedisBackend)
    backend.result_consumer = MagicMock()
    consumer = backend.result_consumer
    consumer.subscribed_to = {b"celery-task-meta-example"}
    consumer.drainer._g = MagicMock(dead=True)
    consumer.drainer.stop.side_effect = lambda: events.append("stop_drainer")
    consumer._pubsub.unsubscribe.side_effect = lambda _key: events.append("unsubscribe")
    consumer.stop.side_effect = lambda: events.append("close_pubsub")
    weak_pending: dict[str, object] = {}
    backend._pending_results = ({"example": object()}, weak_pending)
    client = MagicMock()
    client.connection_pool.disconnect.side_effect = lambda: events.append("disconnect")
    backend.__dict__["client"] = client
    return backend


@pytest.mark.parametrize("dispatch_fails", [False, True])
def test_private_backend_closed_and_previous_restored(dispatch_fails: bool) -> None:
    events: list[str] = []
    previous = object()
    backend = make_backend(events)
    app = SimpleNamespace(_backend_cache=None, _local=SimpleNamespace(backend=previous))
    app._get_backend = MagicMock(return_value=backend)
    app.backend_cls = None
    app.conf = SimpleNamespace(result_backend="redis://localhost/1")
    app.loader = None
    with patch.object(schedule_task, "current_app") as current:
        current._get_current_object.return_value = app
        from contextlib import nullcontext

        expected = pytest.raises(ValueError, match="dispatch failed") if dispatch_fails else nullcontext()
        with expected, schedule_task._dispatch_result_backend():
            assert app._local.backend is backend
            if dispatch_fails:
                raise ValueError("dispatch failed")
    assert events == ["stop_drainer", "close_pubsub", "disconnect"]
    assert app._local.backend is previous
    assert backend.result_consumer._pubsub is None
    assert not backend.result_consumer.subscribed_to
    assert not any(backend._pending_results)
    # AsyncResult 可能在作用域退出后析构，此时取消订阅不能重新打开连接。
    from celery.backends.redis import ResultConsumer

    ResultConsumer.cancel_for(backend.result_consumer, "example")
    assert events == ["stop_drainer", "close_pubsub", "disconnect"]


@pytest.mark.parametrize("failure_stage", ["drainer", "pubsub", "disconnect"])
def test_cleanup_failure_does_not_mask_dispatch_or_skip_disconnect(failure_stage: str) -> None:
    events: list[str] = []
    backend = make_backend(events)
    consumer = backend.result_consumer
    operation = {
        "drainer": consumer.drainer.stop,
        "unsubscribe": consumer._pubsub.unsubscribe,
        "pubsub": consumer.stop,
        "disconnect": backend.__dict__["client"].connection_pool.disconnect,
    }[failure_stage]
    operation.side_effect = RuntimeError("cleanup failed")
    previous = object()
    app = SimpleNamespace(_backend_cache=None, _local=SimpleNamespace(backend=previous))
    app._get_backend = MagicMock(return_value=backend)
    app.backend_cls = None
    app.conf = SimpleNamespace(result_backend="redis://localhost/1")
    app.loader = None
    with patch.object(schedule_task, "current_app") as current:
        current._get_current_object.return_value = app
        with pytest.raises(ValueError, match="dispatch failed"):
            with schedule_task._dispatch_result_backend():
                raise ValueError("dispatch failed")
    backend.__dict__["client"].connection_pool.disconnect.assert_called_once()
    assert app._local.backend is previous
    assert consumer._pubsub is None


def test_unstarted_drainer_and_unused_pool_are_not_touched() -> None:
    backend = make_backend([])
    backend.result_consumer.drainer._g = None
    backend.__dict__.pop("client")
    app = SimpleNamespace(_backend_cache=None, _local=SimpleNamespace(backend=None))
    app._get_backend = MagicMock(return_value=backend)
    app.backend_cls = None
    app.conf = SimpleNamespace(result_backend="redis://localhost/1")
    app.loader = None
    with patch.object(schedule_task, "current_app") as current:
        current._get_current_object.return_value = app
        with schedule_task._dispatch_result_backend():
            pass
    backend.result_consumer.drainer.stop.assert_not_called()
    assert app._local.backend is None


@pytest.mark.parametrize("shared", [False, True])
def test_nonredis_or_shared_backend_is_not_disconnected(shared: bool) -> None:
    backend = MagicMock()
    app = SimpleNamespace(_backend_cache=backend if shared else None, _local=SimpleNamespace(backend=backend))
    app._get_backend = MagicMock(return_value=backend)
    app.backend_cls = None
    app.conf = SimpleNamespace(result_backend="db+sqlite://")
    app.loader = None
    with patch.object(schedule_task, "current_app") as current:
        current._get_current_object.return_value = app
        with schedule_task._dispatch_result_backend():
            assert app._local.backend is backend
    backend.result_consumer.stop.assert_not_called()
    app._get_backend.assert_not_called()


def test_group_dispatch_reuses_producer_without_parent_result_trail() -> None:
    from contextlib import contextmanager

    session = MagicMock()
    events: list[str] = []
    session.commit.side_effect = lambda: events.append("commit")

    @contextmanager
    def scope_with_cleanup() -> Generator[None]:
        try:
            yield
        finally:
            events.append("cleanup")

    schedule = MagicMock(spec=WorkflowSchedulePlan, id="schedule-id", cron_expression="* * * * *", timezone="UTC")
    producer = object()
    with (
        patch.object(schedule_task, "_dispatch_result_backend", side_effect=scope_with_cleanup) as scope,
        patch.object(schedule_task, "calculate_next_run_at", return_value="next-run"),
        patch.object(schedule_task, "run_schedule_trigger") as task,
        patch.object(schedule_task, "group") as group,
    ):
        group.side_effect = lambda signatures: (list(signatures), group.return_value)[1]
        assert schedule_task._process_schedules(session, [schedule], producer) == 1
        task.s.assert_called_once_with("schedule-id")
        scope.assert_called_once()
        group.return_value.apply_async.assert_called_once_with(producer=producer, add_to_parent=False)
    session.commit.assert_called_once()
    assert events == ["commit", "cleanup"]
    assert schedule.next_run_at == "next-run"


def test_empty_batch_does_not_create_backend_or_commit() -> None:
    session = MagicMock()
    with patch.object(schedule_task, "_dispatch_result_backend") as scope:
        assert schedule_task._process_schedules(session, []) == 0
    scope.assert_not_called()
    session.commit.assert_not_called()


def test_real_gevent_groups_close_sockets_and_keep_other_backends_isolated() -> None:
    """在子进程中运行 monkey patch 后的 Celery，避免影响 pytest 主进程。"""
    import ast
    import subprocess
    import sys
    from pathlib import Path

    source_path = Path(schedule_task.__file__)
    tree = ast.parse(source_path.read_text())
    scope_source = ast.unparse(
        next(
            node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_dispatch_result_backend"
        )
    )
    script = r"""
from gevent import monkey
monkey.patch_all()
import gc, logging, socket
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any, cast
import gevent
from celery import Celery, group
from celery.app import backends
from celery.backends.redis import RedisBackend

pools = []
consumers = []
results = []
class SocketPool:
    def __init__(self):
        self.sockets = []
        self.disconnected = False
        pools.append(self)
    def connect(self):
        self.sockets.extend(socket.socketpair())
    def disconnect(self):
        self.disconnected = True
        for sock in self.sockets:
            sock.close()
class PubSub:
    def __init__(self, pool):
        self.pool = pool
        self.closed = False
    def subscribe(self, *args):
        assert not self.closed
        if not self.pool.sockets:
            self.pool.connect()
    def unsubscribe(self, *args):
        assert not self.closed, "late cleanup attempted to reconnect a closed PubSub"
    def get_message(self, timeout=None):
        gevent.sleep(0.01)
    def close(self):
        self.closed = True
class Client:
    def __init__(self):
        self.connection_pool = SocketPool()
    def pubsub(self, **kwargs):
        return PubSub(self.connection_pool)
    def mget(self, *args):
        return []
class OfflineBackend(RedisBackend):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__dict__["client"] = Client()
        consumers.append(self.result_consumer)
    @property
    def client(self):
        return self.__dict__["client"]
app = Celery("schedule_cleanup_test", broker="memory://", backend="redis://localhost/1")
app.conf.task_ignore_result = True
app._get_backend = lambda: OfflineBackend(app=app, url="redis://localhost/1")
from celery.local import Proxy
current_app = Proxy(lambda: app)
logger = logging.getLogger(__name__)
"""
    script += "\n" + scope_source + "\n"
    script += r"""
@app.task
def child():
    pass
def dispatch(fails=False):
    previous = app.backend
    previous_pool = previous.client.connection_pool
    with app.producer_or_acquire() as producer:
        try:
            with _dispatch_result_backend():
                assert app.backend is not previous
                result = group(child.s(), child.s(), app=app).apply_async(
                    producer=producer, add_to_parent=False)
                results.append(result)
                gevent.sleep(0.02)
                if fails:
                    raise ValueError("partial dispatch")
        except ValueError:
            assert fails
    assert app.backend is previous
    assert not previous_pool.disconnected
    assert not previous_pool.sockets
    assert not app.backend.result_consumer.subscribed_to
for cycle in range(3):
    jobs = [gevent.spawn(dispatch), gevent.spawn(dispatch, True)]
    gevent.joinall(jobs, timeout=5, raise_error=True)
    assert all(job.dead for job in jobs)
    active = [c for c in consumers if c.drainer._g is not None]
    assert len(active) == (cycle + 1) * 2
    assert all(c.drainer._g.dead for c in active)
    assert all(c._pubsub is None for c in active)
    assert all(sock.fileno() == -1 for pool in pools for sock in pool.sockets)
results.clear()
gc.collect()
assert all(sock.fileno() == -1 for pool in pools for sock in pool.sockets)
# Redis 重试卡住的 drainer 不能一直阻塞定时计划提交。
with _dispatch_result_backend():
    backend = app.backend
    backend.result_consumer.consume_from("timeout-case")
    drainer = backend.result_consumer.drainer
    drainer.start()
    def blocked_stop():
        gevent.sleep(60)
    drainer.stop = blocked_stop
    stuck_greenlet = drainer._g
assert stuck_greenlet.dead
assert backend.result_consumer._pubsub is None
assert backend.client.connection_pool.disconnected
assert all(sock.fileno() == -1 for sock in backend.client.connection_pool.sockets)
print("6 group dispatches and blocked drainer: consumers exited, sockets closed")
"""
    import os

    env = {key: value for key, value in os.environ.items() if not key.startswith("CELERY_")}
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=30, env=env)
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("failure_stage", ["publish", "commit"])
def test_dispatch_or_commit_failure_still_closes_private_backend(failure_stage: str) -> None:
    events: list[str] = []
    backend = make_backend(events)
    previous = object()
    app = SimpleNamespace(
        _backend_cache=None,
        _local=SimpleNamespace(backend=previous),
        _get_backend=MagicMock(return_value=backend),
        backend_cls=None,
        conf=SimpleNamespace(result_backend="redis://localhost/1"),
        loader=None,
    )
    session = MagicMock()
    schedule = MagicMock(spec=WorkflowSchedulePlan, id="schedule-id", cron_expression="* * * * *", timezone="UTC")
    with (
        patch.object(schedule_task, "current_app") as current,
        patch.object(schedule_task, "calculate_next_run_at"),
        patch.object(schedule_task, "run_schedule_trigger"),
        patch.object(schedule_task, "group") as group,
    ):
        current._get_current_object.return_value = app
        operation = group.return_value.apply_async if failure_stage == "publish" else session.commit
        operation.side_effect = ValueError(failure_stage)
        with pytest.raises(ValueError, match=failure_stage):
            schedule_task._process_schedules(session, [schedule])

    assert events == ["stop_drainer", "close_pubsub", "disconnect"]
    assert app._local.backend is previous
    if failure_stage == "publish":
        session.commit.assert_not_called()
    else:
        session.commit.assert_called_once()
