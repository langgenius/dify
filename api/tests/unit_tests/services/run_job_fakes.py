"""In-memory fakes shared by the run job tests."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from services.run_job_contracts import JobRecord


@dataclass
class InMemoryRedis:
    """Implements only the Redis methods RedisRunJobStore calls."""

    values: dict[str, str] = field(default_factory=dict)
    hashes: dict[str, dict[str, str]] = field(default_factory=dict)
    ttls: dict[str, int] = field(default_factory=dict)

    def set(self, name: str, value: str, ex: int | None = None, nx: bool = False) -> bool | None:
        if nx and name in self.values:
            return None
        self.values[name] = value
        if ex is not None:
            self.ttls[name] = ex
        return True

    def get(self, name: str) -> bytes | None:
        value = self.values.get(name)
        return None if value is None else value.encode()

    def hset(self, name: str, *, mapping: Mapping[str, str]) -> int:
        self.hashes.setdefault(name, {}).update(mapping)
        return len(mapping)

    def hgetall(self, name: str) -> dict[bytes, bytes]:
        return {key.encode(): value.encode() for key, value in self.hashes.get(name, {}).items()}

    def expire(self, name: str, time: int) -> bool:
        exists = name in self.hashes or name in self.values
        if exists:
            self.ttls[name] = time
        return exists

    def register_script(self, _script: str) -> Callable[..., int]:
        def delete_if_equal(*, keys: list[str], args: list[str]) -> int:
            if self.values.get(keys[0]) != args[0]:
                return 0
            return self.delete(keys[0])

        return delete_if_equal

    def exists(self, *names: str) -> int:
        return sum(name in self.hashes or name in self.values for name in names)

    def delete(self, *names: str) -> int:
        removed = 0
        for name in names:
            removed += self.hashes.pop(name, None) is not None
            removed += self.values.pop(name, None) is not None
            self.ttls.pop(name, None)
        return removed


@dataclass
class RecordingJobStopper:
    stopped: list[JobRecord] = field(default_factory=list)

    def stop(self, record: JobRecord) -> None:
        self.stopped.append(record)
