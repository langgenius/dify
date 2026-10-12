"""Legacy Service API producers create owner-scoped jobs without changing their task payloads."""

from collections.abc import Iterator
from queue import Empty
from uuid import uuid4

import pytest
from celery import Celery
from flask import Flask, g
from kombu.exceptions import SerializerNotInstalled
from kombu.simple import SimpleQueue
from sqlalchemy.orm import Session

from extensions.ext_redis import redis_client
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from repositories.annotation_reply_job_repository import (
    RedisAnnotationReplyJobRepository,
    annotation_reply_job_owner_key,
)
from services.annotation_reply_service import AnnotationReplyAction, AnnotationReplyJob
from services.annotation_service import AnnotationJobStatusDict, AppAnnotationService
from tasks.annotation.disable_annotation_reply_task import disable_annotation_reply_task
from tasks.annotation.enable_annotation_reply_task import enable_annotation_reply_task


@pytest.fixture
def memory_celery(flask_app_with_containers: Flask) -> Iterator[Celery]:
    previous = flask_app_with_containers.extensions["celery"]
    assert isinstance(previous, Celery)
    queue = f"annotation-legacy-{uuid4()}"
    celery = Celery(queue, broker="memory://", set_as_current=False)
    celery.conf.update(task_default_queue=queue, task_ignore_result=True, task_publish_retry=False)
    celery.task(name=enable_annotation_reply_task.name, shared=False, lazy=False)(enable_annotation_reply_task.run)
    celery.task(name=disable_annotation_reply_task.name, shared=False, lazy=False)(disable_annotation_reply_task.run)
    celery.set_current()
    try:
        yield celery
    finally:
        previous.set_current()
        with celery.connection_for_read() as connection, SimpleQueue(connection, queue) as messages:
            messages.clear()
        celery.close()


@pytest.fixture
def legacy_actor(db_session_with_containers: Session) -> tuple[Account, Tenant]:
    account = Account(name="Annotation tester", email=f"annotation-{uuid4()}@example.com")
    tenant = Tenant(name="Annotation workspace")
    db_session_with_containers.add_all([account, tenant])
    db_session_with_containers.flush()
    db_session_with_containers.add(
        TenantAccountJoin(account_id=account.id, tenant_id=tenant.id, role=TenantAccountRole.OWNER)
    )
    db_session_with_containers.commit()
    account.set_tenant_id_with_session(tenant.id, session=db_session_with_containers)
    return account, tenant


def _start_job(action: AnnotationReplyAction, app_id: str) -> AnnotationJobStatusDict:
    if action == "enable":
        return AppAnnotationService.enable_app_annotation(
            {"score_threshold": 0.8, "embedding_provider_name": "provider", "embedding_model_name": "model"},
            app_id,
        )
    return AppAnnotationService.disable_app_annotation(app_id)


@pytest.mark.parametrize("action", ["enable", "disable"])
def test_legacy_producer_deduplicates_requests_and_preserves_task_arguments(
    action: AnnotationReplyAction,
    flask_app_with_containers: Flask,
    legacy_actor: tuple[Account, Tenant],
    memory_celery: Celery,
) -> None:
    account, tenant = legacy_actor
    app_id = str(uuid4())

    with flask_app_with_containers.test_request_context():
        g._login_user = account
        result = _start_job(action, app_id)
        repeated = _start_job(action, app_id)

    if action == "enable":
        expected_args = [result["job_id"], app_id, account.id, tenant.id, 0.8, "provider", "model"]
        task_name = enable_annotation_reply_task.name
    else:
        expected_args = [result["job_id"], app_id, tenant.id]
        task_name = disable_annotation_reply_task.name

    assert result["job_status"] == "waiting"
    assert repeated == {"job_id": result["job_id"], "job_status": "processing"}
    jobs = RedisAnnotationReplyJobRepository(redis=redis_client)
    assert jobs.get(tenant_id=tenant.id, app_id=app_id, action=action, job_id=result["job_id"]) == AnnotationReplyJob(
        job_id=result["job_id"], job_status="waiting"
    )
    for key in (
        f"{action}_app_annotation_{app_id}",
        f"{action}_app_annotation_job_{result['job_id']}",
        annotation_reply_job_owner_key(action=action, job_id=result["job_id"]),
    ):
        assert redis_client.ttl(key) > 0
    with (
        memory_celery.connection_for_read() as connection,
        SimpleQueue(connection, memory_celery.conf.task_default_queue) as messages,
    ):
        message = messages.get(block=False)
        assert message.headers["task"] == task_name
        assert message.payload[0] == expected_args
        assert message.payload[1] == {}
        message.ack()
        with pytest.raises(Empty):
            messages.get(block=False)


@pytest.mark.parametrize("action", ["enable", "disable"])
def test_legacy_producer_cancels_reservation_when_publication_fails(
    action: AnnotationReplyAction,
    flask_app_with_containers: Flask,
    legacy_actor: tuple[Account, Tenant],
    memory_celery: Celery,
) -> None:
    account, _tenant = legacy_actor
    app_id = str(uuid4())
    previous_keys = set(redis_client.scan_iter(match=f"{action}_app_annotation_*"))
    task_name = enable_annotation_reply_task.name if action == "enable" else disable_annotation_reply_task.name
    task = memory_celery.tasks[task_name]
    previous_serializer = task.serializer
    task.serializer = "annotation-test-unregistered-serializer"
    vars(task).pop("_exec_options", None)
    try:
        with flask_app_with_containers.test_request_context():
            g._login_user = account
            with pytest.raises(SerializerNotInstalled):
                _start_job(action, app_id)
    finally:
        task.serializer = previous_serializer
        # Celery caches publication options even when serialization fails.
        vars(task).pop("_exec_options", None)

    assert set(redis_client.scan_iter(match=f"{action}_app_annotation_*")) == previous_keys
    assert redis_client.get(f"{action}_app_annotation_{app_id}") is None
    with (
        memory_celery.connection_for_read() as connection,
        SimpleQueue(connection, memory_celery.conf.task_default_queue) as messages,
    ):
        with pytest.raises(Empty):
            messages.get(block=False)

    with flask_app_with_containers.test_request_context():
        g._login_user = account
        retry = _start_job(action, app_id)
    assert retry["job_status"] == "waiting"
    assert redis_client.get(f"{action}_app_annotation_{app_id}") == retry["job_id"].encode()
