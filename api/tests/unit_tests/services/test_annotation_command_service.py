"""Real SQLite writes and Celery's in-memory transport exercise the commit/publish boundary."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from queue import Empty
from typing import Literal
from uuid import uuid4

import pytest
from celery import Celery, Task
from celery.signals import before_task_publish
from kombu.exceptions import SerializerNotInstalled
from kombu.simple import SimpleQueue
from sqlalchemy import Connection, event
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from models.model import App, AppAnnotationSetting, MessageAnnotation
from repositories.annotation_repository import AnnotationRepository
from services.annotation_command_service import AnnotationCommandService
from services.annotation_query import AnnotationNotFoundError, AnnotationRecord
from tasks.annotation.add_annotation_to_index_task import add_annotation_to_index_task
from tasks.annotation.delete_annotation_index_task import delete_annotation_index_task
from tasks.annotation.update_annotation_to_index_task import update_annotation_to_index_task
from tests.unit_tests.model_factories import make_app

type Operation = Literal["upsert", "update", "delete"]


@dataclass
class _Harness:
    service: AnnotationCommandService
    repository: AnnotationRepository
    factory: sessionmaker[Session]
    app: App
    annotation: MessageAnnotation
    binding_id: str
    celery: Celery
    tasks: tuple[Task[..., None], ...]
    queue: str
    publications: list[tuple[bool, tuple[AnnotationRecord, ...]]]

    def apply(self, operation: Operation) -> str:
        if operation == "upsert":
            return self.service.upsert(
                tenant_id=self.app.tenant_id,
                app_id=self.app.id,
                account_id=self.annotation.account_id,
                message_id=None,
                question="new question",
                answer="",
                content="legacy answer",
            ).id
        if operation == "update":
            return self.service.update(
                tenant_id=self.app.tenant_id,
                app_id=self.app.id,
                annotation_id=self.annotation.id,
                question="",
                answer="updated answer",
            ).id
        self.service.delete(tenant_id=self.app.tenant_id, app_id=self.app.id, annotation_id=self.annotation.id)
        return self.annotation.id


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    app = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    annotation = MessageAnnotation(app_id=app.id, question="old", content="old answer", account_id=str(uuid4()))
    binding_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add_all([app, annotation])
    repository = AnnotationRepository(session_factory=sqlite_session_factory)
    queue = f"annotation-{uuid4()}"
    celery = Celery(queue, broker="memory://", set_as_current=False)
    celery.conf.update(task_default_queue=queue, task_ignore_result=True, task_publish_retry=False)
    tasks = (
        celery.task(name=add_annotation_to_index_task.name, shared=False)(add_annotation_to_index_task.run),
        celery.task(name=update_annotation_to_index_task.name, shared=False)(update_annotation_to_index_task.run),
        celery.task(name=delete_annotation_index_task.name, shared=False)(delete_annotation_index_task.run),
    )
    service = AnnotationCommandService(
        annotations=repository, add_index=tasks[0].delay, update_index=tasks[1].delay, delete_index=tasks[2].delay
    )
    sessions: list[Session] = []
    publications: list[tuple[bool, tuple[AnnotationRecord, ...]]] = []

    def track(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    def observe_publish(**_kwargs: object) -> None:
        closed = all(not session.in_transaction() and not session.identity_map for session in sessions)
        publications.append((closed, repository.get_all(tenant_id=app.tenant_id, app_id=app.id)))

    event.listen(sqlite_session_factory, "after_begin", track)
    before_task_publish.connect(observe_publish, weak=True)
    try:
        yield _Harness(
            service, repository, sqlite_session_factory, app, annotation, binding_id, celery, tasks, queue, publications
        )
    finally:
        del observe_publish
        event.remove(sqlite_session_factory, "after_begin", track)
        with celery.connection_for_read() as connection, SimpleQueue(connection, queue) as messages:
            messages.clear()
        celery.close()


def _enable(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.add(
            AppAnnotationSetting(
                app_id=harness.app.id,
                score_threshold=0.5,
                collection_binding_id=harness.binding_id,
                created_user_id=harness.annotation.account_id,
                updated_user_id=harness.annotation.account_id,
            )
        )


@pytest.mark.parametrize("operation", ["upsert", "update", "delete"])
def test_tasks_are_published_after_committed_rows_are_visible_and_sessions_close(
    harness: _Harness, operation: Operation
) -> None:
    _enable(harness)
    annotation_id = harness.apply(operation)

    [(closed, records)] = harness.publications
    assert closed
    saved = {record.id: record for record in records}
    expected_kwargs = {
        "annotation_id": annotation_id,
        "app_id": harness.app.id,
        "tenant_id": harness.app.tenant_id,
        "collection_binding_id": harness.binding_id,
    }
    task_index = {"upsert": 0, "update": 1, "delete": 2}[operation]
    if operation == "delete":
        assert annotation_id not in saved
    else:
        expected_kwargs["question"] = "new question" if operation == "upsert" else "updated answer"
        assert saved[annotation_id].content == ("legacy answer" if operation == "upsert" else "updated answer")
    with harness.celery.connection_for_read() as connection, SimpleQueue(connection, harness.queue) as messages:
        message = messages.get(block=False)
        assert message.headers["task"] == harness.tasks[task_index].name
        assert message.payload[0] == []
        assert message.payload[1] == expected_kwargs
        message.ack()
        with pytest.raises(Empty):
            messages.get(block=False)


@pytest.mark.parametrize("operation", ["upsert", "update", "delete"])
def test_disabled_annotation_reply_does_not_publish(harness: _Harness, operation: Operation) -> None:
    harness.apply(operation)
    assert harness.publications == []
    with harness.celery.connection_for_read() as connection, SimpleQueue(connection, harness.queue) as messages:
        with pytest.raises(Empty):
            messages.get(block=False)


def test_rejected_write_does_not_publish(harness: _Harness) -> None:
    _enable(harness)
    with pytest.raises(AnnotationNotFoundError):
        harness.service.delete(tenant_id=harness.app.tenant_id, app_id=harness.app.id, annotation_id=str(uuid4()))
    assert harness.publications == []
    assert [row.id for row in harness.repository.get_all(tenant_id=harness.app.tenant_id, app_id=harness.app.id)] == [
        harness.annotation.id
    ]


@pytest.mark.parametrize("operation", ["upsert", "update", "delete"])
def test_publish_failure_propagates_without_rolling_back_committed_write(
    harness: _Harness, operation: Operation
) -> None:
    _enable(harness)
    for task in harness.tasks:
        task.serializer = "not-installed"

    with pytest.raises(SerializerNotInstalled):
        harness.apply(operation)

    records = harness.repository.get_all(tenant_id=harness.app.tenant_id, app_id=harness.app.id)
    if operation == "upsert":
        assert len(records) == 2
        assert any(record.content == "legacy answer" for record in records)
    elif operation == "update":
        [record] = records
        assert record.content == "updated answer"
    else:
        assert records == ()
