import asyncio
from collections.abc import Mapping
from typing import cast

from agenton.compositor import CompositorConfig, LayerNodeConfig
from dify_agent.server.schemas import CreateRunRequest, RunnerJob
from dify_agent.storage.redis_run_store import RedisRunStore
from dify_agent.worker.job_worker import JobRunner, RunJobWorker


def _job() -> RunnerJob:
    request = CreateRunRequest(
        compositor=CompositorConfig(
            layers=[LayerNodeConfig(name="prompt", type="plain.prompt", config={"user": "hello"})]
        )
    )
    return RunnerJob(run_id="run-1", request=request)


class FakeRunner:
    ran: bool

    def __init__(self) -> None:
        self.ran = False

    async def run(self) -> None:
        self.ran = True


class FakeRedis:
    xreadgroup_called: bool
    acked: list[tuple[str, str, str | bytes]]
    claimed_payload: str

    def __init__(self, claimed_payload: str) -> None:
        self.xreadgroup_called = False
        self.acked = []
        self.claimed_payload = claimed_payload

    async def xautoclaim(
        self,
        name: str,
        groupname: str,
        consumername: str,
        min_idle_time: int,
        start_id: str,
        count: int,
    ) -> tuple[str, list[tuple[bytes, dict[bytes, bytes]]], list[bytes]]:
        assert name == "test:runs:jobs"
        assert groupname == "workers"
        assert consumername == "worker-b"
        assert min_idle_time == 10
        assert start_id == "0-0"
        assert count == 1
        return "0-0", [(b"1-0", {b"payload": self.claimed_payload.encode()})], []

    async def xreadgroup(
        self,
        groupname: str,
        consumername: str,
        streams: Mapping[str, str],
        count: int,
        block: int,
    ) -> list[tuple[str, list[tuple[bytes, dict[bytes, bytes]]]]]:
        self.xreadgroup_called = True
        return []

    async def xack(self, name: str, groupname: str, entry_id: str | bytes) -> None:
        self.acked.append((name, groupname, entry_id))


def test_process_once_reclaims_stale_pending_job_before_reading_new_entries() -> None:
    job = _job()
    runner = FakeRunner()
    redis = FakeRedis(job.model_dump_json())
    store = RedisRunStore(cast(object, redis), prefix="test")  # pyright: ignore[reportArgumentType]
    worker = RunJobWorker(
        store=store,
        group_name="workers",
        consumer_name="worker-b",
        pending_idle_ms=10,
        runner_factory=lambda _job: cast(JobRunner, runner),
    )

    processed = asyncio.run(worker.process_once(block_ms=0))

    assert processed is True
    assert runner.ran is True
    assert redis.xreadgroup_called is False
    assert redis.acked == [("test:runs:jobs", "workers", b"1-0")]
