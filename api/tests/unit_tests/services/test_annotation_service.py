"""SQLite-backed unit tests for :mod:`services.annotation_service`."""

# Test functions explicitly request the identity fixture to make the patched
# request context visible at each service call, even when they do not inspect it.
# ruff: noqa: ARG002

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from decimal import Decimal
from io import BytesIO
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import NotFound

import services.annotation_service as annotation_service_module
from models.account import Account
from models.dataset import DatasetCollectionBinding
from models.enums import CollectionBindingType
from models.model import (
    App,
    AppAnnotationHitHistory,
    AppAnnotationSetting,
    AppMode,
    ConversationFromSource,
    IconType,
    Message,
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


def _persist_message(
    session: Session,
    app: App,
    *,
    message_id: str = "msg-1",
    query: str = "default-question",
) -> Message:
    message = Message(
        id=message_id,
        app_id=app.id,
        conversation_id="conv-1",
        _inputs={},
        query=query,
        message={},
        message_unit_price=Decimal(0),
        answer="answer",
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
    )
    session.add(message)
    session.commit()
    return message


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


def _persist_binding(
    session: Session,
    *,
    binding_id: str = "collection-1",
    provider_name: str = "provider-a",
    model_name: str = "model-a",
) -> DatasetCollectionBinding:
    binding = DatasetCollectionBinding(
        provider_name=provider_name,
        model_name=model_name,
        type=CollectionBindingType.ANNOTATION,
        collection_name=f"collection-{binding_id}",
    )
    binding.id = binding_id
    session.add(binding)
    session.commit()
    return binding


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


def _file(content: bytes) -> FileStorage:
    return FileStorage(stream=BytesIO(content))


def _observer_get(factory: sessionmaker[Session], model: type[Any], identifier: str) -> Any:
    with factory() as observer:
        return observer.get(model, identifier)


class TestAppAnnotationServiceUpsert:
    def test_rejects_missing_or_cross_tenant_app(self, sqlite_session: Session, current_user: Account) -> None:
        _persist_app(sqlite_session, app_id="other-app", tenant_id=OTHER_TENANT_ID)

        with pytest.raises(NotFound):
            AppAnnotationService.up_insert_app_annotation_from_message(
                {"answer": "hello", "question": "q"}, "other-app", sqlite_session
            )

    def test_validates_answer_and_question(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)

        with pytest.raises(ValueError, match="answer.*content"):
            AppAnnotationService.up_insert_app_annotation_from_message({"question": "q"}, app.id, sqlite_session)
        with pytest.raises(ValueError, match="question"):
            AppAnnotationService.up_insert_app_annotation_from_message({"answer": "a"}, app.id, sqlite_session)

    def test_rejects_message_from_another_app(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        other_app = _persist_app(sqlite_session, app_id="app-2")
        message = _persist_message(sqlite_session, other_app)

        with pytest.raises(NotFound, match="Message"):
            AppAnnotationService.up_insert_app_annotation_from_message(
                {"answer": "hello", "message_id": message.id}, app.id, sqlite_session
            )

    def test_updates_existing_message_annotation_and_enqueues_index(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        current_user: Account,
    ) -> None:
        app = _persist_app(sqlite_session)
        message = _persist_message(sqlite_session, app)
        annotation = _persist_annotation(sqlite_session, app, message_id=message.id, content="old")
        setting = _persist_setting(sqlite_session, app)

        with patch.object(annotation_service_module, "add_annotation_to_index_task") as task:
            result = AppAnnotationService.up_insert_app_annotation_from_message(
                {"answer": "updated", "message_id": message.id}, app.id, sqlite_session
            )

        assert result.id == annotation.id
        stored = _observer_get(sqlite_session_factory, MessageAnnotation, annotation.id)
        assert stored is not None
        assert (stored.question, stored.content) == (message.query, "updated")
        task.delay.assert_called_once_with(
            annotation.id, message.query, TENANT_ID, app.id, setting.collection_binding_id
        )

    def test_creates_message_annotation_without_setting(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        current_user: Account,
    ) -> None:
        app = _persist_app(sqlite_session)
        message = _persist_message(sqlite_session, app)

        with patch.object(annotation_service_module, "add_annotation_to_index_task") as task:
            result = AppAnnotationService.up_insert_app_annotation_from_message(
                {"answer": "hello", "question": "override", "message_id": message.id}, app.id, sqlite_session
            )

        stored = _observer_get(sqlite_session_factory, MessageAnnotation, result.id)
        assert stored is not None
        assert (stored.app_id, stored.message_id, stored.question, stored.content) == (
            app.id,
            message.id,
            "override",
            "hello",
        )
        assert stored.account_id == current_user.id
        task.delay.assert_not_called()

    def test_creates_direct_annotation_and_enqueues_index(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        current_user: Account,
    ) -> None:
        app = _persist_app(sqlite_session)
        setting = _persist_setting(sqlite_session, app)

        with patch.object(annotation_service_module, "add_annotation_to_index_task") as task:
            result = AppAnnotationService.up_insert_app_annotation_from_message(
                {"answer": "hello", "question": "q1"}, app.id, sqlite_session
            )

        stored = _observer_get(sqlite_session_factory, MessageAnnotation, result.id)
        assert stored is not None
        assert (stored.conversation_id, stored.message_id, stored.question, stored.content) == (
            None,
            None,
            "q1",
            "hello",
        )
        task.delay.assert_called_once_with(result.id, "q1", TENANT_ID, app.id, setting.collection_binding_id)


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

    def test_enable_enqueues_on_cache_miss(self, current_user: Account) -> None:
        args = {"score_threshold": 0.5, "embedding_provider_name": "p", "embedding_model_name": "m"}
        with (
            patch.object(annotation_service_module, "redis_client") as redis,
            patch.object(annotation_service_module.uuid, "uuid4", return_value="uuid-1"),
            patch.object(annotation_service_module, "enable_annotation_reply_task") as task,
        ):
            redis.get.return_value = None
            result = AppAnnotationService.enable_app_annotation(args, "app-1")

        assert result == {"job_id": "uuid-1", "job_status": "waiting"}
        redis.setnx.assert_called_once_with("enable_app_annotation_job_uuid-1", "waiting")
        task.delay.assert_called_once_with("uuid-1", "app-1", current_user.id, TENANT_ID, 0.5, "p", "m")

    def test_disable_returns_processing_on_cache_hit(self, current_user: Account) -> None:
        with (
            patch.object(annotation_service_module, "redis_client") as redis,
            patch.object(annotation_service_module, "disable_annotation_reply_task") as task,
        ):
            redis.get.return_value = "job-2"
            result = AppAnnotationService.disable_app_annotation("app-1")

        assert result == {"job_id": "job-2", "job_status": "processing"}
        task.delay.assert_not_called()

    def test_disable_enqueues_on_cache_miss(self, current_user: Account) -> None:
        with (
            patch.object(annotation_service_module, "redis_client") as redis,
            patch.object(annotation_service_module.uuid, "uuid4", return_value="uuid-2"),
            patch.object(annotation_service_module, "disable_annotation_reply_task") as task,
        ):
            redis.get.return_value = None
            result = AppAnnotationService.disable_app_annotation("app-1")

        assert result == {"job_id": "uuid-2", "job_status": "waiting"}
        redis.setnx.assert_called_once_with("disable_app_annotation_job_uuid-2", "waiting")
        task.delay.assert_called_once_with("uuid-2", "app-1", TENANT_ID)


class TestAppAnnotationServiceListAndExport:
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

    def test_export_sanitizes_and_scopes_rows(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        other_app = _persist_app(sqlite_session, app_id="app-2")
        first = _persist_annotation(sqlite_session, app, annotation_id="ann-1", question="=cmd", content="+1")
        second = _persist_annotation(sqlite_session, app, annotation_id="ann-2", question="@bad", content="-2")
        _persist_annotation(sqlite_session, other_app, annotation_id="decoy", question="=decoy")

        result = AppAnnotationService.export_annotation_list_by_app_id(app.id, sqlite_session)

        assert {annotation.id for annotation in result} == {first.id, second.id}
        assert {(annotation.question, annotation.content) for annotation in result} == {
            ("'=cmd", "'+1"),
            ("'@bad", "'-2"),
        }


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

    def test_batch_delete_returns_zero_without_matching_rows(
        self, sqlite_session: Session, current_user: Account
    ) -> None:
        app = _persist_app(sqlite_session)
        other_app = _persist_app(sqlite_session, app_id="app-2")
        _persist_annotation(sqlite_session, other_app, annotation_id="ann-1")

        result = AppAnnotationService.delete_app_annotations_in_batch(_app_ref(app), ["ann-1"], sqlite_session)

        assert result == {"deleted_count": 0}

    def test_batch_delete_scopes_rows_and_histories(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        current_user: Account,
    ) -> None:
        app = _persist_app(sqlite_session)
        other_app = _persist_app(sqlite_session, app_id="app-2")
        annotation1 = _persist_annotation(sqlite_session, app, annotation_id="ann-1")
        annotation2 = _persist_annotation(sqlite_session, app, annotation_id="ann-2")
        decoy = _persist_annotation(sqlite_session, other_app, annotation_id="ann-3")
        history1 = _persist_history(sqlite_session, app, annotation1, history_id="history-1")
        history2 = _persist_history(sqlite_session, app, annotation2, history_id="history-2")
        decoy_history = _persist_history(sqlite_session, other_app, decoy, history_id="history-3")
        setting = _persist_setting(sqlite_session, app)

        with patch.object(annotation_service_module, "delete_annotation_index_task") as task:
            result = AppAnnotationService.delete_app_annotations_in_batch(
                _app_ref(app), [annotation1.id, annotation2.id, decoy.id], sqlite_session
            )

        assert result == {"deleted_count": 2}
        with sqlite_session_factory() as observer:
            assert [observer.get(MessageAnnotation, item.id) for item in (annotation1, annotation2)] == [None, None]
            assert [observer.get(AppAnnotationHitHistory, item.id) for item in (history1, history2)] == [None, None]
            assert observer.get(MessageAnnotation, decoy.id) is not None
            assert observer.get(AppAnnotationHitHistory, decoy_history.id) is not None
        assert task.delay.call_count == 2
        task.delay.assert_any_call(annotation1.id, app.id, TENANT_ID, setting.collection_binding_id)
        task.delay.assert_any_call(annotation2.id, app.id, TENANT_ID, setting.collection_binding_id)


class TestAppAnnotationServiceBatchImport:
    @staticmethod
    def _invoke(
        sqlite_session: Session,
        app: App,
        *,
        dataframe: Any,
        content: bytes = b"question,answer\nq,a\n",
        maximum: int = 5,
        minimum: int = 1,
        features: Any | None = None,
    ) -> dict[str, Any]:
        if features is None:
            features = SimpleNamespace(billing=SimpleNamespace(enabled=False), annotation_quota_limit=None)
        with (
            patch.object(annotation_service_module.pd, "read_csv", return_value=dataframe),
            patch.object(annotation_service_module.FeatureService, "get_features", return_value=features),
            patch(
                "configs.dify_config",
                new=SimpleNamespace(
                    ANNOTATION_IMPORT_MAX_RECORDS=maximum,
                    ANNOTATION_IMPORT_MIN_RECORDS=minimum,
                ),
            ),
        ):
            return AppAnnotationService.batch_import_app_annotations(app.id, _file(content), sqlite_session)

    def test_rejects_cross_tenant_app(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session, tenant_id=OTHER_TENANT_ID)

        with pytest.raises(NotFound):
            AppAnnotationService.batch_import_app_annotations(app.id, _file(b"question,answer\nq,a\n"), sqlite_session)

    @pytest.mark.parametrize(
        ("dataframe", "content", "maximum", "minimum", "expected"),
        [
            (pd.DataFrame({"q": ["only"]}), b"question\nq\n", 5, 1, "Invalid CSV format"),
            (pd.DataFrame({"q": ["q"], "a": ["a"]}), b"", 5, 1, "empty or invalid"),
            (pd.DataFrame({"q": ["q"], "a": ["a"]}), b"question,answer\nq,a\n", 5, 2, "at least"),
            (
                pd.DataFrame({"q": ["q1", "q2"], "a": ["a1", "a2"]}),
                b"question,answer\nq1,a1\nq2,a2\n",
                1,
                1,
                "too many records",
            ),
            (pd.DataFrame({"q": ["nan"], "a": ["nan"]}), b"question,answer\nnan,nan\n", 5, 1, "at least"),
            (
                pd.DataFrame({"q": ["q" * 2001], "a": ["a"]}),
                b"question,answer\nq,a\n",
                5,
                1,
                "Question at row",
            ),
            (
                pd.DataFrame({"q": ["q"], "a": ["a" * 10001]}),
                b"question,answer\nq,a\n",
                5,
                1,
                "Answer at row",
            ),
        ],
    )
    def test_validation_errors(
        self,
        sqlite_session: Session,
        current_user: Account,
        dataframe: pd.DataFrame,
        content: bytes,
        maximum: int,
        minimum: int,
        expected: str,
    ) -> None:
        app = _persist_app(sqlite_session)

        result = self._invoke(
            sqlite_session,
            app,
            dataframe=dataframe,
            content=content,
            maximum=maximum,
            minimum=minimum,
        )

        assert expected in cast(str, result["error_msg"])

    def test_skips_malformed_rows(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        malformed_row = MagicMock()
        malformed_row.iloc.__getitem__.side_effect = IndexError()
        dataframe = MagicMock()
        dataframe.columns = ["q", "a"]
        dataframe.iterrows.return_value = [(0, malformed_row)]

        result = self._invoke(sqlite_session, app, dataframe=dataframe)

        assert "at least" in cast(str, result["error_msg"])

    def test_rejects_subscription_quota_overflow(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=True),
            annotation_quota_limit=SimpleNamespace(limit=1, size=1),
        )

        result = self._invoke(
            sqlite_session,
            app,
            dataframe=pd.DataFrame({"q": ["q1"], "a": ["a1"]}),
            features=features,
        )

        assert "exceeds the limit" in cast(str, result["error_msg"])

    def test_valid_import_enqueues_job(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        dataframe = pd.DataFrame({"q": ["q1"], "a": ["a1"]})
        features = SimpleNamespace(billing=SimpleNamespace(enabled=False), annotation_quota_limit=None)
        with (
            patch.object(annotation_service_module.pd, "read_csv", return_value=dataframe),
            patch.object(annotation_service_module.FeatureService, "get_features", return_value=features),
            patch.object(annotation_service_module, "batch_import_annotations_task") as task,
            patch.object(annotation_service_module, "redis_client") as redis,
            patch.object(annotation_service_module.uuid, "uuid4", return_value="uuid-3"),
            patch.object(annotation_service_module, "naive_utc_now", return_value=datetime.fromtimestamp(1)),
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=5, ANNOTATION_IMPORT_MIN_RECORDS=1),
            ),
        ):
            result = AppAnnotationService.batch_import_app_annotations(
                app.id, _file(b"question,answer\nq,a\n"), sqlite_session
            )

        assert result == {"job_id": "uuid-3", "job_status": "waiting", "record_count": 1}
        redis.zadd.assert_called_once_with(f"annotation_import_active:{TENANT_ID}", {"uuid-3": 1000})
        redis.expire.assert_called_once_with(f"annotation_import_active:{TENANT_ID}", 7200)
        redis.setnx.assert_called_once_with("app_annotation_batch_import_uuid-3", "waiting")
        task.delay.assert_called_once_with(
            "uuid-3", [{"question": "q1", "answer": "a1"}], app.id, TENANT_ID, current_user.id
        )

    def test_unexpected_error_cleans_active_job(
        self, sqlite_session: Session, current_user: Account, caplog: pytest.LogCaptureFixture
    ) -> None:
        app = _persist_app(sqlite_session)
        dataframe = pd.DataFrame({"q": ["q1"], "a": ["a1"]})
        features = SimpleNamespace(billing=SimpleNamespace(enabled=False), annotation_quota_limit=None)
        with (
            patch.object(annotation_service_module.pd, "read_csv", return_value=dataframe),
            patch.object(annotation_service_module.FeatureService, "get_features", return_value=features),
            patch.object(annotation_service_module, "redis_client") as redis,
            patch.object(annotation_service_module.uuid, "uuid4", return_value="uuid-4"),
            patch.object(annotation_service_module, "naive_utc_now", return_value=datetime.fromtimestamp(1)),
            patch(
                "configs.dify_config",
                new=SimpleNamespace(ANNOTATION_IMPORT_MAX_RECORDS=5, ANNOTATION_IMPORT_MIN_RECORDS=1),
            ),
        ):
            redis.zadd.side_effect = RuntimeError("boom")
            redis.zrem.side_effect = RuntimeError("cleanup-failed")
            with caplog.at_level(logging.DEBUG):
                result = AppAnnotationService.batch_import_app_annotations(
                    app.id, _file(b"question,answer\nq,a\n"), sqlite_session
                )

        assert result["error_msg"] == "An error occurred while processing the file: boom"
        redis.zrem.assert_called_once_with(f"annotation_import_active:{TENANT_ID}", "uuid-4")
        assert "Failed to clean up active job tracking" in caplog.text


class TestAppAnnotationServiceHitHistoryAndSettings:
    def test_hit_histories_are_annotation_and_app_scoped(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        other_app = _persist_app(sqlite_session, app_id="app-2")
        other_annotation = _persist_annotation(sqlite_session, other_app)

        with pytest.raises(NotFound):
            AppAnnotationService.get_annotation_hit_histories(
                _annotation_ref(app, other_annotation.id), 1, 10, sqlite_session
            )

        annotation = _persist_annotation(sqlite_session, app, annotation_id="own-ann")
        now = datetime(2026, 1, 1)
        old = _persist_history(sqlite_session, app, annotation, history_id="old", created_at=now)
        new = _persist_history(sqlite_session, app, annotation, history_id="new", created_at=now + timedelta(seconds=1))
        _persist_history(sqlite_session, other_app, other_annotation, history_id="decoy")

        items, total = AppAnnotationService.get_annotation_hit_histories(
            _annotation_ref(app, annotation.id), 1, 1, sqlite_session
        )
        assert total == 2
        assert [item.id for item in items] == [new.id]
        items, total = AppAnnotationService.get_annotation_hit_histories(
            _annotation_ref(app, annotation.id), 2, 1, sqlite_session
        )
        assert total == 2
        assert [item.id for item in items] == [old.id]

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

    def test_get_setting_rejects_cross_tenant_app(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session, tenant_id=OTHER_TENANT_ID)

        with pytest.raises(NotFound):
            AppAnnotationService.get_app_annotation_setting_by_app_id(app.id, sqlite_session)

    def test_get_setting_returns_disabled_without_row(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)

        assert AppAnnotationService.get_app_annotation_setting_by_app_id(app.id, sqlite_session) == {"enabled": False}

    def test_get_setting_returns_binding_detail(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        binding = _persist_binding(sqlite_session)
        setting = _persist_setting(sqlite_session, app, binding_id=binding.id)

        result = AppAnnotationService.get_app_annotation_setting_by_app_id(app.id, sqlite_session)

        assert result == {
            "id": setting.id,
            "enabled": True,
            "score_threshold": 0.5,
            "embedding_model": {
                "embedding_provider_name": binding.provider_name,
                "embedding_model_name": binding.model_name,
            },
        }

    def test_get_setting_returns_empty_detail_for_missing_binding(
        self, sqlite_session: Session, current_user: Account
    ) -> None:
        app = _persist_app(sqlite_session)
        setting = _persist_setting(sqlite_session, app, binding_id="missing-binding")

        result = AppAnnotationService.get_app_annotation_setting_by_app_id(app.id, sqlite_session)

        assert result == {
            "id": setting.id,
            "enabled": True,
            "score_threshold": 0.5,
            "embedding_model": {},
        }

    def test_update_setting_is_app_scoped(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session)
        other_app = _persist_app(sqlite_session, app_id="app-2")
        other_setting = _persist_setting(sqlite_session, other_app)

        with pytest.raises(NotFound):
            AppAnnotationService.update_app_annotation_setting(
                app.id, other_setting.id, {"score_threshold": 0.8}, sqlite_session
            )

    def test_update_setting_flushes_changes_and_returns_binding(
        self, sqlite_session: Session, current_user: Account
    ) -> None:
        app = _persist_app(sqlite_session)
        binding = _persist_binding(sqlite_session)
        setting = _persist_setting(sqlite_session, app, binding_id=binding.id)

        result = AppAnnotationService.update_app_annotation_setting(
            app.id, setting.id, {"score_threshold": 0.8}, sqlite_session
        )

        assert result["enabled"] is True
        assert result["score_threshold"] == 0.8
        assert result["embedding_model"] == {
            "embedding_provider_name": binding.provider_name,
            "embedding_model_name": binding.model_name,
        }
        assert setting.score_threshold == 0.8
        assert setting.updated_user_id == current_user.id

    def test_update_setting_returns_empty_detail_for_missing_binding(
        self, sqlite_session: Session, current_user: Account
    ) -> None:
        app = _persist_app(sqlite_session)
        setting = _persist_setting(sqlite_session, app, binding_id="missing-binding")

        result = AppAnnotationService.update_app_annotation_setting(
            app.id, setting.id, {"score_threshold": 0.7}, sqlite_session
        )

        assert result["score_threshold"] == 0.7
        assert result["embedding_model"] == {}


class TestAppAnnotationServiceClearAll:
    def test_clear_all_deletes_only_app_rows_and_enqueues_indexes(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        current_user: Account,
    ) -> None:
        app = _persist_app(sqlite_session)
        other_app = _persist_app(sqlite_session, app_id="app-2")
        annotations = [
            _persist_annotation(sqlite_session, app, annotation_id="ann-1"),
            _persist_annotation(sqlite_session, app, annotation_id="ann-2"),
        ]
        histories = [
            _persist_history(sqlite_session, app, annotations[0], history_id="history-1"),
            _persist_history(sqlite_session, app, annotations[1], history_id="history-2"),
        ]
        decoy = _persist_annotation(sqlite_session, other_app, annotation_id="decoy")
        decoy_history = _persist_history(sqlite_session, other_app, decoy, history_id="decoy-history")
        setting = _persist_setting(sqlite_session, app)

        with patch.object(annotation_service_module, "delete_annotation_index_task") as task:
            result = AppAnnotationService.clear_all_annotations(app.id, sqlite_session)

        assert result == {"result": "success"}
        with sqlite_session_factory() as observer:
            assert [observer.get(MessageAnnotation, item.id) for item in annotations] == [None, None]
            assert [observer.get(AppAnnotationHitHistory, item.id) for item in histories] == [None, None]
            assert observer.get(MessageAnnotation, decoy.id) is not None
            assert observer.get(AppAnnotationHitHistory, decoy_history.id) is not None
        assert task.delay.call_count == 2
        for annotation in annotations:
            task.delay.assert_any_call(annotation.id, app.id, TENANT_ID, setting.collection_binding_id)

    def test_clear_all_rejects_cross_tenant_app(self, sqlite_session: Session, current_user: Account) -> None:
        app = _persist_app(sqlite_session, tenant_id=OTHER_TENANT_ID)

        with pytest.raises(NotFound):
            AppAnnotationService.clear_all_annotations(app.id, sqlite_session)

        assert sqlite_session.scalar(select(func.count()).select_from(MessageAnnotation)) == 0
