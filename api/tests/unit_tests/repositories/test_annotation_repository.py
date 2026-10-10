"""Real SQLite coverage for detached annotation reads and their visibility rules."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Connection, Engine, event, inspect, text
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from models.account import Account
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.dataset import DatasetCollectionBinding
from models.enums import CollectionBindingType
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, AppMode, MessageAnnotation
from repositories.annotation_repository import AnnotationRepository
from services.annotation_query import (
    AnnotationAppNotFoundError,
    AnnotationEmbeddingModel,
    AnnotationHitHistoryRecord,
    AnnotationNotFoundError,
    AnnotationPage,
    AnnotationRecord,
    AnnotationSettingRecord,
)

CREATED_AT = datetime(2026, 10, 1, 12)
Operation = Literal["count", "page", "setting", "history"]
OPERATIONS: tuple[Operation, ...] = ("count", "page", "setting", "history")


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
    if operation == "setting":
        return repository.get_setting(tenant_id=tenant_id, app_id=app_id)
    return repository.get_hit_history_page(
        tenant_id=tenant_id, app_id=app_id, annotation_id=annotation_id, page=1, limit=20
    )


def test_empty_results(repository: AnnotationRepository, sqlite_session: Session, scope: Scope) -> None:
    assert repository.count(tenant_id=scope.app.tenant_id, app_id=scope.app.id) == 0
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
    assert len(sessions) == 4
    assert len({id(session) for session in sessions}) == 4
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
