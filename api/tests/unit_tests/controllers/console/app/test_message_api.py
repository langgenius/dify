from __future__ import annotations

import pytest

from controllers.console.app import message as message_module


def _unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


def test_chat_messages_query_valid(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test valid ChatMessagesQuery with all fields."""
    query = message_module.ChatMessagesQuery(
        conversation_id="550e8400-e29b-41d4-a716-446655440000",
        first_id="550e8400-e29b-41d4-a716-446655440001",
        limit=50,
    )
    assert query.limit == 50


def test_chat_messages_query_defaults(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test ChatMessagesQuery with defaults."""
    query = message_module.ChatMessagesQuery(conversation_id="550e8400-e29b-41d4-a716-446655440000")
    assert query.first_id is None
    assert query.limit == 20


def test_chat_messages_query_empty_first_id(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test ChatMessagesQuery converts empty first_id to None."""
    query = message_module.ChatMessagesQuery(
        conversation_id="550e8400-e29b-41d4-a716-446655440000",
        first_id="",
    )
    assert query.first_id is None


def test_message_feedback_payload_valid_like(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test MessageFeedbackPayload with like rating."""
    payload = message_module.MessageFeedbackPayload(
        message_id="550e8400-e29b-41d4-a716-446655440000",
        rating="like",
        content="Good answer",
    )
    assert payload.rating == "like"
    assert payload.content == "Good answer"


def test_message_feedback_payload_valid_dislike(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test MessageFeedbackPayload with dislike rating."""
    payload = message_module.MessageFeedbackPayload(
        message_id="550e8400-e29b-41d4-a716-446655440000",
        rating="dislike",
    )
    assert payload.rating == "dislike"


def test_message_feedback_payload_no_rating(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test MessageFeedbackPayload without rating."""
    payload = message_module.MessageFeedbackPayload(message_id="550e8400-e29b-41d4-a716-446655440000")
    assert payload.rating is None


def test_feedback_export_query_defaults(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with default format."""
    query = message_module.FeedbackExportQuery()
    assert query.format == "csv"
    assert query.from_source is None


def test_feedback_export_query_json_format(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with JSON format."""
    query = message_module.FeedbackExportQuery(format="json")
    assert query.format == "json"


def test_feedback_export_query_has_comment_true(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with has_comment as true string."""
    query = message_module.FeedbackExportQuery(has_comment="true")
    assert query.has_comment is True


def test_feedback_export_query_has_comment_false(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with has_comment as false string."""
    query = message_module.FeedbackExportQuery(has_comment="false")
    assert query.has_comment is False


def test_feedback_export_query_has_comment_1(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with has_comment as 1."""
    query = message_module.FeedbackExportQuery(has_comment="1")
    assert query.has_comment is True


def test_feedback_export_query_has_comment_0(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with has_comment as 0."""
    query = message_module.FeedbackExportQuery(has_comment="0")
    assert query.has_comment is False


def test_feedback_export_query_rating_filter(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with rating filter."""
    query = message_module.FeedbackExportQuery(rating="like")
    assert query.rating == "like"


def test_annotation_count_response(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test AnnotationCountResponse creation."""
    response = message_module.AnnotationCountResponse(count=10)
    assert response.count == 10


def test_suggested_questions_response(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test SuggestedQuestionsResponse creation."""
    response = message_module.SuggestedQuestionsResponse(data=["What is AI?", "How does ML work?"])
    assert len(response.data) == 2
    assert response.data[0] == "What is AI?"
