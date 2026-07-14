import logging
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.annotation_reply.annotation_reply import AnnotationReplyFeature
from models.dataset import DatasetCollectionBinding
from models.enums import CollectionBindingType, ConversationFromSource
from models.model import AppAnnotationHitHistory, AppAnnotationSetting, MessageAnnotation

TABLES = (AppAnnotationSetting, DatasetCollectionBinding, MessageAnnotation, AppAnnotationHitHistory)


def _persist_binding(session: Session) -> DatasetCollectionBinding:
    binding = DatasetCollectionBinding(
        provider_name="prov",
        model_name="model",
        type=CollectionBindingType.ANNOTATION,
        collection_name="annotation-collection",
    )
    session.add(binding)
    session.flush()
    return binding


def _persist_setting(
    session: Session,
    *,
    app_id: str = "app-1",
    collection_binding_id: str,
    score_threshold: float = 0.5,
) -> AppAnnotationSetting:
    setting = AppAnnotationSetting(
        app_id=app_id,
        score_threshold=score_threshold,
        collection_binding_id=collection_binding_id,
        created_user_id="user-1",
        updated_user_id="user-1",
    )
    session.add(setting)
    session.flush()
    return setting


def _persist_annotation(session: Session) -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id="app-1",
        question="question",
        content="content",
        account_id="acct-1",
    )
    session.add(annotation)
    session.flush()
    return annotation


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
class TestAnnotationReplyFeature:
    def test_query_returns_none_when_setting_missing(self, sqlite_session: Session):
        binding = _persist_binding(sqlite_session)
        _persist_setting(sqlite_session, app_id="other-app", collection_binding_id=binding.id)

        result = AnnotationReplyFeature().query(
            app_record=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
            message=SimpleNamespace(id="msg-1"),
            query="hi",
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
            session=sqlite_session,
        )

        assert result is None

    def test_query_returns_none_when_binding_missing(self, sqlite_session: Session):
        _persist_setting(sqlite_session, collection_binding_id="missing-binding")

        result = AnnotationReplyFeature().query(
            app_record=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
            message=SimpleNamespace(id="msg-1"),
            query="hi",
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
            session=sqlite_session,
        )

        assert result is None

    def test_query_returns_annotation_and_persists_history_for_api(self, sqlite_session: Session):
        binding = _persist_binding(sqlite_session)
        _persist_setting(sqlite_session, collection_binding_id=binding.id, score_threshold=0)
        annotation = _persist_annotation(sqlite_session)
        document = SimpleNamespace(metadata={"annotation_id": annotation.id, "score": 0.8})
        vector_instance = Mock()
        vector_instance.search_by_vector.return_value = [document]

        with patch("core.app.features.annotation_reply.annotation_reply.Vector", return_value=vector_instance):
            result = AnnotationReplyFeature().query(
                app_record=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
                message=SimpleNamespace(id="msg-1"),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.SERVICE_API,
                session=sqlite_session,
            )

        assert result is annotation
        vector_instance.search_by_vector.assert_called_once_with(
            query="hi", top_k=1, score_threshold=1, filter={"group_id": ["app-1"]}
        )
        sqlite_session.refresh(annotation)
        assert annotation.hit_count == 1
        history = sqlite_session.scalar(select(AppAnnotationHitHistory))
        assert history is not None
        assert history.annotation_id == annotation.id
        assert history.app_id == "app-1"
        assert history.message_id == "msg-1"
        assert history.account_id == "user-1"
        assert history.source == ConversationFromSource.API
        assert history.score == 0.8

    def test_query_returns_annotation_and_persists_history_for_console(self, sqlite_session: Session):
        binding = _persist_binding(sqlite_session)
        _persist_setting(sqlite_session, collection_binding_id=binding.id)
        annotation = _persist_annotation(sqlite_session)
        document = SimpleNamespace(metadata={"annotation_id": annotation.id, "score": 0.6})
        vector_instance = Mock()
        vector_instance.search_by_vector.return_value = [document]

        with patch("core.app.features.annotation_reply.annotation_reply.Vector", return_value=vector_instance):
            result = AnnotationReplyFeature().query(
                app_record=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
                message=SimpleNamespace(id="msg-1"),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.EXPLORE,
                session=sqlite_session,
            )

        assert result is annotation
        history = sqlite_session.scalar(select(AppAnnotationHitHistory))
        assert history is not None
        assert history.source == ConversationFromSource.CONSOLE

    def test_query_logs_and_returns_none_on_exception(self, sqlite_session: Session, caplog: pytest.LogCaptureFixture):
        binding = _persist_binding(sqlite_session)
        _persist_setting(sqlite_session, collection_binding_id=binding.id)
        vector_instance = Mock()
        vector_instance.search_by_vector.side_effect = RuntimeError("boom")

        with (
            patch(
                "core.app.features.annotation_reply.annotation_reply.Vector",
                return_value=vector_instance,
            ),
            caplog.at_level(logging.WARNING),
        ):
            result = AnnotationReplyFeature().query(
                app_record=SimpleNamespace(id="app-1", tenant_id="tenant-1"),
                message=SimpleNamespace(id="msg-1"),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.SERVICE_API,
                session=sqlite_session,
            )

        assert result is None
        assert "Query annotation failed" in caplog.text
        assert sqlite_session.scalar(select(AppAnnotationHitHistory)) is None
        assert sqlite_session.is_active
