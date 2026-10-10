"""Transactional annotation writes against the real SQLite models."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Connection, event, func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from models.account import Account
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.enums import ConversationFromSource
from models.model import (
    App,
    AppAnnotationHitHistory,
    AppAnnotationSetting,
    AppMode,
    Conversation,
    Message,
    MessageAnnotation,
)
from repositories.annotation_repository import AnnotationRepository
from services.annotation_command_service import AnnotationWriteResult
from services.annotation_query import AnnotationAppNotFoundError, AnnotationNotFoundError, AnnotationRecord
from services.errors.message import MessageNotExistsError

Operation = Literal["upsert", "update", "delete"]
OPERATIONS: tuple[Operation, ...] = ("upsert", "update", "delete")
CREATED_AT = datetime(2026, 1, 1)


@dataclass(frozen=True)
class Scope:
    app: App
    other_app: App
    foreign_app: App
    account: Account
    other_account: Account


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> AnnotationRepository:
    return AnnotationRepository(session_factory=sqlite_session_factory)


@pytest.fixture
def scope(sqlite_session: Session) -> Scope:
    tenant_id = str(uuid4())
    apps = [
        App(tenant_id=workspace, name="Annotations", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        for workspace in (tenant_id, tenant_id, str(uuid4()))
    ]
    accounts = [Account(name=name, email=f"{name}@example.com") for name in ("author", "editor")]
    sqlite_session.add_all([*apps, *accounts])
    sqlite_session.commit()
    return Scope(apps[0], apps[1], apps[2], accounts[0], accounts[1])


@pytest.fixture
def message(sqlite_session: Session, scope: Scope) -> Message:
    conversation = Conversation(
        id=str(uuid4()),
        app_id=scope.app.id,
        name="Conversation",
        mode=AppMode.CHAT,
        _inputs={},
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=scope.account.id,
    )
    message = Message(
        id=str(uuid4()),
        app_id=scope.app.id,
        conversation_id=conversation.id,
        _inputs={},
        query="Original message",
        message={},
        answer="Original answer",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=scope.account.id,
    )
    sqlite_session.add_all([conversation, message])
    sqlite_session.commit()
    return message


@pytest.fixture
def annotation(sqlite_session: Session, scope: Scope, message: Message) -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id=scope.app.id,
        question="Old question",
        content="Old answer",
        account_id=scope.account.id,
        conversation_id=message.conversation_id,
        message_id=message.id,
    )
    annotation.created_at = CREATED_AT
    annotation.hit_count = 3
    sqlite_session.add(annotation)
    sqlite_session.commit()
    return annotation


def _setting(session: Session, scope: Scope, *, app_id: str) -> str:
    binding_id = str(uuid4())
    session.add(
        AppAnnotationSetting(
            app_id=app_id,
            score_threshold=0.5,
            collection_binding_id=binding_id,
            created_user_id=scope.account.id,
            updated_user_id=scope.account.id,
        )
    )
    return binding_id


def _history(session: Session, scope: Scope, *, app_id: str, annotation_id: str) -> AppAnnotationHitHistory:
    history = AppAnnotationHitHistory(
        app_id=app_id,
        annotation_id=annotation_id,
        source="api",
        question="Question",
        score=0.9,
        account_id=scope.account.id,
        message_id=str(uuid4()),
        annotation_question="Match",
        annotation_content="Answer",
    )
    session.add(history)
    return history


def _write(
    repository: AnnotationRepository,
    operation: Operation,
    *,
    tenant_id: str,
    app_id: str,
    account_id: str,
    annotation_id: str,
) -> AnnotationWriteResult | str | None:
    if operation == "upsert":
        return repository.upsert(
            tenant_id=tenant_id,
            app_id=app_id,
            account_id=account_id,
            message_id=None,
            question="New question",
            answer="New answer",
        )
    if operation == "update":
        return repository.update(
            tenant_id=tenant_id,
            app_id=app_id,
            annotation_id=annotation_id,
            question="New question",
            answer="New answer",
        )
    return repository.delete(tenant_id=tenant_id, app_id=app_id, annotation_id=annotation_id)


@pytest.mark.parametrize("enabled", [True, False])
def test_manual_upsert_materializes_server_defaults_and_app_binding(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, enabled: bool
) -> None:
    _setting(sqlite_session, scope, app_id=scope.other_app.id)
    binding_id = _setting(sqlite_session, scope, app_id=scope.app.id) if enabled else None
    sqlite_session.commit()
    result = repository.upsert(
        tenant_id=scope.app.tenant_id,
        app_id=scope.app.id,
        account_id=scope.account.id,
        message_id=None,
        question="Manual question",
        answer="",
    )
    assert result.collection_binding_id == binding_id
    assert result.annotation == AnnotationRecord(
        id=result.annotation.id,
        question="Manual question",
        content="",
        hit_count=0,
        created_at=result.annotation.created_at,
    )
    assert isinstance(result.annotation.created_at, datetime)
    assert inspect(result.annotation, raiseerr=False) is None
    stored = sqlite_session.get_one(MessageAnnotation, result.annotation.id)
    assert stored.account_id == scope.account.id
    assert stored.app_id == scope.app.id
    assert stored.conversation_id is None
    assert stored.message_id is None
    assert stored.created_at == result.annotation.created_at


@pytest.mark.parametrize(
    ("question", "query", "expected"),
    [
        ("Explicit question", "Message query", "Explicit question"),
        (None, "Message query", "Message query"),
        ("", "Message query", "Message query"),
        (None, "", ""),
    ],
)
def test_message_upsert_resolves_question_and_links_new_annotation(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    message: Message,
    question: str | None,
    query: str,
    expected: str,
) -> None:
    message.query = query
    sqlite_session.commit()
    result = repository.upsert(
        tenant_id=scope.app.tenant_id,
        app_id=scope.app.id,
        account_id=scope.account.id,
        message_id=message.id,
        question=question,
        answer="Answer",
    )
    assert result.annotation.question == expected
    stored = sqlite_session.get_one(MessageAnnotation, result.annotation.id)
    assert stored.conversation_id == message.conversation_id
    assert stored.message_id == message.id
    assert stored.account_id == scope.account.id


def test_message_upsert_retains_existing_authorship_associations_and_creation_time(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    message: Message,
    annotation: MessageAnnotation,
) -> None:
    result = repository.upsert(
        tenant_id=scope.app.tenant_id,
        app_id=scope.app.id,
        account_id=scope.other_account.id,
        message_id=message.id,
        question="Revised question",
        answer="Revised answer",
    )
    assert result.annotation == AnnotationRecord(
        id=annotation.id, question="Revised question", content="Revised answer", hit_count=3, created_at=CREATED_AT
    )
    sqlite_session.refresh(annotation)
    assert annotation.account_id == scope.account.id
    assert annotation.message_id == message.id
    assert annotation.conversation_id == message.conversation_id
    assert sqlite_session.scalar(select(func.count()).select_from(MessageAnnotation)) == 1


def test_message_upsert_does_not_update_other_app_annotation_with_same_message_id(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, message: Message
) -> None:
    decoy = MessageAnnotation(
        app_id=scope.other_app.id,
        question="Decoy question",
        content="Decoy answer",
        account_id=scope.other_account.id,
        message_id=message.id,
    )
    sqlite_session.add(decoy)
    sqlite_session.commit()
    result = repository.upsert(
        tenant_id=scope.app.tenant_id,
        app_id=scope.app.id,
        account_id=scope.account.id,
        message_id=message.id,
        question=None,
        answer="Correct answer",
    )
    assert result.annotation.id != decoy.id
    assert result.annotation.question == message.query
    sqlite_session.refresh(decoy)
    assert (decoy.question, decoy.content, decoy.account_id) == (
        "Decoy question",
        "Decoy answer",
        scope.other_account.id,
    )
    assert sqlite_session.scalar(select(func.count()).select_from(MessageAnnotation)) == 2


@pytest.mark.parametrize("message_scope", ["missing", "other_app", "foreign_tenant"])
def test_upsert_requires_message_in_admitted_app(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, message: Message, message_scope: str
) -> None:
    message_id = message.id
    if message_scope == "missing":
        message_id = str(uuid4())
    else:
        message.app_id = scope.other_app.id if message_scope == "other_app" else scope.foreign_app.id
    sqlite_session.commit()
    with pytest.raises(MessageNotExistsError):
        repository.upsert(
            tenant_id=scope.app.tenant_id,
            app_id=scope.app.id,
            account_id=scope.account.id,
            message_id=message_id,
            question="Question",
            answer="Answer",
        )
    assert sqlite_session.scalar(select(func.count()).select_from(MessageAnnotation)) == 0


@pytest.mark.parametrize("question", [None, ""])
@pytest.mark.parametrize("message_id", [None, ""])
def test_manual_upsert_requires_truthy_question(
    repository: AnnotationRepository, scope: Scope, question: str | None, message_id: str | None
) -> None:
    with pytest.raises(ValueError, match="'question' is required when 'message_id' is not provided"):
        repository.upsert(
            tenant_id=scope.app.tenant_id,
            app_id=scope.app.id,
            account_id=scope.account.id,
            message_id=message_id,
            question=question,
            answer="Answer",
        )


def test_upsert_checks_app_before_answer_and_answer_before_message(
    repository: AnnotationRepository, scope: Scope
) -> None:
    with pytest.raises(AnnotationAppNotFoundError):
        repository.upsert(
            tenant_id=str(uuid4()),
            app_id=scope.app.id,
            account_id=scope.account.id,
            message_id=str(uuid4()),
            question=None,
            answer=None,
        )
    with pytest.raises(ValueError, match="Either 'answer' or 'content' must be provided"):
        repository.upsert(
            tenant_id=scope.app.tenant_id,
            app_id=scope.app.id,
            account_id=scope.account.id,
            message_id=str(uuid4()),
            question=None,
            answer=None,
        )


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize("visibility", ["missing", "wrong_tenant", "foreign_app", "disabled"])
def test_writes_require_app_tenant_and_normal_status(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    annotation: MessageAnnotation,
    operation: Operation,
    visibility: str,
) -> None:
    tenant_id, app_id = scope.app.tenant_id, scope.app.id
    if visibility == "missing":
        app_id = str(uuid4())
    elif visibility == "wrong_tenant":
        tenant_id = str(uuid4())
    elif visibility == "foreign_app":
        app_id = scope.foreign_app.id
    else:
        sqlite_session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app_id})
    sqlite_session.commit()
    with pytest.raises(AnnotationAppNotFoundError):
        _write(
            repository,
            operation,
            tenant_id=tenant_id,
            app_id=app_id,
            account_id=scope.account.id,
            annotation_id=annotation.id,
        )
    sqlite_session.refresh(annotation)
    assert (annotation.question, annotation.content) == ("Old question", "Old answer")
    assert sqlite_session.scalar(select(func.count()).select_from(MessageAnnotation)) == 1


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize("status", [AgentStatus.ACTIVE, AgentStatus.ARCHIVED])
def test_writes_keep_workflow_backing_apps_visible(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    annotation: MessageAnnotation,
    operation: Operation,
    status: AgentStatus,
) -> None:
    annotation_id = annotation.id
    scope.app.mode = AppMode.AGENT
    sqlite_session.add(
        Agent(
            tenant_id=scope.app.tenant_id,
            name="Hidden agent",
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            status=status,
            backing_app_id=scope.app.id,
        )
    )
    sqlite_session.commit()
    _write(
        repository,
        operation,
        tenant_id=scope.app.tenant_id,
        app_id=scope.app.id,
        account_id=scope.account.id,
        annotation_id=annotation_id,
    )
    sqlite_session.expire_all()
    stored = sqlite_session.scalar(select(MessageAnnotation).where(MessageAnnotation.id == annotation_id))
    if operation == "delete":
        assert stored is None
    elif operation == "update":
        assert stored is not None
        assert stored.question == "New question"
    else:
        assert sqlite_session.scalar(select(func.count()).select_from(MessageAnnotation)) == 2


@pytest.mark.parametrize("enabled", [True, False])
def test_update_allows_empty_fields_and_retains_author_and_linkage(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    annotation: MessageAnnotation,
    message: Message,
    enabled: bool,
) -> None:
    _setting(sqlite_session, scope, app_id=scope.other_app.id)
    binding_id = _setting(sqlite_session, scope, app_id=scope.app.id) if enabled else None
    sqlite_session.commit()
    result = repository.update(
        tenant_id=scope.app.tenant_id, app_id=scope.app.id, annotation_id=annotation.id, question="", answer=""
    )
    assert result == AnnotationWriteResult(
        annotation=AnnotationRecord(id=annotation.id, question="", content="", hit_count=3, created_at=CREATED_AT),
        collection_binding_id=binding_id,
    )
    sqlite_session.refresh(annotation)
    assert (annotation.account_id, annotation.message_id, annotation.conversation_id) == (
        scope.account.id,
        message.id,
        message.conversation_id,
    )


@pytest.mark.parametrize(("question", "answer", "error"), [(None, None, "question"), ("", None, "answer")])
def test_update_validates_required_fields_without_mutating(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    annotation: MessageAnnotation,
    question: str | None,
    answer: str | None,
    error: str,
) -> None:
    with pytest.raises(ValueError, match=f"'{error}' is required"):
        repository.update(
            tenant_id=scope.app.tenant_id,
            app_id=scope.app.id,
            annotation_id=annotation.id,
            question=question,
            answer=answer,
        )
    sqlite_session.refresh(annotation)
    assert (annotation.question, annotation.content) == ("Old question", "Old answer")


@pytest.mark.parametrize("operation", ["update", "delete"])
@pytest.mark.parametrize("annotation_scope", ["missing", "other_app", "foreign_app"])
def test_update_and_delete_require_annotation_in_admitted_app(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    annotation: MessageAnnotation,
    operation: Operation,
    annotation_scope: str,
) -> None:
    annotation_id = annotation.id
    if annotation_scope == "missing":
        annotation_id = str(uuid4())
    else:
        annotation.app_id = scope.other_app.id if annotation_scope == "other_app" else scope.foreign_app.id
    sqlite_session.commit()
    with pytest.raises(AnnotationNotFoundError):
        _write(
            repository,
            operation,
            tenant_id=scope.app.tenant_id,
            app_id=scope.app.id,
            account_id=scope.account.id,
            annotation_id=annotation_id,
        )
    sqlite_session.refresh(annotation)
    assert (annotation.question, annotation.content) == ("Old question", "Old answer")


def test_update_checks_app_then_annotation_before_fields(repository: AnnotationRepository, scope: Scope) -> None:
    with pytest.raises(AnnotationAppNotFoundError):
        repository.update(
            tenant_id=str(uuid4()), app_id=scope.app.id, annotation_id=str(uuid4()), question=None, answer=None
        )
    with pytest.raises(AnnotationNotFoundError):
        repository.update(
            tenant_id=scope.app.tenant_id, app_id=scope.app.id, annotation_id=str(uuid4()), question=None, answer=None
        )


@pytest.mark.parametrize("enabled", [True, False])
def test_delete_removes_only_matching_app_and_annotation_histories(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    annotation: MessageAnnotation,
    enabled: bool,
) -> None:
    target = _history(sqlite_session, scope, app_id=scope.app.id, annotation_id=annotation.id)
    foreign_app_history = _history(sqlite_session, scope, app_id=scope.other_app.id, annotation_id=annotation.id)
    other_annotation_history = _history(sqlite_session, scope, app_id=scope.app.id, annotation_id=str(uuid4()))
    _setting(sqlite_session, scope, app_id=scope.other_app.id)
    binding_id = _setting(sqlite_session, scope, app_id=scope.app.id) if enabled else None
    sqlite_session.commit()
    annotation_id, target_id = annotation.id, target.id
    result = repository.delete(tenant_id=scope.app.tenant_id, app_id=scope.app.id, annotation_id=annotation_id)
    assert result == binding_id
    sqlite_session.expire_all()
    assert sqlite_session.scalar(select(MessageAnnotation.id).where(MessageAnnotation.id == annotation_id)) is None
    assert (
        sqlite_session.scalar(select(AppAnnotationHitHistory.id).where(AppAnnotationHitHistory.id == target_id)) is None
    )
    assert set(sqlite_session.scalars(select(AppAnnotationHitHistory.id))) == {
        foreign_app_history.id,
        other_annotation_history.id,
    }


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize("fail", [False, True])
def test_write_sessions_close_and_roll_back_database_failures(
    repository: AnnotationRepository,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    scope: Scope,
    annotation: MessageAnnotation,
    operation: Operation,
    fail: bool,
) -> None:
    history = _history(sqlite_session, scope, app_id=scope.app.id, annotation_id=annotation.id)
    if fail:
        sql_operation = {"upsert": "INSERT", "update": "UPDATE", "delete": "DELETE"}[operation]
        sqlite_session.execute(
            text(
                f"CREATE TRIGGER reject_annotation_write BEFORE {sql_operation} ON message_annotations "
                "BEGIN SELECT RAISE(ABORT, 'annotation write rejected'); END"
            )
        )
    sqlite_session.commit()
    sessions: list[Session] = []
    commits: list[Session] = []
    rollbacks: list[Session] = []

    def record_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    def record_commit(session: Session) -> None:
        commits.append(session)

    def record_rollback(session: Session) -> None:
        rollbacks.append(session)

    event.listen(sqlite_session_factory, "after_begin", record_session)
    event.listen(sqlite_session_factory, "after_commit", record_commit)
    event.listen(sqlite_session_factory, "after_rollback", record_rollback)
    try:
        if fail:
            with pytest.raises(IntegrityError, match="annotation write rejected"):
                _write(
                    repository,
                    operation,
                    tenant_id=scope.app.tenant_id,
                    app_id=scope.app.id,
                    account_id=scope.account.id,
                    annotation_id=annotation.id,
                )
        else:
            result = _write(
                repository,
                operation,
                tenant_id=scope.app.tenant_id,
                app_id=scope.app.id,
                account_id=scope.account.id,
                annotation_id=annotation.id,
            )
            if isinstance(result, AnnotationWriteResult):
                assert inspect(result.annotation, raiseerr=False) is None
                assert result.annotation.question == "New question"
    finally:
        event.remove(sqlite_session_factory, "after_begin", record_session)
        event.remove(sqlite_session_factory, "after_commit", record_commit)
        event.remove(sqlite_session_factory, "after_rollback", record_rollback)
    assert len(sessions) == 1
    assert not sessions[0].in_transaction()
    assert not sessions[0].identity_map
    assert len(commits) == (0 if fail else 1)
    assert len(rollbacks) == (1 if fail else 0)
    if fail:
        sqlite_session.refresh(annotation)
        sqlite_session.refresh(history)
        assert (annotation.question, annotation.content) == ("Old question", "Old answer")
        assert sqlite_session.scalar(select(func.count()).select_from(MessageAnnotation)) == 1
        assert history.annotation_id == annotation.id
