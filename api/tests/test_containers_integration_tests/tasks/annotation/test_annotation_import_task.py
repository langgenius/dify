"""Run CSV import workers against real PostgreSQL and Redis (CI-owned containers).

Reply-disabled imports and configuration failures do not need a vector server.
Successful embedding/index writes remain outside this suite's coverage.
"""

import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, event, select, text
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from configs import dify_config
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from extensions.redis_names import serialize_redis_name
from models.dataset import DatasetCollectionBinding
from models.enums import CollectionBindingType
from models.model import App, AppAnnotationSetting, MessageAnnotation
from repositories.annotation_import_job_repository import RedisAnnotationImportJobRepository
from services.annotation_import_service import AnnotationImportJob, AnnotationImportRecord
from tasks.annotation.batch_import_annotations_task import batch_import_annotations_task
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_app


@dataclass
class Harness:
    target: App
    account_id: str
    factory: sessionmaker[Session]
    redis: RedisClientWrapper
    jobs: RedisAnnotationImportJobRepository
    sessions: list[Session]

    def run(
        self, *, job_id: str, app_id: str, tenant_id: str, records: list[AnnotationImportRecord]
    ) -> AnnotationImportJob:
        now_ms = int(time.time() * 1000)
        self.jobs.create(tenant_id=tenant_id, app_id=app_id, job_id=job_id, now_ms=now_ms)
        other_job_id = str(uuid4())
        self.jobs.create(tenant_id=tenant_id, app_id=app_id, job_id=other_job_id, now_ms=now_ms)

        batch_import_annotations_task.run(
            job_id=job_id,
            content_list=records,
            app_id=app_id,
            tenant_id=tenant_id,
            user_id=self.account_id,
        )

        assert self.sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        # zscore is delegated directly, so it needs the configured prefix explicitly.
        active_key = serialize_redis_name(f"annotation_import_active:{tenant_id}", dify_config.REDIS_KEY_PREFIX)
        assert self.redis.zscore(active_key, job_id) is None
        assert self.redis.zscore(active_key, other_job_id) is not None
        job = self.jobs.get(tenant_id=tenant_id, app_id=app_id, job_id=job_id)
        assert job is not None
        return job

    def annotations(self) -> list[MessageAnnotation]:
        with self.factory() as session:
            return list(
                session.scalars(
                    select(MessageAnnotation)
                    .where(MessageAnnotation.app_id == self.target.id)
                    .order_by(MessageAnnotation.question)
                )
            )


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
            yield Harness(
                target, str(uuid4()), factory, redis, RedisAnnotationImportJobRepository(redis=redis), sessions
            )
        finally:
            event.remove(Session, "after_begin", track)


def test_reply_disabled_import_saves_every_record_and_completes_job(harness: Harness) -> None:
    job = harness.run(
        job_id=str(uuid4()),
        app_id=harness.target.id,
        tenant_id=harness.target.tenant_id,
        records=[{"question": "First question", "answer": "First answer"}, {"question": "问题", "answer": "回答"}],
    )

    assert job.job_status == "completed"
    assert job.error_msg == ""
    annotations = harness.annotations()
    assert [(annotation.question, annotation.content) for annotation in annotations] == [
        ("First question", "First answer"),
        ("问题", "回答"),
    ]
    assert all(annotation.account_id == harness.account_id for annotation in annotations)


@pytest.mark.parametrize("status_is_lost", [False, True])
def test_redelivery_does_not_duplicate_committed_rows_even_without_redis_status(
    harness: Harness, status_is_lost: bool
) -> None:
    job_id = str(uuid4())
    records: list[AnnotationImportRecord] = [
        {"question": "Question one", "answer": "Answer one"},
        {"question": "Question two", "answer": "Answer two"},
    ]
    initial = harness.run(job_id=job_id, app_id=harness.target.id, tenant_id=harness.target.tenant_id, records=records)
    assert initial.job_status == "completed"
    initial_ids = [annotation.id for annotation in harness.annotations()]
    assert len(initial_ids) == len(records)
    if status_is_lost:
        harness.redis.delete(f"app_annotation_batch_import_{job_id}")

    repeated = harness.run(job_id=job_id, app_id=harness.target.id, tenant_id=harness.target.tenant_id, records=records)

    assert repeated.job_status == "completed"
    assert repeated.error_msg == ""
    assert [annotation.id for annotation in harness.annotations()] == initial_ids


@pytest.mark.parametrize("unavailable", ["missing", "foreign", "disabled"])
def test_unavailable_app_publishes_error_and_releases_only_its_import_slot(
    harness: Harness, unavailable: Literal["missing", "foreign", "disabled"]
) -> None:
    app_id = str(uuid4()) if unavailable == "missing" else harness.target.id
    tenant_id = str(uuid4()) if unavailable == "foreign" else harness.target.tenant_id
    if unavailable == "disabled":
        with harness.factory.begin() as session:
            session.execute(
                text("UPDATE apps SET status = :status WHERE id = :id"), {"status": "disabled", "id": app_id}
            )

    job = harness.run(
        job_id=str(uuid4()),
        app_id=app_id,
        tenant_id=tenant_id,
        records=[{"question": "Question", "answer": "Answer"}],
    )

    assert job.job_status == "error"
    assert app_id in job.error_msg
    assert tenant_id in job.error_msg
    assert harness.annotations() == []


@pytest.mark.parametrize("binding_state", ["missing", "wrong_type"])
def test_unavailable_annotation_binding_does_not_save_imported_rows(
    harness: Harness, binding_state: Literal["missing", "wrong_type"]
) -> None:
    binding = DatasetCollectionBinding(
        provider_name="openai",
        model_name="text-embedding-3-small",
        type=CollectionBindingType.DATASET,
        collection_name=f"annotation_import_{uuid4().hex}",
    )
    with harness.factory.begin() as session:
        if binding_state == "wrong_type":
            session.add(binding)
        session.add(
            AppAnnotationSetting(
                app_id=harness.target.id,
                score_threshold=0.75,
                collection_binding_id=binding.id,
                created_user_id=harness.account_id,
                updated_user_id=harness.account_id,
            )
        )

    job = harness.run(
        job_id=str(uuid4()),
        app_id=harness.target.id,
        tenant_id=harness.target.tenant_id,
        records=[{"question": "Question", "answer": "Answer"}],
    )

    assert job.job_status == "error"
    assert binding.id in job.error_msg
    assert harness.target.id in job.error_msg
    assert harness.annotations() == []


def test_backend_configuration_error_is_queryable_without_committing_rows(harness: Harness) -> None:
    binding = DatasetCollectionBinding(
        provider_name="openai",
        model_name="text-embedding-3-small",
        type=CollectionBindingType.ANNOTATION,
        collection_name=f"annotation_import_{uuid4().hex}",
    )
    with harness.factory.begin() as session:
        session.add(binding)
        session.add(
            AppAnnotationSetting(
                app_id=harness.target.id,
                score_threshold=0.75,
                collection_binding_id=binding.id,
                created_user_id=harness.account_id,
                updated_user_id=harness.account_id,
            )
        )
    with config_overrides_context(
        VECTOR_STORE="unavailable-annotation-test-backend", VECTOR_STORE_WHITELIST_ENABLE=False
    ):
        job = harness.run(
            job_id=str(uuid4()),
            app_id=harness.target.id,
            tenant_id=harness.target.tenant_id,
            records=[{"question": "Question", "answer": "Answer"}],
        )

    assert job.job_status == "error"
    assert "unavailable-annotation-test-backend" in job.error_msg
    assert harness.annotations() == []


def test_database_constraint_failure_rolls_back_the_entire_batch(harness: Harness) -> None:
    # A real PostgreSQL constraint rejects the second row without replacing any
    # persistence methods or changing otherwise valid worker arguments.
    constraint_name = f"test_annotation_import_{uuid4().hex}"
    with harness.factory.begin() as session:
        session.add(
            MessageAnnotation(
                app_id=harness.target.id,
                account_id=harness.account_id,
                question="Existing question",
                content="Existing answer",
            )
        )
        session.execute(
            text(
                f"ALTER TABLE message_annotations ADD CONSTRAINT {constraint_name} "
                "CHECK (question <> 'Rejected import question')"
            )
        )
    try:
        job = harness.run(
            job_id=str(uuid4()),
            app_id=harness.target.id,
            tenant_id=harness.target.tenant_id,
            records=[
                {"question": "Accepted import question", "answer": "First answer"},
                {"question": "Rejected import question", "answer": "Second answer"},
            ],
        )

        assert job.job_status == "error"
        assert constraint_name in job.error_msg
        assert [(annotation.question, annotation.content) for annotation in harness.annotations()] == [
            ("Existing question", "Existing answer")
        ]
    finally:
        with harness.factory.begin() as session:
            session.execute(text(f"ALTER TABLE message_annotations DROP CONSTRAINT {constraint_name}"))
