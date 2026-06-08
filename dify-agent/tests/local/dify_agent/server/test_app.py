from __future__ import annotations

import asyncio
import base64
import time
from typing import ClassVar

import httpx
import pytest
from fastapi.testclient import TestClient
from shell_session_manager.shellctl.client import ShellctlClient

import dify_agent.server.app as app_module
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.shell import DifyShellLayerConfig
from dify_agent.layers.shell.layer import DifyShellLayer
from dify_agent.runtime.compositor_factory import DifyAgentLayerProvider
from dify_agent.server.app import create_app, create_plugin_daemon_http_client
from dify_agent.server.settings import ServerSettings
from dify_agent.storage.redis_run_store import RedisRunStore


def _base64url_secret(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _execution_context() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        agent_mode="workflow_run",
        invoke_from="service-api",
    )


def _patch_app_lifecycle(monkeypatch: pytest.MonkeyPatch) -> tuple[FakeRedis, FakePluginDaemonHttpClient]:
    fake_redis = FakeRedis()
    fake_http_client = FakePluginDaemonHttpClient()
    FakeRunScheduler.created.clear()
    FakeRedisModule.fake_redis = fake_redis
    monkeypatch.setattr(app_module, "Redis", FakeRedisModule)
    monkeypatch.setattr(app_module, "RunScheduler", FakeRunScheduler)

    def fake_create_plugin_daemon_http_client(_settings: ServerSettings) -> FakePluginDaemonHttpClient:
        return fake_http_client

    monkeypatch.setattr(app_module, "create_plugin_daemon_http_client", fake_create_plugin_daemon_http_client)
    return fake_redis, fake_http_client


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


class FakeAgentStubGRPCServer:
    closed: bool

    def __init__(self) -> None:
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


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
    fake_redis, fake_http_client = _patch_app_lifecycle(monkeypatch)

    settings = ServerSettings(
        redis_url="redis://example.invalid/0",
        redis_prefix="test",
        shutdown_grace_seconds=5,
        run_retention_seconds=7,
        plugin_daemon_url="http://plugin-daemon",
        plugin_daemon_api_key="daemon-secret",
        shellctl_entrypoint="http://shellctl",
        shellctl_auth_token="shell-secret",
        agent_stub_url="https://agent.example.com/agent-stub",
        server_secret_key=_base64url_secret(b"1" * 32),
        dify_api_base_url="https://api.example.com",
        dify_api_inner_api_key="inner-secret",
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
        execution_context_provider = next(
            provider for provider in layer_providers if provider.type_id == "dify.execution_context"
        )
        execution_context_layer = execution_context_provider.create_layer(
            DifyExecutionContextLayerConfig(
                tenant_id="tenant-1",
                user_from="account",
                agent_mode="workflow_run",
                invoke_from="service-api",
            )
        )
        shell_provider = next(provider for provider in layer_providers if provider.type_id == "dify.shell")
        shell_layer = shell_provider.create_layer(DifyShellLayerConfig())
        assert isinstance(execution_context_layer, DifyExecutionContextLayer)
        assert isinstance(shell_layer, DifyShellLayer)
        assert execution_context_layer.daemon_url == "http://plugin-daemon"
        assert execution_context_layer.daemon_api_key == "daemon-secret"
        assert shell_layer.shellctl_entrypoint == "http://shellctl"
        assert shell_layer.agent_stub_url == "https://agent.example.com/agent-stub"
        shellctl_client = shell_layer.shellctl_client_factory("http://shellctl")
        assert isinstance(shellctl_client, ShellctlClient)
        assert shellctl_client.token == "shell-secret"
        asyncio.run(shellctl_client.close())
        http_client = scheduler.plugin_daemon_http_client
        assert http_client is fake_http_client
        assert http_client.is_closed is False
        store = scheduler.store
        assert isinstance(store, RedisRunStore)
        assert store.run_retention_seconds == 7
        assert any(getattr(route, "path", None) == "/agent-stub/connections" for route in create_app(settings).routes)
        assert any(
            getattr(route, "path", None) == "/agent-stub/files/upload-request"
            for route in create_app(settings).routes
        )
        assert any(
            getattr(route, "path", None) == "/agent-stub/files/download-request"
            for route in create_app(settings).routes
        )

    assert FakeRunScheduler.created[0].shutdown_called is True
    assert FakeRunScheduler.created[0].plugin_daemon_http_client.is_closed is True
    assert fake_redis.closed is True


def test_create_app_wires_authenticated_agent_stub_connection_route(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis, fake_http_client = _patch_app_lifecycle(monkeypatch)
    settings = ServerSettings(
        redis_url="redis://example.invalid/0",
        agent_stub_url="https://agent.example.com/agent-stub",
        server_secret_key=_base64url_secret(b"1" * 32),
    )
    token_codec = settings.create_agent_stub_token_codec()
    assert token_codec is not None
    token = token_codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/agent-stub/connections",
            headers={"Authorization": f"Bearer {token}"},
            json={"protocol_version": 1, "argv": ["connect"]},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "connected"
    assert isinstance(response.json()["connection_id"], str)
    assert FakeRunScheduler.created[0].shutdown_called is True
    assert fake_http_client.is_closed is True
    assert fake_redis.closed is True


def test_create_app_wires_authenticated_agent_stub_file_upload_route(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis, fake_http_client = _patch_app_lifecycle(monkeypatch)
    settings = ServerSettings(
        redis_url="redis://example.invalid/0",
        agent_stub_url="https://agent.example.com/agent-stub",
        server_secret_key=_base64url_secret(b"1" * 32),
        dify_api_base_url="https://api.example.com",
        dify_api_inner_api_key="inner-secret",
    )
    token_codec = settings.create_agent_stub_token_codec()
    assert token_codec is not None
    token = token_codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.example.com/inner/api/upload/file/request"
        assert request.headers["X-Inner-Api-Key"] == "inner-secret"
        return httpx.Response(200, json={"data": {"url": "https://files.example.com/upload"}})

    monkeypatch.setattr(
        "dify_agent.agent_stub.server.agent_stub_files.httpx.AsyncClient",
        lambda **kwargs: original_async_client(transport=httpx.MockTransport(handler), **kwargs),
    )

    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/agent-stub/files/upload-request",
            headers={"Authorization": f"Bearer {token}"},
            json={"filename": "report.pdf", "mimetype": "application/pdf"},
        )

    assert response.status_code == 200
    assert response.json() == {"upload_url": "https://files.example.com/upload"}
    assert FakeRunScheduler.created[0].shutdown_called is True
    assert fake_http_client.is_closed is True
    assert fake_redis.closed is True


def test_create_app_starts_and_stops_agent_stub_grpc_server_for_grpc_url(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis, fake_http_client = _patch_app_lifecycle(monkeypatch)
    started: dict[str, object] = {}
    fake_grpc_server = FakeAgentStubGRPCServer()

    async def fake_start_agent_stub_grpc_server(**kwargs):
        started.update(kwargs)
        return fake_grpc_server

    monkeypatch.setattr(app_module, "start_agent_stub_grpc_server", fake_start_agent_stub_grpc_server)

    settings = ServerSettings(
        redis_url="redis://example.invalid/0",
        agent_stub_url="grpc://agent.example.com:9091",
        agent_stub_grpc_bind_address="0.0.0.0:9191",
        server_secret_key=_base64url_secret(b"1" * 32),
    )

    with TestClient(create_app(settings)):
        assert started["public_url"] == "grpc://agent.example.com:9091"
        assert started["bind_address"] == "0.0.0.0:9191"

    assert fake_grpc_server.closed is True
    assert FakeRunScheduler.created[0].shutdown_called is True
    assert fake_http_client.is_closed is True
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
