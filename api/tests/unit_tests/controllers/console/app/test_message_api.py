from __future__ import annotations

from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

from controllers.console.app import message as message_module


def test_app_message_routes_pass_injected_session(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    current_user = SimpleNamespace(id="account-1")
    app_model = SimpleNamespace(id="app-1", mode="chat")
    message_id = "550e8400-e29b-41d4-a716-446655440000"
    list_messages = MagicMock(return_value={"data": []})
    update_feedback = MagicMock(return_value={"result": "success"})
    get_suggested_questions = MagicMock(return_value={"data": ["next"]})
    get_message_detail = MagicMock(return_value={"id": message_id})
    monkeypatch.setattr(message_module, "_list_chat_messages", list_messages)
    monkeypatch.setattr(message_module, "_update_message_feedback", update_feedback)
    monkeypatch.setattr(message_module, "_get_message_suggested_questions", get_suggested_questions)
    monkeypatch.setattr(message_module, "_get_message_detail", get_message_detail)

    assert unwrap(message_module.ChatMessageListApi.get)(
        message_module.ChatMessageListApi(), session, current_user, app_model
    ) == {"data": []}
    assert unwrap(message_module.MessageFeedbackApi.post)(
        message_module.MessageFeedbackApi(), session, current_user, app_model
    ) == {"result": "success"}
    assert unwrap(message_module.MessageSuggestedQuestionApi.get)(
        message_module.MessageSuggestedQuestionApi(), session, current_user, app_model, message_id
    ) == {"data": ["next"]}
    assert unwrap(message_module.MessageApi.get)(message_module.MessageApi(), session, app_model, message_id) == {
        "id": message_id
    }

    assert list_messages.call_args.kwargs["session"] is session
    assert update_feedback.call_args.kwargs["session"] is session
    assert get_suggested_questions.call_args.kwargs["session"] is session
    assert get_message_detail.call_args.kwargs["session"] is session


def test_update_message_feedback_commits_injected_session(app: Flask) -> None:
    message_id = "550e8400-e29b-41d4-a716-446655440000"
    feedback = SimpleNamespace(rating="dislike", content=None)
    get_admin_feedback = MagicMock(return_value=feedback)
    message = SimpleNamespace(
        id=message_id,
        conversation_id="conversation-1",
        admin_feedback_with_session=get_admin_feedback,
    )
    session = MagicMock()
    session.scalar.return_value = message

    with app.test_request_context(json={"message_id": message_id, "rating": "like", "content": "helpful"}):
        result = message_module._update_message_feedback(
            session=session,
            current_user=SimpleNamespace(id="account-1"),
            app_model=SimpleNamespace(id="app-1"),
        )

    assert result == {"result": "success"}
    assert feedback.rating == "like"
    assert feedback.content == "helpful"
    get_admin_feedback.assert_called_once_with(session=session)
    session.commit.assert_called_once_with()


def test_get_message_detail_uses_injected_session(monkeypatch: pytest.MonkeyPatch) -> None:
    message_id = "550e8400-e29b-41d4-a716-446655440000"
    message = SimpleNamespace(id=message_id)
    response_source = object()
    response_source_factory = MagicMock(return_value=response_source)
    session = MagicMock()
    session.scalar.return_value = message
    monkeypatch.setattr(message_module, "attach_message_extra_contents", MagicMock())
    monkeypatch.setattr(message_module, "MessageResponseSource", response_source_factory)
    monkeypatch.setattr(message_module, "dump_response", lambda _model, value: value)

    result = message_module._get_message_detail(
        session=session,
        app_model=SimpleNamespace(id="app-1"),
        message_id=message_id,
    )

    assert result is response_source
    response_source_factory.assert_called_once_with(message, session=session)
    session.scalar.assert_called_once()


def test_message_response_source_uses_caller_session_for_nested_fields() -> None:
    session = MagicMock()
    account = object()
    feedback = MagicMock()
    feedback.from_account_with_session.return_value = account
    annotation = MagicMock()
    annotation.account_with_session.return_value = account
    annotation.annotation_create_account_with_session.return_value = account
    thought = object()
    message_file = {"id": "file-1"}
    message = MagicMock()
    message.inputs_with_session.return_value = {"topic": "support"}
    message.user_feedback_with_session.return_value = feedback
    message.feedbacks_with_session.return_value = [feedback]
    message.annotation_with_session.return_value = annotation
    message.annotation_hit_history_with_session.return_value = annotation
    message.agent_thoughts_with_session.return_value = [thought]
    message.message_files_with_session.return_value = [message_file]

    source = message_module.MessageResponseSource(message, session=session)

    assert source.inputs == {"topic": "support"}
    assert source.user_feedback is feedback
    assert source.feedbacks[0].from_account is account
    annotation_source = source.annotation
    assert annotation_source is not None
    assert annotation_source.account is account
    annotation_hit_history_source = source.annotation_hit_history
    assert annotation_hit_history_source is not None
    assert annotation_hit_history_source.annotation_create_account is account
    assert source.agent_thoughts == [thought]
    assert source.message_files == [message_file]
    message.inputs_with_session.assert_called_once_with(session=session)
    message.user_feedback_with_session.assert_called_once_with(session=session)
    message.feedbacks_with_session.assert_called_once_with(session=session)
    message.annotation_with_session.assert_called_once_with(session=session)
    message.annotation_hit_history_with_session.assert_called_once_with(session=session)
    message.agent_thoughts_with_session.assert_called_once_with(session=session)
    message.message_files_with_session.assert_called_once_with(session=session)
    feedback.from_account_with_session.assert_called_once_with(session=session)
    annotation.account_with_session.assert_called_once_with(session=session)
    annotation.annotation_create_account_with_session.assert_called_once_with(session=session)


def test_chat_messages_query_valid(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test valid ChatMessagesQuery with all fields."""
    query = message_module.ChatMessagesQuery(
        conversation_id="550e8400-e29b-41d4-a716-446655440000",
        first_id="550e8400-e29b-41d4-a716-446655440001",
        limit=50,
    )
    assert query.limit == 50


def test_chat_messages_query_defaults(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test ChatMessagesQuery with defaults."""
    query = message_module.ChatMessagesQuery(conversation_id="550e8400-e29b-41d4-a716-446655440000")
    assert query.first_id is None
    assert query.limit == 20


def test_chat_messages_query_empty_first_id(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test ChatMessagesQuery converts empty first_id to None."""
    query = message_module.ChatMessagesQuery(
        conversation_id="550e8400-e29b-41d4-a716-446655440000",
        first_id="",
    )
    assert query.first_id is None


def test_message_feedback_payload_valid_like(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test MessageFeedbackPayload with like rating."""
    payload = message_module.MessageFeedbackPayload(
        message_id="550e8400-e29b-41d4-a716-446655440000",
        rating="like",
        content="Good answer",
    )
    assert payload.rating == "like"
    assert payload.content == "Good answer"


def test_message_feedback_payload_valid_dislike(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test MessageFeedbackPayload with dislike rating."""
    payload = message_module.MessageFeedbackPayload(
        message_id="550e8400-e29b-41d4-a716-446655440000",
        rating="dislike",
    )
    assert payload.rating == "dislike"


def test_message_feedback_payload_no_rating(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test MessageFeedbackPayload without rating."""
    payload = message_module.MessageFeedbackPayload(message_id="550e8400-e29b-41d4-a716-446655440000")
    assert payload.rating is None


def test_feedback_export_query_defaults(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with default format."""
    query = message_module.FeedbackExportQuery()
    assert query.format == "csv"
    assert query.from_source is None


def test_feedback_export_query_json_format(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with JSON format."""
    query = message_module.FeedbackExportQuery(format="json")
    assert query.format == "json"


def test_feedback_export_query_has_comment_true(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with has_comment as true string."""
    query = message_module.FeedbackExportQuery(has_comment="true")
    assert query.has_comment is True


def test_feedback_export_query_has_comment_false(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with has_comment as false string."""
    query = message_module.FeedbackExportQuery(has_comment="false")
    assert query.has_comment is False


def test_feedback_export_query_has_comment_1(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with has_comment as 1."""
    query = message_module.FeedbackExportQuery(has_comment="1")
    assert query.has_comment is True


def test_feedback_export_query_has_comment_0(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with has_comment as 0."""
    query = message_module.FeedbackExportQuery(has_comment="0")
    assert query.has_comment is False


def test_feedback_export_query_rating_filter(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test FeedbackExportQuery with rating filter."""
    query = message_module.FeedbackExportQuery(rating="like")
    assert query.rating == "like"


def test_annotation_count_response(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test AnnotationCountResponse creation."""
    response = message_module.AnnotationCountResponse(count=10)
    assert response.count == 10


def test_suggested_questions_response(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test SuggestedQuestionsResponse creation."""
    response = message_module.SuggestedQuestionsResponse(data=["What is AI?", "How does ML work?"])
    assert len(response.data) == 2
    assert response.data[0] == "What is AI?"


def test_message_detail_response_normalizes_aliases_and_timestamp(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test MessageDetailResponse normalizes alias fields and datetime timestamps."""
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    response = message_module.MessageDetailResponse.model_validate(
        {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "conversation_id": "550e8400-e29b-41d4-a716-446655440001",
            "inputs": {"foo": "bar"},
            "query": "hello",
            "message": [{"text": "hello"}],
            "message_tokens": 7,
            "answer": "world",
            "answer_tokens": 11,
            "provider_response_latency": 1.25,
            "from_source": "user",
            "from_end_user_id": None,
            "from_account_id": "550e8400-e29b-41d4-a716-446655440002",
            "feedbacks": [],
            "workflow_run_id": None,
            "annotation": None,
            "annotation_hit_history": None,
            "status": "normal",
            "created_at": created_at,
            "agent_thoughts": [],
            "message_files": [],
            "message_metadata_dict": {"token_usage": 3},
            "error": None,
            "parent_message_id": None,
            "extra_contents": [],
        }
    )
    assert response.answer == "world"
    assert response.message_tokens == 7
    assert response.answer_tokens == 11
    assert response.provider_response_latency == 1.25
    assert response.metadata == {"token_usage": 3}
    assert response.created_at == int(created_at.timestamp())
    assert response.model_dump(mode="json") == {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "conversation_id": "550e8400-e29b-41d4-a716-446655440001",
        "inputs": {"foo": "bar"},
        "query": "hello",
        "message": [{"text": "hello"}],
        "message_tokens": 7,
        "answer": "world",
        "answer_tokens": 11,
        "provider_response_latency": 1.25,
        "from_source": "user",
        "from_end_user_id": None,
        "from_account_id": "550e8400-e29b-41d4-a716-446655440002",
        "feedbacks": [],
        "workflow_run_id": None,
        "annotation": None,
        "annotation_hit_history": None,
        "created_at": int(created_at.timestamp()),
        "agent_thoughts": [],
        "message_files": [],
        "metadata": {"token_usage": 3},
        "status": "normal",
        "error": None,
        "parent_message_id": None,
        "extra_contents": [],
    }
