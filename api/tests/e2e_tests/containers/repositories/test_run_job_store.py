"""Run the run job store's single-key writes against the container's real Redis."""

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Barrier
from uuid import uuid4

import pytest
from flask import Flask
from redis import Redis

from configs import dify_config
from extensions.ext_redis import RedisClientWrapper
from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.run_job import JobEnding, JobFailure, JobOwner, JobRecord, JobStatus

RACERS = 8
SAMPLE_OP = "run.sample"
RACER_OP_PREFIX = "run.racer"


@pytest.fixture(params=[False, True], ids=["bytes", "decoded"])
def store(request: pytest.FixtureRequest, flask_app_with_containers: Flask) -> Iterator[RedisRunJobStore]:
    assert "redis" in flask_app_with_containers.extensions
    with Redis(
        host=dify_config.REDIS_HOST,
        port=dify_config.REDIS_PORT,
        db=dify_config.REDIS_DB,
        username=dify_config.REDIS_USERNAME or None,
        password=dify_config.REDIS_PASSWORD or None,
        decode_responses=request.param,
    ) as client:
        redis = RedisClientWrapper()
        redis.initialize(client)
        yield RedisRunJobStore(redis_client=redis, job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)


def _record() -> JobRecord:
    owner = JobOwner(tenant_id=str(uuid4()), app_id=str(uuid4()), caller_role=CreatorUserRole.ACCOUNT, caller_id="u1")
    return JobRecord(id=str(uuid4()), owner=owner, mode=AppMode.WORKFLOW, op=SAMPLE_OP)


def test_settle_writes_the_first_ending_only(store: RedisRunJobStore) -> None:
    job = _record()
    store.create(job)

    first = store.settle(job.id, JobEnding(status=JobStatus.FAILED, failure=JobFailure.NO_RESULT))
    second = store.settle(job.id, JobEnding(status=JobStatus.SUCCEEDED, error="late"))

    assert (first, second) == (True, False)
    assert store.get(job.id) == replace(job, ending=JobEnding(status=JobStatus.FAILED, failure=JobFailure.NO_RESULT))


def test_settle_of_a_missing_job_writes_nothing(store: RedisRunJobStore) -> None:
    job = _record()

    assert store.settle(job.id, JobEnding(status=JobStatus.STOPPED)) is False
    assert store.get(job.id) is None


def test_concurrent_creates_of_one_job_let_exactly_one_win(store: RedisRunJobStore) -> None:
    job = _record()
    barrier = Barrier(RACERS)
    racers = [replace(job, op=f"{RACER_OP_PREFIX}{index}") for index in range(RACERS)]

    def create(record: JobRecord) -> bool:
        barrier.wait()
        return store.create(record)

    with ThreadPoolExecutor(max_workers=RACERS) as pool:
        won = list(pool.map(create, racers))

    assert won.count(True) == 1
    assert store.get(job.id) == racers[won.index(True)]


def test_concurrent_settles_let_exactly_one_win(store: RedisRunJobStore) -> None:
    job = _record()
    store.create(job)
    barrier = Barrier(RACERS)
    endings = [JobEnding(status=JobStatus.FAILED, error=f"racer {index}") for index in range(RACERS)]

    def settle(ending: JobEnding) -> bool:
        barrier.wait()
        return store.settle(job.id, ending)

    with ThreadPoolExecutor(max_workers=RACERS) as pool:
        won = list(pool.map(settle, endings))

    stored = store.get(job.id)
    assert won.count(True) == 1
    assert stored is not None
    assert stored.error == endings[won.index(True)].error
