"""FastAPI application factory for the Dify Agent run server.

The HTTP process owns Redis clients, one shared plugin daemon ``httpx.AsyncClient``,
route wiring, and a process-local scheduler. Run execution happens in background
``asyncio`` tasks rather than request handlers, so client disconnects do not
cancel the agent runtime. Redis persists run records and per-run event streams
with configured retention only; it is not used as a job queue. Agenton layers and
providers stay state-only: they borrow the lifespan-owned plugin daemon client
through the runner and never create or close it themselves.
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from redis.asyncio import Redis

from dify_agent.runtime.compositor_factory import create_default_layer_providers
from dify_agent.runtime.run_scheduler import RunScheduler
from dify_agent.server.routes.runs import create_runs_router
from dify_agent.server.settings import ServerSettings
from dify_agent.storage.redis_run_store import RedisRunStore


def create_app(settings: ServerSettings | None = None) -> FastAPI:
    """Build the FastAPI app with one shared Redis store and local scheduler."""
    resolved_settings = settings or ServerSettings()
    layer_providers = create_default_layer_providers(
        plugin_daemon_url=resolved_settings.plugin_daemon_url,
        plugin_daemon_api_key=resolved_settings.plugin_daemon_api_key,
    )
    state: dict[str, object] = {}

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
        redis = Redis.from_url(resolved_settings.redis_url)
        plugin_daemon_http_client = create_plugin_daemon_http_client(resolved_settings)
        store = RedisRunStore(
            redis,
            prefix=resolved_settings.redis_prefix,
            run_retention_seconds=resolved_settings.run_retention_seconds,
        )
        scheduler = RunScheduler(
            store=store,
            plugin_daemon_http_client=plugin_daemon_http_client,
            shutdown_grace_seconds=resolved_settings.shutdown_grace_seconds,
            layer_providers=layer_providers,
        )
        state["store"] = store
        state["scheduler"] = scheduler
        try:
            yield
        finally:
            await scheduler.shutdown()
            await plugin_daemon_http_client.aclose()
            await redis.aclose()

    app = FastAPI(title="Dify Agent Run Server", version="0.1.0", lifespan=lifespan)

    def get_store() -> RedisRunStore:
        return state["store"]  # pyright: ignore[reportReturnType]

    def get_scheduler() -> RunScheduler:
        return state["scheduler"]  # pyright: ignore[reportReturnType]

    app.include_router(create_runs_router(get_store, get_scheduler))
    return app


def create_plugin_daemon_http_client(settings: ServerSettings) -> httpx.AsyncClient:
    """Create the lifespan-owned plugin daemon HTTP client with configured limits.

    The returned client is shared by all local background runs in this FastAPI
    process and must be closed by the app lifespan after the scheduler has stopped
    using it.
    """
    return httpx.AsyncClient(
        timeout=httpx.Timeout(
            connect=settings.plugin_daemon_connect_timeout,
            read=settings.plugin_daemon_read_timeout,
            write=settings.plugin_daemon_write_timeout,
            pool=settings.plugin_daemon_pool_timeout,
        ),
        limits=httpx.Limits(
            max_connections=settings.plugin_daemon_max_connections,
            max_keepalive_connections=settings.plugin_daemon_max_keepalive_connections,
            keepalive_expiry=settings.plugin_daemon_keepalive_expiry,
        ),
        trust_env=False,
    )


app = create_app()


__all__ = ["app", "create_app", "create_plugin_daemon_http_client"]
