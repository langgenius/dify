from __future__ import annotations

from datetime import datetime
from inspect import unwrap
from unittest.mock import Mock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.console.app import annotation as annotation_module
from models.account import Account
from models.model import App, AppAnnotationHitHistory, AppMode, IconType, MessageAnnotation
from services.app_ref_service import AnnotationRef, AppRef


def _persist_app(session: Session) -> App:
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Annotation app",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#ffffff",
        enable_site=False,
        enable_api=True,
    )
    session.add(app)
    session.commit()
    return app


def _account() -> Account:
    account = Account(name="Owner", email="owner@example.com")
    account.id = "account-1"
    return account


def _annotation_model(annotation_id: str = "ann-1") -> MessageAnnotation:
    annotation = MessageAnnotation(
        app_id="app-1",
        question="q",
        content="a",
        account_id="account-1",
    )
    annotation.id = annotation_id
    annotation.hit_count = 0
    annotation.created_at = datetime(2026, 1, 1)
    return annotation


def _annotation_hit_history() -> AppAnnotationHitHistory:
    history = AppAnnotationHitHistory(
        app_id="app-1",
        annotation_id="ann-1",
        source="hit-testing",
        score=0.9,
        question="q",
        annotation_question="q",
        annotation_content="a",
        account_id="account-1",
        message_id="message-1",
    )
    history.id = "history-1"
    history.created_at = datetime(2026, 1, 1)
    return history


def test_annotation_reply_payload_valid():
    """Test AnnotationReplyPayload with valid data."""
    payload = annotation_module.AnnotationReplyPayload(
        score_threshold=0.5,
        embedding_provider_name="openai",
        embedding_model_name="text-embedding-3-small",
    )
    assert payload.score_threshold == 0.5
    assert payload.embedding_provider_name == "openai"
    assert payload.embedding_model_name == "text-embedding-3-small"


def test_annotation_setting_update_payload_valid():
    """Test AnnotationSettingUpdatePayload with valid data."""
    payload = annotation_module.AnnotationSettingUpdatePayload(
        score_threshold=0.75,
    )
    assert payload.score_threshold == 0.75


def test_annotation_list_query_defaults():
    """Test AnnotationListQuery with default parameters."""
    query = annotation_module.AnnotationListQuery()
    assert query.page == 1
    assert query.limit == 20
    assert query.keyword == ""


def test_annotation_list_query_custom_page():
    """Test AnnotationListQuery with custom page."""
    query = annotation_module.AnnotationListQuery(page=3, limit=50)
    assert query.page == 3
    assert query.limit == 50


def test_annotation_list_query_with_keyword():
    """Test AnnotationListQuery with keyword."""
    query = annotation_module.AnnotationListQuery(keyword="test")
    assert query.keyword == "test"


def test_create_annotation_payload_with_message_id():
    """Test CreateAnnotationPayload with message ID."""
    payload = annotation_module.CreateAnnotationPayload(
        message_id="550e8400-e29b-41d4-a716-446655440000",
        question="What is AI?",
    )
    assert payload.message_id == "550e8400-e29b-41d4-a716-446655440000"
    assert payload.question == "What is AI?"


def test_create_annotation_payload_with_text():
    """Test CreateAnnotationPayload with text content."""
    payload = annotation_module.CreateAnnotationPayload(
        question="What is ML?",
        answer="Machine learning is...",
    )
    assert payload.question == "What is ML?"
    assert payload.answer == "Machine learning is..."


def test_update_annotation_payload():
    """Test UpdateAnnotationPayload."""
    payload = annotation_module.UpdateAnnotationPayload(
        question="Updated question",
        answer="Updated answer",
    )
    assert payload.question == "Updated question"
    assert payload.answer == "Updated answer"


def test_annotation_reply_status_query_enable():
    """Test AnnotationReplyStatusQuery with enable action."""
    query = annotation_module.AnnotationReplyStatusQuery(action="enable")
    assert query.action == "enable"


def test_annotation_reply_status_query_disable():
    """Test AnnotationReplyStatusQuery with disable action."""
    query = annotation_module.AnnotationReplyStatusQuery(action="disable")
    assert query.action == "disable"


def test_annotation_file_payload_valid():
    """Test AnnotationFilePayload with valid message ID."""
    payload = annotation_module.AnnotationFilePayload(message_id="550e8400-e29b-41d4-a716-446655440000")
    assert payload.message_id == "550e8400-e29b-41d4-a716-446655440000"


def test_get_app_ref_raises_not_found_when_app_is_not_in_current_tenant(sqlite_session: Session):
    _persist_app(sqlite_session)
    with (
        patch.object(
            annotation_module,
            "current_account_with_tenant",
            return_value=(_account(), "tenant-2"),
        ),
    ):
        with pytest.raises(NotFound):
            annotation_module._get_app_ref(sqlite_session, "app-1")


class TestConsoleAnnotationRefBoundaries:
    def test_batch_delete_uses_app_ref(self, app: Flask, sqlite_session: Session):
        api = annotation_module.AnnotationApi()
        handler = unwrap(api.delete)
        delete_mock = Mock()
        _persist_app(sqlite_session)

        with (
            app.test_request_context("/?annotation_id=ann-1&annotation_id=ann-2", method="DELETE"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(_account(), "tenant-1"),
            ),
            patch.object(annotation_module.AppAnnotationService, "delete_app_annotations_in_batch", delete_mock),
        ):
            response, status = handler(api, sqlite_session, "app-1")

        assert response == ""
        assert status == 204
        delete_mock.assert_called_once_with(AppRef("tenant-1", "app-1"), ["ann-1", "ann-2"], sqlite_session)

    def test_update_uses_annotation_ref(self, app: Flask, sqlite_session: Session):
        api = annotation_module.AnnotationUpdateDeleteApi()
        handler = unwrap(api.post)
        update_mock = Mock(return_value=_annotation_model())
        _persist_app(sqlite_session)

        with (
            app.test_request_context("/annotations/ann-1", method="POST", json={"question": "updated"}),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(_account(), "tenant-1"),
            ),
            patch.object(annotation_module.AppAnnotationService, "update_app_annotation_directly", update_mock),
        ):
            response = handler(
                api,
                annotation_module.UpdateAnnotationPayload(question="updated"),
                sqlite_session,
                "app-1",
                "ann-1",
            )

        assert response["question"] == "q"
        update_mock.assert_called_once()
        assert update_mock.call_args.args[1] == AnnotationRef(AppRef("tenant-1", "app-1"), "ann-1")
        assert update_mock.call_args.args[2] is sqlite_session

    def test_delete_uses_annotation_ref(self, app: Flask, sqlite_session: Session):
        api = annotation_module.AnnotationUpdateDeleteApi()
        handler = unwrap(api.delete)
        delete_mock = Mock()
        _persist_app(sqlite_session)

        with (
            app.test_request_context("/annotations/ann-1", method="DELETE"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(_account(), "tenant-1"),
            ),
            patch.object(annotation_module.AppAnnotationService, "delete_app_annotation", delete_mock),
        ):
            response, status = handler(api, sqlite_session, "app-1", "ann-1")

        assert response == ""
        assert status == 204
        delete_mock.assert_called_once()
        assert delete_mock.call_args.args[0] == AnnotationRef(AppRef("tenant-1", "app-1"), "ann-1")
        assert delete_mock.call_args.args[1] is sqlite_session

    def test_hit_history_uses_annotation_ref(self, app: Flask, sqlite_session: Session):
        api = annotation_module.AnnotationHitHistoryListApi()
        handler = unwrap(api.get)
        history = _annotation_hit_history()
        hit_history_mock = Mock(return_value=([history], 1))
        _persist_app(sqlite_session)

        with (
            app.test_request_context("/hit-histories?page=2&limit=5", method="GET"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(_account(), "tenant-1"),
            ),
            patch.object(annotation_module.AppAnnotationService, "get_annotation_hit_histories", hit_history_mock),
        ):
            response = handler(api, sqlite_session, "app-1", "ann-1")

        assert response["total"] == 1
        hit_history_mock.assert_called_once_with(
            AnnotationRef(AppRef("tenant-1", "app-1"), "ann-1"), 2, 5, sqlite_session
        )
