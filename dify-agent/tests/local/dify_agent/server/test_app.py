from __future__ import annotations

import base64
import os
import time
from typing import ClassVar

import httpx
from dify_agent.runtime.context import Services
from dify_agent.protocol.native_testing import NATIVE_TEST_CAPABILITIES, NativeTestCapabilities
from dify_agent.runtime.native_continuation import NativeContinuationOwner
import pytest
from fastapi.testclient import TestClient

import dify_agent.server.app as app_module
import dify_agent.server.observability as server_observability
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.server.app import create_app, create_dify_api_inner_http_client, create_plugin_daemon_http_client
from dify_agent.server.settings import ServerSettings


@pytest.fixture(autouse=True)
def _isolated_app_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep app construction independent of the developer's dotenv and SDK env.

    ``ServerSettings`` resolves ``.env``/``dify-agent/.env`` against the current
    directory, and importing this module builds ``app_module.app``, which already
    latched the process-global trace context mode from whatever it found there.
    Pinning the settings source and resetting that latch lets each case build an
    app from the settings it states, in any order and on any machine.
    """
    for name in tuple(os.environ):
        if name.startswith(("DIFY_AGENT_", "OTEL_", "LOGFIRE_")):
            monkeypatch.delenv(name)
    monkeypatch.setitem(ServerSettings.model_config, "env_file", None)
    monkeypatch.setattr(server_observability, "_global_instrumentation_ready", False)
    monkeypatch.setattr(server_observability, "_global_trace_context_mode", None)


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
    run_timeout_seconds: float
    stream_text_delta_coalescing_enabled: bool
    stream_text_delta_flush_interval_seconds: float
    stream_text_delta_max_chars: int
    services: Services
    plugin_daemon_http_client: FakePluginDaemonHttpClient
    dify_api_http_client: FakePluginDaemonHttpClient
    shutdown_called: bool

    def __init__(
        self,
        *,
        store: object,
        services: Services,
        shutdown_grace_seconds: float,
        run_timeout_seconds: float,
        stream_text_delta_coalescing_enabled: bool,
        stream_text_delta_flush_interval_seconds: float,
        stream_text_delta_max_chars: int,
        agent_observability: object | None = None,
        native_owner: NativeContinuationOwner | None = None,
    ) -> None:
        self.native_owner = native_owner
        self.native_capabilities = native_owner.capabilities if native_owner is not None else NATIVE_TEST_CAPABILITIES
        self.store = store
        self.shutdown_grace_seconds = shutdown_grace_seconds
        self.run_timeout_seconds = run_timeout_seconds
        self.stream_text_delta_coalescing_enabled = stream_text_delta_coalescing_enabled
        self.stream_text_delta_flush_interval_seconds = stream_text_delta_flush_interval_seconds
        self.stream_text_delta_max_chars = stream_text_delta_max_chars
        self.services = services
        self.plugin_daemon_http_client = services.plugin_daemon_http_client
        self.dify_api_http_client = services.dify_api_http_client
        self.agent_observability = agent_observability
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
        transport: object | None = None,
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
    AsyncHTTPTransport = staticmethod(lambda **kwargs: object())


@pytest.mark.parametrize(
    "path",
    [
        "/runs",
        "/execution-bindings",
        "/home-snapshots/from-binding",
        "/execution-bindings/files/list",
    ],
)
def test_create_app_authenticates_control_plane_routes(
    monkeypatch: pytest.MonkeyPatch,
    path: str,
) -> None:
    _patch_app_lifecycle(monkeypatch)
    settings = ServerSettings(redis_url="redis://example.invalid/0", api_token="secret-token")

    with TestClient(create_app(settings)) as client:
        assert client.post(path, json={}).status_code == 401
        assert client.post(path, headers={"Authorization": "Bearer secret-token"}, json={}).status_code != 401


def test_create_app_wires_authenticated_agent_stub_connection_route(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis, fake_http_client = _patch_app_lifecycle(monkeypatch)
    settings = ServerSettings(
        redis_url="redis://example.invalid/0",
        agent_stub_api_base_url="https://agent.example.com/agent-stub",
        inner_api_key="explicit-legacy-test-key",
        sandbox_files_base_url="http://files.example",
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
        agent_stub_api_base_url="https://agent.example.com/agent-stub",
        server_secret_key=_base64url_secret(b"1" * 32),
        inner_api_url="https://api.example.com",
        inner_api_key="inner-secret",
        sandbox_files_base_url="https://files.example.com",
    )
    token_codec = settings.create_agent_stub_token_codec()
    assert token_codec is not None
    token = token_codec.encode_connection_token(_execution_context(), now=int(time.time()) - 1)

    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.example.com/inner/api/agent/files/upload-request"
        assert request.headers["X-Inner-Api-Key"] == "inner-secret"
        return httpx.Response(200, json={"upload_uri": "/files/upload/for-plugin?sign=1"})

    monkeypatch.setattr(
        "dify_agent.agent_stub.server.agent_stub_files.httpx.AsyncClient",
        lambda **kwargs: original_async_client(**(kwargs | {"transport": httpx.MockTransport(handler)})),
    )

    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/agent-stub/files/upload-request",
            headers={"Authorization": f"Bearer {token}"},
            json={"filename": "report.pdf", "mimetype": "application/pdf"},
        )

    assert response.status_code == 200
    assert response.json() == {"upload_url": "https://files.example.com/files/upload/for-plugin?sign=1"}
    assert FakeRunScheduler.created[0].shutdown_called is True
    assert fake_http_client.is_closed is True
    assert fake_redis.closed is True


def test_create_plugin_daemon_http_client_uses_generic_outbound_httpx_construction_args(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(app_module, "httpx", FakeHttpxModule)

    client = create_plugin_daemon_http_client(
        ServerSettings(
            outbound_http_connect_timeout=1,
            outbound_http_read_timeout=2,
            outbound_http_write_timeout=3,
            outbound_http_pool_timeout=4,
            outbound_http_max_connections=5,
            outbound_http_max_keepalive_connections=3,
            outbound_http_keepalive_expiry=6,
        )
    )

    assert isinstance(client, FakePluginDaemonHttpClient)
    assert client.timeout.connect == 1
    assert client.timeout.read == 2
    assert client.timeout.write == 3
    assert client.timeout.pool == 4
    assert isinstance(client.limits, FakeLimits)
    assert client.limits.max_connections == 5
    assert client.limits.max_keepalive_connections == 3
    assert client.limits.keepalive_expiry == 6
    assert client.trust_env is False


def test_create_dify_api_inner_http_client_uses_generic_outbound_httpx_construction_args(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(app_module, "httpx", FakeHttpxModule)

    client = create_dify_api_inner_http_client(
        ServerSettings(
            inner_api_key="test-legacy-key",
            outbound_http_connect_timeout=1,
            outbound_http_read_timeout=2,
            outbound_http_write_timeout=3,
            outbound_http_pool_timeout=4,
            outbound_http_max_connections=5,
            outbound_http_max_keepalive_connections=3,
            outbound_http_keepalive_expiry=6,
        )
    )

    assert isinstance(client, FakePluginDaemonHttpClient)
    assert client.timeout.connect == 1
    assert client.timeout.read == 2
    assert client.timeout.write == 3
    assert client.timeout.pool == 4
    assert isinstance(client.limits, FakeLimits)
    assert client.limits.max_connections == 5
    assert client.limits.max_keepalive_connections == 3
    assert client.limits.keepalive_expiry == 6
    assert client.trust_env is False


def test_create_app_lifecycle_owns_agent_observability_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_app_lifecycle(monkeypatch)
    events: list[str] = []

    class FakeAgentObservability:
        async def aclose(self) -> None:
            events.append("agent-observability-close")

    sentinel = FakeAgentObservability()

    def fake_configure_agent_observability(_settings: ServerSettings) -> object:
        events.append("agent-observability-configure")
        return sentinel

    async def recording_shutdown(self: FakeRunScheduler) -> None:
        self.shutdown_called = True
        events.append("scheduler-shutdown")

    monkeypatch.setattr(app_module, "configure_agent_observability", fake_configure_agent_observability)
    monkeypatch.setattr(FakeRunScheduler, "shutdown", recording_shutdown)
    FakeRunScheduler.created.clear()

    app = create_app(ServerSettings(redis_url="redis://example.invalid/0"))
    with TestClient(app):
        assert app.state.agent_observability is sentinel
        assert FakeRunScheduler.created[0].agent_observability is sentinel
        assert events == ["agent-observability-configure"]

    # The instance is closed after the scheduler drains, so spans from runs
    # finishing during shutdown still reach the exporter.
    assert events == ["agent-observability-configure", "scheduler-shutdown", "agent-observability-close"]


def test_create_app_defaults_agent_observability_to_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_app_lifecycle(monkeypatch)
    FakeRunScheduler.created.clear()
    settings = ServerSettings(redis_url="redis://example.invalid/0", trajectory_enabled=False)
    created: list[ServerSettings] = []
    real_configure = app_module.configure_agent_observability

    def recording_configure(settings: ServerSettings):
        created.append(settings)
        return real_configure(settings)

    monkeypatch.setattr(app_module, "configure_agent_observability", recording_configure)
    app = create_app(settings)
    with TestClient(app):
        assert app.state.agent_observability is None
        assert FakeRunScheduler.created[0].agent_observability is None

    assert created == [settings]
    assert app.state.platform_observability is not None


def test_create_app_passes_settings_to_server_observability(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_app_lifecycle(monkeypatch)
    captured: dict[str, object] = {}
    sentinel = object()

    def fake_configure(app, *, settings=None):
        captured["app"] = app
        captured["settings"] = settings
        return sentinel

    monkeypatch.setattr(app_module, "configure_server_observability", fake_configure)
    settings = ServerSettings(
        _env_file=None,
        redis_url="redis://example.invalid/0",
        trajectory_trace_context_mode="shared",
    )

    app = create_app(settings)

    assert captured["app"] is app
    assert captured["settings"] is settings
    assert app.state.platform_observability is sentinel


def test_server_settings_use_generic_outbound_http_args_for_shared_clients() -> None:
    model_fields = ServerSettings.model_fields

    assert "inner_api_url" in model_fields
    assert "inner_api_key" in model_fields
    assert "outbound_http_connect_timeout" in model_fields
    assert "outbound_http_read_timeout" in model_fields
    assert "outbound_http_write_timeout" in model_fields
    assert "outbound_http_pool_timeout" in model_fields
    assert "outbound_http_max_connections" in model_fields
    assert "outbound_http_max_keepalive_connections" in model_fields
    assert "outbound_http_keepalive_expiry" in model_fields


@pytest.mark.parametrize("enabled", [False, True])
def test_optional_metering_never_starts_a_collector_or_blocks_runtime_startup(
    monkeypatch: pytest.MonkeyPatch, enabled: bool
) -> None:
    import dify_agent.server.routes.e2b_usage as usage_route

    _patch_app_lifecycle(monkeypatch)

    def unexpected_collector(*args: object, **kwargs: object) -> None:
        raise AssertionError("collector must only be constructed by an explicit scheduled request")

    monkeypatch.setattr(usage_route, "E2BUsageCollector", unexpected_collector)
    settings = ServerSettings(
        _env_file=None,
        sandbox_metering_enabled=enabled,
        runtime_backend="local",
        api_token="control-token",
        e2b_project_id="",
        e2b_api_key=None,
        inner_api_key=None,
    )
    with TestClient(create_app(settings)) as client:
        assert client.get("/openapi.json").status_code == 200
        response = client.post(
            "/internal/e2b/usage/collect",
            headers={"Authorization": "Bearer control-token"},
            json={"project_id": "project"},
        )
        assert response.status_code == 503
    assert FakeRunScheduler.created[-1].shutdown_called


def test_create_app_native_owner_injection_and_truthful_capabilities(monkeypatch):
    _patch_app_lifecycle(monkeypatch)

    class Owner:
        capabilities = NativeTestCapabilities(protocol_version=1, features=frozenset({"pending-call-v1"}))

    owner = Owner()
    app = create_app(ServerSettings(api_token="secret"), native_owner=owner)
    with TestClient(app) as client:
        response = client.get("/runs/capabilities", headers={"Authorization": "Bearer secret"})
        assert response.status_code == 200
        assert response.json()["protocol_version"] == 1
        assert set(response.json()["features"]) == {"pending-call-v1", "create-idempotency-v1"}
        assert client.get("/runs/capabilities").status_code == 401
        assert FakeRunScheduler.created[-1].native_owner is owner


def test_strict_embedded_stub_borrows_lifespan_reader_and_client(monkeypatch: pytest.MonkeyPatch) -> None:
    from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient, bind_runtime_identity
    from dify_agent.protocol.native_testing import AgentRuntimeIdentity

    _patch_app_lifecycle(monkeypatch)
    identity = AgentRuntimeIdentity(
        run_id="actual", execution_mode="ordinary", parent_node=None, request_digest="a" * 64, agent_generation=0
    )
    seen = []
    reads = []

    async def read_active(self, selected):
        reads.append((self, selected))
        return identity

    monkeypatch.setattr(app_module.RedisRunStore, "read_active_stub_identity", read_active)
    monkeypatch.setattr(
        app_module,
        "create_dify_api_inner_http_client",
        lambda settings: AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(req) or httpx.Response(200, json={})),
        ),
    )
    settings = ServerSettings(
        redis_url="redis://example.invalid/0",
        inner_api_url="http://api",
        api_token="backend",
        server_secret_key=_base64url_secret(b"1" * 32),
        sandbox_files_base_url="http://files",
    )
    codec = settings.create_agent_stub_token_codec()
    assert codec is not None
    context = _execution_context().model_copy(
        update={"agent_id": "agent", "agent_config_version_id": "config", "agent_config_version_kind": "draft"}
    )
    with bind_runtime_identity(identity):
        token = codec.encode_runtime_token(context, run_id="actual", session_id=None)
    with TestClient(create_app(settings)) as client:
        result = client.get("/agent-stub/config/skills/alpha/inspect", headers={"Authorization": "Bearer " + token})
        assert result.status_code == 200
        assert (
            client.post(
                "/agent-stub/connections",
                json={"protocol_version": 1, "argv": ["connect"]},
                headers={"Authorization": "Bearer " + codec.encode_connection_token(context)},
            ).status_code
            == 403
        )
    assert len(seen) == 1
    assert "X-Dify-Agent-Run" in seen[0].headers
    assert len(reads) >= 2
    assert all(store is reads[0][0] for store, _ in reads)


def test_confirmed_owner_is_composed_without_withdrawing_ordinary_keys(monkeypatch):
    from dify_agent.runtime.confirmed_continuation import ConfirmedNativeContinuationOwner
    from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient

    _patch_app_lifecycle(monkeypatch)
    settings = ServerSettings(
        _env_file=None, api_token="secret", inner_api_key="ordinary-inner", plugin_daemon_api_key="ordinary-plugin"
    )
    with TestClient(create_app(settings)) as client:
        response = client.get("/runs/capabilities", headers={"Authorization": "Bearer secret"})
        assert response.status_code == 200
        assert set(response.json()["features"]) == {"pending-call-v1", "policy-gate-v1", "create-idempotency-v1"}
        scheduler = FakeRunScheduler.created[-1]
        assert isinstance(scheduler.native_owner, ConfirmedNativeContinuationOwner)
        assert isinstance(scheduler.services.confirmed_api_http_client, AgentRuntimeHTTPClient)
        assert scheduler.services.inner_api_key == "ordinary-inner"
        assert scheduler.services.plugin_daemon_api_key == "ordinary-plugin"
