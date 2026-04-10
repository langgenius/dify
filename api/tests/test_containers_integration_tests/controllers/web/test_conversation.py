"""Testcontainers integration tests for controllers.web.conversation endpoints."""

from __future__ import annotations

from typing import cast
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from werkzeug.exceptions import NotFound

from controllers.web.conversation import (
    ConversationApi,
    ConversationListApi,
    ConversationPinApi,
    ConversationRenameApi,
    ConversationUnPinApi,
)
from controllers.web.error import NotChatAppError
from models.model import App, Conversation, EndUser
from services.errors.conversation import ConversationNotExistsError


def _app(*, mode: str) -> App:
    app_model = MagicMock(spec=App)
    app_model.id = "app-1"
    app_model.mode = mode
    return cast(App, app_model)


def _chat_app() -> App:
    return _app(mode="chat")


def _completion_app() -> App:
    return _app(mode="completion")


def _end_user() -> EndUser:
    end_user = MagicMock(spec=EndUser)
    end_user.id = "eu-1"
    return cast(EndUser, end_user)


class TestConversationListApi:
    @pytest.fixture
    def app(self, flask_app_with_containers):
        return flask_app_with_containers

    def test_non_chat_mode_raises(self, app) -> None:
        with app.test_request_context("/conversations"):
            with pytest.raises(NotChatAppError):
                ConversationListApi().get(_completion_app(), _end_user())

    @patch("controllers.web.conversation.WebConversationService.pagination_by_last_id")
    def test_happy_path(self, mock_paginate: MagicMock, app) -> None:
        conv_id = str(uuid4())
        conv = MagicMock(spec=Conversation)
        conv.id = conv_id
        conv.name = "Test"
        conv.inputs = {}
        conv.status = "normal"
        conv.introduction = ""
        conv.created_at = 1700000000
        conv.updated_at = 1700000000
        page = MagicMock()
        page.limit = 20
        page.has_more = False
        page.data = [conv]
        mock_paginate.return_value = page

        with app.test_request_context("/conversations?limit=20"):
            result = ConversationListApi().get(_chat_app(), _end_user())

        assert result["limit"] == 20
        assert result["has_more"] is False


class TestConversationApi:
    @pytest.fixture
    def app(self, flask_app_with_containers):
        return flask_app_with_containers

    def test_non_chat_mode_raises(self, app) -> None:
        with app.test_request_context(f"/conversations/{uuid4()}"):
            with pytest.raises(NotChatAppError):
                ConversationApi().delete(_completion_app(), _end_user(), uuid4())

    @patch("controllers.web.conversation.ConversationService.delete")
    def test_delete_success(self, mock_delete: MagicMock, app) -> None:
        c_id = uuid4()
        with app.test_request_context(f"/conversations/{c_id}"):
            result, status = ConversationApi().delete(_chat_app(), _end_user(), c_id)

        assert status == 204
        assert result["result"] == "success"

    @patch("controllers.web.conversation.ConversationService.delete", side_effect=ConversationNotExistsError())
    def test_delete_not_found(self, mock_delete: MagicMock, app) -> None:
        c_id = uuid4()
        with app.test_request_context(f"/conversations/{c_id}"):
            with pytest.raises(NotFound, match="Conversation Not Exists"):
                ConversationApi().delete(_chat_app(), _end_user(), c_id)


class TestConversationRenameApi:
    @pytest.fixture
    def app(self, flask_app_with_containers):
        return flask_app_with_containers

    def test_non_chat_mode_raises(self, app) -> None:
        with app.test_request_context(f"/conversations/{uuid4()}/name", method="POST", json={"name": "x"}):
            with pytest.raises(NotChatAppError):
                ConversationRenameApi().post(_completion_app(), _end_user(), uuid4())

    @patch("controllers.web.conversation.ConversationService.rename")
    @patch("controllers.web.conversation.web_ns")
    def test_rename_success(self, mock_ns: MagicMock, mock_rename: MagicMock, app) -> None:
        c_id = uuid4()
        mock_ns.payload = {"name": "New Name", "auto_generate": False}
        conv = MagicMock(spec=Conversation)
        conv.id = str(c_id)
        conv.name = "New Name"
        conv.inputs = {}
        conv.status = "normal"
        conv.introduction = ""
        conv.created_at = 1700000000
        conv.updated_at = 1700000000
        mock_rename.return_value = conv

        with app.test_request_context(f"/conversations/{c_id}/name", method="POST", json={"name": "New Name"}):
            result = ConversationRenameApi().post(_chat_app(), _end_user(), c_id)

        assert result["name"] == "New Name"

    @patch(
        "controllers.web.conversation.ConversationService.rename",
        side_effect=ConversationNotExistsError(),
    )
    @patch("controllers.web.conversation.web_ns")
    def test_rename_not_found(self, mock_ns: MagicMock, mock_rename: MagicMock, app) -> None:
        c_id = uuid4()
        mock_ns.payload = {"name": "X", "auto_generate": False}

        with app.test_request_context(f"/conversations/{c_id}/name", method="POST", json={"name": "X"}):
            with pytest.raises(NotFound, match="Conversation Not Exists"):
                ConversationRenameApi().post(_chat_app(), _end_user(), c_id)


class TestConversationPinApi:
    @pytest.fixture
    def app(self, flask_app_with_containers):
        return flask_app_with_containers

    def test_non_chat_mode_raises(self, app) -> None:
        with app.test_request_context(f"/conversations/{uuid4()}/pin", method="PATCH"):
            with pytest.raises(NotChatAppError):
                ConversationPinApi().patch(_completion_app(), _end_user(), uuid4())

    @patch("controllers.web.conversation.WebConversationService.pin")
    def test_pin_success(self, mock_pin: MagicMock, app) -> None:
        c_id = uuid4()
        with app.test_request_context(f"/conversations/{c_id}/pin", method="PATCH"):
            result = ConversationPinApi().patch(_chat_app(), _end_user(), c_id)

        assert result["result"] == "success"

    @patch("controllers.web.conversation.WebConversationService.pin", side_effect=ConversationNotExistsError())
    def test_pin_not_found(self, mock_pin: MagicMock, app) -> None:
        c_id = uuid4()
        with app.test_request_context(f"/conversations/{c_id}/pin", method="PATCH"):
            with pytest.raises(NotFound):
                ConversationPinApi().patch(_chat_app(), _end_user(), c_id)


class TestConversationUnPinApi:
    @pytest.fixture
    def app(self, flask_app_with_containers):
        return flask_app_with_containers

    def test_non_chat_mode_raises(self, app) -> None:
        with app.test_request_context(f"/conversations/{uuid4()}/unpin", method="PATCH"):
            with pytest.raises(NotChatAppError):
                ConversationUnPinApi().patch(_completion_app(), _end_user(), uuid4())

    @patch("controllers.web.conversation.WebConversationService.unpin")
    def test_unpin_success(self, mock_unpin: MagicMock, app) -> None:
        c_id = uuid4()
        with app.test_request_context(f"/conversations/{c_id}/unpin", method="PATCH"):
            result = ConversationUnPinApi().patch(_chat_app(), _end_user(), c_id)

        assert result["result"] == "success"
