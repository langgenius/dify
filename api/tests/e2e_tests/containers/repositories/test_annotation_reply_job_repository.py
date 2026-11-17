"""Exercise the worker's legacy Redis protocol against the container's real Redis."""

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Barrier
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from redis import Redis

from configs import dify_config
from extensions.ext_redis import RedisClientWrapper
from repositories.annotation_reply_job_repository import (
    RedisAnnotationReplyJobRepository,
    annotation_reply_job_owner_key,
)
from services.annotation_reply_service import AnnotationReplyAction, AnnotationReplyJob


@dataclass(frozen=True)
class JobStore:
    redis: RedisClientWrapper
    repository: RedisAnnotationReplyJobRepository
    tenant_id: str
    app_id: str
    job_id: str


@pytest.fixture(params=[False, True], ids=["bytes", "decoded"])
def store(request: pytest.FixtureRequest, flask_app_with_containers: Flask) -> Iterator[JobStore]:
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
        yield JobStore(redis, RedisAnnotationReplyJobRepository(redis=redis), str(uuid4()), str(uuid4()), str(uuid4()))


@pytest.mark.parametrize("action", ["enable", "disable"])
def test_reserved_job_has_waiting_status_owner_and_bounded_reservation(
    store: JobStore, action: AnnotationReplyAction
) -> None:
    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=store.job_id)

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=store.job_id
    ) == AnnotationReplyJob(job_id=store.job_id, job_status="waiting")
    assert store.redis.ttl(annotation_reply_job_owner_key(action=action, job_id=store.job_id)) > 0
    assert store.redis.ttl(f"{action}_app_annotation_job_{store.job_id}") > 0
    assert store.redis.get(f"{action}_app_annotation_{store.app_id}") in (store.job_id, store.job_id.encode())


@pytest.mark.parametrize("different_owner", ["tenant", "app", "action"])
def test_job_reads_do_not_cross_ownership_boundaries(
    store: JobStore, different_owner: Literal["tenant", "app", "action"]
) -> None:
    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action="enable", job_id=store.job_id)
    tenant_id = str(uuid4()) if different_owner == "tenant" else store.tenant_id
    app_id = str(uuid4()) if different_owner == "app" else store.app_id
    action: AnnotationReplyAction = "disable" if different_owner == "action" else "enable"
    store.redis.set(f"{action}_app_annotation_{app_id}", store.job_id)
    store.redis.set(f"{action}_app_annotation_job_{store.job_id}", "error")
    store.redis.set(f"{action}_app_annotation_error_{store.job_id}", "private provider error")

    assert store.repository.get(tenant_id=tenant_id, app_id=app_id, action=action, job_id=store.job_id) is None


@pytest.mark.parametrize("missing_key", ["owner", "status"])
def test_missing_owner_or_status_is_not_a_queryable_job(
    store: JobStore, missing_key: Literal["owner", "status"]
) -> None:
    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action="enable", job_id=store.job_id)
    key = (
        annotation_reply_job_owner_key(action="enable", job_id=store.job_id)
        if missing_key == "owner"
        else f"enable_app_annotation_job_{store.job_id}"
    )
    store.redis.delete(key)

    assert (
        store.repository.get(tenant_id=store.tenant_id, app_id=store.app_id, action="enable", job_id=store.job_id)
        is None
    )
    assert store.redis.get(key) is None


@pytest.mark.parametrize("status", ["waiting", "completed", "error"])
@pytest.mark.parametrize("has_error", [False, True])
def test_error_message_is_returned_only_for_an_error_job(store: JobStore, status: str, has_error: bool) -> None:
    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action="enable", job_id=store.job_id)
    store.redis.set(f"enable_app_annotation_job_{store.job_id}", status)
    if has_error:
        store.redis.set(f"enable_app_annotation_error_{store.job_id}", "模型配置错误")

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, action="enable", job_id=store.job_id
    ) == AnnotationReplyJob(
        job_id=store.job_id, job_status=status, error_msg="模型配置错误" if has_error and status == "error" else ""
    )


def test_recreating_an_owned_job_does_not_reset_its_terminal_status_or_ttl(store: JobStore) -> None:
    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action="disable", job_id=store.job_id)
    owner_key = annotation_reply_job_owner_key(action="disable", job_id=store.job_id)
    store.redis.setex(f"disable_app_annotation_job_{store.job_id}", 600, "completed")
    store.redis.expire(owner_key, 600)

    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action="disable", job_id=store.job_id)

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, action="disable", job_id=store.job_id
    ) == AnnotationReplyJob(job_id=store.job_id, job_status="completed")
    assert 0 < store.redis.ttl(owner_key) <= 600
    assert 0 < store.redis.ttl(f"disable_app_annotation_job_{store.job_id}") <= 600


@pytest.mark.parametrize("different_owner", ["tenant", "app"])
def test_creation_cannot_overwrite_another_owner(store: JobStore, different_owner: Literal["tenant", "app"]) -> None:
    store.redis.set(
        annotation_reply_job_owner_key(action="enable", job_id=store.job_id), f"{store.tenant_id}:{store.app_id}"
    )
    tenant_id = str(uuid4()) if different_owner == "tenant" else store.tenant_id
    app_id = str(uuid4()) if different_owner == "app" else store.app_id

    with pytest.raises(RuntimeError, match="already belongs to another app or tenant"):
        store.repository.reserve(tenant_id=tenant_id, app_id=app_id, action="enable", job_id=store.job_id)

    assert store.redis.get(f"enable_app_annotation_job_{store.job_id}") is None
    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action="enable", job_id=store.job_id)
    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, action="enable", job_id=store.job_id
    ) == AnnotationReplyJob(job_id=store.job_id, job_status="waiting")


@pytest.mark.parametrize("action", ["enable", "disable"])
def test_concurrent_reservations_select_one_job_and_remove_losing_metadata(
    store: JobStore, action: AnnotationReplyAction
) -> None:
    candidates = [str(uuid4()) for _ in range(16)]
    barrier = Barrier(len(candidates))

    def reserve(job_id: str) -> str:
        barrier.wait(timeout=10)
        return store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=job_id)

    with ThreadPoolExecutor(max_workers=len(candidates)) as executor:
        results = list(executor.map(reserve, candidates))

    assert len(set(results)) == 1
    winner = results[0]
    assert winner in candidates
    assert store.redis.get(f"{action}_app_annotation_{store.app_id}") in (winner, winner.encode())
    assert 0 < store.redis.ttl(f"{action}_app_annotation_{store.app_id}") <= 86400
    for job_id in candidates:
        job = store.repository.get(tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=job_id)
        if job_id == winner:
            assert job == AnnotationReplyJob(job_id=job_id, job_status="waiting")
        else:
            assert job is None
            assert store.redis.get(annotation_reply_job_owner_key(action=action, job_id=job_id)) is None
            assert store.redis.get(f"{action}_app_annotation_job_{job_id}") is None


@pytest.mark.parametrize("action", ["enable", "disable"])
def test_finishing_an_old_job_cannot_release_a_new_reservation(store: JobStore, action: AnnotationReplyAction) -> None:
    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=store.job_id)
    store.redis.expire(f"{action}_app_annotation_{store.app_id}", 0)
    next_job = str(uuid4())
    assert (
        store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=next_job)
        == next_job
    )

    store.repository.release_processing(app_id=store.app_id, action=action, job_id=store.job_id)
    assert store.redis.get(f"{action}_app_annotation_{store.app_id}") in (next_job, next_job.encode())
    store.repository.release_processing(app_id=store.app_id, action=action, job_id=next_job)
    assert store.redis.get(f"{action}_app_annotation_{store.app_id}") is None


@pytest.mark.parametrize("action", ["enable", "disable"])
@pytest.mark.parametrize("different_owner", ["tenant", "app", "action"])
def test_cancel_does_not_remove_another_owners_job(
    store: JobStore, action: AnnotationReplyAction, different_owner: Literal["tenant", "app", "action"]
) -> None:
    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=store.job_id)
    store.repository.cancel(
        tenant_id=str(uuid4()) if different_owner == "tenant" else store.tenant_id,
        app_id=str(uuid4()) if different_owner == "app" else store.app_id,
        action=("enable" if action == "disable" else "disable") if different_owner == "action" else action,
        job_id=store.job_id,
    )
    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=store.job_id
    ) == AnnotationReplyJob(job_id=store.job_id, job_status="waiting")
    assert store.redis.get(f"{action}_app_annotation_{store.app_id}") in (store.job_id, store.job_id.encode())


@pytest.mark.parametrize("action", ["enable", "disable"])
def test_cancel_removes_job_and_allows_a_new_reservation(store: JobStore, action: AnnotationReplyAction) -> None:
    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=store.job_id)
    store.redis.set(f"{action}_app_annotation_error_{store.job_id}", "old error")
    store.repository.cancel(tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=store.job_id)
    assert store.redis.get(f"{action}_app_annotation_{store.app_id}") is None
    assert store.redis.get(annotation_reply_job_owner_key(action=action, job_id=store.job_id)) is None
    assert store.redis.get(f"{action}_app_annotation_job_{store.job_id}") is None
    assert store.redis.get(f"{action}_app_annotation_error_{store.job_id}") is None
    next_job = str(uuid4())
    assert (
        store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=next_job)
        == next_job
    )


@pytest.mark.parametrize("action", ["enable", "disable"])
def test_failed_job_remains_queryable_without_releasing_a_new_reservation(
    store: JobStore, action: AnnotationReplyAction
) -> None:
    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=store.job_id)
    store.redis.expire(f"{action}_app_annotation_{store.app_id}", 0)
    next_job = str(uuid4())
    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=next_job)

    store.repository.fail(
        tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=store.job_id, error_msg="Publish failed"
    )

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, action=action, job_id=store.job_id
    ) == AnnotationReplyJob(job_id=store.job_id, job_status="error", error_msg="Publish failed")
    for key in (
        annotation_reply_job_owner_key(action=action, job_id=store.job_id),
        f"{action}_app_annotation_job_{store.job_id}",
        f"{action}_app_annotation_error_{store.job_id}",
    ):
        assert 0 < store.redis.ttl(key) <= 600
    assert store.redis.get(f"{action}_app_annotation_{store.app_id}") in (next_job, next_job.encode())


@pytest.mark.parametrize("different_owner", ["tenant", "app", "action"])
def test_failure_cannot_change_another_owners_job(
    store: JobStore, different_owner: Literal["tenant", "app", "action"]
) -> None:
    store.repository.reserve(tenant_id=store.tenant_id, app_id=store.app_id, action="enable", job_id=store.job_id)

    store.repository.fail(
        tenant_id=str(uuid4()) if different_owner == "tenant" else store.tenant_id,
        app_id=str(uuid4()) if different_owner == "app" else store.app_id,
        action="disable" if different_owner == "action" else "enable",
        job_id=store.job_id,
        error_msg="Publish failed",
    )

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, action="enable", job_id=store.job_id
    ) == AnnotationReplyJob(job_id=store.job_id, job_status="waiting")
    assert store.redis.get(f"enable_app_annotation_{store.app_id}") in (store.job_id, store.job_id.encode())
    assert store.redis.get(f"enable_app_annotation_error_{store.job_id}") is None
