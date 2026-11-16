from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

import pytest

from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.run_job_contracts import (
    ALIVE_TTL_SECONDS,
    JOB_TTL_SECONDS,
    JobFamily,
    JobOwner,
    JobPatch,
    JobRecord,
    JobStatus,
)


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


IDEM_NAME = "openapi:job:idem:t1:account:acct-1:k"


@pytest.fixture
def redis() -> InMemoryRedis:
    return InMemoryRedis()


@pytest.fixture
def store(redis: InMemoryRedis) -> RedisRunJobStore:
    return RedisRunJobStore(redis_client=redis)


def _record(job_id: str = "job-1", *, caller_id: str = "acct-1", form: Mapping[str, object] | None = None) -> JobRecord:
    return JobRecord(
        id=job_id,
        owner=JobOwner(tenant_id="t1", app_id="app-1", caller_role=CreatorUserRole.ACCOUNT, caller_id=caller_id),
        mode=AppMode.WORKFLOW,
        op="start.console_app.workflow",
        status=JobStatus.RUNNING,
        form=form,
    )


def test_open_then_get_returns_the_same_record(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record(form={"form_id": "f1", "fields": [1, 2]})

    opened = store.open(job, idempotency_key=None)

    assert opened.created is True
    assert store.get(job.id) == job
    assert store.is_alive(job.id)
    assert redis.ttls[f"openapi:job:{job.id}"] == JOB_TTL_SECONDS
    assert redis.ttls[f"openapi:job:{job.id}:alive"] == ALIVE_TTL_SECONDS


def test_get_unknown_job_returns_none(store: RedisRunJobStore) -> None:
    assert store.get("missing") is None
    assert not store.is_alive("missing")


def test_open_with_a_used_idempotency_key_returns_the_first_job(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    first = store.open(_record("job-1"), idempotency_key="k")

    second = store.open(_record("job-2"), idempotency_key="k")

    assert first.created is True
    assert second.created is False
    assert second.record.id == first.record.id
    assert store.get("job-2") is None
    assert "openapi:job:job-2" not in redis.hashes
    assert redis.ttls["openapi:job:idem:t1:account:acct-1:k"] == JOB_TTL_SECONDS


def test_the_same_key_from_another_caller_opens_a_new_job(store: RedisRunJobStore) -> None:
    store.open(_record("job-1", caller_id="acct-1"), idempotency_key="k")

    other = store.open(_record("job-2", caller_id="acct-2"), idempotency_key="k")

    assert other.created is True
    assert other.record.id == "job-2"


def test_patch_changes_only_the_given_fields(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()
    store.open(job, idempotency_key=None)
    redis.ttls.clear()

    store.patch(job.id, JobPatch(run_id="r1"))

    got = store.get(job.id)
    assert got is not None
    assert got.run_id == "r1"
    assert got.status is JobStatus.RUNNING
    assert got.stop_requested is False
    assert redis.ttls[f"openapi:job:{job.id}"] == JOB_TTL_SECONDS


def test_patch_can_set_false_stop_flag_and_status(store: RedisRunJobStore) -> None:
    job = _record()
    store.open(job, idempotency_key=None)

    store.patch(job.id, JobPatch(stop_requested=True, status=JobStatus.STOPPED, error="boom"))

    got = store.get(job.id)
    assert got is not None
    assert got.stop_requested is True
    assert got.status is JobStatus.STOPPED
    assert got.error == "boom"


def test_patch_of_an_expired_job_does_not_recreate_it(store: RedisRunJobStore) -> None:
    store.patch("gone", JobPatch(run_id="r1"))

    assert store.get("gone") is None


def test_touch_refreshes_the_alive_key(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    redis.delete("openapi:job:job-1:alive")
    store.touch("job-1")

    assert store.is_alive("job-1")
    assert redis.ttls["openapi:job:job-1:alive"] == ALIVE_TTL_SECONDS


def test_discard_removes_the_job_and_frees_the_key(store: RedisRunJobStore) -> None:
    store.open(_record("job-1"), idempotency_key="k")

    store.discard("job-1", idempotency_key="k")

    assert store.get("job-1") is None
    assert not store.is_alive("job-1")
    reopened = store.open(_record("job-2"), idempotency_key="k")
    assert reopened.created is True
    assert reopened.record.id == "job-2"


def test_family_follows_the_app_mode() -> None:
    for mode in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT):
        assert JobFamily.for_mode(mode) is JobFamily.GRAPH
    for mode in (AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION):
        assert JobFamily.for_mode(mode) is JobFamily.MESSAGE


def test_family_of_an_unsupported_mode_is_rejected() -> None:
    with pytest.raises(ValueError, match="does not support run jobs"):
        JobFamily.for_mode(AppMode.RAG_PIPELINE)


def test_record_family_uses_its_mode() -> None:
    assert _record().family is JobFamily.GRAPH


def test_only_three_statuses_are_final() -> None:
    final = {status for status in JobStatus if status.is_final}

    assert final == {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.STOPPED}


def test_stale_idempotency_key_is_replaced_once(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    redis.set("openapi:job:idem:t1:account:acct-1:k", "vanished", ex=JOB_TTL_SECONDS)

    opened = store.open(_record("job-2"), idempotency_key="k")

    assert opened.created is True
    assert redis.values["openapi:job:idem:t1:account:acct-1:k"] == "job-2"


class RetakingRedis(InMemoryRedis):
    """Another opener binds the key to a live job right before the compare-and-delete runs."""

    def register_script(self, _script: str) -> Callable[..., int]:
        self.values[IDEM_NAME] = "job-5"
        return super().register_script(_script)


def test_stale_key_retaken_by_another_opener_is_not_overwritten() -> None:
    redis = RetakingRedis()
    store = RedisRunJobStore(redis_client=redis)
    store.open(_record("job-5"), idempotency_key=None)
    redis.set(IDEM_NAME, "vanished", ex=JOB_TTL_SECONDS)

    loser = store.open(_record("job-4"), idempotency_key="k")

    assert loser.created is False
    assert loser.record.id == "job-5"
    assert redis.values[IDEM_NAME] == "job-5"
    assert store.get("job-4") is None


def test_partial_hash_reads_as_missing(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    redis.hset("openapi:job:late", mapping={"run_id": '"r1"'})

    assert store.get("late") is None


def test_discard_leaves_a_key_bound_to_another_job(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    store.open(_record("job-1"), idempotency_key="k")
    store.open(_record("job-2"), idempotency_key=None)

    store.discard("job-2", idempotency_key="k")

    assert redis.values["openapi:job:idem:t1:account:acct-1:k"] == "job-1"


def test_empty_patch_is_a_no_op(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()
    store.open(job, idempotency_key=None)
    redis.ttls.clear()

    store.patch(job.id, JobPatch())

    assert store.get(job.id) == job
    assert redis.ttls == {}
