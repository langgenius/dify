"""Execute reply workers against real PostgreSQL and Redis (CI-owned containers).

Empty indexes and unavailable-backend errors need no external vector server.
Successful embedding/index creation remains outside this suite's coverage.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, event, select, text
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from models.model import App, AppAnnotationSetting, MessageAnnotation
from repositories.annotation_reply_job_repository import RedisAnnotationReplyJobRepository
from services.annotation_reply_service import AnnotationReplyAction
from tasks.annotation.disable_annotation_reply_task import disable_annotation_reply_task
from tasks.annotation.enable_annotation_reply_task import enable_annotation_reply_task
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_app


@dataclass
class Harness:
    target: App
    factory: sessionmaker[Session]
    redis: RedisClientWrapper
    jobs: RedisAnnotationReplyJobRepository
    sessions: list[Session]

    def run(self, action: AnnotationReplyAction, *, app_id: str, tenant_id: str) -> str:
        job_id = str(uuid4())
        self.jobs.create(tenant_id=tenant_id, app_id=app_id, action=action, job_id=job_id)
        self.redis.set(f"{action}_app_annotation_{app_id}", job_id)
        if action == "enable":
            enable_annotation_reply_task.run(
                job_id=job_id,
                app_id=app_id,
                user_id=str(uuid4()),
                tenant_id=tenant_id,
                score_threshold=0.75,
                embedding_provider_name="openai",
                embedding_model_name="text-embedding-3-small",
            )
        else:
            disable_annotation_reply_task.run(job_id=job_id, app_id=app_id, tenant_id=tenant_id)
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        assert self.redis.get(f"{action}_app_annotation_{app_id}") is None
        return job_id


@pytest.fixture
def harness(flask_app_with_containers: Flask) -> Iterator[Harness]:
    with flask_app_with_containers.app_context():
        redis = flask_app_with_containers.extensions["redis"]
        assert isinstance(redis, RedisClientWrapper)
        factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        target = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
        with factory.begin() as session:
            session.add(target)
        sessions: list[Session] = []

        def track(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
            sessions.append(session)

        event.listen(Session, "after_begin", track)
        try:
            yield Harness(target, factory, redis, RedisAnnotationReplyJobRepository(redis=redis), sessions)
        finally:
            event.remove(Session, "after_begin", track)


def test_enable_then_disable_publish_completed_after_settings_are_committed(harness: Harness) -> None:
    for action in ("enable", "disable"):
        job_id = harness.run(action, app_id=harness.target.id, tenant_id=harness.target.tenant_id)
        job = harness.jobs.get(
            tenant_id=harness.target.tenant_id, app_id=harness.target.id, action=action, job_id=job_id
        )
        assert job is not None
        assert job.job_status == "completed"
        assert job.error_msg == ""
        with harness.factory() as session:
            setting = session.scalar(
                select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == harness.target.id)
            )
            if action == "enable":
                assert setting is not None
                assert setting.score_threshold == 0.75
            else:
                assert setting is None


@pytest.mark.parametrize("action", ["enable", "disable"])
@pytest.mark.parametrize("unavailable", ["missing", "foreign", "disabled"])
def test_unavailable_app_finishes_with_error_instead_of_remaining_waiting(
    harness: Harness, action: AnnotationReplyAction, unavailable: Literal["missing", "foreign", "disabled"]
) -> None:
    app_id = str(uuid4()) if unavailable == "missing" else harness.target.id
    tenant_id = str(uuid4()) if unavailable == "foreign" else harness.target.tenant_id
    if unavailable == "disabled":
        with harness.factory.begin() as session:
            session.execute(
                text("UPDATE apps SET status = :status WHERE id = :id"), {"status": "disabled", "id": app_id}
            )
    job_id = harness.run(action, app_id=app_id, tenant_id=tenant_id)
    job = harness.jobs.get(tenant_id=tenant_id, app_id=app_id, action=action, job_id=job_id)
    assert job is not None
    assert job.job_status == "error"
    assert app_id in job.error_msg
    assert tenant_id in job.error_msg


def test_repeated_disable_of_absent_setting_completes(harness: Harness) -> None:
    for _ in range(2):
        job_id = harness.run("disable", app_id=harness.target.id, tenant_id=harness.target.tenant_id)
        job = harness.jobs.get(
            tenant_id=harness.target.tenant_id, app_id=harness.target.id, action="disable", job_id=job_id
        )
        assert job is not None
        assert job.job_status == "completed"


def test_backend_error_is_queryable_and_does_not_enable_reply(harness: Harness) -> None:
    with harness.factory.begin() as session:
        session.add(
            MessageAnnotation(app_id=harness.target.id, question="Question", content="Answer", account_id=str(uuid4()))
        )
    with config_overrides_context(
        VECTOR_STORE="unavailable-annotation-test-backend", VECTOR_STORE_WHITELIST_ENABLE=False
    ):
        job_id = harness.run("enable", app_id=harness.target.id, tenant_id=harness.target.tenant_id)
    job = harness.jobs.get(tenant_id=harness.target.tenant_id, app_id=harness.target.id, action="enable", job_id=job_id)
    assert job is not None
    assert job.job_status == "error"
    assert "unavailable-annotation-test-backend" in job.error_msg
    with harness.factory() as session:
        assert (
            session.scalar(select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == harness.target.id)) is None
        )
