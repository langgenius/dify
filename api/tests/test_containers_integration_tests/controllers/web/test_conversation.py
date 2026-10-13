"""Testcontainers integration tests for controllers.web.conversation endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask

from controllers.web.conversation import ConversationListApi
from controllers.web.error import NotChatAppError


def _chat_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", tenant_id="tenant-1", mode="chat")


def _completion_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode="completion")


def _end_user() -> SimpleNamespace:
    return SimpleNamespace(id="eu-1")


class TestConversationListApi:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def test_non_chat_mode_raises(self, app: Flask) -> None:
        with app.test_request_context("/conversations"):
            with pytest.raises(NotChatAppError):
                ConversationListApi().get(_completion_app(), _end_user())

    @patch("controllers.web.conversation.WebConversationService.pagination_by_last_id")
    def test_happy_path(self, mock_paginate: MagicMock, app: Flask) -> None:
        conv_id = str(uuid4())
        conv = SimpleNamespace(
            id=conv_id,
            name="Test",
            inputs={},
            status="normal",
            introduction="",
            created_at=1700000000,
            updated_at=1700000000,
        )
        mock_paginate.return_value = SimpleNamespace(limit=20, has_more=False, data=[conv])

        with app.test_request_context("/conversations?limit=20"):
            result = ConversationListApi().get(_chat_app(), _end_user())

        assert result["limit"] == 20
        assert result["has_more"] is False
