"""FastAPI application factory for the Dify Agent run server.

The HTTP process owns Redis clients, route wiring, and by default one embedded
Redis Streams worker task. Run execution still happens outside request handlers,
so client latency and disconnects do not control the agent runtime, but local
development only needs one ``uvicorn`` process plus Redis.
"""

import asyncio
import os
import socket
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from redis.asyncio import Redis

from dify_agent.server.routes.runs import create_runs_router
from dify_agent.server.settings import ServerSettings
from dify_agent.storage.redis_run_store import RedisRunStore
from dify_agent.worker.job_worker import RunJobWorker


def create_app(settings: ServerSettings | None = None) -> FastAPI:
    """Build the FastAPI app with one shared Redis-backed run store and worker."""
    resolved_settings = settings or ServerSettings()
    state: dict[str, RedisRunStore] = {}

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
        redis = Redis.from_url(resolved_settings.redis_url)
        store = RedisRunStore(redis, prefix=resolved_settings.redis_prefix)
        state["store"] = store
        worker_task: asyncio.Task[None] | None = None
        if resolved_settings.worker_enabled:
            worker = RunJobWorker(
                store=store,
                group_name=resolved_settings.worker_group_name,
                consumer_name=_worker_consumer_name(resolved_settings),
                pending_idle_ms=resolved_settings.worker_pending_idle_ms,
            )
            worker_task = asyncio.create_task(worker.run_forever(), name="dify-agent-run-worker")
            # Give the worker one loop turn so startup tests and immediate failures observe the task.
            await asyncio.sleep(0)
        try:
            yield
        finally:
            if worker_task is not None:
                _ = worker_task.cancel()
                with suppress(asyncio.CancelledError):
                    await worker_task
            await redis.aclose()

    app = FastAPI(title="Dify Agent Run Server", version="0.1.0", lifespan=lifespan)

    def get_store() -> RedisRunStore:
        return state["store"]

    app.include_router(create_runs_router(get_store))
    return app


app = create_app()


def _worker_consumer_name(settings: ServerSettings) -> str:
    """Return a stable-enough consumer name for this API process.

    Redis consumer names should be unique per live process. The explicit setting
    is useful for tests or controlled deployments; otherwise hostname and PID
    distinguish common ``uvicorn --workers`` and reload processes.
    """
    if settings.worker_consumer_name:
        return settings.worker_consumer_name
    return f"api-{socket.gethostname()}-{os.getpid()}"


__all__ = ["app", "create_app"]
