import pytest

from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock, RedisLockHandle, RedisScript
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError, KnowledgeIndexingLockBusyError


class FakeEncoder:
    def encode(self, value: str) -> bytes:
        return value.encode()


class FakeLocalToken:
    def __init__(self) -> None:
        self.token: bytes | None = None


class FakeRawRedis:
    def __init__(self, values: dict[str, bytes]) -> None:
        self.values = values

    def get_encoder(self) -> FakeEncoder:
        return FakeEncoder()

    def get(self, name: str) -> bytes | None:
        return self.values.get(name)


class FakeRedisLock:
    def __init__(self, *, values: dict[str, bytes], name: str) -> None:
        self.redis = FakeRawRedis(values)
        self.local = FakeLocalToken()
        self._values = values
        self._name = name

    def acquire(self, *, blocking: bool, token: str) -> bool:
        assert not blocking
        if self._name in self._values:
            return False
        encoded = token.encode()
        self._values[self._name] = encoded
        self.local.token = encoded
        return True

    def reacquire(self) -> bool:
        return self.local.token is not None and self._values.get(self._name) == self.local.token

    def release(self) -> None:
        if self.local.token is None or self._values.get(self._name) != self.local.token:
            raise RuntimeError("lock no longer owned")
        self._values.pop(self._name)


class ScriptedRedis:
    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}

    def lock(
        self,
        name: str,
        timeout: float | None = None,
        sleep: float = 0.1,
        blocking: bool = True,
        blocking_timeout: float | None = None,
        thread_local: bool = True,
    ) -> RedisLockHandle:
        assert timeout is not None
        assert sleep >= 0
        assert not blocking
        assert blocking_timeout is None
        assert not thread_local
        return FakeRedisLock(values=self.values, name=name)

    def register_script(self, script: str) -> RedisScript:
        del script

        def adopt(*, keys: list[str], args: list[object]) -> int:
            key = keys[0]
            expected_token, replacement_token = str(args[0]).encode(), str(args[1]).encode()
            if (current := self.values.get(key)) is not None and current != expected_token:
                return 0
            self.values[key] = replacement_token
            return 1

        return adopt


class TokenSequence:
    def __init__(self) -> None:
        self._next = 1

    def __call__(self) -> str:
        token = f"owner-{self._next}"
        self._next += 1
        return token


def _locks(redis: ScriptedRedis) -> RedisKnowledgeIndexingLock:
    return RedisKnowledgeIndexingLock(
        redis=redis,
        token_factory=TokenSequence(),
        heartbeat_interval=60,
    )


def test_expired_owner_cannot_release_replacement_lock() -> None:
    redis = ScriptedRedis()
    locks = _locks(redis)
    expired = locks.try_acquire("dataset-1", timeout=60)
    assert expired is not None
    redis.values.pop("dataset-1")
    replacement = locks.try_acquire("dataset-1", timeout=60)
    assert replacement is not None

    assert not expired.release()
    assert redis.values["dataset-1"] == replacement.token.encode()


def test_worker_handoff_rotates_token_and_rejects_duplicate_owner() -> None:
    redis = ScriptedRedis()
    locks = _locks(redis)
    producer = locks.try_acquire("document-1", timeout=60)
    assert producer is not None

    with locks.hold("document-1", timeout=60, expected_token=producer.token) as worker:
        assert worker.token != producer.token
        assert worker.renew()
        with pytest.raises(KnowledgeIndexingLockBusyError):
            with locks.hold("document-1", timeout=60, expected_token=producer.token):
                raise AssertionError("duplicate owner entered the lease")

    assert "document-1" not in redis.values


def test_handoff_can_reclaim_an_expired_uncontended_lock() -> None:
    redis = ScriptedRedis()
    locks = _locks(redis)
    producer = locks.try_acquire("document-1", timeout=60)
    assert producer is not None
    redis.values.pop("document-1")

    with locks.hold("document-1", timeout=60, expected_token=producer.token) as worker:
        assert redis.values["document-1"] == worker.token.encode()


def test_lease_loss_stops_old_owner_and_preserves_replacement() -> None:
    redis = ScriptedRedis()
    locks = _locks(redis)
    old_owner = locks.try_acquire("dataset-1", timeout=60)
    assert old_owner is not None
    redis.values["dataset-1"] = b"replacement-owner"

    assert not old_owner.renew()
    with pytest.raises(KnowledgeIndexingLeaseLostError):
        old_owner.assert_owned()
    assert not old_owner.release()
    assert redis.values["dataset-1"] == b"replacement-owner"
