from __future__ import annotations

from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from controllers.console.app import annotation as annotation_module


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


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


def test_annotation_reply_action_enable(app, monkeypatch: pytest.MonkeyPatch) -> None:
    enable_mock = Mock()
    monkeypatch.setattr(annotation_module.AppAnnotationService, "enable_app_annotation", enable_mock)

    api = annotation_module.AnnotationReplyActionApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/annotation-reply/enable",
        method="POST",
        json={"score_threshold": 0.5, "embedding_provider_name": "p", "embedding_model_name": "m"},
    ):
        response, status = handler(api, app_id="app", action="enable")

    assert status == 200
    enable_mock.assert_called_once()


def test_annotation_reply_status_missing_job(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(annotation_module.redis_client, "get", lambda *_args, **_kwargs: None)

    api = annotation_module.AnnotationReplyActionStatusApi()
    handler = _unwrap(api.get)

    with pytest.raises(ValueError):
        handler(api, app_id="app", job_id="job", action="enable")


def test_annotation_reply_status_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def _get(key):
        if "error" in key:
            return b"oops"
        return b"error"

    monkeypatch.setattr(annotation_module.redis_client, "get", _get)

    api = annotation_module.AnnotationReplyActionStatusApi()
    handler = _unwrap(api.get)

    response, status = handler(api, app_id="app", job_id="job", action="enable")

    assert status == 200
    assert response["error_msg"] == "oops"


def test_annotation_setting_update(app, monkeypatch: pytest.MonkeyPatch) -> None:
    update_mock = Mock(return_value={"result": "ok"})
    monkeypatch.setattr(annotation_module.AppAnnotationService, "update_app_annotation_setting", update_mock)

    api = annotation_module.AppAnnotationSettingUpdateApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/annotation-settings/1",
        method="POST",
        json={"score_threshold": 0.5},
    ):
        response, status = handler(api, app_id="app", annotation_setting_id="1")

    assert status == 200
    assert response == {"result": "ok"}


def test_annotation_message_id_invalid() -> None:
    with pytest.raises(ValidationError):
        annotation_module.AnnotationFilePayload.model_validate({"message_id": "bad"})
