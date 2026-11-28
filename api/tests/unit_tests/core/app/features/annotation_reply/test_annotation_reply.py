import logging
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.annotation_reply import annotation_reply as annotation_reply_module
from core.app.features.annotation_reply.annotation_reply import AnnotationReplyFeature
from core.rag.models.document import Document
from models.dataset import Dataset, DatasetCollectionBinding
from models.enums import CollectionBindingType, ConversationFromSource
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, Message, MessageAnnotation
from tests.helpers.unit.model_factories import make_app, make_message

TABLES = (AppAnnotationSetting, DatasetCollectionBinding, MessageAnnotation, AppAnnotationHitHistory)


def _app() -> App:
    return make_app(icon_type=None, max_active_requests=0)


def _message() -> Message:
    return make_message(message_id="msg-1", app_id=None, conversation_id=None)


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


class _RecordingVectorIndex:
    """Stands in for ``Vector``: resolves a type, opens like the class, returns one hit.

    Records, when the index is opened and when it is searched, whether the caller's session and
    the feature's lookup sessions were in a transaction.
    """

    def __init__(self, *, annotation_id: str, caller_session: Session) -> None:
        self._annotation_id = annotation_id
        self._caller_session = caller_session
        self.lookup_sessions: list[Session] = []
        self.opened_with: list[tuple[Session | None, str]] = []
        self.in_transaction: list[tuple[str, bool, list[bool]]] = []

    def _record(self, moment: str) -> None:
        self.in_transaction.append(
            (
                moment,
                self._caller_session.in_transaction(),
                [session.in_transaction() for session in self.lookup_sessions],
            )
        )

    def resolve_vector_type(self, dataset: Dataset, *, session: Session) -> str:
        assert dataset.indexing_technique == "high_quality"
        self.lookup_sessions.append(session)
        return "weaviate"

    def __call__(
        self, dataset: Dataset, *, attributes: list[str], session: Session | None, vector_type: str
    ) -> "_RecordingVectorIndex":
        assert dataset.embedding_model == "model"
        assert attributes == ["doc_id", "annotation_id", "app_id"]
        self.opened_with.append((session, vector_type))
        self._record("open")
        return self

    def search_by_vector(self, **kwargs: object) -> list[Document]:
        assert kwargs["query"] == "hi"
        self._record("search")
        return [Document(page_content="", metadata={"annotation_id": self._annotation_id, "score": 0.9})]


@pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
class TestAnnotationReplyFeature:
    def test_query_holds_no_session_while_the_index_is_opened_and_searched(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Opening and searching the index wait on the vector store and the embedding model.

        No pooled connection may wait with them: not the caller's, and not the feature's own.
        """
        binding = _persist_binding(sqlite_session)
        _persist_setting(sqlite_session, collection_binding_id=binding.id)
        annotation = _persist_annotation(sqlite_session)
        sqlite_session.commit()
        index = _RecordingVectorIndex(annotation_id=annotation.id, caller_session=sqlite_session)
        monkeypatch.setattr(annotation_reply_module, "Vector", index)

        result = AnnotationReplyFeature().query(
            app_record=_app(),
            message=_message(),
            query="hi",
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
            session=sqlite_session,
        )

        assert index.opened_with == [(None, "weaviate")]
        assert index.in_transaction == [("open", False, [False]), ("search", False, [False])]
        assert result is annotation
        # The hit is recorded on the caller's session, which the caller commits.
        assert sqlite_session.in_transaction()
        history = sqlite_session.scalar(select(AppAnnotationHitHistory))
        assert history is not None
        assert history.annotation_id == annotation.id

    def test_query_returns_none_when_setting_missing(self, sqlite_session: Session) -> None:
        binding = _persist_binding(sqlite_session)
        _persist_setting(sqlite_session, app_id="other-app", collection_binding_id=binding.id)
        sqlite_session.commit()

        result = AnnotationReplyFeature().query(
            app_record=_app(),
            message=_message(),
            query="hi",
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
            session=sqlite_session,
        )

        assert result is None

    def test_query_returns_none_when_binding_missing(self, sqlite_session: Session) -> None:
        _persist_setting(sqlite_session, collection_binding_id="missing-binding")
        sqlite_session.commit()

        result = AnnotationReplyFeature().query(
            app_record=_app(),
            message=_message(),
            query="hi",
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
            session=sqlite_session,
        )

        assert result is None

    def test_query_returns_annotation_and_persists_history_for_api(self, sqlite_session: Session) -> None:
        binding = _persist_binding(sqlite_session)
        _persist_setting(sqlite_session, collection_binding_id=binding.id, score_threshold=0)
        annotation = _persist_annotation(sqlite_session)
        sqlite_session.commit()
        document = SimpleNamespace(metadata={"annotation_id": annotation.id, "score": 0.8})
        vector_instance = Mock()
        vector_instance.search_by_vector.return_value = [document]

        with patch(
            "core.app.features.annotation_reply.annotation_reply.Vector", return_value=vector_instance
        ) as vector_cls:
            result = AnnotationReplyFeature().query(
                app_record=_app(),
                message=_message(),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.SERVICE_API,
                session=sqlite_session,
            )

        assert result is annotation
        vector_instance.search_by_vector.assert_called_once_with(
            query="hi", top_k=1, score_threshold=1, filter={"group_id": ["app-1"]}
        )
        # The index is opened with no session at all, once the vector type is known.
        assert vector_cls.call_args.kwargs["session"] is None
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

    def test_query_returns_annotation_and_persists_history_for_console(self, sqlite_session: Session) -> None:
        binding = _persist_binding(sqlite_session)
        _persist_setting(sqlite_session, collection_binding_id=binding.id)
        annotation = _persist_annotation(sqlite_session)
        sqlite_session.commit()
        document = SimpleNamespace(metadata={"annotation_id": annotation.id, "score": 0.6})
        vector_instance = Mock()
        vector_instance.search_by_vector.return_value = [document]

        with patch("core.app.features.annotation_reply.annotation_reply.Vector", return_value=vector_instance):
            result = AnnotationReplyFeature().query(
                app_record=_app(),
                message=_message(),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.EXPLORE,
                session=sqlite_session,
            )

        assert result is annotation
        history = sqlite_session.scalar(select(AppAnnotationHitHistory))
        assert history is not None
        assert history.source == ConversationFromSource.CONSOLE

    def test_query_logs_and_returns_none_when_the_vector_store_is_not_configured(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """A failure while the settings are looked up is logged, and the caller's session is left alone."""
        binding = _persist_binding(sqlite_session)
        _persist_setting(sqlite_session, collection_binding_id=binding.id)
        sqlite_session.commit()
        monkeypatch.setattr(dify_config, "VECTOR_STORE", None)

        with caplog.at_level(logging.WARNING):
            result = AnnotationReplyFeature().query(
                app_record=_app(),
                message=_message(),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.SERVICE_API,
                session=sqlite_session,
            )

        assert result is None
        assert "Query annotation failed" in caplog.text
        assert "Vector store must be specified." in caplog.text
        assert not sqlite_session.in_transaction()

    def test_query_logs_and_returns_none_on_exception(
        self, sqlite_session: Session, caplog: pytest.LogCaptureFixture
    ) -> None:
        binding = _persist_binding(sqlite_session)
        _persist_setting(sqlite_session, collection_binding_id=binding.id)
        sqlite_session.commit()
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
                app_record=_app(),
                message=_message(),
                query="hi",
                user_id="user-1",
                invoke_from=InvokeFrom.SERVICE_API,
                session=sqlite_session,
            )

        assert result is None
        assert "Query annotation failed" in caplog.text
        assert sqlite_session.scalar(select(AppAnnotationHitHistory)) is None
        assert sqlite_session.is_active
