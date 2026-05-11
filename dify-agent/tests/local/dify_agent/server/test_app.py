import pytest
from fastapi.testclient import TestClient

import dify_agent.server.app as app_module
from agenton.compositor import LayerRegistry
from dify_agent.layers.dify_plugin.configs import DifyPluginLayerConfig
from dify_agent.layers.dify_plugin.plugin_layer import DifyPluginLayer
from dify_agent.server.app import create_app
from dify_agent.server.settings import ServerSettings
from dify_agent.storage.redis_run_store import RedisRunStore


class FakeRedis:
    closed: bool

    def __init__(self) -> None:
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


class FakeRunScheduler:
    created: list["FakeRunScheduler"] = []

    store: object
    shutdown_grace_seconds: float
    layer_registry: LayerRegistry
    shutdown_called: bool

    def __init__(
        self,
        *,
        store: object,
        shutdown_grace_seconds: float,
        layer_registry: LayerRegistry,
    ) -> None:
        self.store = store
        self.shutdown_grace_seconds = shutdown_grace_seconds
        self.layer_registry = layer_registry
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
        run_retention_seconds=7,
        plugin_daemon_url="http://plugin-daemon",
        plugin_daemon_api_key="daemon-secret",
        plugin_daemon_timeout=12,
    )

    with TestClient(create_app(settings)):
        assert len(FakeRunScheduler.created) == 1
        scheduler = FakeRunScheduler.created[0]
        assert scheduler.shutdown_grace_seconds == 5
        assert isinstance(scheduler.layer_registry, LayerRegistry)
        descriptor = scheduler.layer_registry.resolve("dify.plugin")
        assert descriptor.factory is not None
        plugin_layer = descriptor.factory(DifyPluginLayerConfig(tenant_id="tenant-1", plugin_id="plugin-1"))
        assert isinstance(plugin_layer, DifyPluginLayer)
        assert plugin_layer.daemon_url == "http://plugin-daemon"
        assert plugin_layer.daemon_api_key == "daemon-secret"
        assert plugin_layer.timeout == 12
        store = scheduler.store
        assert isinstance(store, RedisRunStore)
        assert store.run_retention_seconds == 7

    assert FakeRunScheduler.created[0].shutdown_called is True
    assert fake_redis.closed is True
