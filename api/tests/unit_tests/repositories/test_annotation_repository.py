"""Real SQLite coverage for annotation queries, writes, and transaction boundaries."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from sqlite3 import SQLITE_LIMIT_VARIABLE_NUMBER
from sqlite3 import Connection as SQLiteConnection
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Connection, Engine, event, func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.account import Account
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.dataset import DatasetCollectionBinding
from models.enums import CollectionBindingType, ConversationFromSource
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
from services.annotation_command_service import (
    AnnotationDeletionResult,
    AnnotationSettingNotFoundError,
    AnnotationWriteResult,
)
from services.annotation_query import (
    AnnotationAppNotFoundError,
    AnnotationEmbeddingModel,
    AnnotationHitHistoryRecord,
    AnnotationNotFoundError,
    AnnotationPage,
    AnnotationRecord,
    AnnotationSettingRecord,
)
from services.errors.message import MessageNotExistsError

CREATED_AT = datetime(2026, 10, 1, 12)
Operation = Literal["count", "page", "all", "setting", "history"]
OPERATIONS: tuple[Operation, ...] = ("count", "page", "all", "setting", "history")


@dataclass(frozen=True)
class Scope:
    app: App
    other_app: App
    foreign_app: App
    account: Account


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> AnnotationRepository:
    return AnnotationRepository(session_factory=sqlite_session_factory)


@pytest.fixture
def scope(sqlite_session: Session) -> Scope:
    tenant_id = str(uuid4())
    apps = [
        App(tenant_id=workspace, name="Annotation app", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        for workspace in (tenant_id, tenant_id, str(uuid4()))
    ]
    account = Account(name="Annotation owner", email="annotation@example.com")
    sqlite_session.add_all([*apps, account])
    sqlite_session.commit()
    return Scope(apps[0], apps[1], apps[2], account)


def _annotation(
    session: Session,
    scope: Scope,
    *,
    app_id: str | None = None,
    question: str = "Question",
    content: str = "Answer",
    created_at: datetime = CREATED_AT,
    message_id: str | None = None,
) -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id=app_id or scope.app.id,
        question=question,
        content=content,
        account_id=scope.account.id,
        message_id=message_id,
    )
    annotation.created_at = created_at
    annotation.hit_count = 7
    session.add(annotation)
    return annotation


def _history(
    session: Session,
    scope: Scope,
    *,
    annotation_id: str,
    app_id: str | None = None,
    created_at: datetime = CREATED_AT,
) -> AppAnnotationHitHistory:
    history = AppAnnotationHitHistory(
        app_id=app_id or scope.app.id,
        annotation_id=annotation_id,
        source="api",
        question="User question",
        account_id=scope.account.id,
        score=0.875,
        message_id=str(uuid4()),
        annotation_question="Historical question",
        annotation_content="Historical answer",
    )
    history.created_at = created_at
    session.add(history)
    return history


def _setting(session: Session, scope: Scope, *, binding_id: str, app_id: str | None = None) -> AppAnnotationSetting:
    setting = AppAnnotationSetting(
        app_id=app_id or scope.app.id,
        score_threshold=0.75,
        collection_binding_id=binding_id,
        created_user_id=scope.account.id,
        updated_user_id=scope.account.id,
    )
    session.add(setting)
    return setting


def _query(
    repository: AnnotationRepository,
    operation: Operation,
    *,
    tenant_id: str,
    app_id: str,
    annotation_id: str,
) -> object:
    if operation == "count":
        return repository.count(tenant_id=tenant_id, app_id=app_id)
    if operation == "page":
        return repository.get_page(tenant_id=tenant_id, app_id=app_id, page=1, limit=20, keyword="")
    if operation == "all":
        return repository.get_all(tenant_id=tenant_id, app_id=app_id)
    if operation == "setting":
        return repository.get_setting(tenant_id=tenant_id, app_id=app_id)
    return repository.get_hit_history_page(
        tenant_id=tenant_id, app_id=app_id, annotation_id=annotation_id, page=1, limit=20
    )


def test_empty_results(repository: AnnotationRepository, sqlite_session: Session, scope: Scope) -> None:
    assert repository.count(tenant_id=scope.app.tenant_id, app_id=scope.app.id) == 0
    assert repository.get_all(tenant_id=scope.app.tenant_id, app_id=scope.app.id) == ()
    page = repository.get_page(tenant_id=scope.app.tenant_id, app_id=scope.app.id, page=1, limit=20, keyword="")
    assert page == AnnotationPage(data=(), page=1, limit=20, total=0)
    assert not page.has_more
    _setting(sqlite_session, scope, app_id=scope.other_app.id, binding_id=str(uuid4()))
    annotation = _annotation(sqlite_session, scope)
    sqlite_session.commit()
    assert repository.get_setting(tenant_id=scope.app.tenant_id, app_id=scope.app.id) == AnnotationSettingRecord(
        enabled=False, id=None, score_threshold=None, embedding_model=None
    )
    assert repository.get_hit_history_page(
        tenant_id=scope.app.tenant_id, app_id=scope.app.id, annotation_id=annotation.id, page=1, limit=20
    ) == AnnotationPage(data=(), page=1, limit=20, total=0)


def test_count_includes_annotations_without_messages_and_excludes_other_apps(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    _annotation(sqlite_session, scope)
    _annotation(sqlite_session, scope, message_id=str(uuid4()))
    _annotation(sqlite_session, scope, app_id=scope.other_app.id)
    _annotation(sqlite_session, scope, app_id=scope.foreign_app.id)
    sqlite_session.commit()
    assert repository.count(tenant_id=scope.app.tenant_id, app_id=scope.app.id) == 2


def test_get_all_is_unpaginated_app_scoped_and_keeps_unsanitized_text(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    annotations = [
        _annotation(
            sqlite_session,
            scope,
            question="=1+1",
            content="+answer",
            created_at=CREATED_AT + timedelta(seconds=index),
        )
        for index in range(101)
    ]
    _annotation(sqlite_session, scope, app_id=scope.other_app.id)
    _annotation(sqlite_session, scope, app_id=scope.foreign_app.id)
    sqlite_session.commit()

    records = repository.get_all(tenant_id=scope.app.tenant_id, app_id=scope.app.id)

    assert [record.id for record in records] == [annotation.id for annotation in reversed(annotations)]
    assert all(record.question == "=1+1" and record.content == "+answer" for record in records)
    assert all(record.hit_count == 7 for record in records)


def test_page_orders_ties_by_id_and_preserves_raw_question(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    older = _annotation(sqlite_session, scope, created_at=CREATED_AT - timedelta(seconds=1))
    tied = [_annotation(sqlite_session, scope, question=""), _annotation(sqlite_session, scope)]
    _annotation(sqlite_session, scope, app_id=scope.other_app.id, created_at=CREATED_AT + timedelta(seconds=1))
    sqlite_session.commit()
    expected = sorted(tied, key=lambda item: item.id, reverse=True)
    first = repository.get_page(tenant_id=scope.app.tenant_id, app_id=scope.app.id, page=1, limit=2, keyword="")
    assert first.total == 3
    assert first.has_more
    assert first.data == tuple(
        AnnotationRecord(
            id=annotation.id,
            question=annotation.question,
            content="Answer",
            hit_count=7,
            created_at=CREATED_AT,
        )
        for annotation in expected
    )
    second = repository.get_page(tenant_id=scope.app.tenant_id, app_id=scope.app.id, page=2, limit=2, keyword="")
    assert [item.id for item in second.data] == [older.id]
    assert second.total == 3
    assert not second.has_more
    assert repository.get_page(
        tenant_id=scope.app.tenant_id, app_id=scope.app.id, page=3, limit=2, keyword=""
    ) == AnnotationPage(data=(), page=3, limit=2, total=3)


@pytest.mark.parametrize("keyword", ["%", "_", "\\", "mixedCASE"])
@pytest.mark.parametrize("field", ["question", "content"])
def test_search_is_literal_case_insensitive_and_app_scoped(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, keyword: str, field: str
) -> None:
    question = f"prefix {keyword.lower()} suffix" if field == "question" else "Decoy question"
    content = f"prefix {keyword.lower()} suffix" if field == "content" else "Decoy answer"
    matched = _annotation(sqlite_session, scope, question=question, content=content)
    _annotation(sqlite_session, scope, question="prefix x suffix", content="prefix y suffix")
    _annotation(sqlite_session, scope, app_id=scope.other_app.id, question=question, content=content)
    sqlite_session.commit()
    page = repository.get_page(tenant_id=scope.app.tenant_id, app_id=scope.app.id, page=1, limit=20, keyword=keyword)
    assert [record.id for record in page.data] == [matched.id]
    assert page.total == 1
    assert not page.has_more


@pytest.mark.parametrize("operation", ["page", "history"])
@pytest.mark.parametrize(
    ("page", "limit", "expected_page", "expected_limit", "expected_size", "has_more"),
    [(0, 0, 1, 1, 1, True), (-2, -5, 1, 1, 1, True), (1, 1000, 1, 100, 100, True), (2, 1000, 2, 100, 1, False)],
)
def test_pagination_clamps_bounds_and_counts_all_matches(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    operation: str,
    page: int,
    limit: int,
    expected_page: int,
    expected_limit: int,
    expected_size: int,
    has_more: bool,
) -> None:
    annotations = [_annotation(sqlite_session, scope) for _ in range(101)]
    if operation == "history":
        for index in range(101):
            _history(
                sqlite_session, scope, annotation_id=annotations[0].id, created_at=CREATED_AT + timedelta(seconds=index)
            )
    sqlite_session.commit()
    if operation == "page":
        result = repository.get_page(
            tenant_id=scope.app.tenant_id, app_id=scope.app.id, page=page, limit=limit, keyword=""
        )
    else:
        result = repository.get_hit_history_page(
            tenant_id=scope.app.tenant_id, app_id=scope.app.id, annotation_id=annotations[0].id, page=page, limit=limit
        )
    assert (result.page, result.limit, result.total, len(result.data), result.has_more) == (
        expected_page,
        expected_limit,
        101,
        expected_size,
        has_more,
    )


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize("visibility", ["missing", "wrong_tenant", "foreign_app", "disabled"])
def test_all_queries_validate_app_tenant_and_status(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, operation: Operation, visibility: str
) -> None:
    annotation = _annotation(sqlite_session, scope)
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
        _query(repository, operation, tenant_id=tenant_id, app_id=app_id, annotation_id=annotation.id)


@pytest.mark.parametrize("status", [AgentStatus.ACTIVE, AgentStatus.ARCHIVED])
def test_only_count_hides_workflow_backing_apps(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, status: AgentStatus
) -> None:
    scope.app.mode = AppMode.AGENT
    sqlite_session.add(
        Agent(
            tenant_id=scope.app.tenant_id,
            name="Workflow-only agent",
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            status=status,
            backing_app_id=scope.app.id,
        )
    )
    annotation = _annotation(sqlite_session, scope)
    sqlite_session.commit()
    with pytest.raises(AnnotationAppNotFoundError):
        repository.count(tenant_id=scope.app.tenant_id, app_id=scope.app.id)
    page = repository.get_page(tenant_id=scope.app.tenant_id, app_id=scope.app.id, page=1, limit=20, keyword="")
    assert [record.id for record in page.data] == [annotation.id]
    assert [record.id for record in repository.get_all(tenant_id=scope.app.tenant_id, app_id=scope.app.id)] == [
        annotation.id
    ]
    assert not repository.get_setting(tenant_id=scope.app.tenant_id, app_id=scope.app.id).enabled
    assert (
        repository.get_hit_history_page(
            tenant_id=scope.app.tenant_id, app_id=scope.app.id, annotation_id=annotation.id, page=1, limit=20
        ).total
        == 0
    )


def test_count_keeps_roster_agent_app_visible(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    scope.app.mode = AppMode.AGENT
    sqlite_session.add(
        Agent(
            tenant_id=scope.app.tenant_id,
            name="Roster agent",
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            app_id=scope.app.id,
        )
    )
    _annotation(sqlite_session, scope)
    sqlite_session.commit()
    assert repository.count(tenant_id=scope.app.tenant_id, app_id=scope.app.id) == 1


def test_history_filters_both_app_and_annotation_and_maps_saved_snapshot(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    annotation = _annotation(sqlite_session, scope)
    other = _annotation(sqlite_session, scope)
    older = _history(sqlite_session, scope, annotation_id=annotation.id, created_at=CREATED_AT - timedelta(seconds=1))
    newest = _history(sqlite_session, scope, annotation_id=annotation.id)
    _history(sqlite_session, scope, annotation_id=annotation.id, app_id=scope.other_app.id)
    _history(sqlite_session, scope, annotation_id=other.id)
    sqlite_session.commit()
    page = repository.get_hit_history_page(
        tenant_id=scope.app.tenant_id, app_id=scope.app.id, annotation_id=annotation.id, page=1, limit=1
    )
    assert page == AnnotationPage(
        data=(
            AnnotationHitHistoryRecord(
                id=newest.id,
                source="api",
                score=0.875,
                question="User question",
                created_at=CREATED_AT,
                annotation_question="Historical question",
                annotation_content="Historical answer",
            ),
        ),
        page=1,
        limit=1,
        total=2,
    )
    assert page.has_more
    second = repository.get_hit_history_page(
        tenant_id=scope.app.tenant_id, app_id=scope.app.id, annotation_id=annotation.id, page=2, limit=1
    )
    assert [record.id for record in second.data] == [older.id]
    assert not second.has_more


@pytest.mark.parametrize("annotation_scope", ["missing", "same_tenant_other_app", "foreign_tenant"])
def test_history_rejects_foreign_or_missing_annotation_even_when_history_exists(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, annotation_scope: str
) -> None:
    if annotation_scope == "missing":
        annotation_id = str(uuid4())
    else:
        app_id = scope.other_app.id if annotation_scope == "same_tenant_other_app" else scope.foreign_app.id
        annotation_id = _annotation(sqlite_session, scope, app_id=app_id).id
    _history(sqlite_session, scope, annotation_id=annotation_id)
    sqlite_session.commit()
    with pytest.raises(AnnotationNotFoundError):
        repository.get_hit_history_page(
            tenant_id=scope.app.tenant_id, app_id=scope.app.id, annotation_id=annotation_id, page=1, limit=20
        )


@pytest.mark.parametrize("has_binding", [True, False])
def test_enabled_setting_preserves_missing_binding_nulls(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, has_binding: bool
) -> None:
    binding = DatasetCollectionBinding(
        provider_name="provider",
        model_name="embedding-model",
        type=CollectionBindingType.ANNOTATION,
        collection_name="annotations",
    )
    if has_binding:
        sqlite_session.add(binding)
    setting = _setting(sqlite_session, scope, binding_id=binding.id)
    _setting(sqlite_session, scope, binding_id=str(uuid4()), app_id=scope.other_app.id)
    sqlite_session.commit()
    assert repository.get_setting(tenant_id=scope.app.tenant_id, app_id=scope.app.id) == AnnotationSettingRecord(
        enabled=True,
        id=setting.id,
        score_threshold=0.75,
        embedding_model=AnnotationEmbeddingModel(
            embedding_provider_name="provider" if has_binding else None,
            embedding_model_name="embedding-model" if has_binding else None,
        ),
    )


def test_read_sessions_close_without_writes_and_return_detached_values(
    repository: AnnotationRepository,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    scope: Scope,
) -> None:
    annotation = _annotation(sqlite_session, scope)
    _history(sqlite_session, scope, annotation_id=annotation.id)
    _setting(sqlite_session, scope, binding_id=str(uuid4()))
    sqlite_session.commit()
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
        results = [
            _query(
                repository, operation, tenant_id=scope.app.tenant_id, app_id=scope.app.id, annotation_id=annotation.id
            )
            for operation in OPERATIONS
        ]
    finally:
        event.remove(sqlite_session_factory, "after_begin", record_session)
        event.remove(sqlite_session_factory, "before_commit", record_commit)
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)
    assert len(sessions) == len(OPERATIONS)
    assert len({id(session) for session in sessions}) == len(OPERATIONS)
    assert all(not session.in_transaction() and not session.identity_map for session in sessions)
    assert not commits
    assert statements
    assert all(statement.lstrip().upper().startswith("SELECT") for statement in statements)
    for result in results:
        assert inspect(result, raiseerr=False) is None
        if isinstance(result, AnnotationPage):
            assert result.data
            assert all(inspect(record, raiseerr=False) is None for record in result.data)
        elif isinstance(result, AnnotationSettingRecord):
            assert result.embedding_model == AnnotationEmbeddingModel(None, None)
        elif isinstance(result, tuple):
            assert result
            assert all(isinstance(record, AnnotationRecord) for record in result)


_WriteOperation = Literal["upsert", "update", "delete", "delete_many", "clear"]
_WRITE_OPERATIONS: tuple[_WriteOperation, ...] = ("upsert", "update", "delete", "delete_many", "clear")
_WRITE_CREATED_AT = datetime(2026, 1, 1)


@dataclass(frozen=True)
class _WriteScope:
    app: App
    other_app: App
    foreign_app: App
    account: Account
    other_account: Account


@pytest.fixture
def write_scope(sqlite_session: Session) -> _WriteScope:
    tenant_id = str(uuid4())
    apps = [
        App(tenant_id=workspace, name="Annotations", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        for workspace in (tenant_id, tenant_id, str(uuid4()))
    ]
    accounts = [Account(name=name, email=f"{name}@example.com") for name in ("author", "editor")]
    sqlite_session.add_all([*apps, *accounts])
    sqlite_session.commit()
    return _WriteScope(apps[0], apps[1], apps[2], accounts[0], accounts[1])


@pytest.fixture
def message(sqlite_session: Session, write_scope: _WriteScope) -> Message:
    conversation = Conversation(
        id=str(uuid4()),
        app_id=write_scope.app.id,
        name="Conversation",
        mode=AppMode.CHAT,
        _inputs={},
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=write_scope.account.id,
    )
    message = Message(
        id=str(uuid4()),
        app_id=write_scope.app.id,
        conversation_id=conversation.id,
        _inputs={},
        query="Original message",
        message={},
        answer="Original answer",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=write_scope.account.id,
    )
    sqlite_session.add_all([conversation, message])
    sqlite_session.commit()
    return message


@pytest.fixture
def annotation(sqlite_session: Session, write_scope: _WriteScope, message: Message) -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id=write_scope.app.id,
        question="Old question",
        content="Old answer",
        account_id=write_scope.account.id,
        conversation_id=message.conversation_id,
        message_id=message.id,
    )
    annotation.created_at = _WRITE_CREATED_AT
    annotation.hit_count = 3
    sqlite_session.add(annotation)
    sqlite_session.commit()
    return annotation


@pytest.fixture
def setting(sqlite_session: Session, write_scope: _WriteScope) -> AppAnnotationSetting:
    binding = DatasetCollectionBinding(
        provider_name="test-provider",
        model_name="test-embedding",
        type=CollectionBindingType.ANNOTATION,
        collection_name="annotations",
    )
    sqlite_session.add(binding)
    sqlite_session.flush()
    setting = AppAnnotationSetting(
        app_id=write_scope.app.id,
        score_threshold=0.5,
        collection_binding_id=binding.id,
        created_user_id=write_scope.account.id,
        updated_user_id=write_scope.account.id,
    )
    setting.created_at = _WRITE_CREATED_AT
    setting.updated_at = _WRITE_CREATED_AT
    sqlite_session.add(setting)
    sqlite_session.commit()
    return setting


def _write_setting(session: Session, write_scope: _WriteScope, *, app_id: str) -> str:
    binding_id = str(uuid4())
    session.add(
        AppAnnotationSetting(
            app_id=app_id,
            score_threshold=0.5,
            collection_binding_id=binding_id,
            created_user_id=write_scope.account.id,
            updated_user_id=write_scope.account.id,
        )
    )
    return binding_id


def _write_history(
    session: Session, write_scope: _WriteScope, *, app_id: str, annotation_id: str
) -> AppAnnotationHitHistory:
    history = AppAnnotationHitHistory(
        app_id=app_id,
        annotation_id=annotation_id,
        source="api",
        question="Question",
        score=0.9,
        account_id=write_scope.account.id,
        message_id=str(uuid4()),
        annotation_question="Match",
        annotation_content="Answer",
    )
    session.add(history)
    return history


def _write(
    repository: AnnotationRepository,
    operation: _WriteOperation,
    *,
    tenant_id: str,
    app_id: str,
    account_id: str,
    annotation_id: str,
) -> AnnotationWriteResult | AnnotationDeletionResult | str | None:
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
    if operation == "delete":
        return repository.delete(tenant_id=tenant_id, app_id=app_id, annotation_id=annotation_id)
    if operation == "delete_many":
        return repository.delete_many(tenant_id=tenant_id, app_id=app_id, annotation_ids=[annotation_id])
    return repository.clear(tenant_id=tenant_id, app_id=app_id)


@pytest.mark.parametrize("enabled", [True, False])
def test_manual_upsert_materializes_server_defaults_and_app_binding(
    repository: AnnotationRepository, sqlite_session: Session, write_scope: _WriteScope, enabled: bool
) -> None:
    _write_setting(sqlite_session, write_scope, app_id=write_scope.other_app.id)
    binding_id = _write_setting(sqlite_session, write_scope, app_id=write_scope.app.id) if enabled else None
    sqlite_session.commit()
    result = repository.upsert(
        tenant_id=write_scope.app.tenant_id,
        app_id=write_scope.app.id,
        account_id=write_scope.account.id,
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
    assert stored.account_id == write_scope.account.id
    assert stored.app_id == write_scope.app.id
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
    write_scope: _WriteScope,
    message: Message,
    question: str | None,
    query: str,
    expected: str,
) -> None:
    message.query = query
    sqlite_session.commit()
    result = repository.upsert(
        tenant_id=write_scope.app.tenant_id,
        app_id=write_scope.app.id,
        account_id=write_scope.account.id,
        message_id=message.id,
        question=question,
        answer="Answer",
    )
    assert result.annotation.question == expected
    stored = sqlite_session.get_one(MessageAnnotation, result.annotation.id)
    assert stored.conversation_id == message.conversation_id
    assert stored.message_id == message.id
    assert stored.account_id == write_scope.account.id


def test_message_upsert_retains_existing_authorship_associations_and_creation_time(
    repository: AnnotationRepository,
    sqlite_session: Session,
    write_scope: _WriteScope,
    message: Message,
    annotation: MessageAnnotation,
) -> None:
    result = repository.upsert(
        tenant_id=write_scope.app.tenant_id,
        app_id=write_scope.app.id,
        account_id=write_scope.other_account.id,
        message_id=message.id,
        question="Revised question",
        answer="Revised answer",
    )
    assert result.annotation == AnnotationRecord(
        id=annotation.id,
        question="Revised question",
        content="Revised answer",
        hit_count=3,
        created_at=_WRITE_CREATED_AT,
    )
    sqlite_session.refresh(annotation)
    assert annotation.account_id == write_scope.account.id
    assert annotation.message_id == message.id
    assert annotation.conversation_id == message.conversation_id
    assert sqlite_session.scalar(select(func.count()).select_from(MessageAnnotation)) == 1


def test_message_upsert_does_not_update_other_app_annotation_with_same_message_id(
    repository: AnnotationRepository, sqlite_session: Session, write_scope: _WriteScope, message: Message
) -> None:
    decoy = MessageAnnotation(
        app_id=write_scope.other_app.id,
        question="Decoy question",
        content="Decoy answer",
        account_id=write_scope.other_account.id,
        message_id=message.id,
    )
    sqlite_session.add(decoy)
    sqlite_session.commit()
    result = repository.upsert(
        tenant_id=write_scope.app.tenant_id,
        app_id=write_scope.app.id,
        account_id=write_scope.account.id,
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
        write_scope.other_account.id,
    )
    assert sqlite_session.scalar(select(func.count()).select_from(MessageAnnotation)) == 2


@pytest.mark.parametrize("message_scope", ["missing", "other_app", "foreign_tenant"])
def test_upsert_requires_message_in_admitted_app(
    repository: AnnotationRepository,
    sqlite_session: Session,
    write_scope: _WriteScope,
    message: Message,
    message_scope: str,
) -> None:
    message_id = message.id
    if message_scope == "missing":
        message_id = str(uuid4())
    else:
        message.app_id = write_scope.other_app.id if message_scope == "other_app" else write_scope.foreign_app.id
    sqlite_session.commit()
    with pytest.raises(MessageNotExistsError):
        repository.upsert(
            tenant_id=write_scope.app.tenant_id,
            app_id=write_scope.app.id,
            account_id=write_scope.account.id,
            message_id=message_id,
            question="Question",
            answer="Answer",
        )
    assert sqlite_session.scalar(select(func.count()).select_from(MessageAnnotation)) == 0


@pytest.mark.parametrize("question", [None, ""])
@pytest.mark.parametrize("message_id", [None, ""])
def test_manual_upsert_requires_truthy_question(
    repository: AnnotationRepository, write_scope: _WriteScope, question: str | None, message_id: str | None
) -> None:
    with pytest.raises(ValueError, match="'question' is required when 'message_id' is not provided"):
        repository.upsert(
            tenant_id=write_scope.app.tenant_id,
            app_id=write_scope.app.id,
            account_id=write_scope.account.id,
            message_id=message_id,
            question=question,
            answer="Answer",
        )


def test_upsert_checks_app_before_answer_and_answer_before_message(
    repository: AnnotationRepository, write_scope: _WriteScope
) -> None:
    with pytest.raises(AnnotationAppNotFoundError):
        repository.upsert(
            tenant_id=str(uuid4()),
            app_id=write_scope.app.id,
            account_id=write_scope.account.id,
            message_id=str(uuid4()),
            question=None,
            answer=None,
        )
    with pytest.raises(ValueError, match="Either 'answer' or 'content' must be provided"):
        repository.upsert(
            tenant_id=write_scope.app.tenant_id,
            app_id=write_scope.app.id,
            account_id=write_scope.account.id,
            message_id=str(uuid4()),
            question=None,
            answer=None,
        )


@pytest.mark.parametrize("operation", _WRITE_OPERATIONS)
@pytest.mark.parametrize("visibility", ["missing", "wrong_tenant", "foreign_app", "disabled"])
def test_writes_require_app_tenant_and_normal_status(
    repository: AnnotationRepository,
    sqlite_session: Session,
    write_scope: _WriteScope,
    annotation: MessageAnnotation,
    operation: _WriteOperation,
    visibility: str,
) -> None:
    tenant_id, app_id = write_scope.app.tenant_id, write_scope.app.id
    if visibility == "missing":
        app_id = str(uuid4())
    elif visibility == "wrong_tenant":
        tenant_id = str(uuid4())
    elif visibility == "foreign_app":
        app_id = write_scope.foreign_app.id
    else:
        sqlite_session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app_id})
    sqlite_session.commit()
    with pytest.raises(AnnotationAppNotFoundError):
        _write(
            repository,
            operation,
            tenant_id=tenant_id,
            app_id=app_id,
            account_id=write_scope.account.id,
            annotation_id=annotation.id,
        )
    sqlite_session.refresh(annotation)
    assert (annotation.question, annotation.content) == ("Old question", "Old answer")
    assert sqlite_session.scalar(select(func.count()).select_from(MessageAnnotation)) == 1


@pytest.mark.parametrize("operation", _WRITE_OPERATIONS)
@pytest.mark.parametrize("status", [AgentStatus.ACTIVE, AgentStatus.ARCHIVED])
def test_writes_keep_workflow_backing_apps_visible(
    repository: AnnotationRepository,
    sqlite_session: Session,
    write_scope: _WriteScope,
    annotation: MessageAnnotation,
    operation: _WriteOperation,
    status: AgentStatus,
) -> None:
    annotation_id = annotation.id
    write_scope.app.mode = AppMode.AGENT
    sqlite_session.add(
        Agent(
            tenant_id=write_scope.app.tenant_id,
            name="Hidden agent",
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            status=status,
            backing_app_id=write_scope.app.id,
        )
    )
    sqlite_session.commit()
    _write(
        repository,
        operation,
        tenant_id=write_scope.app.tenant_id,
        app_id=write_scope.app.id,
        account_id=write_scope.account.id,
        annotation_id=annotation_id,
    )
    sqlite_session.expire_all()
    stored = sqlite_session.scalar(select(MessageAnnotation).where(MessageAnnotation.id == annotation_id))
    if operation in ("delete", "delete_many", "clear"):
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
    write_scope: _WriteScope,
    annotation: MessageAnnotation,
    message: Message,
    enabled: bool,
) -> None:
    _write_setting(sqlite_session, write_scope, app_id=write_scope.other_app.id)
    binding_id = _write_setting(sqlite_session, write_scope, app_id=write_scope.app.id) if enabled else None
    sqlite_session.commit()
    result = repository.update(
        tenant_id=write_scope.app.tenant_id,
        app_id=write_scope.app.id,
        annotation_id=annotation.id,
        question="",
        answer="",
    )
    assert result == AnnotationWriteResult(
        annotation=AnnotationRecord(
            id=annotation.id, question="", content="", hit_count=3, created_at=_WRITE_CREATED_AT
        ),
        collection_binding_id=binding_id,
    )
    sqlite_session.refresh(annotation)
    assert (annotation.account_id, annotation.message_id, annotation.conversation_id) == (
        write_scope.account.id,
        message.id,
        message.conversation_id,
    )


@pytest.mark.parametrize(("question", "answer", "error"), [(None, None, "question"), ("", None, "answer")])
def test_update_validates_required_fields_without_mutating(
    repository: AnnotationRepository,
    sqlite_session: Session,
    write_scope: _WriteScope,
    annotation: MessageAnnotation,
    question: str | None,
    answer: str | None,
    error: str,
) -> None:
    with pytest.raises(ValueError, match=f"'{error}' is required"):
        repository.update(
            tenant_id=write_scope.app.tenant_id,
            app_id=write_scope.app.id,
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
    write_scope: _WriteScope,
    annotation: MessageAnnotation,
    operation: _WriteOperation,
    annotation_scope: str,
) -> None:
    annotation_id = annotation.id
    if annotation_scope == "missing":
        annotation_id = str(uuid4())
    else:
        annotation.app_id = write_scope.other_app.id if annotation_scope == "other_app" else write_scope.foreign_app.id
    sqlite_session.commit()
    with pytest.raises(AnnotationNotFoundError):
        _write(
            repository,
            operation,
            tenant_id=write_scope.app.tenant_id,
            app_id=write_scope.app.id,
            account_id=write_scope.account.id,
            annotation_id=annotation_id,
        )
    sqlite_session.refresh(annotation)
    assert (annotation.question, annotation.content) == ("Old question", "Old answer")


def test_update_checks_app_then_annotation_before_fields(
    repository: AnnotationRepository, write_scope: _WriteScope
) -> None:
    with pytest.raises(AnnotationAppNotFoundError):
        repository.update(
            tenant_id=str(uuid4()), app_id=write_scope.app.id, annotation_id=str(uuid4()), question=None, answer=None
        )
    with pytest.raises(AnnotationNotFoundError):
        repository.update(
            tenant_id=write_scope.app.tenant_id,
            app_id=write_scope.app.id,
            annotation_id=str(uuid4()),
            question=None,
            answer=None,
        )


@pytest.mark.parametrize("enabled", [True, False])
def test_delete_removes_only_matching_app_and_annotation_histories(
    repository: AnnotationRepository,
    sqlite_session: Session,
    write_scope: _WriteScope,
    annotation: MessageAnnotation,
    enabled: bool,
) -> None:
    target = _write_history(sqlite_session, write_scope, app_id=write_scope.app.id, annotation_id=annotation.id)
    foreign_app_history = _write_history(
        sqlite_session, write_scope, app_id=write_scope.other_app.id, annotation_id=annotation.id
    )
    other_annotation_history = _write_history(
        sqlite_session, write_scope, app_id=write_scope.app.id, annotation_id=str(uuid4())
    )
    _write_setting(sqlite_session, write_scope, app_id=write_scope.other_app.id)
    binding_id = _write_setting(sqlite_session, write_scope, app_id=write_scope.app.id) if enabled else None
    sqlite_session.commit()
    annotation_id, target_id = annotation.id, target.id
    result = repository.delete(
        tenant_id=write_scope.app.tenant_id, app_id=write_scope.app.id, annotation_id=annotation_id
    )
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


@pytest.mark.parametrize("operation", _WRITE_OPERATIONS)
@pytest.mark.parametrize("fail", [False, True])
def test_write_sessions_close_and_roll_back_database_failures(
    repository: AnnotationRepository,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    write_scope: _WriteScope,
    annotation: MessageAnnotation,
    operation: _WriteOperation,
    fail: bool,
) -> None:
    history = _write_history(sqlite_session, write_scope, app_id=write_scope.app.id, annotation_id=annotation.id)
    if fail:
        sql_operation = {"upsert": "INSERT", "update": "UPDATE"}.get(operation, "DELETE")
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
                    tenant_id=write_scope.app.tenant_id,
                    app_id=write_scope.app.id,
                    account_id=write_scope.account.id,
                    annotation_id=annotation.id,
                )
        else:
            result = _write(
                repository,
                operation,
                tenant_id=write_scope.app.tenant_id,
                app_id=write_scope.app.id,
                account_id=write_scope.account.id,
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


@pytest.mark.parametrize("operation", ["delete_many", "clear"])
@pytest.mark.parametrize("enabled", [True, False])
def test_bulk_delete_scopes_actual_ids_histories_and_binding_to_app(
    repository: AnnotationRepository,
    sqlite_session: Session,
    write_scope: _WriteScope,
    annotation: MessageAnnotation,
    operation: Literal["delete_many", "clear"],
    enabled: bool,
) -> None:
    annotations = [
        MessageAnnotation(app_id=app.id, question="Question", content="Answer", account_id=write_scope.account.id)
        for app in (write_scope.app, write_scope.app, write_scope.other_app, write_scope.foreign_app)
    ]
    sqlite_session.add_all(annotations)
    sqlite_session.flush()
    selected, unselected, same_workspace, foreign_workspace = annotations
    _write_history(sqlite_session, write_scope, app_id=write_scope.app.id, annotation_id=annotation.id)
    _write_history(sqlite_session, write_scope, app_id=write_scope.app.id, annotation_id=selected.id)
    unselected_history = _write_history(
        sqlite_session, write_scope, app_id=write_scope.app.id, annotation_id=unselected.id
    )
    retained_histories = [
        _write_history(sqlite_session, write_scope, app_id=write_scope.other_app.id, annotation_id=same_workspace.id),
        _write_history(
            sqlite_session, write_scope, app_id=write_scope.foreign_app.id, annotation_id=foreign_workspace.id
        ),
        _write_history(sqlite_session, write_scope, app_id=write_scope.other_app.id, annotation_id=annotation.id),
        _write_history(sqlite_session, write_scope, app_id=write_scope.app.id, annotation_id=str(uuid4())),
    ]
    _write_setting(sqlite_session, write_scope, app_id=write_scope.other_app.id)
    binding_id = _write_setting(sqlite_session, write_scope, app_id=write_scope.app.id) if enabled else None
    sqlite_session.commit()
    requested_ids = [annotation.id, selected.id, annotation.id, same_workspace.id, foreign_workspace.id, str(uuid4())]
    expected_deleted = {annotation.id, selected.id}
    expected_retained = {same_workspace.id, foreign_workspace.id}
    expected_histories = {history.id for history in retained_histories}
    if operation == "delete_many":
        expected_retained.add(unselected.id)
        expected_histories.add(unselected_history.id)
        result = repository.delete_many(
            tenant_id=write_scope.app.tenant_id, app_id=write_scope.app.id, annotation_ids=requested_ids
        )
    else:
        expected_deleted.add(unselected.id)
        result = repository.clear(tenant_id=write_scope.app.tenant_id, app_id=write_scope.app.id)
    assert set(result.annotation_ids) == expected_deleted
    assert len(result.annotation_ids) == len(expected_deleted)
    assert result.collection_binding_id == binding_id
    assert set(sqlite_session.scalars(select(MessageAnnotation.id))) == expected_retained
    assert set(sqlite_session.scalars(select(AppAnnotationHitHistory.id))) == expected_histories
    assert sqlite_session.scalar(select(func.count()).select_from(AppAnnotationSetting)) == (2 if enabled else 1)


@pytest.mark.parametrize("requested_ids", [[], [str(uuid4())]])
def test_delete_many_with_no_matching_ids_does_not_clear_annotations(
    repository: AnnotationRepository,
    sqlite_session: Session,
    write_scope: _WriteScope,
    annotation: MessageAnnotation,
    requested_ids: list[str],
) -> None:
    history = _write_history(sqlite_session, write_scope, app_id=write_scope.app.id, annotation_id=annotation.id)
    binding_id = _write_setting(sqlite_session, write_scope, app_id=write_scope.app.id)
    sqlite_session.commit()
    result = repository.delete_many(
        tenant_id=write_scope.app.tenant_id, app_id=write_scope.app.id, annotation_ids=requested_ids
    )
    assert result == AnnotationDeletionResult(annotation_ids=(), collection_binding_id=binding_id)
    assert list(sqlite_session.scalars(select(MessageAnnotation.id))) == [annotation.id]
    assert list(sqlite_session.scalars(select(AppAnnotationHitHistory.id))) == [history.id]


def test_clear_empty_app_keeps_other_app_annotations_and_settings(
    repository: AnnotationRepository, sqlite_session: Session, write_scope: _WriteScope, annotation: MessageAnnotation
) -> None:
    annotation.app_id = write_scope.other_app.id
    binding_id = _write_setting(sqlite_session, write_scope, app_id=write_scope.app.id)
    sqlite_session.commit()
    result = repository.clear(tenant_id=write_scope.app.tenant_id, app_id=write_scope.app.id)
    assert result == AnnotationDeletionResult(annotation_ids=(), collection_binding_id=binding_id)
    assert list(sqlite_session.scalars(select(MessageAnnotation.id))) == [annotation.id]
    assert sqlite_session.scalar(select(AppAnnotationSetting.collection_binding_id)) == binding_id


@pytest.mark.parametrize("operation", ["delete_many", "clear"])
@pytest.mark.parametrize("fail", [False, True])
def test_large_bulk_delete_respects_sql_parameter_limit_and_rolls_back_all_batches(
    sqlite_engine: Engine,
    sqlite_session: Session,
    write_scope: _WriteScope,
    operation: Literal["delete_many", "clear"],
    fail: bool,
) -> None:
    annotations = [
        MessageAnnotation(
            app_id=write_scope.app.id, question="Question", content="Answer", account_id=write_scope.account.id
        )
        for _ in range(1100)
    ]
    sqlite_session.add_all(annotations)
    sqlite_session.flush()
    for annotation in annotations:
        _write_history(sqlite_session, write_scope, app_id=write_scope.app.id, annotation_id=annotation.id)
    if fail:
        sqlite_session.execute(
            text(
                "CREATE TRIGGER reject_last_annotation_delete BEFORE DELETE ON message_annotations "
                "WHEN (SELECT COUNT(*) FROM message_annotations WHERE app_id = OLD.app_id) = 1 "
                "BEGIN SELECT RAISE(ABORT, 'last annotation delete rejected'); END"
            )
        )
    sqlite_session.commit()
    annotation_ids = [annotation.id for annotation in annotations]
    with sqlite_engine.connect() as connection:
        driver_connection = connection.connection.driver_connection
        assert isinstance(driver_connection, SQLiteConnection)
        # Exercise the database's real limit instead of assuming the local SQLite build uses 999.
        previous_limit = driver_connection.setlimit(SQLITE_LIMIT_VARIABLE_NUMBER, 999)
        try:
            repository = AnnotationRepository(session_factory=sessionmaker(bind=connection))

            def delete_annotations() -> AnnotationDeletionResult:
                if operation == "delete_many":
                    return repository.delete_many(
                        tenant_id=write_scope.app.tenant_id, app_id=write_scope.app.id, annotation_ids=annotation_ids
                    )
                return repository.clear(tenant_id=write_scope.app.tenant_id, app_id=write_scope.app.id)

            if fail:
                with pytest.raises(IntegrityError, match="last annotation delete rejected"):
                    delete_annotations()
            else:
                result = delete_annotations()
                assert set(result.annotation_ids) == set(annotation_ids)
            assert not connection.in_transaction()
        finally:
            driver_connection.setlimit(SQLITE_LIMIT_VARIABLE_NUMBER, previous_limit)
    expected_count = len(annotation_ids) if fail else 0
    assert sqlite_session.scalar(select(func.count()).select_from(MessageAnnotation)) == expected_count
    assert sqlite_session.scalar(select(func.count()).select_from(AppAnnotationHitHistory)) == expected_count


@pytest.mark.parametrize("score_threshold", [-0.1, 0.0, 0.75, 1.0, 1.5])
@pytest.mark.parametrize("has_binding", [True, False])
def test_update_setting_preserves_binding_creation_audit_and_other_settings(
    repository: AnnotationRepository,
    sqlite_session: Session,
    write_scope: _WriteScope,
    setting: AppAnnotationSetting,
    score_threshold: float,
    has_binding: bool,
) -> None:
    binding_id = setting.collection_binding_id
    if not has_binding:
        sqlite_session.delete(sqlite_session.get_one(DatasetCollectionBinding, binding_id))
    decoy = AppAnnotationSetting(
        app_id=write_scope.app.id,
        score_threshold=0.4,
        collection_binding_id=str(uuid4()),
        created_user_id=write_scope.account.id,
        updated_user_id=write_scope.account.id,
    )
    sqlite_session.add(decoy)
    sqlite_session.commit()
    before = naive_utc_now()
    result = repository.update_setting(
        tenant_id=write_scope.app.tenant_id,
        app_id=write_scope.app.id,
        setting_id=setting.id,
        account_id=write_scope.other_account.id,
        score_threshold=score_threshold,
    )
    after = naive_utc_now()
    assert result == AnnotationSettingRecord(
        enabled=True,
        id=setting.id,
        score_threshold=score_threshold,
        embedding_model=AnnotationEmbeddingModel(
            embedding_provider_name="test-provider" if has_binding else None,
            embedding_model_name="test-embedding" if has_binding else None,
        ),
    )
    assert inspect(result, raiseerr=False) is None
    sqlite_session.refresh(setting)
    assert setting.score_threshold == score_threshold
    assert setting.updated_user_id == write_scope.other_account.id
    assert before <= setting.updated_at <= after
    assert setting.updated_at.tzinfo is None
    assert setting.created_at == _WRITE_CREATED_AT
    assert setting.created_user_id == write_scope.account.id
    assert setting.collection_binding_id == binding_id
    assert setting.app_id == write_scope.app.id
    sqlite_session.refresh(decoy)
    assert decoy.score_threshold == 0.4
    assert decoy.updated_user_id == write_scope.account.id


@pytest.mark.parametrize("visibility", ["missing", "wrong_tenant", "foreign_app", "disabled"])
def test_update_setting_checks_app_visibility_before_setting(
    repository: AnnotationRepository,
    sqlite_session: Session,
    write_scope: _WriteScope,
    setting: AppAnnotationSetting,
    visibility: str,
) -> None:
    tenant_id, app_id = write_scope.app.tenant_id, write_scope.app.id
    if visibility == "missing":
        app_id = str(uuid4())
    elif visibility == "wrong_tenant":
        tenant_id = str(uuid4())
    elif visibility == "foreign_app":
        app_id = write_scope.foreign_app.id
    else:
        sqlite_session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app_id})
    sqlite_session.commit()
    with pytest.raises(AnnotationAppNotFoundError):
        repository.update_setting(
            tenant_id=tenant_id,
            app_id=app_id,
            setting_id=str(uuid4()),
            account_id=write_scope.other_account.id,
            score_threshold=0.75,
        )
    sqlite_session.refresh(setting)
    assert setting.score_threshold == 0.5
    assert setting.updated_user_id == write_scope.account.id
    assert setting.updated_at == _WRITE_CREATED_AT


@pytest.mark.parametrize("setting_scope", ["missing", "other_app", "foreign_app"])
def test_update_setting_requires_setting_in_admitted_app(
    repository: AnnotationRepository,
    sqlite_session: Session,
    write_scope: _WriteScope,
    setting: AppAnnotationSetting,
    setting_scope: str,
) -> None:
    setting_id = setting.id
    if setting_scope == "missing":
        setting_id = str(uuid4())
    else:
        setting.app_id = write_scope.other_app.id if setting_scope == "other_app" else write_scope.foreign_app.id
    sqlite_session.commit()
    with pytest.raises(AnnotationSettingNotFoundError):
        repository.update_setting(
            tenant_id=write_scope.app.tenant_id,
            app_id=write_scope.app.id,
            setting_id=setting_id,
            account_id=write_scope.other_account.id,
            score_threshold=0.75,
        )
    sqlite_session.refresh(setting)
    assert setting.score_threshold == 0.5
    assert setting.updated_user_id == write_scope.account.id


@pytest.mark.parametrize("fail", [False, True])
def test_update_setting_closes_session_and_rolls_back_database_failure(
    repository: AnnotationRepository,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    write_scope: _WriteScope,
    setting: AppAnnotationSetting,
    fail: bool,
) -> None:
    if fail:
        sqlite_session.execute(
            text(
                "CREATE TRIGGER reject_annotation_setting_update BEFORE UPDATE ON app_annotation_settings "
                "BEGIN SELECT RAISE(ABORT, 'setting update rejected'); END"
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
            with pytest.raises(IntegrityError, match="setting update rejected"):
                repository.update_setting(
                    tenant_id=write_scope.app.tenant_id,
                    app_id=write_scope.app.id,
                    setting_id=setting.id,
                    account_id=write_scope.other_account.id,
                    score_threshold=0.75,
                )
        else:
            repository.update_setting(
                tenant_id=write_scope.app.tenant_id,
                app_id=write_scope.app.id,
                setting_id=setting.id,
                account_id=write_scope.other_account.id,
                score_threshold=0.75,
            )
    finally:
        event.remove(sqlite_session_factory, "after_begin", record_session)
        event.remove(sqlite_session_factory, "after_commit", record_commit)
        event.remove(sqlite_session_factory, "after_rollback", record_rollback)
    assert len(sessions) == 1
    assert not sessions[0].in_transaction()
    assert not sessions[0].identity_map
    assert len(commits) == (0 if fail else 1)
    assert len(rollbacks) == (1 if fail else 0)
    sqlite_session.refresh(setting)
    assert setting.score_threshold == (0.5 if fail else 0.75)
    assert setting.updated_user_id == (write_scope.account.id if fail else write_scope.other_account.id)
    if fail:
        assert setting.updated_at == _WRITE_CREATED_AT
