"""Exercise annotation import ownership and legacy counters against real Redis."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from redis import Redis
from redis.exceptions import NoPermissionError, ResponseError

from configs import dify_config
from extensions.ext_redis import RedisClientWrapper
from extensions.redis_names import serialize_redis_name
from repositories.annotation_import_job_repository import (
    RedisAnnotationImportJobRepository,
    annotation_import_job_owner_key,
)
from services.annotation_import_service import AnnotationImportJob


@dataclass(frozen=True)
class JobStore:
    redis: RedisClientWrapper
    raw_redis: Redis[bytes] | Redis[str]
    repository: RedisAnnotationImportJobRepository
    prefix: str
    tenant_id: str
    app_id: str
    job_id: str


@pytest.fixture(
    params=[(False, False), (True, False), (False, True), (True, True)],
    ids=["bytes", "decoded", "prefixed-bytes", "prefixed-decoded"],
)
def store(request: pytest.FixtureRequest, flask_app_with_containers: Flask) -> Iterator[JobStore]:
    assert "redis" in flask_app_with_containers.extensions
    decode_responses, use_prefix = request.param
    prefix = f"annotation-import-test-{uuid4()}" if use_prefix else ""
    previous_prefix = dify_config.REDIS_KEY_PREFIX
    dify_config.REDIS_KEY_PREFIX = prefix
    try:
        with Redis(
            host=dify_config.REDIS_HOST,
            port=dify_config.REDIS_PORT,
            db=dify_config.REDIS_DB,
            username=dify_config.REDIS_USERNAME or None,
            password=dify_config.REDIS_PASSWORD or None,
            decode_responses=decode_responses,
        ) as client:
            redis = RedisClientWrapper()
            redis.initialize(client)
            yield JobStore(
                redis,
                client,
                RedisAnnotationImportJobRepository(redis=redis),
                prefix,
                str(uuid4()),
                str(uuid4()),
                str(uuid4()),
            )
    finally:
        dify_config.REDIS_KEY_PREFIX = previous_prefix


def test_created_job_retains_waiting_status_and_owner_until_worker_completion(store: JobStore) -> None:
    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, now_ms=200000)

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id
    ) == AnnotationImportJob(job_id=store.job_id, job_status="waiting")
    assert store.redis.ttl(annotation_import_job_owner_key(job_id=store.job_id)) == -1
    assert store.redis.ttl(f"app_annotation_batch_import_{store.job_id}") == -1
    assert store.repository.count_active(tenant_id=store.tenant_id, now_ms=200000) == 1
    assert 0 < store.redis.ttl(f"annotation_import_active:{store.tenant_id}") <= 7200


@pytest.mark.parametrize("different_owner", ["tenant", "app"])
def test_job_reads_do_not_cross_ownership_boundaries(
    store: JobStore, different_owner: Literal["tenant", "app"]
) -> None:
    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, now_ms=200000)
    store.redis.set(f"app_annotation_batch_import_{store.job_id}", "error")
    store.redis.set(f"app_annotation_batch_import_error_msg_{store.job_id}", "private import error")

    assert (
        store.repository.get(
            tenant_id=str(uuid4()) if different_owner == "tenant" else store.tenant_id,
            app_id=str(uuid4()) if different_owner == "app" else store.app_id,
            job_id=store.job_id,
        )
        is None
    )


@pytest.mark.parametrize("missing_key", ["owner", "status"])
def test_missing_owner_or_status_is_not_a_queryable_job(
    store: JobStore, missing_key: Literal["owner", "status"]
) -> None:
    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, now_ms=200000)
    key = (
        annotation_import_job_owner_key(job_id=store.job_id)
        if missing_key == "owner"
        else f"app_annotation_batch_import_{store.job_id}"
    )
    store.redis.delete(key)

    assert store.repository.get(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id) is None
    assert store.redis.get(key) is None


@pytest.mark.parametrize("status", ["waiting", "completed", "error"])
@pytest.mark.parametrize("has_error", [False, True])
def test_error_message_is_returned_only_for_an_error_job(store: JobStore, status: str, has_error: bool) -> None:
    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, now_ms=200000)
    store.redis.set(f"app_annotation_batch_import_{store.job_id}", status)
    if has_error:
        store.redis.set(f"app_annotation_batch_import_error_msg_{store.job_id}", "导入失败")

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id
    ) == AnnotationImportJob(
        job_id=store.job_id, job_status=status, error_msg="导入失败" if has_error and status == "error" else ""
    )


def test_recreating_an_owned_job_does_not_reset_its_terminal_status_or_ttl(store: JobStore) -> None:
    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, now_ms=200000)
    owner_key = annotation_import_job_owner_key(job_id=store.job_id)
    status_key = f"app_annotation_batch_import_{store.job_id}"
    store.redis.setex(status_key, 600, "completed")
    store.redis.expire(owner_key, 600)

    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, now_ms=200001)

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id
    ) == AnnotationImportJob(job_id=store.job_id, job_status="completed")
    assert 0 < store.redis.ttl(owner_key) <= 600
    assert 0 < store.redis.ttl(status_key) <= 600


@pytest.mark.parametrize("different_owner", ["tenant", "app"])
def test_creation_cannot_overwrite_another_owner(store: JobStore, different_owner: Literal["tenant", "app"]) -> None:
    store.redis.set(annotation_import_job_owner_key(job_id=store.job_id), f"{store.tenant_id}:{store.app_id}")
    tenant_id = str(uuid4()) if different_owner == "tenant" else store.tenant_id
    app_id = str(uuid4()) if different_owner == "app" else store.app_id

    with pytest.raises(RuntimeError, match="already belongs to another app or tenant"):
        store.repository.create(tenant_id=tenant_id, app_id=app_id, job_id=store.job_id, now_ms=200000)

    assert store.redis.get(f"app_annotation_batch_import_{store.job_id}") is None
    assert store.repository.count_active(tenant_id=tenant_id, now_ms=200000) == 0
    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, now_ms=200000)
    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id
    ) == AnnotationImportJob(job_id=store.job_id, job_status="waiting")


@pytest.mark.parametrize("error", [None, "", "模型配置错误：embedding model is unavailable"])
def test_finish_publishes_terminal_state_and_expiry_and_releases_only_its_slot(
    store: JobStore, error: str | None
) -> None:
    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, now_ms=200000)
    newer_job_id = str(uuid4())
    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=newer_job_id, now_ms=200001)
    other_tenant_id = str(uuid4())
    other_tenant_key = f"annotation_import_active:{other_tenant_id}"
    store.redis.zadd(other_tenant_key, {store.job_id: 200000})
    error_key = f"app_annotation_batch_import_error_msg_{store.job_id}"
    store.redis.set(error_key, "previous attempt failed")

    store.repository.finish(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, error=error)

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id
    ) == AnnotationImportJob(
        job_id=store.job_id, job_status="completed" if error is None else "error", error_msg=error or ""
    )
    active_key = serialize_redis_name(f"annotation_import_active:{store.tenant_id}", store.prefix)
    assert store.raw_redis.zscore(active_key, store.job_id) is None
    assert store.raw_redis.zscore(active_key, newer_job_id) == 200001
    assert store.raw_redis.zscore(serialize_redis_name(other_tenant_key, store.prefix), store.job_id) == 200000
    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, job_id=newer_job_id
    ) == AnnotationImportJob(job_id=newer_job_id, job_status="waiting")
    assert 0 < store.redis.ttl(annotation_import_job_owner_key(job_id=store.job_id)) <= 600
    assert 0 < store.redis.ttl(f"app_annotation_batch_import_{store.job_id}") <= 600
    if error is None:
        assert store.redis.get(error_key) is None
    else:
        assert 0 < store.redis.ttl(error_key) <= 600


def test_finish_establishes_owner_and_releases_slot_for_a_legacy_queued_job(store: JobStore) -> None:
    store.redis.set(f"app_annotation_batch_import_{store.job_id}", "waiting")
    active_key = f"annotation_import_active:{store.tenant_id}"
    store.redis.zadd(active_key, {store.job_id: 200000})

    store.repository.finish(
        tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, error="App is no longer available"
    )

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id
    ) == AnnotationImportJob(job_id=store.job_id, job_status="error", error_msg="App is no longer available")
    assert store.redis.zcard(active_key) == 0
    assert 0 < store.redis.ttl(annotation_import_job_owner_key(job_id=store.job_id)) <= 600


@pytest.mark.parametrize("different_owner", ["tenant", "app"])
def test_finish_cannot_change_another_owners_job_or_release_slots(
    store: JobStore, different_owner: Literal["tenant", "app"]
) -> None:
    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, now_ms=200000)
    tenant_id = str(uuid4()) if different_owner == "tenant" else store.tenant_id
    app_id = str(uuid4()) if different_owner == "app" else store.app_id
    active_key = f"annotation_import_active:{tenant_id}"
    error_key = f"app_annotation_batch_import_error_msg_{store.job_id}"
    store.redis.zadd(active_key, {store.job_id: 200000})
    store.redis.set(error_key, "original error")
    original_error = store.redis.get(error_key)

    with pytest.raises(RuntimeError, match="already belongs to another app or tenant"):
        store.repository.finish(tenant_id=tenant_id, app_id=app_id, job_id=store.job_id, error="foreign job failed")

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id
    ) == AnnotationImportJob(job_id=store.job_id, job_status="waiting")
    assert store.raw_redis.zscore(serialize_redis_name(active_key, store.prefix), store.job_id) == 200000
    owner_active_key = serialize_redis_name(f"annotation_import_active:{store.tenant_id}", store.prefix)
    assert store.raw_redis.zscore(owner_active_key, store.job_id) == 200000
    assert store.redis.get(error_key) == original_error
    assert store.redis.ttl(annotation_import_job_owner_key(job_id=store.job_id)) == -1


@pytest.mark.parametrize("release_fails", [False, True])
@pytest.mark.parametrize("failure", ["ownership", "status"])
def test_finish_releases_slot_when_job_persistence_fails_and_preserves_the_original_error(
    store: JobStore, release_fails: bool, failure: Literal["ownership", "status"]
) -> None:
    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, now_ms=200000)
    active_key = f"annotation_import_active:{store.tenant_id}"
    if release_fails:
        store.redis.set(active_key, "invalid active jobs data")
    username = f"annotation-import-publish-{uuid4()}"
    password = str(uuid4())
    # Real ACL denial fails owner claiming or status publication without replacing repository behavior.
    denied_commands = ["-eval", "-evalsha"] if failure == "ownership" else ["-setex"]
    store.raw_redis.acl_setuser(
        username, enabled=True, passwords=[f"+{password}"], keys=["*"], commands=["+@all", *denied_commands]
    )
    try:
        with Redis(
            host=dify_config.REDIS_HOST,
            port=dify_config.REDIS_PORT,
            db=dify_config.REDIS_DB,
            username=username,
            password=password,
        ) as client:
            redis = RedisClientWrapper()
            redis.initialize(client)
            repository = RedisAnnotationImportJobRepository(redis=redis)
            with pytest.raises(NoPermissionError):
                repository.finish(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, error=None)
    finally:
        store.raw_redis.acl_deluser(username)

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id
    ) == AnnotationImportJob(job_id=store.job_id, job_status="waiting")
    if not release_fails:
        assert store.redis.zcard(active_key) == 0


def test_finish_reports_slot_release_failure_after_publishing_the_terminal_status(store: JobStore) -> None:
    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, now_ms=200000)
    store.redis.set(f"annotation_import_active:{store.tenant_id}", "invalid active jobs data")

    with pytest.raises(ResponseError, match="WRONGTYPE"):
        store.repository.finish(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, error=None)

    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id
    ) == AnnotationImportJob(job_id=store.job_id, job_status="completed")


def test_active_count_excludes_the_two_minute_boundary_and_is_tenant_scoped(store: JobStore) -> None:
    store.redis.zadd(
        f"annotation_import_active:{store.tenant_id}",
        {"old": 79999, "boundary": 80000, "recent": 80001, "now": 200000},
    )
    other_tenant_id = str(uuid4())
    store.redis.zadd(f"annotation_import_active:{other_tenant_id}", {"other": 200000})

    assert store.repository.count_active(tenant_id=store.tenant_id, now_ms=200000) == 2
    assert store.redis.zcard(f"annotation_import_active:{store.tenant_id}") == 2
    assert store.repository.count_active(tenant_id=other_tenant_id, now_ms=200000) == 1


def test_release_removes_only_the_selected_job_from_the_tenants_prefixed_key(store: JobStore) -> None:
    store.repository.create(tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id, now_ms=200000)
    active_key = f"annotation_import_active:{store.tenant_id}"
    store.redis.zadd(active_key, {"remaining": 200000})
    other_tenant_key = f"annotation_import_active:{uuid4()}"
    store.redis.zadd(other_tenant_key, {store.job_id: 200000})
    if store.prefix:
        store.raw_redis.zadd(active_key, {store.job_id: 200000})

    store.repository.release(tenant_id=store.tenant_id, job_id=store.job_id)
    store.repository.release(tenant_id=store.tenant_id, job_id=store.job_id)

    assert store.repository.count_active(tenant_id=store.tenant_id, now_ms=200000) == 1
    assert store.redis.zcard(other_tenant_key) == 1
    if store.prefix:
        assert store.raw_redis.zscore(f"{store.prefix}:{active_key}", store.job_id) is None
        assert store.raw_redis.zscore(active_key, store.job_id) == 200000
    assert store.repository.get(
        tenant_id=store.tenant_id, app_id=store.app_id, job_id=store.job_id
    ) == AnnotationImportJob(job_id=store.job_id, job_status="waiting")


@pytest.mark.parametrize(("window_seconds", "suffix"), [(60, "1min"), (3600, "1hour")])
def test_request_count_excludes_the_window_boundary_and_sets_ttl(
    store: JobStore, window_seconds: Literal[60, 3600], suffix: str
) -> None:
    now_ms = 4000000
    threshold = now_ms - window_seconds * 1000
    key = f"annotation_import_rate_limit:{store.tenant_id}:{suffix}"
    store.redis.zadd(key, {"old": threshold - 1, "boundary": threshold, "recent": threshold + 1})
    other_tenant_id = str(uuid4())
    other_key = f"annotation_import_rate_limit:{other_tenant_id}:{suffix}"
    store.redis.zadd(other_key, {"other": now_ms})

    assert store.repository.record_request(tenant_id=store.tenant_id, window_seconds=window_seconds, now_ms=now_ms) == 2
    assert store.redis.zcard(key) == 2
    assert 0 < store.redis.ttl(key) <= window_seconds * 2
    assert store.redis.zcard(other_key) == 1


def test_rate_windows_remain_independent_and_retain_timestamp_members(store: JobStore) -> None:
    assert store.repository.record_request(tenant_id=store.tenant_id, window_seconds=60, now_ms=4000000) == 1
    assert store.repository.record_request(tenant_id=store.tenant_id, window_seconds=60, now_ms=4000000) == 1
    assert store.repository.record_request(tenant_id=store.tenant_id, window_seconds=60, now_ms=4000001) == 2
    assert store.repository.record_request(tenant_id=store.tenant_id, window_seconds=3600, now_ms=4000001) == 1
    assert store.redis.zcard(f"annotation_import_rate_limit:{store.tenant_id}:1min") == 2
    assert store.redis.zcard(f"annotation_import_rate_limit:{store.tenant_id}:1hour") == 1
