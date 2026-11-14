"""Single-annotation worker snapshots use real, bounded SQLite reads."""

from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Connection, Engine, event, inspect, text
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from models.account import Account
from models.dataset import DatasetCollectionBinding
from models.enums import CollectionBindingType
from models.model import App, AppAnnotationSetting, AppMode, MessageAnnotation
from repositories.annotation_repository import AnnotationRepository
from services.annotation_command_service import AnnotationIndexWritePlan, AnnotationSettingNotFoundError
from services.annotation_query import AnnotationAppNotFoundError
from services.annotation_reply_service import AnnotationIndexBinding

Operation = Literal["write", "delete"]


@dataclass(frozen=True)
class Scope:
    app: App
    other_app: App
    foreign_app: App
    account: Account
    binding: DatasetCollectionBinding
    setting: AppAnnotationSetting
    annotation: MessageAnnotation


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> AnnotationRepository:
    return AnnotationRepository(session_factory=sqlite_session_factory)


def _binding(session: Session) -> DatasetCollectionBinding:
    binding = DatasetCollectionBinding(
        provider_name="embedding-provider",
        model_name="embedding-model",
        type=CollectionBindingType.ANNOTATION,
        collection_name=f"collection_{uuid4().hex}",
    )
    session.add(binding)
    return binding


@pytest.fixture
def scope(sqlite_session: Session) -> Scope:
    tenant_id = str(uuid4())
    apps = [
        App(tenant_id=workspace, name="Annotations", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        for workspace in (tenant_id, tenant_id, str(uuid4()))
    ]
    account = Account(name="Author", email="annotation-index@example.com")
    sqlite_session.add_all([*apps, account])
    sqlite_session.flush()
    binding = _binding(sqlite_session)
    setting = AppAnnotationSetting(
        app_id=apps[0].id,
        collection_binding_id=binding.id,
        score_threshold=0.5,
        created_user_id=account.id,
        updated_user_id=account.id,
    )
    annotation = MessageAnnotation(app_id=apps[0].id, question="Question", content="Answer", account_id=account.id)
    sqlite_session.add_all([setting, annotation])
    sqlite_session.commit()
    return Scope(apps[0], apps[1], apps[2], account, binding, setting, annotation)


def _query(
    repository: AnnotationRepository,
    operation: Operation,
    *,
    tenant_id: str,
    app_id: str,
    annotation_id: str,
    binding_id: str,
) -> AnnotationIndexWritePlan | AnnotationIndexBinding | None:
    query = repository.prepare_index_write if operation == "write" else repository.prepare_index_delete
    return query(tenant_id=tenant_id, app_id=app_id, annotation_id=annotation_id, collection_binding_id=binding_id)


@pytest.mark.parametrize("question", ["Question", ""])
def test_write_returns_latest_raw_question_and_answer(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, question: str
) -> None:
    scope.annotation.question = question
    scope.annotation.content = "Latest answer"
    sqlite_session.commit()

    plan = repository.prepare_index_write(
        tenant_id=scope.app.tenant_id,
        app_id=scope.app.id,
        annotation_id=scope.annotation.id,
        collection_binding_id=scope.binding.id,
    )

    assert plan == AnnotationIndexWritePlan(
        binding=AnnotationIndexBinding(
            id=scope.binding.id,
            provider_name="embedding-provider",
            model_name="embedding-model",
            collection_name=scope.binding.collection_name,
        ),
        question=question,
        content="Latest answer",
    )


@pytest.mark.parametrize("operation", ["write", "delete"])
@pytest.mark.parametrize("invalid_app", ["missing", "foreign"])
def test_worker_reads_require_an_available_app_in_the_requested_tenant(
    repository: AnnotationRepository,
    scope: Scope,
    operation: Operation,
    invalid_app: str,
) -> None:
    app_id = str(uuid4()) if invalid_app == "missing" else scope.foreign_app.id

    with pytest.raises(AnnotationAppNotFoundError, match=app_id):
        _query(
            repository,
            operation,
            tenant_id=scope.app.tenant_id,
            app_id=app_id,
            annotation_id=scope.annotation.id if operation == "write" else str(uuid4()),
            binding_id=scope.binding.id,
        )


def test_write_rejects_an_inactive_app(repository: AnnotationRepository, sqlite_session: Session, scope: Scope) -> None:
    sqlite_session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": scope.app.id})
    sqlite_session.commit()

    with pytest.raises(AnnotationAppNotFoundError, match=scope.app.id):
        repository.prepare_index_write(
            tenant_id=scope.app.tenant_id,
            app_id=scope.app.id,
            annotation_id=scope.annotation.id,
            collection_binding_id=scope.binding.id,
        )


def test_delete_allows_cleanup_for_an_inactive_owned_app(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    sqlite_session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": scope.app.id})
    sqlite_session.delete(scope.annotation)
    sqlite_session.commit()

    binding = repository.prepare_index_delete(
        tenant_id=scope.app.tenant_id,
        app_id=scope.app.id,
        annotation_id=scope.annotation.id,
        collection_binding_id=scope.binding.id,
    )

    assert binding is not None
    assert binding.id == scope.binding.id


@pytest.mark.parametrize("target", ["other_app", "foreign_app", "deleted"])
def test_write_skips_missing_or_other_apps_annotations(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, target: str
) -> None:
    if target == "deleted":
        sqlite_session.delete(scope.annotation)
    else:
        scope.annotation.app_id = scope.other_app.id if target == "other_app" else scope.foreign_app.id
    sqlite_session.commit()

    assert (
        repository.prepare_index_write(
            tenant_id=scope.app.tenant_id,
            app_id=scope.app.id,
            annotation_id=scope.annotation.id,
            collection_binding_id=scope.binding.id,
        )
        is None
    )


@pytest.mark.parametrize("setting_change", ["disabled", "switched", "other_app"])
def test_write_skips_a_disabled_or_obsolete_collection(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, setting_change: str
) -> None:
    if setting_change == "disabled":
        sqlite_session.delete(scope.setting)
    elif setting_change == "switched":
        scope.setting.collection_binding_id = _binding(sqlite_session).id
    else:
        scope.setting.app_id = scope.other_app.id
    sqlite_session.commit()

    assert (
        repository.prepare_index_write(
            tenant_id=scope.app.tenant_id,
            app_id=scope.app.id,
            annotation_id=scope.annotation.id,
            collection_binding_id=scope.binding.id,
        )
        is None
    )


@pytest.mark.parametrize("operation", ["write", "delete"])
@pytest.mark.parametrize("invalid_binding", ["missing", "wrong_type"])
def test_worker_reads_reject_missing_or_non_annotation_bindings(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    operation: Operation,
    invalid_binding: str,
) -> None:
    if invalid_binding == "missing":
        sqlite_session.delete(scope.binding)
    else:
        scope.binding.type = CollectionBindingType.DATASET
    sqlite_session.commit()

    with pytest.raises(AnnotationSettingNotFoundError, match=scope.binding.id):
        _query(
            repository,
            operation,
            tenant_id=scope.app.tenant_id,
            app_id=scope.app.id,
            annotation_id=scope.annotation.id if operation == "write" else str(uuid4()),
            binding_id=scope.binding.id,
        )


@pytest.mark.parametrize("setting_change", ["unchanged", "disabled", "switched"])
def test_delete_uses_the_queued_binding_after_the_row_is_deleted(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, setting_change: str
) -> None:
    sqlite_session.delete(scope.annotation)
    if setting_change == "disabled":
        sqlite_session.delete(scope.setting)
    elif setting_change == "switched":
        scope.setting.collection_binding_id = _binding(sqlite_session).id
    sqlite_session.commit()

    binding = repository.prepare_index_delete(
        tenant_id=scope.app.tenant_id,
        app_id=scope.app.id,
        annotation_id=scope.annotation.id,
        collection_binding_id=scope.binding.id,
    )

    assert binding == AnnotationIndexBinding(
        id=scope.binding.id,
        provider_name="embedding-provider",
        model_name="embedding-model",
        collection_name=scope.binding.collection_name,
    )


@pytest.mark.parametrize("row_owner", ["current_app", "other_app", "foreign_app"])
def test_delete_does_not_remove_the_index_of_an_existing_annotation(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, row_owner: str
) -> None:
    if row_owner != "current_app":
        scope.annotation.app_id = scope.other_app.id if row_owner == "other_app" else scope.foreign_app.id
        sqlite_session.commit()

    assert (
        repository.prepare_index_delete(
            tenant_id=scope.app.tenant_id,
            app_id=scope.app.id,
            annotation_id=scope.annotation.id,
            collection_binding_id=scope.binding.id,
        )
        is None
    )


def test_snapshots_are_detached_and_sessions_close_without_writes(
    repository: AnnotationRepository,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    scope: Scope,
) -> None:
    sessions: list[Session] = []
    commits: list[Session] = []
    statements: list[str] = []

    def record_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    def record_commit(session: Session) -> None:
        commits.append(session)

    def record_statement(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(sqlite_session_factory, "after_begin", record_session)
    event.listen(sqlite_session_factory, "before_commit", record_commit)
    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        plan = repository.prepare_index_write(
            tenant_id=scope.app.tenant_id,
            app_id=scope.app.id,
            annotation_id=scope.annotation.id,
            collection_binding_id=scope.binding.id,
        )
        binding = repository.prepare_index_delete(
            tenant_id=scope.app.tenant_id,
            app_id=scope.app.id,
            annotation_id=str(uuid4()),
            collection_binding_id=scope.binding.id,
        )
    finally:
        event.remove(sqlite_session_factory, "after_begin", record_session)
        event.remove(sqlite_session_factory, "before_commit", record_commit)
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    assert len(sessions) == 2
    assert sessions[0] is not sessions[1]
    assert all(not session.in_transaction() and not session.identity_map for session in sessions)
    assert not commits
    assert statements
    assert all(statement.lstrip().upper().startswith("SELECT") for statement in statements)
    assert plan is not None
    assert binding is not None
    assert inspect(plan, raiseerr=False) is None
    assert inspect(binding, raiseerr=False) is None
    assert plan.binding == binding
