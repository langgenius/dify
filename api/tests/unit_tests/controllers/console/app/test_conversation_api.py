from __future__ import annotations

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console.app import conversation as conversation_module
from core.app.entities.app_invoke_entities import InvokeFrom
from models.enums import ConversationFromSource
from models.model import AppMode, Conversation
from services.errors.conversation import ConversationNotExistsError


def _make_account():
    return SimpleNamespace(timezone="UTC", id="u1")


def _conversation(*, conversation_id: str = "c1", app_id: str = "app-1") -> Conversation:
    conversation = Conversation(
        app_id=app_id,
        app_model_config_id=None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=AppMode.CHAT,
        name="Conversation",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from=InvokeFrom.EXPLORE,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id="u1",
    )
    conversation.id = conversation_id
    return conversation


def test_completion_conversation_list_returns_paginated_result(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    api = conversation_module.CompletionConversationApi()
    method = unwrap(api.get)
    account = _make_account()
    monkeypatch.setattr(conversation_module, "parse_time_range", lambda *_args, **_kwargs: (None, None))
    paginate_result = MagicMock()
    paginate_result.page = 1
    paginate_result.per_page = 20
    paginate_result.total = 0
    paginate_result.has_next = False
    paginate_result.items = []
    monkeypatch.setattr(conversation_module, "paginate_query", lambda *_args, **_kwargs: paginate_result)
    with app.test_request_context("/console/api/apps/app-1/completion-conversations", method="GET"):
        response = method(api, unbound_session, account, app_model=SimpleNamespace(id="app-1"))
    assert response == {"page": 1, "limit": 20, "total": 0, "has_more": False, "data": []}


def test_completion_conversation_list_invalid_time_range(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    api = conversation_module.CompletionConversationApi()
    method = unwrap(api.get)
    account = _make_account()
    monkeypatch.setattr(
        conversation_module,
        "parse_time_range",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad range")),
    )
    with app.test_request_context(
        "/console/api/apps/app-1/completion-conversations", method="GET", query_string={"start": "bad"}
    ):
        with pytest.raises(BadRequest):
            method(api, unbound_session, account, app_model=SimpleNamespace(id="app-1"))


def test_chat_conversation_list_advanced_chat_calls_paginate(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    api = conversation_module.ChatConversationApi()
    method = unwrap(api.get)
    account = _make_account()
    monkeypatch.setattr(conversation_module, "parse_time_range", lambda *_args, **_kwargs: (None, None))
    paginate_result = MagicMock()
    paginate_result.page = 1
    paginate_result.per_page = 20
    paginate_result.total = 0
    paginate_result.has_next = False
    paginate_result.items = []
    monkeypatch.setattr(conversation_module, "paginate_query", lambda *_args, **_kwargs: paginate_result)
    with app.test_request_context("/console/api/apps/app-1/chat-conversations", method="GET"):
        response = method(
            api, unbound_session, account, app_model=SimpleNamespace(id="app-1", mode=AppMode.ADVANCED_CHAT)
        )
    assert response == {"page": 1, "limit": 20, "total": 0, "has_more": False, "data": []}


def test_get_conversation_updates_read_at(sqlite_session: Session) -> None:
    conversation = _conversation()
    sqlite_session.add(conversation)
    sqlite_session.flush()
    session = sqlite_session
    result = conversation_module._get_conversation(session, _make_account(), SimpleNamespace(id="app-1"), "c1")
    assert result is conversation
    assert conversation.read_at is not None
    assert conversation.read_account_id == "u1"


def test_get_conversation_missing_raises_not_found(sqlite_session: Session) -> None:
    session = sqlite_session
    with pytest.raises(NotFound):
        conversation_module._get_conversation(session, _make_account(), SimpleNamespace(id="app-1"), "missing")


def test_conversation_response_source_uses_caller_session(unbound_session: Session) -> None:
    session = unbound_session
    account = object()
    annotation = MagicMock()
    annotation.account_with_session.return_value = account
    message = MagicMock()
    conversation = MagicMock()
    conversation.inputs_with_session.return_value = {"topic": "support"}
    conversation.model_config_with_session.return_value = {"model_id": "model-1"}
    conversation.summary_or_query_with_session.return_value = "summary"
    conversation.annotated_with_session.return_value = True
    conversation.annotation_with_session.return_value = annotation
    conversation.message_count_with_session.return_value = 3
    conversation.user_feedback_stats_with_session.return_value = {"like": 2, "dislike": 1}
    conversation.admin_feedback_stats_with_session.return_value = {"like": 1, "dislike": 0}
    conversation.status_count_with_session.return_value = {"success": 1, "failed": 0}
    conversation.first_message_with_session.return_value = message
    conversation.from_end_user_session_id_with_session.return_value = "end-user-session"
    conversation.from_account_name_with_session.return_value = "Account"

    source = conversation_module.ConversationResponseSource(conversation, session=session)

    assert source.inputs == {"topic": "support"}
    assert source.model_config == {"model_id": "model-1"}
    assert source.summary_or_query == "summary"
    assert source.annotated is True
    annotation_source = source.annotation
    assert annotation_source is not None
    assert annotation_source.account is account
    assert source.message_count == 3
    assert source.user_feedback_stats == {"like": 2, "dislike": 1}
    assert source.admin_feedback_stats == {"like": 1, "dislike": 0}
    assert source.status_count == {"success": 1, "failed": 0}
    assert source.first_message is not None
    assert source.from_end_user_session_id == "end-user-session"
    assert source.from_account_name == "Account"
    conversation.model_config_with_session.assert_called_once_with(session=session)
    conversation.inputs_with_session.assert_called_once_with(session=session)
    conversation.summary_or_query_with_session.assert_called_once_with(session=session)
    conversation.annotated_with_session.assert_called_once_with(session=session)
    conversation.annotation_with_session.assert_called_once_with(session=session)
    conversation.message_count_with_session.assert_called_once_with(session=session)
    conversation.user_feedback_stats_with_session.assert_called_once_with(session=session)
    conversation.admin_feedback_stats_with_session.assert_called_once_with(session=session)
    conversation.status_count_with_session.assert_called_once_with(session=session)
    conversation.first_message_with_session.assert_called_once_with(session=session)
    conversation.from_end_user_session_id_with_session.assert_called_once_with(session=session)
    conversation.from_account_name_with_session.assert_called_once_with(session=session)
    annotation.account_with_session.assert_called_once_with(session=session)


def test_completion_conversation_delete_maps_not_found(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    api = conversation_module.CompletionConversationDetailApi()
    method = unwrap(api.delete)
    monkeypatch.setattr(
        conversation_module.ConversationService,
        "delete",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ConversationNotExistsError()),
    )
    session = unbound_session
    with pytest.raises(NotFound):
        method(api, session, _make_account(), app_model=SimpleNamespace(id="app-1"), conversation_id="c1")
