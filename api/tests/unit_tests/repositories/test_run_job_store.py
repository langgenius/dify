from dataclasses import replace

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
    )


def test_create_then_get_returns_the_same_record(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()

    created = store.create(job)

    assert created is True
    assert store.get(job.id) == job
    assert store.is_alive(job.id)
    assert redis.ttls[f"openapi:job:{job.id}"] == JOB_TTL_SECONDS
    assert redis.ttls[f"openapi:job:{job.id}:alive"] == ALIVE_TTL_SECONDS


def test_get_unknown_job_returns_none(store: RedisRunJobStore) -> None:
    assert store.get("missing") is None
    assert not store.is_alive("missing")


def test_record_ids_changes_only_the_given_ids(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()
    store.create(job)
    redis.ttls.clear()

    store.record_ids(job.id, JobIds(run_id="r1"))

    assert store.get(job.id) == replace(job, run_id="r1")
    assert redis.ttls[f"openapi:job:{job.id}"] == JOB_TTL_SECONDS


def test_record_ids_without_ids_writes_nothing(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()
    store.create(job)
    redis.ttls.clear()

    store.record_ids(job.id, JobIds())

    assert store.get(job.id) == job
    assert redis.ttls == {}


def test_request_stop_sets_only_the_flag(store: RedisRunJobStore) -> None:
    job = _record()
    store.create(job)

    store.request_stop(job.id)

    assert store.get(job.id) == replace(job, stop_requested=True)


def test_settle_writes_the_first_final_status_only(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()
    store.create(job)
    redis.ttls.clear()

    first = store.settle(job.id, JobEnding(status=JobStatus.FAILED, error="boom"))
    second = store.settle(job.id, JobEnding(status=JobStatus.SUCCEEDED))

    assert (first, second) == (True, False)
    assert store.get(job.id) == replace(job, ending=JobEnding(status=JobStatus.FAILED, error="boom"))
    assert redis.hashes[f"openapi:job:{job.id}"]["ending"] == '{"status": "failed", "failure": null, "error": "boom"}'
    assert redis.ttls[f"openapi:job:{job.id}"] == JOB_TTL_SECONDS


def test_a_record_without_an_ending_is_running(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()
    store.create(job)

    stored = store.get(job.id)

    assert stored is not None
    assert (stored.status, stored.error, stored.failure) == (JobStatus.RUNNING, None, None)
    assert "ending" not in redis.hashes[f"openapi:job:{job.id}"]


def test_a_failure_reports_its_own_message_and_stores_no_text(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()
    store.create(job)

    store.settle(job.id, JobEnding(status=JobStatus.FAILED, failure=JobFailure.NO_RESULT))

    stored = store.get(job.id)
    assert stored is not None
    assert (stored.status, stored.failure, stored.error) == (
        JobStatus.FAILED,
        JobFailure.NO_RESULT,
        JobFailure.NO_RESULT.message,
    )
    assert '"error": null' in redis.hashes[f"openapi:job:{job.id}"]["ending"]


def test_an_ending_must_be_final() -> None:
    with pytest.raises(ValueError, match="final"):
        JobEnding(status=JobStatus.RUNNING)


def test_writes_to_an_expired_job_do_not_recreate_it(store: RedisRunJobStore) -> None:
    store.record_ids("gone", JobIds(run_id="r1"))
    store.request_stop("gone")

    assert store.settle("gone", JobEnding(status=JobStatus.FAILED)) is False
    assert store.get("gone") is None


def test_create_of_an_existing_job_writes_nothing(store: RedisRunJobStore) -> None:
    job = _record()
    store.create(job)
    store.settle(job.id, JobEnding(status=JobStatus.SUCCEEDED))

    again = store.create(replace(job, op="start.other"))

    assert again is False
    assert store.get(job.id) == replace(job, ending=JobEnding(status=JobStatus.SUCCEEDED))


def test_discard_removes_the_job_and_its_alive_key(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    store.create(_record())

    store.discard("job-1")

    assert store.get("job-1") is None
    assert not store.is_alive("job-1")
    assert redis.hashes == {}
    assert store.create(_record()) is True


def test_drop_alive_removes_only_the_alive_key(store: RedisRunJobStore) -> None:
    job = _record()
    store.create(job)

    store.drop_alive(job.id)

    assert not store.is_alive(job.id)
    assert store.get(job.id) == job


def test_touch_refreshes_the_alive_key(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    redis.delete("openapi:job:job-1:alive")
    store.touch("job-1")

    assert store.is_alive("job-1")
    assert redis.ttls["openapi:job:job-1:alive"] == ALIVE_TTL_SECONDS


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


def test_only_three_statuses_are_final() -> None:
    final = {status for status in JobStatus if status.is_final}

    assert final == {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.STOPPED}


def test_partial_hash_reads_as_missing(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    redis.hset("openapi:job:late", mapping={"run_id": '"r1"'})

    assert store.get("late") is None


def test_a_hash_with_fields_from_a_newer_version_still_decodes(store: RedisRunJobStore, redis: InMemoryRedis) -> None:
    job = _record()
    store.create(job)
    redis.hset("openapi:job:" + job.id, mapping={"added_later": '{"x": 1}'})

    assert store.get(job.id) == job
