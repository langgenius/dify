import asyncio
from collections.abc import Mapping

from agenton.compositor import CompositorConfig, LayerNodeConfig
from dify_agent.server.schemas import CreateRunRequest, RunStartedEvent
from dify_agent.storage.redis_run_store import DEFAULT_RUN_RETENTION_SECONDS, RedisRunStore


def _request() -> CreateRunRequest:
    return CreateRunRequest(
        compositor=CompositorConfig(
            layers=[LayerNodeConfig(name="prompt", type="plain.prompt", config={"user": "hello"})]
        )
    )


class FakeRedis:
    commands: list[tuple[object, ...]]
    values: dict[str, object]

    def __init__(self) -> None:
        self.commands = []
        self.values = {}

    async def set(self, key: str, value: object, *, ex: int | None = None) -> None:
        self.commands.append(("set", key, value, ex))
        self.values[key] = value

    async def get(self, key: str) -> object | None:
        self.commands.append(("get", key))
        return self.values.get(key)

    async def xadd(self, key: str, fields: Mapping[str, object]) -> str:
        self.commands.append(("xadd", key, dict(fields)))
        return "1-0"

    async def expire(self, key: str, seconds: int) -> bool:
        self.commands.append(("expire", key, seconds))
        return True


def test_create_run_writes_running_record_without_job_queue_and_with_retention() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test")  # pyright: ignore[reportArgumentType]

    record = asyncio.run(store.create_run(_request()))

    assert record.status == "running"
    assert [command[0] for command in redis.commands] == ["set"]
    assert redis.commands[0][1] == f"test:runs:{record.run_id}:record"
    assert redis.commands[0][3] == DEFAULT_RUN_RETENTION_SECONDS


def test_update_status_refreshes_record_retention() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test", run_retention_seconds=60)  # pyright: ignore[reportArgumentType]
    record = asyncio.run(store.create_run(_request()))
    redis.commands.clear()

    asyncio.run(store.update_status(record.run_id, "succeeded"))

    assert [command[0] for command in redis.commands] == ["get", "set"]
    assert redis.commands[1][1] == f"test:runs:{record.run_id}:record"
    assert redis.commands[1][3] == 60


def test_append_event_serializes_typed_event_without_id_and_expires_run_keys() -> None:
    redis = FakeRedis()
    store = RedisRunStore(redis, prefix="test", run_retention_seconds=60)  # pyright: ignore[reportArgumentType]

    event_id = asyncio.run(store.append_event(RunStartedEvent(id="local", run_id="run-1")))

    assert event_id == "1-0"
    assert redis.commands[0][0] == "xadd"
    fields = redis.commands[0][2]
    assert isinstance(fields, dict)
    assert '"id"' not in str(fields["payload"])
    assert '"type":"run_started"' in str(fields["payload"])
    assert redis.commands[1:] == [
        ("expire", "test:runs:run-1:events", 60),
        ("expire", "test:runs:run-1:record", 60),
    ]
