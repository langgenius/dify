import asyncio
from collections.abc import Mapping

import pytest

from agenton.compositor import CompositorConfig, LayerNodeConfig
from dify_agent.server.schemas import CreateRunRequest
from dify_agent.storage.redis_run_store import RedisRunStore


def _request() -> CreateRunRequest:
    return CreateRunRequest(
        compositor=CompositorConfig(
            layers=[LayerNodeConfig(name="prompt", type="plain.prompt", config={"user": "hello"})]
        )
    )


class FakePipeline:
    staged: list[tuple[str, str, object]]
    executed: bool
    fail_execute: bool

    def __init__(self, *, fail_execute: bool = False) -> None:
        self.staged = []
        self.executed = False
        self.fail_execute = fail_execute

    async def __aenter__(self) -> "FakePipeline":
        return self

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None

    def set(self, key: str, value: object) -> None:
        self.staged.append(("set", key, value))

    def xadd(self, key: str, fields: Mapping[str, object]) -> None:
        self.staged.append(("xadd", key, dict(fields)))

    async def execute(self) -> None:
        if self.fail_execute:
            raise RuntimeError("transaction failed")
        self.executed = True


class FakeRedis:
    pipeline_instance: FakePipeline
    direct_commands: list[str]

    def __init__(self, pipeline: FakePipeline) -> None:
        self.pipeline_instance = pipeline
        self.direct_commands = []

    def pipeline(self, *, transaction: bool) -> FakePipeline:
        assert transaction is True
        return self.pipeline_instance

    async def set(self, key: str, value: object) -> None:
        self.direct_commands.append(f"set:{key}")

    async def xadd(self, key: str, fields: Mapping[str, object]) -> str:
        self.direct_commands.append(f"xadd:{key}")
        return "1-0"


def test_create_run_writes_record_and_job_in_one_transaction() -> None:
    pipeline = FakePipeline()
    redis = FakeRedis(pipeline)
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    record = asyncio.run(store.create_run(_request()))

    assert record.status == "queued"
    assert pipeline.executed is True
    assert [command[0] for command in pipeline.staged] == ["set", "xadd"]
    assert redis.direct_commands == []


def test_create_run_does_not_fall_back_to_partial_writes_when_transaction_fails() -> None:
    pipeline = FakePipeline(fail_execute=True)
    redis = FakeRedis(pipeline)
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    with pytest.raises(RuntimeError, match="transaction failed"):
        asyncio.run(store.create_run(_request()))

    assert pipeline.executed is False
    assert redis.direct_commands == []
