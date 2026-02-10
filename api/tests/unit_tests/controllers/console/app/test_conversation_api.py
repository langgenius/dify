from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console.app import conversation as conversation_module
from models.model import AppMode
from services.errors.conversation import ConversationNotExistsError


def _unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


def _make_account():
    return SimpleNamespace(timezone="UTC", id="u1")


def test_completion_conversation_list_returns_paginated_result(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = conversation_module.CompletionConversationApi()
    method = _unwrap(api.get)

    account = _make_account()
    monkeypatch.setattr(conversation_module, "current_account_with_tenant", lambda: (account, "t1"))
    monkeypatch.setattr(conversation_module, "parse_time_range", lambda *_args, **_kwargs: (None, None))

    paginate_result = MagicMock()
    monkeypatch.setattr(conversation_module.db, "paginate", lambda *_args, **_kwargs: paginate_result)

    with app.test_request_context("/console/api/apps/app-1/completion-conversations", method="GET"):
        response = method(app_model=SimpleNamespace(id="app-1"))

    assert response is paginate_result


def test_completion_conversation_list_invalid_time_range(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = conversation_module.CompletionConversationApi()
    method = _unwrap(api.get)

    account = _make_account()
    monkeypatch.setattr(conversation_module, "current_account_with_tenant", lambda: (account, "t1"))
    monkeypatch.setattr(
        conversation_module,
        "parse_time_range",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad range")),
    )

    with app.test_request_context(
        "/console/api/apps/app-1/completion-conversations",
        method="GET",
        query_string={"start": "bad"},
    ):
        with pytest.raises(BadRequest):
            method(app_model=SimpleNamespace(id="app-1"))


def test_chat_conversation_list_advanced_chat_calls_paginate(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = conversation_module.ChatConversationApi()
    method = _unwrap(api.get)

    account = _make_account()
    monkeypatch.setattr(conversation_module, "current_account_with_tenant", lambda: (account, "t1"))
    monkeypatch.setattr(conversation_module, "parse_time_range", lambda *_args, **_kwargs: (None, None))

    paginate_result = MagicMock()
    monkeypatch.setattr(conversation_module.db, "paginate", lambda *_args, **_kwargs: paginate_result)

    with app.test_request_context("/console/api/apps/app-1/chat-conversations", method="GET"):
        response = method(app_model=SimpleNamespace(id="app-1", mode=AppMode.ADVANCED_CHAT))

    assert response is paginate_result


def test_get_conversation_updates_read_at(monkeypatch: pytest.MonkeyPatch) -> None:
    conversation = SimpleNamespace(id="c1", app_id="app-1")

    query = MagicMock()
    query.where.return_value = query
    query.first.return_value = conversation

    session = MagicMock()
    session.query.return_value = query

    monkeypatch.setattr(conversation_module, "current_account_with_tenant", lambda: (_make_account(), "t1"))
    monkeypatch.setattr(conversation_module.db, "session", session)

    result = conversation_module._get_conversation(SimpleNamespace(id="app-1"), "c1")

    assert result is conversation
    session.execute.assert_called_once()
    session.commit.assert_called_once()
    session.refresh.assert_called_once_with(conversation)


def test_get_conversation_missing_raises_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    query = MagicMock()
    query.where.return_value = query
    query.first.return_value = None

    session = MagicMock()
    session.query.return_value = query

    monkeypatch.setattr(conversation_module, "current_account_with_tenant", lambda: (_make_account(), "t1"))
    monkeypatch.setattr(conversation_module.db, "session", session)

    with pytest.raises(NotFound):
        conversation_module._get_conversation(SimpleNamespace(id="app-1"), "missing")


def test_completion_conversation_delete_maps_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    api = conversation_module.CompletionConversationDetailApi()
    method = _unwrap(api.delete)

    monkeypatch.setattr(conversation_module, "current_account_with_tenant", lambda: (_make_account(), "t1"))
    monkeypatch.setattr(
        conversation_module.ConversationService,
        "delete",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ConversationNotExistsError()),
    )

    with pytest.raises(NotFound):
        method(app_model=SimpleNamespace(id="app-1"), conversation_id="c1")
