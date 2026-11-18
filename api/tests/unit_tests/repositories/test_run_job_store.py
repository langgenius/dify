from collections.abc import Callable
from dataclasses import replace
from typing import override

import pytest

from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.run_job_contracts import (
    ALIVE_TTL_SECONDS,
    JOB_TTL_SECONDS,
    JobEnding,
    JobFailure,
    JobFamily,
    JobIds,
    JobOwner,
    JobRecord,
    JobStatus,
)
from tests.unit_tests.services.run_job_fakes import InMemoryRedis

IDEM_NAME = "openapi:job:idem:t1:app-1:account:acct-1:k"


@pytest.fixture
def redis() -> InMemoryRedis:
    return InMemoryRedis()


@pytest.fixture
def store(redis: InMemoryRedis) -> RedisRunJobStore:
    return RedisRunJobStore(redis_client=redis)


def _record(job_id: str = "job-1", *, caller_id: str = "acct-1") -> JobRecord:
    return JobRecord(
        id=job_id,
        owner=JobOwner(tenant_id="t1", app_id="app-1", caller_role=CreatorUserRole.ACCOUNT, caller_id=caller_id),
        mode=AppMode.WORKFLOW,
        op="start.console_app.workflow",
        status=JobStatus.RUNNING,
    )


def test_open_then_get_returns_the_same_record(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()

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
    assert redis.ttls["openapi:job:idem:t1:app-1:account:acct-1:k"] == JOB_TTL_SECONDS


def test_the_same_key_from_another_caller_opens_a_new_job(store: RedisRunJobStore) -> None:
    store.open(_record("job-1", caller_id="acct-1"), idempotency_key="k")

    other = store.open(_record("job-2", caller_id="acct-2"), idempotency_key="k")

    assert other.created is True
    assert other.record.id == "job-2"


def test_the_same_key_on_another_app_opens_a_new_job(store: RedisRunJobStore) -> None:
    first = store.open(_record("job-1"), idempotency_key="k")
    other_app = JobOwner(tenant_id="t1", app_id="app-2", caller_role=CreatorUserRole.ACCOUNT, caller_id="acct-1")

    other = store.open(replace(_record("job-2"), owner=other_app), idempotency_key="k")

    assert other.created is True
    assert other.record.id != first.record.id


def test_record_ids_changes_only_the_given_ids(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()
    store.open(job, idempotency_key=None)
    redis.ttls.clear()

    store.record_ids(job.id, JobIds(run_id="r1"))

    assert store.get(job.id) == replace(job, run_id="r1")
    assert redis.ttls[f"openapi:job:{job.id}"] == JOB_TTL_SECONDS


def test_record_ids_without_ids_writes_nothing(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()
    store.open(job, idempotency_key=None)
    redis.ttls.clear()

    store.record_ids(job.id, JobIds())

    assert store.get(job.id) == job
    assert redis.ttls == {}


def test_request_stop_sets_only_the_flag(store: RedisRunJobStore) -> None:
    job = _record()
    store.open(job, idempotency_key=None)

    store.request_stop(job.id)

    assert store.get(job.id) == replace(job, stop_requested=True)


def test_settle_writes_the_first_final_status_only(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()
    store.open(job, idempotency_key=None)
    redis.ttls.clear()

    first = store.settle(job.id, JobEnding(status=JobStatus.FAILED, error="boom"))
    second = store.settle(job.id, JobEnding(status=JobStatus.SUCCEEDED))

    assert (first, second) == (True, False)
    assert store.get(job.id) == replace(job, status=JobStatus.FAILED, error="boom")
    assert redis.ttls[f"openapi:job:{job.id}"] == JOB_TTL_SECONDS


def test_settle_clears_an_error_it_does_not_set(store: RedisRunJobStore) -> None:
    job = _record()
    store.open(job, idempotency_key=None)

    store.settle(job.id, JobEnding(status=JobStatus.STOPPED))

    assert store.get(job.id) == replace(job, status=JobStatus.STOPPED)


def test_an_ending_must_be_final() -> None:
    with pytest.raises(ValueError, match="final"):
        JobEnding(status=JobStatus.RUNNING)


def test_writes_to_an_expired_job_do_not_recreate_it(store: RedisRunJobStore) -> None:
    store.record_ids("gone", JobIds(run_id="r1"))
    store.request_stop("gone")

    assert store.settle("gone", JobEnding(status=JobStatus.FAILED)) is False
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


def test_each_failure_reason_carries_its_message() -> None:
    assert JobFailure.RUN_NOT_CONFIRMED.message == "run start was not confirmed; it may still execute"
    assert JobFailure.NO_RESULT.message == "run ended without a result"


def test_a_failure_reason_round_trips_through_the_store(store: RedisRunJobStore) -> None:
    store.open(_record(), idempotency_key=None)

    store.settle("job-1", JobEnding(status=JobStatus.FAILED, failure=JobFailure.NO_RESULT))

    stored = store.get("job-1")
    assert stored is not None
    assert (stored.failure, stored.error) == (JobFailure.NO_RESULT, None)


def test_only_three_statuses_are_final() -> None:
    final = {status for status in JobStatus if status.is_final}

    assert final == {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.STOPPED}


def test_stale_idempotency_key_is_replaced_once(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    redis.set("openapi:job:idem:t1:app-1:account:acct-1:k", "vanished", ex=JOB_TTL_SECONDS)

    opened = store.open(_record("job-2"), idempotency_key="k")

    assert opened.created is True
    assert redis.values["openapi:job:idem:t1:app-1:account:acct-1:k"] == "job-2"


class RetakingRedis(InMemoryRedis):
    """Another opener binds the key to a live job right before the compare-and-delete runs."""

    @override
    def register_script(self, script: str) -> Callable[..., int]:
        self.values[IDEM_NAME] = "job-5"
        return super().register_script(script)


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

    assert redis.values["openapi:job:idem:t1:app-1:account:acct-1:k"] == "job-1"


def test_a_hash_with_fields_from_a_newer_version_still_decodes(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()
    store.open(job, idempotency_key=None)
    redis.hset("openapi:job:" + job.id, mapping={"added_later": '{"x": 1}'})

    assert store.get(job.id) == job
