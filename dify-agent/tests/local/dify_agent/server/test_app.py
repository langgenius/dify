from __future__ import annotations

from typing import ClassVar

import pytest
from fastapi.testclient import TestClient

import dify_agent.server.app as app_module
from dify_agent.runtime.compositor_factory import DifyAgentLayerProvider
from dify_agent.layers.dify_plugin.configs import DifyPluginLayerConfig
from dify_agent.layers.dify_plugin.plugin_layer import DifyPluginLayer
from dify_agent.server.app import create_app, create_plugin_daemon_http_client
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
    layer_providers: tuple[DifyAgentLayerProvider, ...]
    plugin_daemon_http_client: FakePluginDaemonHttpClient
    shutdown_called: bool

    def __init__(
        self,
        *,
        store: object,
        plugin_daemon_http_client: FakePluginDaemonHttpClient,
        shutdown_grace_seconds: float,
        layer_providers: tuple[DifyAgentLayerProvider, ...],
    ) -> None:
        self.store = store
        self.shutdown_grace_seconds = shutdown_grace_seconds
        self.layer_providers = layer_providers
        self.plugin_daemon_http_client = plugin_daemon_http_client
        self.shutdown_called = False
        self.created.append(self)

    async def shutdown(self) -> None:
        self.shutdown_called = True


class FakePluginDaemonHttpClient:
    timeout: object | None
    limits: object | None
    trust_env: bool | None
    is_closed: bool

    def __init__(
        self,
        *,
        timeout: object | None = None,
        limits: object | None = None,
        trust_env: bool | None = None,
    ) -> None:
        self.timeout = timeout
        self.limits = limits
        self.trust_env = trust_env
        self.is_closed = False

    async def aclose(self) -> None:
        self.is_closed = True


class FakeTimeout:
    connect: float
    read: float
    write: float
    pool: float

    def __init__(self, *, connect: float, read: float, write: float, pool: float) -> None:
        self.connect = connect
        self.read = read
        self.write = write
        self.pool = pool


class FakeLimits:
    max_connections: int
    max_keepalive_connections: int
    keepalive_expiry: float

    def __init__(self, *, max_connections: int, max_keepalive_connections: int, keepalive_expiry: float) -> None:
        self.max_connections = max_connections
        self.max_keepalive_connections = max_keepalive_connections
        self.keepalive_expiry = keepalive_expiry


class FakeRedisModule:
    fake_redis: ClassVar[FakeRedis | None] = None

    @staticmethod
    def from_url(_url: str) -> FakeRedis:
        assert FakeRedisModule.fake_redis is not None
        return FakeRedisModule.fake_redis


class FakeHttpxModule:
    Timeout: ClassVar[type[FakeTimeout]] = FakeTimeout
    Limits: ClassVar[type[FakeLimits]] = FakeLimits
    AsyncClient: ClassVar[type[FakePluginDaemonHttpClient]] = FakePluginDaemonHttpClient


def test_create_app_creates_scheduler_and_closes_after_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = FakeRedis()
    fake_http_client = FakePluginDaemonHttpClient()
    FakeRunScheduler.created.clear()
    FakeRedisModule.fake_redis = fake_redis
    monkeypatch.setattr(app_module, "Redis", FakeRedisModule)
    monkeypatch.setattr(app_module, "RunScheduler", FakeRunScheduler)

    def fake_create_plugin_daemon_http_client(_settings: ServerSettings) -> FakePluginDaemonHttpClient:
        return fake_http_client

    monkeypatch.setattr(app_module, "create_plugin_daemon_http_client", fake_create_plugin_daemon_http_client)

    settings = ServerSettings(
        redis_url="redis://example.invalid/0",
        redis_prefix="test",
        shutdown_grace_seconds=5,
        run_retention_seconds=7,
        plugin_daemon_url="http://plugin-daemon",
        plugin_daemon_api_key="daemon-secret",
        plugin_daemon_connect_timeout=1,
        plugin_daemon_read_timeout=2,
        plugin_daemon_write_timeout=3,
        plugin_daemon_pool_timeout=4,
        plugin_daemon_max_connections=5,
        plugin_daemon_max_keepalive_connections=3,
        plugin_daemon_keepalive_expiry=6,
    )

    with TestClient(create_app(settings)):
        assert len(FakeRunScheduler.created) == 1
        scheduler = FakeRunScheduler.created[0]
        assert scheduler.shutdown_grace_seconds == 5
        layer_providers = scheduler.layer_providers
        assert isinstance(layer_providers, tuple)
        plugin_provider = next(provider for provider in layer_providers if provider.type_id == "dify.plugin")
        plugin_layer = plugin_provider.create_layer(DifyPluginLayerConfig(tenant_id="tenant-1", plugin_id="plugin-1"))
        assert isinstance(plugin_layer, DifyPluginLayer)
        assert plugin_layer.daemon_url == "http://plugin-daemon"
        assert plugin_layer.daemon_api_key == "daemon-secret"
        http_client = scheduler.plugin_daemon_http_client
        assert http_client is fake_http_client
        assert http_client.is_closed is False
        store = scheduler.store
        assert isinstance(store, RedisRunStore)
        assert store.run_retention_seconds == 7

    assert FakeRunScheduler.created[0].shutdown_called is True
    assert FakeRunScheduler.created[0].plugin_daemon_http_client.is_closed is True
    assert fake_redis.closed is True


def test_create_plugin_daemon_http_client_uses_configured_httpx_construction_args(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(app_module, "httpx", FakeHttpxModule)

    client = create_plugin_daemon_http_client(ServerSettings())

    assert isinstance(client, FakePluginDaemonHttpClient)
    assert isinstance(client.timeout, FakeTimeout)
    assert client.timeout.connect == 10
    assert client.timeout.read == 600
    assert client.timeout.write == 30
    assert client.timeout.pool == 10
    assert isinstance(client.limits, FakeLimits)
    assert client.limits.max_connections == 100
    assert client.limits.max_keepalive_connections == 20
    assert client.limits.keepalive_expiry == 30
    assert client.trust_env is False
