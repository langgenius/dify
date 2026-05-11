"""FastAPI application factory for the Dify Agent run server.

The HTTP process owns Redis clients, route wiring, and a process-local scheduler.
Run execution happens in background ``asyncio`` tasks rather than request
handlers, so client disconnects do not cancel the agent runtime. Redis persists
run records and per-run event streams only; it is not used as a job queue.
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from dify_agent.runtime.run_scheduler import RunScheduler
from dify_agent.server.routes.runs import create_runs_router
from dify_agent.server.settings import ServerSettings
from dify_agent.storage.redis_run_store import RedisRunStore


def create_app(settings: ServerSettings | None = None) -> FastAPI:
    """Build the FastAPI app with one shared Redis store and local scheduler."""
    resolved_settings = settings or ServerSettings()
    state: dict[str, RedisRunStore | RunScheduler] = {}

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
        redis = Redis.from_url(resolved_settings.redis_url)
        store = RedisRunStore(redis, prefix=resolved_settings.redis_prefix)
        scheduler = RunScheduler(store=store, shutdown_grace_seconds=resolved_settings.shutdown_grace_seconds)
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

    app.include_router(create_runs_router(get_store, get_scheduler))
    return app


app = create_app()


__all__ = ["app", "create_app"]
