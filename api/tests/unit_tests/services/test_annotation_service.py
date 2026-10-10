"""SQLite-backed unit tests for :mod:`services.annotation_service`."""

# Test functions explicitly request the identity fixture to make the patched
# request context visible at each service call, even when they do not inspect it.
# ruff: noqa: ARG002

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import NotFound

import services.annotation_service as annotation_service_module
from models.account import Account
from models.model import (
    App,
    AppAnnotationHitHistory,
    AppAnnotationSetting,
    AppMode,
    IconType,
    MessageAnnotation,
)
from services.annotation_service import AppAnnotationService
from services.app_ref_service import AnnotationRef, AppRef

TENANT_ID = "tenant-1"
OTHER_TENANT_ID = "tenant-2"


@pytest.fixture
def current_user(monkeypatch: pytest.MonkeyPatch) -> Account:
    """Install a real account model as the request identity."""

    account = Account(name="Annotation Tester", email="annotation@example.com")
    account.id = "account-1"
    monkeypatch.setattr(
        annotation_service_module,
        "current_account_with_tenant",
        lambda: (account, TENANT_ID),
    )
    return account


def _persist_app(
    session: Session,
    *,
    app_id: str = "app-1",
    tenant_id: str = TENANT_ID,
    status: str = "normal",
) -> App:
    app = App(
        id=app_id,
        tenant_id=tenant_id,
        name=f"Annotation App {app_id}",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#FFFFFF",
        status=status,
        enable_site=False,
        enable_api=False,
    )
    session.add(app)
    session.commit()
    return app


def _persist_annotation(
    session: Session,
    app: App,
    *,
    annotation_id: str = "ann-1",
    question: str = "question",
    content: str = "answer",
    message_id: str | None = None,
    created_at: datetime | None = None,
) -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id=app.id,
        question=question,
        content=content,
        account_id="account-1",
        message_id=message_id,
    )
    annotation.id = annotation_id
    if created_at is not None:
        annotation.created_at = created_at
    session.add(annotation)
    session.commit()
    return annotation


def _persist_setting(
    session: Session,
    app: App,
    *,
    setting_id: str = "setting-1",
    binding_id: str = "collection-1",
    score_threshold: float = 0.5,
) -> AppAnnotationSetting:
    setting = AppAnnotationSetting(
        app_id=app.id,
        score_threshold=score_threshold,
        collection_binding_id=binding_id,
        created_user_id="account-1",
        updated_user_id="account-1",
    )
    setting.id = setting_id
    session.add(setting)
    session.commit()
    return setting


def _persist_history(
    session: Session,
    app: App,
    annotation: MessageAnnotation,
    *,
    history_id: str = "history-1",
    created_at: datetime | None = None,
) -> AppAnnotationHitHistory:
    history = AppAnnotationHitHistory(
        app_id=app.id,
        annotation_id=annotation.id,
        source="hit-testing",
        question="query",
        account_id="account-1",
        score=0.8,
        message_id="message-1",
        annotation_question=annotation.question,
        annotation_content=annotation.content,
    )
    history.id = history_id
    if created_at is not None:
        history.created_at = created_at
    session.add(history)
    session.commit()
    return history


def _app_ref(app: App) -> AppRef:
    return AppRef(tenant_id=app.tenant_id, app_id=app.id)


def _annotation_ref(app: App, annotation_id: str) -> AnnotationRef:
    return AnnotationRef(app=_app_ref(app), annotation_id=annotation_id)


def _observer_get(factory: sessionmaker[Session], model: type[Any], identifier: str) -> Any:
    with factory() as observer:
        return observer.get(model, identifier)


class TestAppAnnotationServiceEnableDisable:
    def test_enable_returns_processing_on_cache_hit(self, current_user: Account) -> None:
        args = {"score_threshold": 0.5, "embedding_provider_name": "p", "embedding_model_name": "m"}
        with (
            patch.object(annotation_service_module, "redis_client") as redis,
            patch.object(annotation_service_module, "enable_annotation_reply_task") as task,
        ):
            redis.get.return_value = "job-1"
            result = AppAnnotationService.enable_app_annotation(args, "app-1")

        assert result == {"job_id": "job-1", "job_status": "processing"}
        task.delay.assert_not_called()

    def test_disable_returns_processing_on_cache_hit(self, current_user: Account) -> None:
        with (
            patch.object(annotation_service_module, "redis_client") as redis,
            patch.object(annotation_service_module, "disable_annotation_reply_task") as task,
        ):
            redis.get.return_value = "job-2"
            result = AppAnnotationService.disable_app_annotation("app-1")

        assert result == {"job_id": "job-2", "job_status": "processing"}
        task.delay.assert_not_called()


class TestAppAnnotationServiceList:
    def test_list_rejects_cross_tenant_app(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session, tenant_id=OTHER_TENANT_ID)

        with pytest.raises(NotFound):
            AppAnnotationService.get_annotation_list_by_app_id(app.id, 1, 10, "", sqlite_session)

    def test_list_filters_orders_and_paginates(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        other_app = _persist_app(sqlite_session, app_id="app-2")
        now = datetime(2026, 1, 1)
        first = _persist_annotation(sqlite_session, app, annotation_id="ann-1", question="needle first", created_at=now)
        second = _persist_annotation(
            sqlite_session,
            app,
            annotation_id="ann-2",
            question="other",
            content="needle second",
            created_at=now + timedelta(seconds=1),
        )
        _persist_annotation(sqlite_session, app, annotation_id="ann-3", question="not matched")
        _persist_annotation(sqlite_session, other_app, annotation_id="decoy", question="needle decoy")

        items, total = AppAnnotationService.get_annotation_list_by_app_id(app.id, 1, 1, "needle", sqlite_session)

        assert total == 2
        assert [item.id for item in items] == [second.id]
        items, total = AppAnnotationService.get_annotation_list_by_app_id(app.id, 2, 1, "needle", sqlite_session)
        assert total == 2
        assert [item.id for item in items] == [first.id]

    def test_list_without_keyword_is_app_scoped(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        other_app = _persist_app(sqlite_session, app_id="app-2")
        expected = _persist_annotation(sqlite_session, app)
        _persist_annotation(sqlite_session, other_app, annotation_id="decoy")

        items, total = AppAnnotationService.get_annotation_list_by_app_id(app.id, 1, 10, "", sqlite_session)

        assert total == 1
        assert [item.id for item in items] == [expected.id]


class TestAppAnnotationServiceDirectManipulation:
    def test_insert_rejects_cross_tenant_app_and_missing_question(
        self, sqlite_session: Session, current_user: Account
    ) -> None:
        other_app = _persist_app(sqlite_session, tenant_id=OTHER_TENANT_ID)
        with pytest.raises(NotFound):
            AppAnnotationService.insert_app_annotation_directly(
                {"answer": "hello", "question": "q"}, other_app.id, sqlite_session
            )

        app = _persist_app(sqlite_session, app_id="app-2")
        with pytest.raises(ValueError, match="question"):
            AppAnnotationService.insert_app_annotation_directly({"answer": "hello"}, app.id, sqlite_session)

    def test_insert_persists_and_enqueues_index(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        current_user: Account,
    ) -> None:
        app = _persist_app(sqlite_session)
        setting = _persist_setting(sqlite_session, app)

        with patch.object(annotation_service_module, "add_annotation_to_index_task") as task:
            result = AppAnnotationService.insert_app_annotation_directly(
                {"answer": "hello", "question": "q1"}, app.id, sqlite_session
            )

        stored = _observer_get(sqlite_session_factory, MessageAnnotation, result.id)
        assert stored is not None
        assert (stored.app_id, stored.question, stored.content, stored.account_id) == (
            app.id,
            "q1",
            "hello",
            current_user.id,
        )
        task.delay.assert_called_once_with(result.id, "q1", TENANT_ID, app.id, setting.collection_binding_id)

    def test_update_is_app_scoped_and_validates_fields(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        other_app = _persist_app(sqlite_session, app_id="app-2")
        annotation = _persist_annotation(sqlite_session, other_app)

        with pytest.raises(NotFound):
            AppAnnotationService.update_app_annotation_directly(
                {"answer": "a", "question": "q"}, _annotation_ref(app, annotation.id), sqlite_session
            )

        own_annotation = _persist_annotation(sqlite_session, app, annotation_id="own-ann")
        with pytest.raises(ValueError, match="question"):
            AppAnnotationService.update_app_annotation_directly(
                {"answer": "a"}, _annotation_ref(app, own_annotation.id), sqlite_session
            )
        with pytest.raises(ValueError, match="answer"):
            AppAnnotationService.update_app_annotation_directly(
                {"question": "q"}, _annotation_ref(app, own_annotation.id), sqlite_session
            )

    def test_update_persists_and_enqueues_index(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        current_user: Account,
    ) -> None:
        app = _persist_app(sqlite_session)
        annotation = _persist_annotation(sqlite_session, app, content="old")
        setting = _persist_setting(sqlite_session, app)

        with patch.object(annotation_service_module, "update_annotation_to_index_task") as task:
            result = AppAnnotationService.update_app_annotation_directly(
                {"answer": "new", "question": "new q"}, _annotation_ref(app, annotation.id), sqlite_session
            )

        stored = _observer_get(sqlite_session_factory, MessageAnnotation, annotation.id)
        assert stored is not None
        assert (stored.question, stored.content) == ("new q", "new")
        assert result.id == stored.id
        task.delay.assert_called_once_with(annotation.id, "new q", TENANT_ID, app.id, setting.collection_binding_id)

    def test_delete_is_app_scoped(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        other_app = _persist_app(sqlite_session, app_id="app-2")
        annotation = _persist_annotation(sqlite_session, other_app)

        with pytest.raises(NotFound):
            AppAnnotationService.delete_app_annotation(_annotation_ref(app, annotation.id), sqlite_session)

        assert sqlite_session.get(MessageAnnotation, annotation.id) is not None

    def test_delete_removes_annotation_and_histories_and_enqueues_index(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        current_user: Account,
    ) -> None:
        app = _persist_app(sqlite_session)
        annotation = _persist_annotation(sqlite_session, app)
        histories = [
            _persist_history(sqlite_session, app, annotation, history_id="history-1"),
            _persist_history(sqlite_session, app, annotation, history_id="history-2"),
        ]
        setting = _persist_setting(sqlite_session, app)

        with patch.object(annotation_service_module, "delete_annotation_index_task") as task:
            AppAnnotationService.delete_app_annotation(_annotation_ref(app, annotation.id), sqlite_session)

        with sqlite_session_factory() as observer:
            assert observer.get(MessageAnnotation, annotation.id) is None
            assert [observer.get(AppAnnotationHitHistory, history.id) for history in histories] == [None, None]
        task.delay.assert_called_once_with(annotation.id, app.id, TENANT_ID, setting.collection_binding_id)


class TestAppAnnotationServiceHitHistoryAndSettings:
    def test_get_annotation_by_id_uses_real_identity_lookup(
        self, sqlite_session: Session, current_user: Account
    ) -> None:
        app = _persist_app(sqlite_session)
        annotation = _persist_annotation(sqlite_session, app)

        assert AppAnnotationService.get_annotation_by_id("missing", sqlite_session) is None
        assert AppAnnotationService.get_annotation_by_id(annotation.id, sqlite_session) is annotation

    def test_add_history_increments_count_and_flushes_row(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        annotation = _persist_annotation(sqlite_session, app)

        AppAnnotationService.add_annotation_history(
            annotation_id=annotation.id,
            app_id=app.id,
            annotation_question="q",
            annotation_content="a",
            query="user q",
            user_id=current_user.id,
            message_id="msg-1",
            from_source="chat",
            score=0.8,
            session=sqlite_session,
        )

        sqlite_session.refresh(annotation)
        assert annotation.hit_count == 1
        history = sqlite_session.scalar(
            select(AppAnnotationHitHistory).where(AppAnnotationHitHistory.annotation_id == annotation.id)
        )
        assert history is not None
        assert (history.question, history.annotation_question, history.annotation_content, history.score) == (
            "user q",
            "q",
            "a",
            0.8,
        )
