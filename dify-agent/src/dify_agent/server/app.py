"""FastAPI application factory for the Dify Agent run server.

The HTTP process owns Redis clients plus separate shared ``httpx.AsyncClient``
instances for plugin-daemon and Dify API inner calls, route wiring, and a
process-local scheduler. Run execution happens in background ``asyncio`` tasks
rather than request handlers, so client disconnects do not cancel the agent
runtime. Redis persists run records and per-run event streams with configured
retention only; it is not used as a job queue. Agenton layers and providers
stay state-only: they borrow the lifespan-owned clients through the runner and
receive shell-layer server settings through provider construction rather than
reading environment variables themselves. The standard server always mounts the
HTTP Agent Stub router and additionally starts the optional grpclib Agent Stub
server when ``DIFY_AGENT_STUB_API_BASE_URL`` uses ``grpc://``. Process-level
Logfire instrumentation is configured at app construction time and only exports
remotely when Logfire's default environment configuration provides a token.
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from redis.asyncio import Redis

from dify_agent.agent_stub.protocol.agent_stub import parse_agent_stub_endpoint
from dify_agent.agent_stub.server.grpc_runtime import start_agent_stub_grpc_server
from dify_agent.agent_stub.server.router import create_agent_stub_router
from dify_agent.runtime.compositor_factory import create_default_layer_providers
from dify_agent.runtime.run_scheduler import RunScheduler
from dify_agent.server.observability import configure_server_observability
from dify_agent.server.routes.runs import create_runs_router
from dify_agent.server.routes.sandbox_files import create_sandbox_files_router
from dify_agent.server.sandbox_files import SandboxFileService
from dify_agent.server.settings import ServerSettings
from dify_agent.storage.redis_run_store import RedisRunStore


def create_app(settings: ServerSettings | None = None) -> FastAPI:
    """Build the FastAPI app with one shared Redis store and local scheduler."""
    resolved_settings = settings or ServerSettings()
    agent_stub_token_codec = resolved_settings.create_agent_stub_token_codec()
    agent_stub_file_request_handler = resolved_settings.create_agent_stub_file_request_handler()
    agent_stub_config_request_handler = resolved_settings.create_agent_stub_config_request_handler()
    agent_stub_drive_request_handler = resolved_settings.create_agent_stub_drive_request_handler()
    layer_providers = create_default_layer_providers(
        plugin_daemon_url=resolved_settings.plugin_daemon_url,
        plugin_daemon_api_key=resolved_settings.plugin_daemon_api_key,
        inner_api_url=resolved_settings.inner_api_url,
        inner_api_key=resolved_settings.inner_api_key or "",
        shellctl_entrypoint=resolved_settings.shellctl_entrypoint,
        shellctl_auth_token=resolved_settings.shellctl_auth_token,
        agent_stub_api_base_url=resolved_settings.agent_stub_api_base_url,
        agent_stub_token_codec=agent_stub_token_codec,
    )
    sandbox_file_service = (
        SandboxFileService(layer_providers=layer_providers) if resolved_settings.shellctl_entrypoint else None
    )
    state: dict[str, object] = {}

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
        redis = Redis.from_url(resolved_settings.redis_url)
        plugin_daemon_http_client = create_plugin_daemon_http_client(resolved_settings)
        dify_api_inner_http_client = create_dify_api_inner_http_client(resolved_settings)
        store = RedisRunStore(
            redis,
            prefix=resolved_settings.redis_prefix,
            run_retention_seconds=resolved_settings.run_retention_seconds,
        )
        scheduler = RunScheduler(
            store=store,
            plugin_daemon_http_client=plugin_daemon_http_client,
            dify_api_http_client=dify_api_inner_http_client,
            shutdown_grace_seconds=resolved_settings.shutdown_grace_seconds,
            layer_providers=layer_providers,
        )
        grpc_server = None
        if (
            resolved_settings.agent_stub_api_base_url is not None
            and parse_agent_stub_endpoint(resolved_settings.agent_stub_api_base_url).is_grpc
        ):
            grpc_server = await start_agent_stub_grpc_server(
                public_url=resolved_settings.agent_stub_api_base_url,
                bind_address=resolved_settings.agent_stub_grpc_bind_address,
                token_codec=agent_stub_token_codec,
                file_request_handler=agent_stub_file_request_handler,
            )
        state["store"] = store
        state["scheduler"] = scheduler
        try:
            yield
        finally:
            if grpc_server is not None:
                await grpc_server.aclose()
            await scheduler.shutdown()
            await dify_api_inner_http_client.aclose()
            await plugin_daemon_http_client.aclose()
            await redis.aclose()

    app = FastAPI(title="Dify Agent Run Server", version="0.1.0", lifespan=lifespan)
    configure_server_observability(app)

    def get_store() -> RedisRunStore:
        return state["store"]  # pyright: ignore[reportReturnType]

    def get_scheduler() -> RunScheduler:
        return state["scheduler"]  # pyright: ignore[reportReturnType]

    app.include_router(create_runs_router(get_store, get_scheduler))
    app.include_router(create_sandbox_files_router(lambda: sandbox_file_service))
    app.include_router(
        create_agent_stub_router(
            token_codec=agent_stub_token_codec,
            file_request_handler=agent_stub_file_request_handler,
            config_request_handler=agent_stub_config_request_handler,
            drive_request_handler=agent_stub_drive_request_handler,
        )
    )
    return app


def create_plugin_daemon_http_client(settings: ServerSettings) -> httpx.AsyncClient:
    """Create the lifespan-owned plugin daemon HTTP client with configured limits.

    The returned client is shared by all local background runs in this FastAPI
    process and must be closed by the app lifespan after the scheduler has stopped
    using it.
    """
    return _create_shared_http_client(settings)


def create_dify_api_inner_http_client(settings: ServerSettings) -> httpx.AsyncClient:
    """Create the lifespan-owned Dify API inner HTTP client.

    The Dify API inner client intentionally shares the generic outbound HTTP
    timeout and connection-pool settings with the plugin daemon client so
    operational tuning stays in one place while endpoint URL/API keys remain
    distinct server settings.
    """
    return _create_shared_http_client(settings)


def _create_shared_http_client(settings: ServerSettings) -> httpx.AsyncClient:
    """Build one shared HTTP client using generic outbound timeout/pool settings."""
    return httpx.AsyncClient(
        timeout=settings.create_outbound_http_timeout(),
        limits=httpx.Limits(
            max_connections=settings.outbound_http_max_connections,
            max_keepalive_connections=settings.outbound_http_max_keepalive_connections,
            keepalive_expiry=settings.outbound_http_keepalive_expiry,
        ),
        trust_env=False,
    )


app = create_app()


__all__ = ["app", "create_app", "create_dify_api_inner_http_client", "create_plugin_daemon_http_client"]
