"""Runtime matching revalidates detached plans and commits each hit atomically."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Engine, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account
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
from services.annotation_reply_service import (
    AnnotationIndexBinding,
    AnnotationMatchCandidate,
    AnnotationMatchPlan,
    AnnotationReplyRecord,
    AnnotationReplySource,
)


@dataclass(frozen=True)
class Scope:
    app: App
    other_app: App
    foreign_app: App
    account: Account
    binding: DatasetCollectionBinding
    setting: AppAnnotationSetting
    annotation: MessageAnnotation
    message: Message


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
    account = Account(name="Author", email="annotation-runtime@example.com")
    sqlite_session.add_all([*apps, account])
    sqlite_session.flush()
    binding = DatasetCollectionBinding(
        provider_name="embedding-provider",
        model_name="embedding-model",
        type=CollectionBindingType.ANNOTATION,
        collection_name="runtime-annotations",
    )
    setting = AppAnnotationSetting(
        app_id=apps[0].id,
        collection_binding_id=binding.id,
        score_threshold=0.5,
        created_user_id=account.id,
        updated_user_id=account.id,
    )
    annotation = MessageAnnotation(app_id=apps[0].id, question="Question", content="Answer", account_id=account.id)
    conversation = Conversation(
        id=str(uuid4()),
        app_id=apps[0].id,
        name="Conversation",
        mode=AppMode.CHAT,
        _inputs={},
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
    )
    message = Message(
        id=str(uuid4()),
        app_id=apps[0].id,
        conversation_id=conversation.id,
        _inputs={},
        query="Original message",
        message={},
        answer="",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
    )
    sqlite_session.add_all([binding, setting, annotation, conversation, message])
    sqlite_session.commit()
    return Scope(apps[0], apps[1], apps[2], account, binding, setting, annotation, message)


def _plan(repository: AnnotationRepository, scope: Scope) -> AnnotationMatchPlan:
    plan = repository.prepare_match(tenant_id=scope.app.tenant_id, app_id=scope.app.id)
    assert plan is not None
    return plan


def _record(repository: AnnotationRepository, scope: Scope, plan: AnnotationMatchPlan) -> AnnotationReplyRecord | None:
    return repository.record_match(
        plan=plan,
        candidate=AnnotationMatchCandidate(annotation_id=scope.annotation.id, score=0.75),
        message_id=scope.message.id,
        user_id=scope.account.id,
        query="User question",
        source="console",
    )


def _assert_no_hit(session: Session, scope: Scope) -> None:
    assert session.scalar(select(func.count()).select_from(AppAnnotationHitHistory)) == 0
    assert session.scalar(select(MessageAnnotation.hit_count).where(MessageAnnotation.id == scope.annotation.id)) == 0


def test_prepare_returns_configured_binding_without_creating_or_reselecting_one(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope
) -> None:
    decoy = DatasetCollectionBinding(
        provider_name=scope.binding.provider_name,
        model_name=scope.binding.model_name,
        type=CollectionBindingType.ANNOTATION,
        collection_name="older-collection",
    )
    decoy.created_at = datetime(2020, 1, 1)
    sqlite_session.add(decoy)
    scope.setting.score_threshold = 0
    sqlite_session.commit()

    plan = _plan(repository, scope)

    assert plan.tenant_id == scope.app.tenant_id
    assert plan.app_id == scope.app.id
    assert plan.revision.id == scope.setting.id
    assert plan.score_threshold == 0
    assert plan.binding == AnnotationIndexBinding(
        id=scope.binding.id,
        provider_name=scope.binding.provider_name,
        model_name=scope.binding.model_name,
        collection_name=scope.binding.collection_name,
    )
    assert sqlite_session.scalar(select(func.count()).select_from(DatasetCollectionBinding)) == 2
    _assert_no_hit(sqlite_session, scope)


@pytest.mark.parametrize("operation", ["prepare", "get_reply"])
@pytest.mark.parametrize("invalid_scope", ["other_app", "foreign_app", "missing_app", "wrong_tenant", "disabled"])
def test_reads_reject_wrong_owner_or_unavailable_app(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    operation: str,
    invalid_scope: str,
) -> None:
    tenant_id, app_id = scope.app.tenant_id, scope.app.id
    if invalid_scope == "other_app":
        app_id = scope.other_app.id
    elif invalid_scope == "foreign_app":
        app_id = scope.foreign_app.id
    elif invalid_scope == "missing_app":
        app_id = str(uuid4())
    elif invalid_scope == "wrong_tenant":
        tenant_id = str(uuid4())
    else:
        sqlite_session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app_id})
        sqlite_session.commit()

    result = (
        repository.prepare_match(tenant_id=tenant_id, app_id=app_id)
        if operation == "prepare"
        else repository.get_reply(tenant_id=tenant_id, app_id=app_id, annotation_id=scope.annotation.id)
    )

    assert result is None


@pytest.mark.parametrize("mutation", ["disabled", "missing_binding", "wrong_binding_type"])
def test_prepare_skips_unavailable_settings_without_repairing_them(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, mutation: str
) -> None:
    if mutation == "disabled":
        sqlite_session.delete(scope.setting)
    elif mutation == "missing_binding":
        sqlite_session.delete(scope.binding)
    else:
        scope.binding.type = CollectionBindingType.DATASET
    sqlite_session.commit()

    assert repository.prepare_match(tenant_id=scope.app.tenant_id, app_id=scope.app.id) is None
    assert sqlite_session.scalar(select(func.count()).select_from(DatasetCollectionBinding)) == (
        0 if mutation == "missing_binding" else 1
    )
    _assert_no_hit(sqlite_session, scope)


@pytest.mark.parametrize("question", ["Question", ""])
@pytest.mark.parametrize("source", ["api", "console"])
def test_record_commits_count_and_full_history_before_returning_detached_reply(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    question: str,
    source: AnnotationReplySource,
) -> None:
    scope.annotation.question = question
    scope.annotation.hit_count = 3
    sqlite_session.commit()
    plan = _plan(repository, scope)
    viewer_id = str(uuid4())

    reply = repository.record_match(
        plan=plan,
        candidate=AnnotationMatchCandidate(annotation_id=scope.annotation.id, score=0.75),
        message_id=scope.message.id,
        user_id=viewer_id,
        query="User question",
        source=source,
    )

    assert reply == AnnotationReplyRecord(scope.annotation.id, "Answer", scope.account.id, "Author")
    sqlite_session.refresh(scope.annotation)
    assert scope.annotation.hit_count == 4
    history = sqlite_session.scalars(select(AppAnnotationHitHistory)).one()
    assert (history.app_id, history.annotation_id, history.account_id, history.message_id) == (
        scope.app.id,
        scope.annotation.id,
        viewer_id,
        scope.message.id,
    )
    assert (
        history.question,
        history.annotation_question,
        history.annotation_content,
        history.source,
        history.score,
    ) == (
        "User question",
        question or "Answer",
        "Answer",
        source,
        0.75,
    )


@pytest.mark.parametrize("operation", ["record", "get_reply"])
@pytest.mark.parametrize("author_name", [None, ""])
def test_reply_retains_deleted_author_and_does_not_replace_empty_name(
    repository: AnnotationRepository,
    sqlite_session: Session,
    scope: Scope,
    operation: str,
    author_name: str | None,
) -> None:
    if author_name is None:
        sqlite_session.delete(scope.account)
    else:
        scope.account.name = author_name
    sqlite_session.commit()

    reply = (
        _record(repository, scope, _plan(repository, scope))
        if operation == "record"
        else repository.get_reply(tenant_id=scope.app.tenant_id, app_id=scope.app.id, annotation_id=scope.annotation.id)
    )

    assert reply is not None
    assert reply.account_id == scope.account.id
    assert reply.account_name == author_name


@pytest.mark.parametrize("mutation", ["threshold", "binding_id", "setting_id", "disabled"])
def test_record_rejects_setting_changes_after_search(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, mutation: str
) -> None:
    plan = _plan(repository, scope)
    if mutation == "threshold":
        scope.setting.score_threshold = 0.9
    elif mutation == "binding_id":
        scope.setting.collection_binding_id = str(uuid4())
    elif mutation == "setting_id":
        scope.setting.id = str(uuid4())
    else:
        sqlite_session.delete(scope.setting)
    sqlite_session.commit()

    assert _record(repository, scope, plan) is None
    _assert_no_hit(sqlite_session, scope)


@pytest.mark.parametrize("mutation", ["deleted", "type", "model", "provider", "collection"])
def test_record_rejects_binding_changes_after_search(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, mutation: str
) -> None:
    plan = _plan(repository, scope)
    if mutation == "deleted":
        sqlite_session.delete(scope.binding)
    elif mutation == "type":
        scope.binding.type = CollectionBindingType.DATASET
    elif mutation == "model":
        scope.binding.model_name = "changed-model"
    elif mutation == "provider":
        scope.binding.provider_name = "changed-provider"
    else:
        scope.binding.collection_name = "changed-collection"
    sqlite_session.commit()

    assert _record(repository, scope, plan) is None
    _assert_no_hit(sqlite_session, scope)


@pytest.mark.parametrize("mutation", ["owner", "disabled", "deleted"])
def test_record_revalidates_app_after_search(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, mutation: str
) -> None:
    plan = _plan(repository, scope)
    if mutation == "owner":
        scope.app.tenant_id = str(uuid4())
    elif mutation == "disabled":
        sqlite_session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": scope.app.id})
    else:
        sqlite_session.delete(scope.app)
    sqlite_session.commit()

    assert _record(repository, scope, plan) is None
    _assert_no_hit(sqlite_session, scope)


@pytest.mark.parametrize("target", ["annotation", "message"])
@pytest.mark.parametrize("mutation", ["other_app", "foreign_app", "missing"])
def test_record_rechecks_annotation_and_message_app_ownership(
    repository: AnnotationRepository, sqlite_session: Session, scope: Scope, target: str, mutation: str
) -> None:
    plan = _plan(repository, scope)
    row = scope.annotation if target == "annotation" else scope.message
    if mutation == "missing":
        sqlite_session.delete(row)
    else:
        row.app_id = scope.other_app.id if mutation == "other_app" else scope.foreign_app.id
    sqlite_session.commit()

    assert _record(repository, scope, plan) is None
    assert sqlite_session.scalar(select(func.count()).select_from(AppAnnotationHitHistory)) == 0
    if target != "annotation" or mutation != "missing":
        assert (
            sqlite_session.scalar(
                select(MessageAnnotation.hit_count).where(MessageAnnotation.id == scope.annotation.id)
            )
            == 0
        )


@pytest.mark.parametrize("operation", ["UPDATE", "INSERT"])
def test_count_and_history_roll_back_together_when_either_sql_write_fails(
    repository: AnnotationRepository,
    sqlite_session: Session,
    sqlite_engine: Engine,
    scope: Scope,
    operation: Literal["UPDATE", "INSERT"],
) -> None:
    plan = _plan(repository, scope)
    table = "message_annotations" if operation == "UPDATE" else "app_annotation_hit_histories"
    with sqlite_engine.begin() as connection:
        connection.execute(
            text(
                f"CREATE TRIGGER reject_annotation_hit BEFORE {operation} ON {table} "
                "BEGIN SELECT RAISE(ABORT, 'annotation hit rejected'); END"
            )
        )

    with pytest.raises(IntegrityError, match="annotation hit rejected"):
        _record(repository, scope, plan)

    _assert_no_hit(sqlite_session, scope)


def test_missing_reply_does_not_return_another_valid_annotation(repository: AnnotationRepository, scope: Scope) -> None:
    assert repository.get_reply(tenant_id=scope.app.tenant_id, app_id=scope.app.id, annotation_id=str(uuid4())) is None
