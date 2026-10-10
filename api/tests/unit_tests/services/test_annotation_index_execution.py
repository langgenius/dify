"""Single-entry index workers with real persistence, service wiring, and backend selection.

An unsupported backend exercises failure paths without a vector server or an
embedding provider. Successful vector writes remain integration-test concerns.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from redis import Redis
from sqlalchemy import Connection, event, select, text
from sqlalchemy.orm import ORMExecuteState, Session, SessionTransaction, sessionmaker

from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from models.dataset import DatasetCollectionBinding, Whitelist
from models.enums import CollectionBindingType
from models.model import App, AppAnnotationSetting, MessageAnnotation
from services.annotation_command_service import AnnotationCommandService
from tasks.annotation.add_annotation_to_index_task import add_annotation_to_index_task
from tasks.annotation.delete_annotation_index_task import delete_annotation_index_task
from tasks.annotation.update_annotation_to_index_task import update_annotation_to_index_task
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_app

INVALID_BACKEND = "annotation-test-uninstalled-vector-backend"
WriteOperation = Literal["add", "update"]
Operation = Literal["add", "update", "delete"]


@dataclass(frozen=True)
class _Harness:
    factory: sessionmaker[Session]
    service: AnnotationCommandService
    app: App
    binding: DatasetCollectionBinding
    setting: AppAnnotationSetting
    annotation: MessageAnnotation

    def execute(self, operation: Operation, *, question: str) -> None:
        if operation == "delete":
            self.service.execute_index_delete(
                annotation_id=self.annotation.id,
                tenant_id=self.app.tenant_id,
                app_id=self.app.id,
                collection_binding_id=self.binding.id,
            )
        else:
            execute = self.service.execute_index_add if operation == "add" else self.service.execute_index_update
            execute(
                annotation_id=self.annotation.id,
                question=question,
                tenant_id=self.app.tenant_id,
                app_id=self.app.id,
                collection_binding_id=self.binding.id,
            )


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    app = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    binding = DatasetCollectionBinding(
        provider_name="annotation-provider",
        model_name="annotation-embedding",
        type=CollectionBindingType.ANNOTATION,
        collection_name="shared_annotation_collection",
    )
    binding.id = str(uuid4())
    setting = AppAnnotationSetting(
        app_id=app.id,
        collection_binding_id=binding.id,
        score_threshold=0.4,
        created_user_id=str(uuid4()),
        updated_user_id=str(uuid4()),
    )
    annotation = MessageAnnotation(
        app_id=app.id,
        account_id=str(uuid4()),
        question="Current question",
        content="Current answer",
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([app, binding, setting, annotation])
    with config_overrides_context(VECTOR_STORE=INVALID_BACKEND, VECTOR_STORE_WHITELIST_ENABLE=False):
        redis = RedisClientWrapper()
        redis.initialize(Redis())
        services = build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=redis,
        )
        flask_app = Flask(__name__)
        flask_app.extensions["application_services"] = services
        with flask_app.app_context():
            yield _Harness(sqlite_session_factory, services.annotation_commands, app, binding, setting, annotation)


@pytest.mark.parametrize("operation", ["add", "update"])
@pytest.mark.parametrize("queued_question", ["Older question", "A different later question"])
def test_stale_queued_question_does_not_reindex_current_annotation(
    harness: _Harness, operation: WriteOperation, queued_question: str
) -> None:
    harness.execute(operation, question=queued_question)

    with harness.factory() as session:
        stored = session.get_one(MessageAnnotation, harness.annotation.id)
        assert stored.question == "Current question"
        assert stored.content == "Current answer"


@pytest.mark.parametrize("operation", ["add", "update"])
def test_matching_queued_question_reaches_real_vector_backend_without_modifying_annotation(
    harness: _Harness, operation: WriteOperation
) -> None:
    with pytest.raises(ValueError, match="not supported"):
        harness.execute(operation, question="Current question")

    with harness.factory() as session:
        assert session.get_one(MessageAnnotation, harness.annotation.id).question == "Current question"


@pytest.mark.parametrize("operation", ["add", "update"])
def test_add_retains_empty_question_while_update_uses_answer_fallback(
    harness: _Harness, operation: WriteOperation
) -> None:
    with harness.factory.begin() as session:
        session.get_one(MessageAnnotation, harness.annotation.id).question = ""
    matching_question = "" if operation == "add" else "Current answer"
    mismatched_question = "Current answer" if operation == "add" else ""

    harness.execute(operation, question=mismatched_question)
    with pytest.raises(ValueError, match="not supported"):
        harness.execute(operation, question=matching_question)


@pytest.mark.parametrize("operation", ["add", "update"])
@pytest.mark.parametrize("change", ["deleted_annotation", "disabled_reply", "switched_binding"])
def test_obsolete_write_job_does_not_initialize_vector_backend(
    harness: _Harness,
    operation: WriteOperation,
    change: Literal["deleted_annotation", "disabled_reply", "switched_binding"],
) -> None:
    with harness.factory.begin() as session:
        if change == "deleted_annotation":
            session.delete(session.get_one(MessageAnnotation, harness.annotation.id))
        elif change == "disabled_reply":
            session.delete(session.get_one(AppAnnotationSetting, harness.setting.id))
        else:
            replacement = DatasetCollectionBinding(
                provider_name="replacement-provider",
                model_name="replacement-model",
                type=CollectionBindingType.ANNOTATION,
                collection_name="replacement_collection",
            )
            replacement.id = str(uuid4())
            session.add(replacement)
            session.get_one(AppAnnotationSetting, harness.setting.id).collection_binding_id = replacement.id

    harness.execute(operation, question="Current question")

    with harness.factory() as session:
        if change == "deleted_annotation":
            assert session.get(MessageAnnotation, harness.annotation.id) is None
        elif change == "disabled_reply":
            assert session.get(AppAnnotationSetting, harness.setting.id) is None
        else:
            assert session.get_one(AppAnnotationSetting, harness.setting.id).collection_binding_id != harness.binding.id


@pytest.mark.parametrize("reply_change", ["disabled", "switched_binding"])
def test_delete_cleans_queued_binding_even_after_app_and_reply_state_change(
    harness: _Harness, reply_change: Literal["disabled", "switched_binding"]
) -> None:
    with harness.factory.begin() as session:
        session.delete(session.get_one(MessageAnnotation, harness.annotation.id))
        session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": harness.app.id})
        setting = session.get_one(AppAnnotationSetting, harness.setting.id)
        if reply_change == "disabled":
            session.delete(setting)
        else:
            # No current binding is needed when cleaning the previously queued collection.
            setting.collection_binding_id = str(uuid4())

    with pytest.raises(ValueError, match="not supported"):
        harness.execute("delete", question="")

    with harness.factory() as session:
        assert session.get(MessageAnnotation, harness.annotation.id) is None
        assert session.get(DatasetCollectionBinding, harness.binding.id) is not None


def test_delete_job_preserves_an_existing_annotation_without_vector_io(harness: _Harness) -> None:
    harness.execute("delete", question="")

    with harness.factory() as session:
        assert session.get(MessageAnnotation, harness.annotation.id) is not None


@pytest.mark.parametrize("operation", ["add", "update", "delete"])
def test_persistence_session_closes_before_vector_selection_and_all_sessions_close_on_failure(
    harness: _Harness, operation: Operation
) -> None:
    if operation == "delete":
        with harness.factory.begin() as session:
            session.delete(session.get_one(MessageAnnotation, harness.annotation.id))
    sessions: list[Session] = []
    closed_at_selection: list[bool] = []

    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    def observe_whitelist_query(state: ORMExecuteState) -> None:
        if any(mapper.class_ is Whitelist for mapper in state.all_mappers):
            closed_at_selection.append(
                bool(sessions)
                and all(not session.in_transaction() and not session.identity_map for session in sessions)
            )

    event.listen(harness.factory, "after_begin", track_session)
    event.listen(harness.factory, "do_orm_execute", observe_whitelist_query)
    try:
        with config_overrides_context(VECTOR_STORE_WHITELIST_ENABLE=True):
            with pytest.raises(ValueError, match="not supported"):
                harness.execute(operation, question="Current question")
        assert closed_at_selection == [True]
        assert all(not session.in_transaction() and not session.identity_map for session in sessions)
    finally:
        event.remove(harness.factory, "after_begin", track_session)
        event.remove(harness.factory, "do_orm_execute", observe_whitelist_query)


@pytest.mark.parametrize("operation", ["add", "update", "delete"])
@pytest.mark.parametrize("positional", [False, True])
def test_legacy_task_payload_reaches_real_service_and_logs_failure_with_resource_ids(
    harness: _Harness, operation: Operation, positional: bool, caplog: pytest.LogCaptureFixture
) -> None:
    if operation == "delete":
        with harness.factory.begin() as session:
            session.delete(session.get_one(MessageAnnotation, harness.annotation.id))
        task = delete_annotation_index_task
        assert task.name == "tasks.annotation.delete_annotation_index_task.delete_annotation_index_task"
        if positional:
            task.run(harness.annotation.id, harness.app.id, harness.app.tenant_id, harness.binding.id)
        else:
            task.run(
                annotation_id=harness.annotation.id,
                app_id=harness.app.id,
                tenant_id=harness.app.tenant_id,
                collection_binding_id=harness.binding.id,
            )
    else:
        task = add_annotation_to_index_task if operation == "add" else update_annotation_to_index_task
        task_name = f"{operation}_annotation_to_index_task"
        assert task.name == f"tasks.annotation.{task_name}.{task_name}"
        if positional:
            task.run(
                harness.annotation.id, "Current question", harness.app.tenant_id, harness.app.id, harness.binding.id
            )
        else:
            task.run(
                annotation_id=harness.annotation.id,
                question="Current question",
                tenant_id=harness.app.tenant_id,
                app_id=harness.app.id,
                collection_binding_id=harness.binding.id,
            )

    assert vars(type(task.app.tasks[task.name]))["queue"] == "dataset"
    assert f"Annotation index {operation} failed" in caplog.text
    assert "not supported" in caplog.text
    assert harness.annotation.id in caplog.text
    assert harness.app.id in caplog.text
    assert harness.app.tenant_id in caplog.text
    with harness.factory() as session:
        assert len(session.scalars(select(MessageAnnotation)).all()) == (0 if operation == "delete" else 1)
