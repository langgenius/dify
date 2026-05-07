import asyncio
from typing import ClassVar

import pytest
from fastapi.testclient import TestClient

import dify_agent.server.app as app_module
from dify_agent.server.app import create_app
from dify_agent.server.settings import ServerSettings


class FakeRedis:
    closed: bool

    def __init__(self) -> None:
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


class FakeRunJobWorker:
    created: ClassVar[list["FakeRunJobWorker"]] = []

    group_name: str
    consumer_name: str
    pending_idle_ms: int
    started: bool
    cancelled: bool

    def __init__(
        self,
        *,
        store: object,
        group_name: str,
        consumer_name: str,
        pending_idle_ms: int,
    ) -> None:
        del store
        self.group_name = group_name
        self.consumer_name = consumer_name
        self.pending_idle_ms = pending_idle_ms
        self.started = False
        self.cancelled = False
        self.created.append(self)

    async def run_forever(self) -> None:
        self.started = True
        try:
            await asyncio.get_running_loop().create_future()
        except asyncio.CancelledError:
            self.cancelled = True
            raise


def test_create_app_starts_and_cancels_embedded_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = FakeRedis()
    FakeRunJobWorker.created.clear()
    monkeypatch.setattr(app_module.Redis, "from_url", lambda _url: fake_redis)
    monkeypatch.setattr(app_module, "RunJobWorker", FakeRunJobWorker)

    settings = ServerSettings(
        redis_url="redis://example.invalid/0",
        redis_prefix="test",
        worker_enabled=True,
        worker_group_name="workers",
        worker_consumer_name="consumer-a",
        worker_pending_idle_ms=5,
    )

    with TestClient(create_app(settings)):
        assert len(FakeRunJobWorker.created) == 1
        worker = FakeRunJobWorker.created[0]
        assert worker.started is True
        assert worker.group_name == "workers"
        assert worker.consumer_name == "consumer-a"
        assert worker.pending_idle_ms == 5

    assert FakeRunJobWorker.created[0].cancelled is True
    assert fake_redis.closed is True


def test_create_app_can_disable_embedded_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = FakeRedis()
    FakeRunJobWorker.created.clear()
    monkeypatch.setattr(app_module.Redis, "from_url", lambda _url: fake_redis)
    monkeypatch.setattr(app_module, "RunJobWorker", FakeRunJobWorker)

    with TestClient(create_app(ServerSettings(worker_enabled=False))):
        assert FakeRunJobWorker.created == []

    assert fake_redis.closed is True
