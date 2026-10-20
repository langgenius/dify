"""FastAPI application factory for the Dify Agent run server.

The HTTP process owns Redis clients plus separate shared ``httpx.AsyncClient``
instances for plugin-daemon and Dify API inner calls, route wiring, and a
process-local scheduler. Run execution happens in background ``asyncio`` tasks
rather than request handlers, so client disconnects do not cancel the agent
runtime. Redis persists run records and per-run event streams with configured
retention. Optional provider accounting is exposed as a separate one-shot HTTP
endpoint driven by Celery Beat; it starts no tasks during lifespan startup and
adds no reporting to business operations. Redis is not used as a run job queue. Modules borrow lifespan-owned services through run dependencies; their JSON
configuration and state never retain live infrastructure. The standard server mounts the
HTTP Agent Stub router. Process-level platform Logfire instrumentation is
configured at app construction time. Logfire-platform export is token-gated;
standard OTLP export follows the SDK environment configuration, including
server dotenv files. Agent trajectory export is a separate opt-in Logfire
instance owned by the app lifespan and injected into each run's runner.
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx
from fastapi import APIRouter, FastAPI
from redis.asyncio import Redis
from typing_extensions import cast

from dify_agent.adapters.native_testing.transport import (
    AgentRuntimeHTTPClient,
    AgentRuntimeTransportError,
    LegacyPluginDaemonTransport,
)
from dify_agent.agent_stub.server.admission import AgentStubAdmission
from dify_agent.adapters.native_testing.transport import current_runtime_identity
from dify_agent.agent_stub.server.router import create_agent_stub_router
from dify_agent.agent_stub.shell_env import ShellAgentStubTokenFactory
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.runtime.context import Services
from dify_agent.runtime.native_continuation import NativeContinuationOwner
from dify_agent.protocol.native_testing import NativeTestCapabilities
from dify_agent.runtime.confirmed_continuation import ConfirmedNativeContinuationOwner
from dify_agent.runtime.run_scheduler import RunScheduler
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend
from dify_agent.server.auth import create_bearer_token_dependency
from dify_agent.server.binding_files import BindingFileService
from dify_agent.server.execution_bindings import ExecutionBindingService
from dify_agent.server.home_snapshots import HomeSnapshotService
from dify_agent.server.observability import configure_agent_observability, configure_server_observability
from dify_agent.server.routes.binding_files import create_binding_files_router
from dify_agent.server.routes.e2b_usage import create_e2b_usage_router
from dify_agent.server.routes.execution_bindings import create_execution_bindings_router
from dify_agent.server.routes.home_snapshots import create_home_snapshots_router
from dify_agent.server.routes.runs import create_runs_router
from dify_agent.server.routes.native_testing import create_native_testing_router
from dify_agent.server.settings import ServerSettings
from dify_agent.storage.redis_run_store import RedisRunStore


def create_app(
    settings: ServerSettings | None = None, *, native_owner: NativeContinuationOwner | None = None
) -> FastAPI:
    """Build the FastAPI app with one shared Redis store and local scheduler."""
    resolved_settings = settings or ServerSettings()
    if native_owner is not None and (
        resolved_settings.api_token is None
        or (
            (resolved_settings.inner_api_key or resolved_settings.plugin_daemon_api_key)
            and not isinstance(native_owner, ConfirmedNativeContinuationOwner)
        )
    ):
        raise AgentRuntimeTransportError("native_legacy_authority_unqualified")
    agent_stub_token_codec = resolved_settings.create_agent_stub_token_codec()
    agent_stub_token_factory: ShellAgentStubTokenFactory | None = None
    if agent_stub_token_codec is not None:
        # Runtime receives only this callable boundary; the HTTP router keeps
        # the concrete token codec on the server side.
        def issue_agent_stub_token(
            execution_context: DifyExecutionContextLayerConfig,
            *,
            session_id: str | None,
        ) -> str:
            from dify_agent.runtime.native_effects import current_native_dispatch

            if not resolved_settings.inner_api_key or current_native_dispatch() is not None:
                return agent_stub_token_codec.encode_runtime_token(
                    execution_context, run_id=current_runtime_identity().run_id, session_id=session_id
                )
            return agent_stub_token_codec.encode_connection_token(
                execution_context,
                session_id=session_id,
            )

        agent_stub_token_factory = issue_agent_stub_token
    state: dict[str, object] = {}

    async def read_active_stub(identity):
        store = state.get("store")
        if not isinstance(store, RedisRunStore):
            raise AgentRuntimeTransportError("agent_stub_live_owner_unavailable")
        return await store.read_active_stub_identity(identity)

    def stub_client() -> AgentRuntimeHTTPClient:
        client = state.get("confirmed_api_http_client" if resolved_settings.inner_api_key else "dify_api_http_client")
        if not isinstance(client, AgentRuntimeHTTPClient):
            raise AgentRuntimeTransportError("agent_stub_live_owner_unavailable")
        return client

    stub_admission = AgentStubAdmission(reader=read_active_stub, allow_legacy=bool(resolved_settings.inner_api_key))
    agent_stub_file_request_handler = resolved_settings.create_agent_stub_file_request_handler(
        runtime_client=stub_client if stub_admission is not None else None, admission=stub_admission
    )
    agent_stub_config_request_handler = resolved_settings.create_agent_stub_config_request_handler(
        runtime_client=stub_client if stub_admission is not None else None, admission=stub_admission
    )
    runtime_backend_profile = resolved_settings.build_runtime_backend_profile()
    if (
        resolved_settings.api_token is None
        and runtime_backend_profile is not None
        and isinstance(runtime_backend_profile.execution_bindings, LocalExecutionBindingBackend)
    ):
        # The ordinary migration mode intentionally allows anonymous control
        # requests. Never expose the privileged native supervisor in that mode.
        # All routes and run services borrow this same backend, so existing
        # native refs also fail before acquisition, files, snapshot or cleanup I/O.
        runtime_backend_profile.execution_bindings.native_scope_client = None
    binding_file_service = (
        BindingFileService(
            execution_bindings=runtime_backend_profile.execution_bindings,
            agent_stub_api_base_url=resolved_settings.agent_stub_api_base_url,
            agent_stub_token_factory=agent_stub_token_factory if resolved_settings.inner_api_key else None,
            download_command_timeout_seconds=resolved_settings.binding_file_download_command_timeout_seconds,
        )
        if runtime_backend_profile is not None
        else None
    )
    home_snapshot_service = (
        HomeSnapshotService(
            home_snapshots=runtime_backend_profile.home_snapshots,
            execution_bindings=runtime_backend_profile.execution_bindings,
        )
        if runtime_backend_profile is not None
        else None
    )
    execution_binding_service = (
        ExecutionBindingService(backend=runtime_backend_profile.execution_bindings)
        if runtime_backend_profile is not None
        else None
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
        agent_observability = configure_agent_observability(resolved_settings)
        _app.state.agent_observability = agent_observability
        redis = Redis.from_url(resolved_settings.redis_url)
        plugin_daemon_http_client = create_plugin_daemon_http_client(resolved_settings)
        dify_api_inner_http_client = create_dify_api_inner_http_client(resolved_settings)
        confirmed_api_http_client = (
            AgentRuntimeHTTPClient(
                api_url=resolved_settings.inner_api_url,
                api_token=resolved_settings.api_token,
                timeout=resolved_settings.create_outbound_http_timeout(),
                limits=_http_limits(resolved_settings),
            )
            if resolved_settings.api_token is not None
            else None
        )
        resolved_native_owner = native_owner
        if resolved_native_owner is None and confirmed_api_http_client is not None:
            resolved_native_owner = ConfirmedNativeContinuationOwner(
                http_client=confirmed_api_http_client, base_url=resolved_settings.inner_api_url
            )
        store = RedisRunStore(
            redis,
            prefix=resolved_settings.redis_prefix,
            run_retention_seconds=resolved_settings.run_retention_seconds,
            run_event_stream_max_length=resolved_settings.run_event_stream_max_length,
        )
        scheduler = RunScheduler(
            native_owner=resolved_native_owner,
            store=store,
            services=Services(
                plugin_daemon_http_client=plugin_daemon_http_client,
                dify_api_http_client=dify_api_inner_http_client,
                confirmed_api_http_client=confirmed_api_http_client,
                plugin_daemon_url=resolved_settings.plugin_daemon_url,
                plugin_daemon_api_key=resolved_settings.plugin_daemon_api_key,
                inner_api_url=resolved_settings.inner_api_url,
                inner_api_key=resolved_settings.inner_api_key or "",
                runtime_backend_profile=runtime_backend_profile,
                shell_redact_patterns=resolved_settings.get_shell_redact_patterns(),
                agent_stub_api_base_url=resolved_settings.agent_stub_api_base_url,
                agent_stub_token_factory=agent_stub_token_factory,
            ),
            shutdown_grace_seconds=resolved_settings.shutdown_grace_seconds,
            run_timeout_seconds=resolved_settings.run_timeout_seconds,
            stream_text_delta_coalescing_enabled=resolved_settings.stream_text_delta_coalescing_enabled,
            stream_text_delta_flush_interval_seconds=(resolved_settings.stream_text_delta_flush_interval_ms / 1000),
            stream_text_delta_max_chars=resolved_settings.stream_text_delta_max_chars,
            agent_observability=agent_observability,
        )
        state["dify_api_http_client"] = dify_api_inner_http_client
        state["confirmed_api_http_client"] = confirmed_api_http_client
        state["store"] = store
        state["scheduler"] = scheduler
        try:
            yield
        finally:
            await scheduler.shutdown()
            state.clear()
            await dify_api_inner_http_client.aclose()
            if confirmed_api_http_client is not None:
                await confirmed_api_http_client.aclose()
            await plugin_daemon_http_client.aclose()
            await redis.aclose()
            # Closed last so runs draining above still reach the exporter.
            if agent_observability is not None:
                await agent_observability.aclose()

    app = FastAPI(title="Dify Agent Run Server", version="0.1.0", lifespan=lifespan)
    app.state.platform_observability = configure_server_observability(app, settings=resolved_settings)

    def get_store() -> RedisRunStore:
        return cast(RedisRunStore, state["store"])

    def get_scheduler() -> RunScheduler:
        return cast(RunScheduler, state["scheduler"])

    def get_capabilities() -> NativeTestCapabilities:
        capabilities = get_scheduler().native_capabilities
        # Authenticated lookup and the production Redis claim owner are installed
        # together here. Anonymous migration never advertises recovery admission.
        if resolved_settings.api_token is not None:
            return capabilities.model_copy(update={"features": capabilities.features | {"create-idempotency-v1"}})
        return capabilities

    control_plane_router = APIRouter(
        dependencies=[create_bearer_token_dependency(resolved_settings.api_token)],
    )
    control_plane_router.include_router(
        create_runs_router(
            get_store,
            get_scheduler,
            get_capabilities,
            enable_lookup=resolved_settings.api_token is not None,
        )
    )
    # Ordinary anonymous migration mode must never expose protected checkpoint history.
    if resolved_settings.api_token is not None:
        control_plane_router.include_router(create_native_testing_router(get_store))
    control_plane_router.include_router(create_execution_bindings_router(lambda: execution_binding_service))
    control_plane_router.include_router(create_home_snapshots_router(lambda: home_snapshot_service))
    control_plane_router.include_router(create_binding_files_router(lambda: binding_file_service))
    app.include_router(control_plane_router)
    app.include_router(create_e2b_usage_router(resolved_settings))
    app.include_router(
        create_agent_stub_router(
            token_codec=agent_stub_token_codec,
            admission=stub_admission,
            file_request_handler=agent_stub_file_request_handler,
            config_request_handler=agent_stub_config_request_handler,
        )
    )
    return app


def create_plugin_daemon_http_client(settings: ServerSettings) -> httpx.AsyncClient:
    """Create the lifespan-owned plugin daemon HTTP client with configured limits.

    The returned client is shared by all local background runs in this FastAPI
    process and must be closed by the app lifespan after the scheduler has stopped
    using it.
    """
    return _create_shared_http_client(
        settings,
        transport=LegacyPluginDaemonTransport(httpx.AsyncHTTPTransport(limits=_http_limits(settings), trust_env=False)),
    )


def create_dify_api_inner_http_client(settings: ServerSettings) -> httpx.AsyncClient:
    """Existing inner key selects unqualified legacy ordinary composition.

    Removing it selects strict runtime transport using the existing backend
    bearer. No configured bearer leaves outbound business authority unavailable;
    anonymous ordinary control-plane migration remains possible. Stub, runless
    export and process usage are separately unqualified until S2c.
    """
    if settings.inner_api_key:
        return _create_shared_http_client(settings)
    return AgentRuntimeHTTPClient(
        api_url=settings.inner_api_url,
        api_token=settings.api_token,
        timeout=settings.create_outbound_http_timeout(),
        limits=_http_limits(settings),
    )


def _http_limits(settings: ServerSettings) -> httpx.Limits:
    return httpx.Limits(
        max_connections=settings.outbound_http_max_connections,
        max_keepalive_connections=settings.outbound_http_max_keepalive_connections,
        keepalive_expiry=settings.outbound_http_keepalive_expiry,
    )


def _create_shared_http_client(
    settings: ServerSettings, *, transport: httpx.AsyncBaseTransport | None = None
) -> httpx.AsyncClient:
    """Legacy clients share configured timeouts and never inherit proxies."""
    return httpx.AsyncClient(
        timeout=settings.create_outbound_http_timeout(),
        limits=_http_limits(settings),
        trust_env=False,
        transport=transport,
    )


app = create_app()


__all__ = ["app", "create_app", "create_dify_api_inner_http_client", "create_plugin_daemon_http_client"]
