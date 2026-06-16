from __future__ import annotations

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console.app import conversation as conversation_module
from models.model import AppMode
from services.errors.conversation import ConversationNotExistsError


def _make_account():
    return SimpleNamespace(timezone="UTC", id="u1")


def test_completion_conversation_list_returns_paginated_result(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
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
    monkeypatch.setattr(conversation_module.db, "paginate", lambda *_args, **_kwargs: paginate_result)

    with app.test_request_context("/console/api/apps/app-1/completion-conversations", method="GET"):
        response = method(api, account, app_model=SimpleNamespace(id="app-1"))

    assert response == {"page": 1, "limit": 20, "total": 0, "has_more": False, "data": []}


def test_completion_conversation_list_invalid_time_range(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = conversation_module.CompletionConversationApi()
    method = unwrap(api.get)

    account = _make_account()
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
            method(api, account, app_model=SimpleNamespace(id="app-1"))


def test_chat_conversation_list_advanced_chat_calls_paginate(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
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
    monkeypatch.setattr(conversation_module.db, "paginate", lambda *_args, **_kwargs: paginate_result)

    with app.test_request_context("/console/api/apps/app-1/chat-conversations", method="GET"):
        response = method(api, account, app_model=SimpleNamespace(id="app-1", mode=AppMode.ADVANCED_CHAT))

    assert response == {"page": 1, "limit": 20, "total": 0, "has_more": False, "data": []}


def test_get_conversation_updates_read_at(monkeypatch: pytest.MonkeyPatch) -> None:
    conversation = SimpleNamespace(id="c1", app_id="app-1")

    session = MagicMock()
    session.scalar.return_value = conversation

    monkeypatch.setattr(conversation_module.db, "session", session)

    result = conversation_module._get_conversation(_make_account(), SimpleNamespace(id="app-1"), "c1")

    assert result is conversation
    session.execute.assert_called_once()
    session.commit.assert_called_once()
    session.refresh.assert_called_once_with(conversation)


def test_get_conversation_missing_raises_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.scalar.return_value = None

    monkeypatch.setattr(conversation_module.db, "session", session)

    with pytest.raises(NotFound):
        conversation_module._get_conversation(_make_account(), SimpleNamespace(id="app-1"), "missing")


def test_completion_conversation_delete_maps_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    api = conversation_module.CompletionConversationDetailApi()
    method = unwrap(api.delete)

    monkeypatch.setattr(
        conversation_module.ConversationService,
        "delete",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ConversationNotExistsError()),
    )

    with pytest.raises(NotFound):
        method(api, _make_account(), app_model=SimpleNamespace(id="app-1"), conversation_id="c1")
