"""FastAPI application factory for the Dify Agent run server.

The HTTP process owns Redis clients, route wiring, and a process-local scheduler.
Run execution happens in background ``asyncio`` tasks rather than request
handlers, so client disconnects do not cancel the agent runtime. Redis persists
run records and per-run event streams with configured retention only; it is not
used as a job queue.
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from agenton.compositor import LayerRegistry
from dify_agent.runtime.compositor_factory import create_default_layer_registry
from dify_agent.runtime.run_scheduler import RunScheduler
from dify_agent.server.routes.runs import create_runs_router
from dify_agent.server.settings import ServerSettings
from dify_agent.storage.redis_run_store import RedisRunStore


def create_app(settings: ServerSettings | None = None) -> FastAPI:
    """Build the FastAPI app with one shared Redis store and local scheduler."""
    resolved_settings = settings or ServerSettings()
    layer_registry = create_default_layer_registry(
        plugin_daemon_url=resolved_settings.plugin_daemon_url,
        plugin_daemon_api_key=resolved_settings.plugin_daemon_api_key,
        plugin_daemon_timeout=resolved_settings.plugin_daemon_timeout,
    )
    state: dict[str, RedisRunStore | RunScheduler | LayerRegistry] = {"layer_registry": layer_registry}

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
        redis = Redis.from_url(resolved_settings.redis_url)
        store = RedisRunStore(
            redis,
            prefix=resolved_settings.redis_prefix,
            run_retention_seconds=resolved_settings.run_retention_seconds,
        )
        scheduler = RunScheduler(
            store=store,
            shutdown_grace_seconds=resolved_settings.shutdown_grace_seconds,
            layer_registry=layer_registry,
        )
        state["store"] = store
        state["scheduler"] = scheduler
        try:
            yield
        finally:
            await scheduler.shutdown()
            await redis.aclose()

    app = FastAPI(title="Dify Agent Run Server", version="0.1.0", lifespan=lifespan)

    def get_store() -> RedisRunStore:
        return state["store"]  # pyright: ignore[reportReturnType]

    def get_scheduler() -> RunScheduler:
        return state["scheduler"]  # pyright: ignore[reportReturnType]

    def get_layer_registry() -> LayerRegistry:
        return state["layer_registry"]  # pyright: ignore[reportReturnType]

    app.include_router(create_runs_router(get_store, get_scheduler, get_layer_registry))
    return app


app = create_app()


__all__ = ["app", "create_app"]
