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


class FakeRunScheduler:
    created: list["FakeRunScheduler"] = []

    shutdown_grace_seconds: float
    shutdown_called: bool

    def __init__(
        self,
        *,
        store: object,
        shutdown_grace_seconds: float,
    ) -> None:
        del store
        self.shutdown_grace_seconds = shutdown_grace_seconds
        self.shutdown_called = False
        self.created.append(self)

    async def shutdown(self) -> None:
        self.shutdown_called = True


def test_create_app_creates_scheduler_and_closes_after_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = FakeRedis()
    FakeRunScheduler.created.clear()
    monkeypatch.setattr(app_module.Redis, "from_url", lambda _url: fake_redis)
    monkeypatch.setattr(app_module, "RunScheduler", FakeRunScheduler)

    settings = ServerSettings(
        redis_url="redis://example.invalid/0",
        redis_prefix="test",
        shutdown_grace_seconds=5,
    )

    with TestClient(create_app(settings)):
        assert len(FakeRunScheduler.created) == 1
        scheduler = FakeRunScheduler.created[0]
        assert scheduler.shutdown_grace_seconds == 5

    assert FakeRunScheduler.created[0].shutdown_called is True
    assert fake_redis.closed is True
