"""Real HTTP, PostgreSQL, Redis and Celery publication for annotation import jobs.

Workers are not executed: admission and publication are exercised without vector I/O.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from dataclasses import dataclass, replace
from io import BytesIO
from queue import Empty
from uuid import UUID, uuid4

import pytest
from celery import Celery, Task
from celery.signals import before_task_publish
from flask import Flask
from kombu.simple import SimpleQueue
from sqlalchemy import Connection, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.wraps import _is_setup_completed
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_application_services import ApplicationServices, _get_annotation_import_quota
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models import Account, App, Tenant
from models.account import TenantAccountJoin
from models.model import DifySetup
from repositories.annotation_import_job_repository import (
    RedisAnnotationImportJobRepository,
    annotation_import_job_owner_key,
)
from repositories.annotation_repository import AnnotationRepository
from services.annotation_import_service import AnnotationImportLimits, AnnotationImportService
from services.annotation_reply_index import AnnotationVectorIndex
from tasks.annotation.batch_import_annotations_task import batch_import_annotations_task
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_account, make_app

_CSV = b"question,answer\n  Question  ,  Answer  \nNA,N/A\n"
_RECORDS = [{"question": "Question", "answer": "Answer"}, {"question": "NA", "answer": "N/A"}]


@dataclass(frozen=True)
class _Harness:
    app: Flask
    account: Account
    target: App
    other: App
    factory: sessionmaker[Session]
    redis: RedisClientWrapper
    celery: Celery
    task: Task[..., None]
    queue: str
    sessions: list[Session]
    publications: list[bool]

    def request(
        self,
        *,
        app_id: str | None = None,
        job_id: str | None = None,
        content: bytes = _CSV,
        filename: str = "annotations.CSV",
    ) -> TestResponse:
        client = self.app.test_client()
        token = generate_csrf_token(self.account.id)
        headers = {
            HEADER_NAME_CSRF_TOKEN: token,
            "Authorization": f"Bearer {PassportService().issue({'user_id': self.account.id})}",
        }
        client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
        path = f"/console/api/apps/{app_id or self.target.id}/annotations/batch-import"
        if job_id is None:
            response = client.post(
                path,
                data={"file": (BytesIO(content), filename)},
                content_type="multipart/form-data",
                headers=headers,
            )
        else:
            response = client.get(f"{path}-status/{job_id}", headers=headers)
        assert response.headers["Content-Type"] == "application/json"
        assert int(response.headers["Content-Length"]) == len(response.data)
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        return response


@pytest.fixture
def harness(flask_app_with_containers: Flask) -> Iterator[_Harness]:
    app = flask_app_with_containers
    services = app.extensions["application_services"]
    assert isinstance(services, ApplicationServices)
    redis = app.extensions["redis"]
    assert isinstance(redis, RedisClientWrapper)
    with app.app_context():
        factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    workspace = Tenant(name="Annotation import workspace")
    account = make_account(account_id=str(uuid4()), email=f"{uuid4()}@example.com")
    account.last_active_at = naive_utc_now()
    target = make_app(app_id=str(uuid4()), tenant_id=workspace.id)
    other = make_app(app_id=str(uuid4()), tenant_id=workspace.id)
    with factory.begin() as session:
        session.add_all(
            [
                workspace,
                account,
                target,
                other,
                TenantAccountJoin(
                    tenant_id=workspace.id, account_id=account.id, role=TenantAccountRole.OWNER, current=True
                ),
                DifySetup(version="test"),
            ]
        )
    queue = f"annotation-import-{uuid4()}"
    celery = Celery(queue, broker="memory://", set_as_current=False)
    celery.conf.update(task_default_queue=queue, task_ignore_result=True, task_publish_retry=False)
    task = celery.task(name=batch_import_annotations_task.name, shared=False)(batch_import_annotations_task.run)
    service = AnnotationImportService(
        annotations=AnnotationRepository(session_factory=factory),
        index=AnnotationVectorIndex(session_factory=factory),
        jobs=RedisAnnotationImportJobRepository(redis=redis),
        publish=task.delay,
        quota=_get_annotation_import_quota,
        limits=AnnotationImportLimits(
            min_records=1, max_records=2, requests_per_minute=5, requests_per_hour=20, max_concurrent=3
        ),
    )
    app.extensions["application_services"] = replace(services, annotation_imports=service)
    sessions: list[Session] = []
    publications: list[bool] = []

    def track(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    def observe_publish(**_kwargs: object) -> None:
        publications.append(all(not session.in_transaction() and not session.identity_map for session in sessions))

    event.listen(Session, "after_begin", track)
    before_task_publish.connect(observe_publish, weak=True)
    _is_setup_completed.reset_success()
    try:
        with config_overrides_context(
            DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
            SECRET_KEY="annotation-import-passport-test-key-32-bytes",
            LOGIN_DISABLED=False,
            INIT_PASSWORD="",
            CONSOLE_API_URL="http://localhost",
            CONSOLE_WEB_URL="http://localhost",
            COOKIE_DOMAIN="",
            RBAC_ENABLED=False,
        ):
            with app.app_context():
                assert _is_setup_completed()
                db.session.remove()
            yield _Harness(app, account, target, other, factory, redis, celery, task, queue, sessions, publications)
    finally:
        app.extensions["application_services"] = services
        del observe_publish
        event.remove(Session, "after_begin", track)
        with celery.connection_for_read() as connection, SimpleQueue(connection, queue) as messages:
            messages.clear()
        celery.close()
        _is_setup_completed.reset_success()
        with app.app_context():
            db.session.remove()


def _assert_no_task(harness: _Harness) -> None:
    with harness.celery.connection_for_read() as connection, SimpleQueue(connection, harness.queue) as messages:
        with pytest.raises(Empty):
            messages.get(block=False)


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR])
def test_import_publishes_scoped_records_after_sql_sessions_close(harness: _Harness, role: TenantAccountRole) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id).values(role=role)
        )

    response = harness.request()

    assert response.status_code == 200
    body = response.get_json()
    job_id = body["job_id"]
    assert str(UUID(job_id)) == job_id
    assert body == {"job_id": job_id, "job_status": "waiting", "record_count": 2, "error_msg": None}
    assert harness.redis.get(f"app_annotation_batch_import_{job_id}") == b"waiting"
    assert harness.redis.get(annotation_import_job_owner_key(job_id=job_id)) == (
        f"{harness.target.tenant_id}:{harness.target.id}".encode()
    )
    assert harness.redis.zscore(f"annotation_import_active:{harness.target.tenant_id}", job_id) is not None
    assert harness.publications == [True]
    with harness.celery.connection_for_read() as connection, SimpleQueue(connection, harness.queue) as messages:
        message = messages.get(block=False)
        assert message.headers["task"] == batch_import_annotations_task.name
        assert message.payload[0] == []
        assert message.payload[1] == {
            "job_id": job_id,
            "content_list": _RECORDS,
            "app_id": harness.target.id,
            "tenant_id": harness.target.tenant_id,
            "user_id": harness.account.id,
        }
        message.ack()
    _assert_no_task(harness)
    status = harness.request(job_id=job_id)
    assert status.status_code == 200
    assert status.get_json() == {"job_id": job_id, "job_status": "waiting", "error_msg": ""}


@pytest.mark.parametrize(
    ("content", "message"),
    [
        (b"question\nQuestion\n", "at least 2 columns"),
        (b"question,answer\n", "at least 1 valid annotation record"),
        (b"question,answer", "appears to be empty or invalid"),
        (b"question,answer\nQ1,A1\nQ2,A2\nQ3,A3\n", "Maximum 2 records"),
        (b"question,answer\n" + b"Q" * 2001 + b",Answer\n", "Maximum 2000 characters"),
        (b"question,answer\nQuestion," + b"A" * 10001 + b"\n", "Maximum 10000 characters"),
        (b"question,answer\n\xff,Answer\n", "can't decode byte"),
    ],
    ids=["one-column", "header-only", "no-newline", "too-many-records", "long-question", "long-answer", "bad-encoding"],
)
def test_invalid_csv_preserves_error_message_response_without_creating_a_job(
    harness: _Harness, content: bytes, message: str
) -> None:
    response = harness.request(content=content)

    assert response.status_code == 200
    body = response.get_json()
    assert body == {"job_id": None, "job_status": None, "record_count": None, "error_msg": body["error_msg"]}
    assert message in body["error_msg"]
    for window in ("1min", "1hour"):
        assert harness.redis.zcard(f"annotation_import_rate_limit:{harness.target.tenant_id}:{window}") == 1
    assert harness.redis.zcard(f"annotation_import_active:{harness.target.tenant_id}") == 0
    assert list(harness.redis.scan_iter(match="app_annotation_batch_import_owner_*")) == []
    assert harness.publications == []
    _assert_no_task(harness)


@pytest.mark.parametrize(("window", "limit"), [("1min", 5), ("1hour", 20)])
def test_rate_limit_returns_429_without_registering_or_publishing_job(
    harness: _Harness, window: str, limit: int
) -> None:
    now_ms = int(time.time() * 1000)
    harness.redis.zadd(
        f"annotation_import_rate_limit:{harness.target.tenant_id}:{window}",
        {f"prior-{index}": now_ms for index in range(limit)},
    )

    response = harness.request()

    assert response.status_code == 429
    assert response.get_json()["code"] == "too_many_requests"
    assert harness.redis.zcard(f"annotation_import_active:{harness.target.tenant_id}") == 0
    assert harness.publications == []
    _assert_no_task(harness)


def test_concurrency_limit_returns_429_and_preserves_existing_jobs(harness: _Harness) -> None:
    active_key = f"annotation_import_active:{harness.target.tenant_id}"
    existing = {str(uuid4()) for _ in range(3)}
    now_ms = int(time.time() * 1000)
    harness.redis.zadd(active_key, dict.fromkeys(existing, now_ms))

    response = harness.request()

    assert response.status_code == 429
    assert response.get_json()["code"] == "too_many_requests"
    assert {job.decode() for job in harness.redis.zrange(active_key, 0, -1)} == existing
    assert harness.publications == []
    _assert_no_task(harness)


@pytest.mark.parametrize("mismatch", ["app", "tenant", "legacy", "missing", "status_missing"])
def test_job_status_requires_complete_owner_and_status(harness: _Harness, mismatch: str) -> None:
    job_id = str(uuid4())
    requested_app = harness.other.id if mismatch == "app" else harness.target.id
    if mismatch not in {"missing", "status_missing"}:
        harness.redis.set(f"app_annotation_batch_import_{job_id}", "completed")
    if mismatch not in {"legacy", "missing"}:
        tenant_id = str(uuid4()) if mismatch == "tenant" else harness.target.tenant_id
        harness.redis.set(annotation_import_job_owner_key(job_id=job_id), f"{tenant_id}:{harness.target.id}")

    response = harness.request(app_id=requested_app, job_id=job_id)

    assert response.status_code == 404
    assert response.get_json()["code"] == "not_found"
    assert response.get_json()["message"] == "The job does not exist."
    assert harness.publications == []


@pytest.mark.parametrize(
    ("status", "error", "expected"),
    [
        ("waiting", None, ""),
        ("completed", "Old error", ""),
        ("error", "Worker failed", "Worker failed"),
        ("error", None, ""),
    ],
)
def test_status_preserves_worker_error_and_handles_expired_error_key(
    harness: _Harness, status: str, error: str | None, expected: str
) -> None:
    job_id = str(uuid4())
    harness.redis.set(annotation_import_job_owner_key(job_id=job_id), f"{harness.target.tenant_id}:{harness.target.id}")
    harness.redis.set(f"app_annotation_batch_import_{job_id}", status)
    if error is not None:
        harness.redis.set(f"app_annotation_batch_import_error_msg_{job_id}", error)

    response = harness.request(job_id=job_id)

    assert response.status_code == 200
    assert response.get_json() == {"job_id": job_id, "job_status": status, "error_msg": expected}


def test_publish_failure_returns_500_and_releases_active_job(harness: _Harness) -> None:
    harness.task.serializer = "not-installed"

    response = harness.request()

    assert response.status_code == 500
    assert response.get_json()["code"] == "internal_server_error"
    assert "error_msg" not in response.get_json()
    assert harness.redis.zcard(f"annotation_import_active:{harness.target.tenant_id}") == 0
    [owner_key] = list(harness.redis.scan_iter(match="app_annotation_batch_import_owner_*"))
    job_id = owner_key.decode().rsplit("_", 1)[1]
    assert harness.request(job_id=job_id).get_json() == {"job_id": job_id, "job_status": "waiting", "error_msg": ""}
    _assert_no_task(harness)
