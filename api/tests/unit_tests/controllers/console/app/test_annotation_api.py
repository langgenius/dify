from __future__ import annotations

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import ANY, Mock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.console.app import annotation as annotation_module
from services.app_ref_service import AnnotationRef, AppRef


def _app_model() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", tenant_id="tenant-1", status="normal")


def _annotation_model(annotation_id: str = "ann-1") -> SimpleNamespace:
    return SimpleNamespace(id=annotation_id, question="q", content="a", hit_count=0, created_at=None)


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


def test_get_app_ref_raises_not_found_when_app_is_not_in_current_tenant():
    with (
        patch.object(
            annotation_module,
            "current_account_with_tenant",
            return_value=(SimpleNamespace(id="account-1"), "tenant-1"),
        ),
        patch.object(annotation_module.db.session, "scalar", return_value=None),
    ):
        with pytest.raises(NotFound):
            annotation_module._get_app_ref("app-1")


class TestConsoleAnnotationRefBoundaries:
    def test_batch_delete_uses_app_ref(self, app: Flask):
        api = annotation_module.AnnotationApi()
        handler = unwrap(api.delete)
        delete_mock = Mock()

        with (
            app.test_request_context("/?annotation_id=ann-1&annotation_id=ann-2", method="DELETE"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(SimpleNamespace(id="account-1"), "tenant-1"),
            ),
            patch.object(annotation_module.db.session, "scalar", return_value=_app_model()),
            patch.object(annotation_module.AppAnnotationService, "delete_app_annotations_in_batch", delete_mock),
        ):
            response, status = handler(api, "app-1")

        assert response == ""
        assert status == 204
        delete_mock.assert_called_once_with(AppRef("tenant-1", "app-1"), ["ann-1", "ann-2"], session=ANY)

    def test_update_uses_annotation_ref(self, app: Flask):
        api = annotation_module.AnnotationUpdateDeleteApi()
        handler = unwrap(api.post)
        update_mock = Mock(return_value=_annotation_model())
        payload = {"question": "updated"}

        with (
            app.test_request_context("/annotations/ann-1", method="POST", json=payload),
            patch.object(type(annotation_module.console_ns), "payload", payload),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(SimpleNamespace(id="account-1"), "tenant-1"),
            ),
            patch.object(annotation_module.db.session, "scalar", return_value=_app_model()),
            patch.object(annotation_module.AppAnnotationService, "update_app_annotation_directly", update_mock),
        ):
            response = handler(api, "app-1", "ann-1")

        assert response["question"] == "q"
        update_mock.assert_called_once()
        assert update_mock.call_args.args[1] == AnnotationRef("tenant-1", "app-1", "ann-1")

    def test_delete_uses_annotation_ref(self, app: Flask):
        api = annotation_module.AnnotationUpdateDeleteApi()
        handler = unwrap(api.delete)
        delete_mock = Mock()

        with (
            app.test_request_context("/annotations/ann-1", method="DELETE"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(SimpleNamespace(id="account-1"), "tenant-1"),
            ),
            patch.object(annotation_module.db.session, "scalar", return_value=_app_model()),
            patch.object(annotation_module.AppAnnotationService, "delete_app_annotation", delete_mock),
        ):
            response, status = handler(api, "app-1", "ann-1")

        assert response == ""
        assert status == 204
        delete_mock.assert_called_once()
        assert delete_mock.call_args.args[0] == AnnotationRef("tenant-1", "app-1", "ann-1")

    def test_hit_history_uses_annotation_ref(self, app: Flask):
        api = annotation_module.AnnotationHitHistoryListApi()
        handler = unwrap(api.get)
        history = SimpleNamespace(
            id="history-1",
            source="hit-testing",
            score=0.9,
            question="q",
            annotation_question="q",
            annotation_content="a",
            created_at=None,
        )
        hit_history_mock = Mock(return_value=([history], 1))

        with (
            app.test_request_context("/hit-histories?page=2&limit=5", method="GET"),
            patch.object(
                annotation_module,
                "current_account_with_tenant",
                return_value=(SimpleNamespace(id="account-1"), "tenant-1"),
            ),
            patch.object(annotation_module.db.session, "scalar", return_value=_app_model()),
            patch.object(annotation_module.AppAnnotationService, "get_annotation_hit_histories", hit_history_mock),
        ):
            response = handler(api, "app-1", "ann-1")

        assert response["total"] == 1
        hit_history_mock.assert_called_once_with(AnnotationRef("tenant-1", "app-1", "ann-1"), 2, 5, session=ANY)
