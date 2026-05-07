"""Redis Streams worker for executing queued runs.

This worker is asyncio/uvloop compatible and intentionally does not use Celery.
It reads jobs from the shared Redis stream, executes them through
``AgentRunRunner``, and acknowledges entries only after terminal status/events
have been written.
"""

import asyncio
import logging
from collections.abc import Callable
from typing import Protocol, cast

from redis.asyncio import Redis

from dify_agent.runtime.runner import AgentRunRunner
from dify_agent.server.schemas import RunnerJob
from dify_agent.server.settings import ServerSettings
from dify_agent.storage.redis_keys import run_jobs_key
from dify_agent.storage.redis_run_store import RedisRunStore

logger = logging.getLogger(__name__)


class JobRunner(Protocol):
    """Executable unit for one decoded run job."""

    async def run(self) -> None:
        """Execute the job and write terminal status/events."""
        ...


type JobRunnerFactory = Callable[[RunnerJob], JobRunner]


def create_default_job_runner(store: RedisRunStore, job: RunnerJob) -> JobRunner:
    """Create the production runner for a decoded Redis job."""
    return AgentRunRunner(sink=store, request=job.request, run_id=job.run_id)


class RunJobWorker:
    """Long-running worker that consumes the run jobs stream."""

    store: RedisRunStore
    group_name: str
    consumer_name: str
    pending_idle_ms: int
    runner_factory: JobRunnerFactory

    def __init__(
        self,
        *,
        store: RedisRunStore,
        group_name: str = "run-workers",
        consumer_name: str = "worker-1",
        pending_idle_ms: int = 600_000,
        runner_factory: JobRunnerFactory | None = None,
    ) -> None:
        self.store = store
        self.group_name = group_name
        self.consumer_name = consumer_name
        self.pending_idle_ms = pending_idle_ms
        self.runner_factory = runner_factory or (lambda job: create_default_job_runner(store, job))

    async def run_forever(self) -> None:
        """Continuously read and execute jobs until cancelled."""
        jobs_key = run_jobs_key(self.store.prefix)
        await self._ensure_group(jobs_key)
        while True:
            await self.process_once(jobs_key, block_ms=30_000)

    async def process_once(self, jobs_key: str | None = None, *, block_ms: int = 30_000) -> bool:
        """Process one stale pending or new job entry.

        Stale pending entries are reclaimed before blocking on new work. This
        covers worker crashes after ``XREADGROUP`` delivery but before ``XACK``:
        Redis keeps the entry pending, and another worker can claim it after the
        configured idle timeout instead of leaving the run stuck forever.
        """
        resolved_jobs_key = jobs_key or run_jobs_key(self.store.prefix)
        claimed = await self._claim_stale_pending(resolved_jobs_key)
        if claimed:
            for entry_id, fields in claimed:
                await self._handle_entry(resolved_jobs_key, entry_id, fields)
            return True

        response = await self.store.redis.xreadgroup(
            self.group_name,
            self.consumer_name,
            {resolved_jobs_key: ">"},
            count=1,
            block=block_ms,
        )
        for _stream_name, entries in response:
            for entry_id, fields in entries:
                await self._handle_entry(resolved_jobs_key, entry_id, fields)
                return True
        return False

    async def _claim_stale_pending(self, jobs_key: str) -> list[tuple[object, dict[object, object]]]:
        """Claim stale pending jobs from crashed consumers."""
        response = await self.store.redis.xautoclaim(
            jobs_key,
            self.group_name,
            self.consumer_name,
            min_idle_time=self.pending_idle_ms,
            start_id="0-0",
            count=1,
        )
        if len(response) >= 2:
            entries = response[1]
            return list(entries)
        return []

    async def _ensure_group(self, jobs_key: str) -> None:
        """Create the Redis consumer group if needed."""
        try:
            await self.store.redis.xgroup_create(jobs_key, self.group_name, id="0", mkstream=True)
        except Exception as exc:
            if "BUSYGROUP" not in str(exc):
                raise

    async def _handle_entry(self, jobs_key: str, entry_id: object, fields: dict[object, object]) -> None:
        """Decode and execute one stream entry."""
        payload = fields.get(b"payload") or fields.get("payload")
        if isinstance(payload, bytes):
            payload = payload.decode()
        if not isinstance(payload, str | bytes | bytearray):
            raise ValueError("Redis job payload must be JSON text")
        job = RunnerJob.model_validate_json(payload)
        try:
            await self.runner_factory(job).run()
        except Exception:
            logger.exception("run worker failed", extra={"run_id": job.run_id})
        finally:
            await self.store.redis.xack(jobs_key, self.group_name, cast(str | bytes, entry_id))


async def main() -> None:
    """Run the worker using environment settings."""
    settings = ServerSettings()
    redis = Redis.from_url(settings.redis_url)
    try:
        await RunJobWorker(
            store=RedisRunStore(redis, prefix=settings.redis_prefix),
            group_name=settings.worker_group_name,
            consumer_name=settings.worker_consumer_name or "worker-1",
            pending_idle_ms=settings.worker_pending_idle_ms,
        ).run_forever()
    finally:
        await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main())


__all__ = ["RunJobWorker", "main"]
