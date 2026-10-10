"""Real HTTP admission, PostgreSQL, Redis and Celery memory transport for reply jobs.

Workers are not executed: these tests cover admission and publication, not
embedding/vector execution.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, replace
from queue import Empty
from typing import Literal
from uuid import UUID, uuid4

import pytest
from celery import Celery, Task
from celery.signals import before_task_publish
from flask import Flask
from kombu.exceptions import SerializerNotInstalled
from kombu.simple import SimpleQueue
from sqlalchemy import Connection, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.wraps import _is_setup_completed
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_application_services import ApplicationServices
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models import Account, App, Tenant
from models.account import TenantAccountJoin
from models.model import DifySetup
from repositories.annotation_reply_job_repository import (
    RedisAnnotationReplyJobRepository,
    annotation_reply_job_owner_key,
)
from repositories.annotation_repository import AnnotationRepository
from services.annotation_reply_service import AnnotationReplyAction, AnnotationReplyService
from tasks.annotation.disable_annotation_reply_task import disable_annotation_reply_task
from tasks.annotation.enable_annotation_reply_task import enable_annotation_reply_task
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_account, make_app

_PAYLOAD: dict[str, object] = {
    "score_threshold": 0.75,
    "embedding_provider_name": "openai",
    "embedding_model_name": "text-embedding-3-small",
}


@dataclass(frozen=True)
class _Harness:
    app: Flask
    account: Account
    target: App
    other: App
    factory: sessionmaker[Session]
    redis: RedisClientWrapper
    service: AnnotationReplyService
    celery: Celery
    tasks: tuple[Task[..., None], ...]
    queue: str
    sessions: list[Session]
    publications: list[bool]

    def request(
        self,
        action: AnnotationReplyAction,
        *,
        app_id: str | None = None,
        job_id: str | None = None,
    ) -> TestResponse:
        client = self.app.test_client()
        token = generate_csrf_token(self.account.id)
        headers = {
            HEADER_NAME_CSRF_TOKEN: token,
            "Authorization": f"Bearer {PassportService().issue({'user_id': self.account.id})}",
        }
        client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
        path = f"/console/api/apps/{app_id or self.target.id}/annotation-reply/{action}"
        if job_id is None:
            response = client.post(path, json=_PAYLOAD, headers=headers)
        else:
            response = client.get(f"{path}/status/{job_id}", headers=headers)
        assert response.headers["Content-Type"] == "application/json"
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
    workspace = Tenant(name="Annotation reply workspace")
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
    queue = f"annotation-reply-{uuid4()}"
    celery = Celery(queue, broker="memory://", set_as_current=False)
    celery.conf.update(task_default_queue=queue, task_ignore_result=True, task_publish_retry=False)
    tasks = (
        celery.task(name=enable_annotation_reply_task.name, shared=False)(enable_annotation_reply_task.run),
        celery.task(name=disable_annotation_reply_task.name, shared=False)(disable_annotation_reply_task.run),
    )
    service = AnnotationReplyService(
        apps=AnnotationRepository(session_factory=factory),
        jobs=RedisAnnotationReplyJobRepository(redis=redis),
        enable_task=tasks[0].delay,
        disable_task=tasks[1].delay,
    )
    app.extensions["application_services"] = replace(services, annotation_reply=service)
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
            SECRET_KEY="annotation-reply-passport-test-key-32-bytes",
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
            yield _Harness(
                app, account, target, other, factory, redis, service, celery, tasks, queue, sessions, publications
            )
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


def _consume_task(harness: _Harness, action: AnnotationReplyAction, job_id: str) -> None:
    expected: dict[str, object] = {
        "job_id": job_id,
        "app_id": harness.target.id,
        "tenant_id": harness.target.tenant_id,
    }
    if action == "enable":
        expected.update(_PAYLOAD, user_id=harness.account.id)
    with harness.celery.connection_for_read() as connection, SimpleQueue(connection, harness.queue) as messages:
        message = messages.get(block=False)
        assert message.headers["task"] == harness.tasks[0 if action == "enable" else 1].name
        assert message.payload[0] == []
        assert message.payload[1] == expected
        message.ack()
        with pytest.raises(Empty):
            messages.get(block=False)


@pytest.mark.parametrize("action", ["enable", "disable"])
@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR])
def test_reply_actions_publish_scoped_task_after_sql_sessions_close(
    harness: _Harness, action: AnnotationReplyAction, role: TenantAccountRole
) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id).values(role=role)
        )

    response = harness.request(action)

    assert response.status_code == 200
    body = response.get_json()
    job_id = body["job_id"]
    assert str(UUID(job_id)) == job_id
    assert body == {"job_id": job_id, "job_status": "waiting"}
    assert harness.redis.get(f"{action}_app_annotation_job_{job_id}") == b"waiting"
    assert harness.redis.get(annotation_reply_job_owner_key(action=action, job_id=job_id)) == (
        f"{harness.target.tenant_id}:{harness.target.id}".encode()
    )
    assert harness.publications == [True]
    _consume_task(harness, action, job_id)
    status = harness.request(action, job_id=job_id)
    assert status.status_code == 200
    assert status.get_json() == {"job_id": job_id, "job_status": "waiting", "error_msg": ""}


@pytest.mark.parametrize("action", ["enable", "disable"])
def test_cached_owned_job_returns_decoded_identifier_without_duplicate_publish(
    harness: _Harness, action: AnnotationReplyAction
) -> None:
    started = harness.request(action).get_json()
    job_id = started["job_id"]
    _consume_task(harness, action, job_id)
    harness.redis.setex(f"{action}_app_annotation_{harness.target.id}", 600, job_id)

    response = harness.request(action)

    assert response.status_code == 200
    assert response.get_json() == {"job_id": job_id, "job_status": "processing"}
    assert harness.publications == [True]
    with harness.celery.connection_for_read() as connection, SimpleQueue(connection, harness.queue) as messages:
        with pytest.raises(Empty):
            messages.get(block=False)


@pytest.mark.parametrize("action", ["enable", "disable"])
@pytest.mark.parametrize("mismatch", ["app", "tenant", "action", "legacy", "missing"])
def test_job_status_rejects_missing_or_unverifiable_ownership(
    harness: _Harness, action: AnnotationReplyAction, mismatch: Literal["app", "tenant", "action", "legacy", "missing"]
) -> None:
    job_id = str(uuid4())
    requested_app = harness.target.id
    stored_action: AnnotationReplyAction = (
        ("disable" if action == "enable" else "enable") if mismatch == "action" else action
    )
    if mismatch != "missing":
        harness.redis.set(f"{stored_action}_app_annotation_job_{job_id}", "completed")
    if mismatch not in {"legacy", "missing"}:
        tenant_id = str(uuid4()) if mismatch == "tenant" else harness.target.tenant_id
        harness.redis.set(
            annotation_reply_job_owner_key(action=stored_action, job_id=job_id),
            f"{tenant_id}:{harness.target.id}",
        )
    if mismatch == "app":
        requested_app = harness.other.id

    response = harness.request(action, app_id=requested_app, job_id=job_id)

    assert response.status_code == 404
    assert response.get_json()["code"] == "not_found"
    assert response.get_json()["message"] == "The job does not exist."
    assert harness.publications == []


@pytest.mark.parametrize("action", ["enable", "disable"])
@pytest.mark.parametrize(
    ("status", "error", "expected"),
    [("error", "Provider unavailable", "Provider unavailable"), ("error", None, ""), ("completed", "Old error", "")],
)
def test_status_preserves_worker_error_and_handles_expired_error_key(
    harness: _Harness, action: AnnotationReplyAction, status: str, error: str | None, expected: str
) -> None:
    body = harness.request(action).get_json()
    job_id = body["job_id"]
    harness.redis.set(f"{action}_app_annotation_job_{job_id}", status)
    if error is not None:
        harness.redis.set(f"{action}_app_annotation_error_{job_id}", error)

    response = harness.request(action, job_id=job_id)

    assert response.status_code == 200
    assert response.get_json() == {"job_id": job_id, "job_status": status, "error_msg": expected}


@pytest.mark.parametrize("action", ["enable", "disable"])
def test_publish_failure_propagates_and_preserves_waiting_job(harness: _Harness, action: AnnotationReplyAction) -> None:
    harness.tasks[0 if action == "enable" else 1].serializer = "not-installed"

    if action == "enable":
        with pytest.raises(SerializerNotInstalled):
            harness.service.enable(
                tenant_id=harness.target.tenant_id,
                app_id=harness.target.id,
                account_id=harness.account.id,
                score_threshold=0.75,
                embedding_provider_name="openai",
                embedding_model_name="text-embedding-3-small",
            )
    else:
        with pytest.raises(SerializerNotInstalled):
            harness.service.disable(tenant_id=harness.target.tenant_id, app_id=harness.target.id)

    keys = list(harness.redis.scan_iter(match=f"{action}_app_annotation_job_owner_*"))
    assert len(keys) == 1
    job_id = keys[0].decode().rsplit("_", 1)[1]
    response = harness.request(action, job_id=job_id)
    assert response.status_code == 200
    assert response.get_json() == {"job_id": job_id, "job_status": "waiting", "error_msg": ""}
    assert all(not session.in_transaction() and not session.identity_map for session in harness.sessions)
    with harness.celery.connection_for_read() as connection, SimpleQueue(connection, harness.queue) as messages:
        with pytest.raises(Empty):
            messages.get(block=False)
