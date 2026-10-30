import pytest

from services.knowledge.indexing.adapters import redis_lock as redis_lock_module
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
        if script == redis_lock_module._ADOPT_SCRIPT:

            def adopt(*, keys: list[str], args: list[object]) -> int:
                key = keys[0]
                expected_token, replacement_token = str(args[0]).encode(), str(args[1]).encode()
                if (current := self.values.get(key)) is not None and current != expected_token:
                    return 0
                self.values[key] = replacement_token
                return 1

            return adopt
        if script == redis_lock_module._HANDOFF_SCRIPT:

            def handoff(*, keys: list[str], args: list[object]) -> int:
                key, owner_key = keys
                owner_id = str(args[0]).encode()
                current = self.values.get(key)
                producer_prefix = b"producer:" + owner_id + b":"
                recorded_owner = self.values.get(owner_key)
                if not (
                    (current is None and recorded_owner in (None, owner_id))
                    or (current or b"").startswith(producer_prefix)
                ):
                    return 0
                self.values[key] = str(args[1]).encode()
                self.values[owner_key] = owner_id
                return 1

            return handoff
        if script == redis_lock_module._ACQUIRE_HANDOFF_SCRIPT:

            def acquire_handoff(*, keys: list[str], args: list[object]) -> int:
                key, owner_key = keys
                if key in self.values:
                    return 0
                self.values[key] = str(args[1]).encode()
                self.values[owner_key] = str(args[0]).encode()
                return 1

            return acquire_handoff
        if script == redis_lock_module._MARK_HANDOFF_OWNER_SCRIPT:

            def mark_owner(*, keys: list[str], args: list[object]) -> int:
                key, owner_key = keys
                if self.values.get(key) != str(args[0]).encode():
                    return 0
                self.values[owner_key] = str(args[1]).encode()
                return 1

            return mark_owner
        if script == redis_lock_module._CLEAR_HANDOFF_OWNER_SCRIPT:

            def clear_owner(*, keys: list[str], args: list[object]) -> int:
                key, owner_key = keys
                if self.values.get(key) != str(args[0]).encode() or self.values.get(owner_key) != str(args[1]).encode():
                    return 0
                self.values.pop(key, None)
                self.values.pop(owner_key, None)
                return 1

            return clear_owner
        raise AssertionError("unexpected script")


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


def test_server_side_handoff_validates_actor_and_rejects_an_active_worker() -> None:
    redis = ScriptedRedis()
    locks = _locks(redis)
    producer = locks.try_acquire_handoff("document-1", timeout=60, owner_id="actor-1")
    assert producer is not None
    assert redis.values["document-1"].startswith(b"producer:actor-1:")
    assert redis.values["{document-1}:handoff-owner"] == b"actor-1"
    assert locks.try_acquire_handoff("document-1", timeout=60, owner_id="actor-2") is None

    with pytest.raises(KnowledgeIndexingLockBusyError):
        with locks.hold_handoff("document-1", timeout=60, owner_id="actor-2"):
            raise AssertionError("a different actor claimed the producer handoff")

    with locks.hold_handoff("document-1", timeout=60, owner_id="actor-1") as worker:
        assert redis.values["document-1"].startswith(b"worker:actor-1:")
        assert worker.renew()
        with pytest.raises(KnowledgeIndexingLockBusyError):
            with locks.hold_handoff("document-1", timeout=60, owner_id="actor-1"):
                raise AssertionError("a duplicate delivery stole an active worker lease")

    assert "document-1" not in redis.values
    assert "{document-1}:handoff-owner" not in redis.values


def test_server_side_handoff_recovers_a_lost_worker_only_for_the_recorded_actor() -> None:
    redis = ScriptedRedis()
    locks = _locks(redis)
    producer = locks.try_acquire_handoff("document-1", timeout=60, owner_id="actor-1")
    assert producer is not None
    with pytest.raises(KnowledgeIndexingLeaseLostError):
        with locks.hold_handoff("document-1", timeout=60, owner_id="actor-1"):
            redis.values.pop("document-1")

    assert redis.values["{document-1}:handoff-owner"] == b"actor-1"
    with pytest.raises(KnowledgeIndexingLockBusyError):
        with locks.hold_handoff("document-1", timeout=60, owner_id="actor-2"):
            raise AssertionError("a stale actor recovered another actor's handoff")

    with locks.hold_handoff("document-1", timeout=60, owner_id="actor-1"):
        assert redis.values["document-1"].startswith(b"worker:actor-1:")


def test_pre_marker_message_waits_for_its_raw_lock_to_expire_then_establishes_actor_owner() -> None:
    redis = ScriptedRedis()
    locks = _locks(redis)
    redis.values["document-1"] = b"legacy-raw-token"

    with pytest.raises(KnowledgeIndexingLockBusyError):
        with locks.hold_handoff("document-1", timeout=60, owner_id="actor-1"):
            raise AssertionError("a legacy raw lock was stolen before expiry")

    redis.values.pop("document-1")
    with locks.hold_handoff("document-1", timeout=60, owner_id="actor-1"):
        assert redis.values["document-1"].startswith(b"worker:actor-1:")
        assert redis.values["{document-1}:handoff-owner"] == b"actor-1"


@pytest.mark.parametrize("handoff", [False, True])
def test_thread_start_failure_releases_acquired_lease(monkeypatch: pytest.MonkeyPatch, handoff: bool) -> None:
    redis = ScriptedRedis()
    locks = RedisKnowledgeIndexingLock(redis=redis, token_factory=lambda: "token")

    def fail_start(_thread: object) -> None:
        raise RuntimeError("cannot start thread")

    monkeypatch.setattr(redis_lock_module.threading.Thread, "start", fail_start)
    owner = (
        locks.hold_handoff("document", timeout=600, owner_id="actor")
        if handoff
        else locks.hold("document", timeout=600)
    )
    with pytest.raises(KnowledgeIndexingLockBusyError, match="Cannot start indexing heartbeat"):
        with owner:
            pytest.fail("unreachable")
    assert redis.values == {}


def test_cleanup_batches_bound_lease_heartbeats_for_large_requests() -> None:
    from services.knowledge.indexing.adapters.cleanup import document_cleanup_batches

    document_ids = [f"document-{index}" for index in range(10001)]
    batches = list(document_cleanup_batches(document_ids + document_ids))
    assert max(map(len, batches)) <= 16
    assert [item for batch in batches for item in batch] == sorted(document_ids)
