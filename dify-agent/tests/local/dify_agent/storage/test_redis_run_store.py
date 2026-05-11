import asyncio
from collections.abc import Mapping

from agenton.compositor import CompositorConfig, LayerNodeConfig
from dify_agent.server.schemas import CreateRunRequest, RunStartedEvent
from dify_agent.storage.redis_run_store import RedisRunStore


def _request() -> CreateRunRequest:
    return CreateRunRequest(
        compositor=CompositorConfig(
            layers=[LayerNodeConfig(name="prompt", type="plain.prompt", config={"user": "hello"})]
        )
    )


class FakeRedis:
    commands: list[tuple[str, str, object]]

    def __init__(self) -> None:
        self.commands = []

    async def set(self, key: str, value: object) -> None:
        self.commands.append(("set", key, value))

    async def xadd(self, key: str, fields: Mapping[str, object]) -> str:
        self.commands.append(("xadd", key, dict(fields)))
        return "1-0"


def test_create_run_writes_running_record_without_job_queue() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    record = asyncio.run(store.create_run(_request()))

    assert record.status == "running"
    assert [command[0] for command in redis.commands] == ["set"]
    assert redis.commands[0][1] == f"test:runs:{record.run_id}:record"


def test_append_event_serializes_typed_event_without_id() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    event_id = asyncio.run(store.append_event(RunStartedEvent(id="local", run_id="run-1")))

    assert event_id == "1-0"
    assert redis.commands[0][0] == "xadd"
    fields = redis.commands[0][2]
    assert isinstance(fields, dict)
    assert '"id"' not in str(fields["payload"])
    assert '"type":"run_started"' in str(fields["payload"])
