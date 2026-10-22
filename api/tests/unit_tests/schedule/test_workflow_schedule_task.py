"""验证定时 group 派发只清理本批独占的真实 Redis backend。"""

from __future__ import annotations

import ast
import gc
import os
import subprocess
import sys
import weakref
from collections.abc import Iterator, MutableMapping
from contextlib import AbstractContextManager, nullcontext
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol, cast
from unittest.mock import patch

import gevent
import pytest
from celery import Celery, current_app, group
from celery.backends.asynchronous import Drainer, geventDrainer
from celery.backends.redis import RedisBackend
from celery.canvas import Signature
from celery.result import AsyncResult
from kombu import Producer
from redis.client import PubSub
from redis.connection import Connection
from sqlalchemy import event
from sqlalchemy.orm import Session

import schedule.workflow_schedule_task as schedule_task
from models.trigger import WorkflowSchedulePlan


# Celery 存根遗漏的私有状态，只声明实际读取的字段，不替换运行时对象。
class BackendPendingResults(Protocol):
    _pending_results: tuple[MutableMapping[str, AsyncResult[object]], MutableMapping[str, AsyncResult[object]]]


class CurrentAppProxy(Protocol):
    def _get_current_object(self) -> Celery: ...


class AppBackendCache(Protocol):
    _backend: object | None


@pytest.fixture
def celery_app() -> Iterator[Celery]:
    # 恢复全局应用，避免线程局部状态污染其他测试。
    previous_app = cast(CurrentAppProxy, current_app)._get_current_object()
    with Celery(
        "schedule_cleanup_test", broker="memory://", backend="redis://localhost/1", set_as_current=False
    ) as app:
        app.set_current()
        try:
            yield app
        finally:
            previous_app.set_current()


@pytest.fixture
def dispatch_backend(celery_app: Celery) -> Iterator[RedisBackend]:
    # 构造真实 backend，仅替换创建边界，便于事先观测本批资源。
    previous = celery_app.backend
    backend = RedisBackend(app=celery_app, url="redis://localhost/1")

    def poll_message(*_args: object, **_kwargs: object) -> None:
        gevent.sleep(0.001)

    with (
        patch.object(celery_app, "_get_backend", return_value=backend),
        patch.object(Connection, "connect", side_effect=AssertionError("测试不允许 Redis 网络连接")),
        patch.object(PubSub, "execute_command", return_value=None),
        patch.object(PubSub, "get_message", side_effect=poll_message),
    ):
        try:
            yield backend
        finally:
            consumer = backend.result_consumer
            drainer = consumer.drainer
            if isinstance(drainer, geventDrainer) and drainer._g is not None:
                drainer._g.kill(block=True)
            consumer.stop()
            if "client" in backend.__dict__:
                backend.client.connection_pool.disconnect()
            assert celery_app.backend is previous


def subscribe_result(backend: RedisBackend) -> AsyncResult[object]:
    """走真实订阅逻辑，保留强弱引用以验证清理与延迟析构。"""
    result: AsyncResult[object] = AsyncResult("example", backend=backend, app=current_app)
    backend.result_consumer.consume_from(result.id)
    backend.add_pending_result(result)
    cast(BackendPendingResults, backend)._pending_results[1][result.id] = result
    assert backend.result_consumer.subscribed_to
    assert backend.result_consumer._pubsub is not None
    return result


@pytest.mark.parametrize("dispatch_fails", [False, True])
def test_private_backend_closed_and_previous_restored(
    celery_app: Celery, dispatch_backend: RedisBackend, dispatch_fails: bool
) -> None:
    backend = dispatch_backend
    previous = celery_app.backend
    consumer = backend.result_consumer
    consumer.drainer = geventDrainer(consumer)
    result = subscribe_result(backend)
    pubsub = consumer._pubsub
    assert isinstance(pubsub, PubSub)
    events: list[str] = []

    def close_pubsub() -> None:
        events.append("close_pubsub")
        pubsub.reset()

    disconnect_pool = backend.client.connection_pool.disconnect

    def disconnect() -> None:
        events.append("disconnect")
        disconnect_pool()

    with (
        patch.object(consumer.drainer, "stop", wraps=consumer.drainer.stop) as stop,
        patch.object(pubsub, "close", side_effect=close_pubsub),
        patch.object(backend.client.connection_pool, "disconnect", side_effect=disconnect),
        patch.object(pubsub, "unsubscribe", side_effect=AssertionError("不应发送取消订阅命令")),
        patch.object(consumer, "_reconnect_pubsub", side_effect=AssertionError("不应重新连接")),
    ):
        expected = pytest.raises(ValueError, match="dispatch failed") if dispatch_fails else nullcontext()
        with expected, schedule_task._dispatch_result_backend():
            assert celery_app.backend is backend
            if dispatch_fails:
                raise ValueError("dispatch failed")
        stop.assert_called_once()
        assert consumer.drainer._g is not None
        assert consumer.drainer._g.dead
        assert events == ["close_pubsub", "disconnect"]
        assert not pubsub.channels
        assert consumer._pubsub is None
        assert not consumer.subscribed_to
        assert not any(cast(BackendPendingResults, backend)._pending_results)
        # 真正触发 AsyncResult 析构；显式取消也不能重新打开 PubSub。
        reference = weakref.ref(result)
        del result
        gc.collect()
        assert reference() is None
        consumer.cancel_for("example")
        assert events == ["close_pubsub", "disconnect"]
    assert celery_app.backend is previous


@pytest.mark.parametrize("failure_stage", ["drainer", "pubsub", "disconnect"])
@pytest.mark.parametrize("dispatch_fails", [False, True])
def test_cleanup_failure_does_not_mask_dispatch_or_skip_disconnect(
    celery_app: Celery, dispatch_backend: RedisBackend, failure_stage: str, dispatch_fails: bool
) -> None:
    backend = dispatch_backend
    previous = celery_app.backend
    consumer = backend.result_consumer
    consumer.drainer = geventDrainer(consumer)
    result = subscribe_result(backend)
    pubsub = consumer._pubsub
    assert isinstance(pubsub, PubSub)
    pool = backend.client.connection_pool
    target, method = {
        "drainer": (consumer.drainer, "stop"),
        "pubsub": (pubsub, "close"),
        "disconnect": (pool, "disconnect"),
    }[failure_stage]
    with (
        patch.object(pool, "disconnect", wraps=pool.disconnect) as disconnect,
        patch.object(target, method, side_effect=RuntimeError("cleanup failed")) as failing,
        patch.object(schedule_task.logger, "exception") as log,
    ):
        expected = pytest.raises(ValueError, match="dispatch failed") if dispatch_fails else nullcontext()
        with expected, schedule_task._dispatch_result_backend():
            if dispatch_fails:
                raise ValueError("dispatch failed")
        failing.assert_called_once()
        if failure_stage != "disconnect":
            disconnect.assert_called_once()
        log.assert_called_once()
    assert celery_app.backend is previous
    assert consumer.drainer._g is not None
    assert consumer.drainer._g.dead
    assert consumer._pubsub is None
    assert not consumer.subscribed_to
    assert not any(cast(BackendPendingResults, backend)._pending_results)
    del result


@pytest.mark.parametrize("drainer_state", ["unstarted", "nongevent", "running", "dead"])
def test_drainer_type_and_forced_shutdown(dispatch_backend: RedisBackend, drainer_state: str) -> None:
    backend = dispatch_backend
    consumer = backend.result_consumer
    consumer.drainer = Drainer(consumer) if drainer_state == "nongevent" else geventDrainer(consumer)
    drainer = consumer.drainer
    if drainer_state in {"running", "dead"}:
        assert isinstance(drainer, geventDrainer)
        consumer.consume_from("example")
        drainer.start()
        if drainer_state == "dead":
            drainer.stop()
        assert drainer._g is not None
    # running 分支令 stop 不退出，必须在主进程执行真实 Greenlet.kill。
    with patch.object(drainer, "stop", return_value=None) as stop:
        with schedule_task._dispatch_result_backend():
            pass
        if drainer_state in {"unstarted", "nongevent"}:
            stop.assert_not_called()
            assert "client" not in backend.__dict__
        else:
            stop.assert_called_once()
            assert isinstance(drainer, geventDrainer)
            assert drainer._g is not None
            assert drainer._g.dead
    assert consumer._pubsub is None


def test_originally_uninitialized_backend_is_restored(celery_app: Celery) -> None:
    assert cast(AppBackendCache, celery_app)._backend is None
    with schedule_task._dispatch_result_backend():
        assert isinstance(celery_app.backend, RedisBackend)
    assert cast(AppBackendCache, celery_app)._backend is None


@pytest.mark.parametrize("shared", [False, True])
def test_nonredis_or_shared_backend_is_not_disconnected(celery_app: Celery, shared: bool) -> None:
    if shared:
        celery_app.conf.result_backend_thread_safe = True
    else:
        celery_app.conf.result_backend = "cache+memory://"
    backend = celery_app.backend
    with patch.object(celery_app, "_get_backend", side_effect=AssertionError("不应创建独占 backend")):
        if shared:
            assert isinstance(backend, RedisBackend)
            with patch.object(backend.result_consumer, "stop") as stop:
                with schedule_task._dispatch_result_backend():
                    assert celery_app.backend is backend
                stop.assert_not_called()
            assert "client" not in backend.__dict__
        else:
            with schedule_task._dispatch_result_backend():
                assert celery_app.backend is backend
    assert celery_app.backend is backend


@pytest.mark.parametrize("failure_stage", ["none", "publish", "commit"])
def test_process_schedules_publishes_and_commits_before_cleanup(
    celery_app: Celery, dispatch_backend: RedisBackend, sqlite_session: Session, failure_stage: str
) -> None:
    backend = dispatch_backend
    schedule = WorkflowSchedulePlan(
        app_id="00000000-0000-0000-0000-000000000001",
        tenant_id="00000000-0000-0000-0000-000000000002",
        node_id="schedule-node",
        cron_expression="* * * * *",
        timezone="UTC",
        next_run_at=datetime(2026, 1, 1),
    )
    sqlite_session.add(schedule)
    sqlite_session.commit()
    before_dispatch = datetime.now(UTC)
    events: list[str] = []
    result = subscribe_result(backend)
    pubsub = backend.result_consumer._pubsub
    assert isinstance(pubsub, PubSub)

    def after_commit(_session: Session) -> None:
        events.append("commit")

    def before_commit(_session: Session) -> None:
        if failure_stage == "commit":
            events.append("commit_failed")
            raise ValueError("commit")

    def publish(job: group, **options: object) -> None:
        events.append("publish")
        assert celery_app.backend is backend
        signatures = list(cast("Iterator[Signature[object]]", job.kwargs["tasks"]))
        assert len(signatures) == 1
        assert signatures[0].task == schedule_task.run_schedule_trigger.name
        assert signatures[0].args == (schedule.id,)
        assert options == {"producer": producer, "add_to_parent": False}
        if failure_stage == "publish":
            raise ValueError("publish")

    def close_pubsub() -> None:
        events.append("cleanup")
        pubsub.reset()

    event.listen(sqlite_session, "after_commit", after_commit)
    event.listen(sqlite_session, "before_commit", before_commit)
    try:
        with (
            cast(AbstractContextManager[Producer], celery_app.producer_or_acquire()) as producer,
            patch.object(group, "apply_async", new=publish),
            patch.object(pubsub, "close", side_effect=close_pubsub),
        ):
            expected = nullcontext() if failure_stage == "none" else pytest.raises(ValueError, match=failure_stage)
            with expected:
                assert schedule_task._process_schedules(sqlite_session, [schedule], producer) == 1
        assert (
            events
            == {
                "none": ["publish", "commit", "cleanup"],
                "publish": ["publish", "cleanup"],
                "commit": ["publish", "commit_failed", "cleanup"],
            }[failure_stage]
        )
        assert schedule.next_run_at is not None
        assert schedule.next_run_at > before_dispatch
        if failure_stage == "none":
            next_run_at = schedule.next_run_at
            sqlite_session.expire(schedule)
            # SQLite 的 DateTime 列按无时区 UTC 保存。
            assert schedule.next_run_at == next_run_at.replace(tzinfo=None)
        assert backend.result_consumer._pubsub is None
        assert not backend.result_consumer.subscribed_to
        assert not any(cast(BackendPendingResults, backend)._pending_results)
    finally:
        event.remove(sqlite_session, "after_commit", after_commit)
        event.remove(sqlite_session, "before_commit", before_commit)
        sqlite_session.rollback()
    del result


def test_empty_batch_does_not_create_backend_or_commit(celery_app: Celery, sqlite_session: Session) -> None:
    with (
        patch.object(celery_app, "_get_backend", side_effect=AssertionError("空批次不创建 backend")),
        patch.object(sqlite_session, "commit", wraps=sqlite_session.commit) as commit,
    ):
        assert schedule_task._process_schedules(sqlite_session, []) == 0
    commit.assert_not_called()
    assert cast(AppBackendCache, celery_app)._backend is None


def test_real_gevent_groups_close_sockets_and_keep_other_backends_isolated() -> None:
    """隔离 monkey patch，使用真实连接池、PubSub 和本地 socketpair，无网络访问。"""
    tree = ast.parse(Path(schedule_task.__file__).read_text())
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
from unittest.mock import patch
import gevent
from celery import Celery, current_app, group
from celery.app import backends
from celery.backends.asynchronous import geventDrainer
from celery.backends.redis import RedisBackend
from redis.connection import Connection, ConnectionPool

sockets = []
pools = []
consumers = []
results = []
# 仅替换传输方法，连接池租借/归还和 PubSub 清理保持真实。
def connect(connection):
    if connection._sock is None:
        connection._sock, peer = socket.socketpair()
        sockets.extend((connection._sock, peer))
def can_read(connection, timeout=0):
    gevent.sleep(timeout or 0)
    return False
original_disconnect = ConnectionPool.disconnect
def disconnect(pool, *args, **kwargs):
    pools.append(pool)
    return original_disconnect(pool, *args, **kwargs)
app = Celery("schedule_cleanup_test", broker="memory://", backend="redis://localhost/1")
app.conf.task_ignore_result = True
app.set_default()
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
                backend = app.backend
                assert backend is not previous
                consumers.append(backend.result_consumer)
                result = group(child.s(), child.s(), app=app).apply_async(
                    producer=producer, add_to_parent=False)
                results.append(result)
                gevent.sleep(0.02)
                if fails:
                    raise ValueError("partial dispatch")
        except ValueError:
            assert fails
    assert app.backend is previous
    assert previous_pool not in pools
    assert not previous_pool._available_connections
    assert not previous_pool._in_use_connections
    assert not previous.result_consumer.subscribed_to
with (
    patch.object(Connection, "connect", new=connect),
    patch.object(Connection, "can_read", new=can_read),
    patch.object(ConnectionPool, "disconnect", new=disconnect),
):
    for cycle in range(3):
        jobs = [gevent.spawn(dispatch), gevent.spawn(dispatch, True)]
        gevent.joinall(jobs, timeout=5, raise_error=True)
        assert all(job.dead for job in jobs)
        assert len(consumers) == (cycle + 1) * 2
        assert len(sockets) == (cycle + 1) * 4
        assert all(c.drainer._g is not None and c.drainer._g.dead for c in consumers)
        assert all(c._pubsub is None for c in consumers)
        assert all(not c.subscribed_to for c in consumers)
        assert all(sock.fileno() == -1 for sock in sockets[::2])
    # 保留结果直到作用域退出，确保真实析构不会重连。
    connected = len(sockets)
    results.clear()
    gc.collect()
    assert len(sockets) == connected
    assert all(sock.fileno() == -1 for sock in sockets[::2])
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
    assert backend.client.connection_pool in pools
    assert all(sock.fileno() == -1 for sock in sockets[::2])
# 订阅命令经过真实 Redis 打包和 socketpair 写入，不伪造客户端或连接池。
for peer in sockets[1::2]:
    peer.settimeout(1)
    commands = peer.recv(4096)
    assert b"SUBSCRIBE" in commands
    peer.close()
assert all(sock.fileno() == -1 for sock in sockets)
print("6 group dispatches and blocked drainer: consumers exited, sockets closed")
"""
    env = {key: value for key, value in os.environ.items() if not key.startswith("CELERY_")}
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=30, env=env)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "6 group dispatches and blocked drainer" in result.stdout


@pytest.mark.parametrize("failure_stage", ["pubsub", "disconnect"])
def test_synchronous_cleanup_failure_is_logged_and_backend_restored(
    celery_app: Celery, dispatch_backend: RedisBackend, failure_stage: str
) -> None:
    """同步消费者也必须记录清理异常；不依赖协程切换或专用覆盖率配置。"""
    backend = dispatch_backend
    previous = celery_app.backend
    consumer = backend.result_consumer
    consumer.drainer = Drainer(consumer)
    result = subscribe_result(backend)
    pubsub = consumer._pubsub
    assert isinstance(pubsub, PubSub)
    pool = backend.client.connection_pool
    target, method = (pubsub, "close") if failure_stage == "pubsub" else (pool, "disconnect")
    with (
        patch.object(pool, "disconnect", wraps=pool.disconnect) as disconnect,
        patch.object(target, method, side_effect=RuntimeError("cleanup failed")) as failing,
        patch.object(schedule_task.logger, "exception") as log,
    ):
        with schedule_task._dispatch_result_backend():
            pass
        failing.assert_called_once()
        if failure_stage == "pubsub":
            disconnect.assert_called_once()
        log.assert_called_once_with("Failed to close schedule dispatch Redis result backend")
    assert celery_app.backend is previous
    assert consumer._pubsub is None
    assert not consumer.subscribed_to
    assert not any(cast(BackendPendingResults, backend)._pending_results)
    del result
