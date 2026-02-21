"""Unit tests for controllers.web.conversation endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.web.conversation import (
    ConversationApi,
    ConversationListApi,
    ConversationPinApi,
    ConversationRenameApi,
    ConversationUnPinApi,
)
from controllers.web.error import NotChatAppError
from services.errors.conversation import ConversationNotExistsError


def _chat_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode="chat")


def _completion_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode="completion")


def _end_user() -> SimpleNamespace:
    return SimpleNamespace(id="eu-1")


# ---------------------------------------------------------------------------
# ConversationListApi
# ---------------------------------------------------------------------------
class TestConversationListApi:
    def test_non_chat_mode_raises(self, app: Flask) -> None:
        with app.test_request_context("/conversations"):
            with pytest.raises(NotChatAppError):
                ConversationListApi().get(_completion_app(), _end_user())

    @patch("controllers.web.conversation.WebConversationService.pagination_by_last_id")
    @patch("controllers.web.conversation.db")
    def test_happy_path(self, mock_db: MagicMock, mock_paginate: MagicMock, app: Flask) -> None:
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
        mock_db.engine = "engine"

        session_mock = MagicMock()
        session_ctx = MagicMock()
        session_ctx.__enter__ = MagicMock(return_value=session_mock)
        session_ctx.__exit__ = MagicMock(return_value=False)

        with (
            app.test_request_context("/conversations?limit=20"),
            patch("controllers.web.conversation.Session", return_value=session_ctx),
        ):
            result = ConversationListApi().get(_chat_app(), _end_user())

        assert result["limit"] == 20
        assert result["has_more"] is False


# ---------------------------------------------------------------------------
# ConversationApi (delete)
# ---------------------------------------------------------------------------
class TestConversationApi:
    def test_non_chat_mode_raises(self, app: Flask) -> None:
        with app.test_request_context(f"/conversations/{uuid4()}"):
            with pytest.raises(NotChatAppError):
                ConversationApi().delete(_completion_app(), _end_user(), uuid4())

    @patch("controllers.web.conversation.ConversationService.delete")
    def test_delete_success(self, mock_delete: MagicMock, app: Flask) -> None:
        c_id = uuid4()
        with app.test_request_context(f"/conversations/{c_id}"):
            result, status = ConversationApi().delete(_chat_app(), _end_user(), c_id)

        assert status == 204
        assert result["result"] == "success"

    @patch("controllers.web.conversation.ConversationService.delete", side_effect=ConversationNotExistsError())
    def test_delete_not_found(self, mock_delete: MagicMock, app: Flask) -> None:
        c_id = uuid4()
        with app.test_request_context(f"/conversations/{c_id}"):
            with pytest.raises(NotFound, match="Conversation Not Exists"):
                ConversationApi().delete(_chat_app(), _end_user(), c_id)


# ---------------------------------------------------------------------------
# ConversationRenameApi
# ---------------------------------------------------------------------------
class TestConversationRenameApi:
    def test_non_chat_mode_raises(self, app: Flask) -> None:
        with app.test_request_context(f"/conversations/{uuid4()}/name", method="POST", json={"name": "x"}):
            with pytest.raises(NotChatAppError):
                ConversationRenameApi().post(_completion_app(), _end_user(), uuid4())

    @patch("controllers.web.conversation.ConversationService.rename")
    @patch("controllers.web.conversation.web_ns")
    def test_rename_success(self, mock_ns: MagicMock, mock_rename: MagicMock, app: Flask) -> None:
        c_id = uuid4()
        mock_ns.payload = {"name": "New Name", "auto_generate": False}
        conv = SimpleNamespace(
            id=str(c_id),
            name="New Name",
            inputs={},
            status="normal",
            introduction="",
            created_at=1700000000,
            updated_at=1700000000,
        )
        mock_rename.return_value = conv

        with app.test_request_context(f"/conversations/{c_id}/name", method="POST", json={"name": "New Name"}):
            result = ConversationRenameApi().post(_chat_app(), _end_user(), c_id)

        assert result["name"] == "New Name"

    @patch(
        "controllers.web.conversation.ConversationService.rename",
        side_effect=ConversationNotExistsError(),
    )
    @patch("controllers.web.conversation.web_ns")
    def test_rename_not_found(self, mock_ns: MagicMock, mock_rename: MagicMock, app: Flask) -> None:
        c_id = uuid4()
        mock_ns.payload = {"name": "X", "auto_generate": False}

        with app.test_request_context(f"/conversations/{c_id}/name", method="POST", json={"name": "X"}):
            with pytest.raises(NotFound, match="Conversation Not Exists"):
                ConversationRenameApi().post(_chat_app(), _end_user(), c_id)


# ---------------------------------------------------------------------------
# ConversationPinApi / ConversationUnPinApi
# ---------------------------------------------------------------------------
class TestConversationPinApi:
    def test_non_chat_mode_raises(self, app: Flask) -> None:
        with app.test_request_context(f"/conversations/{uuid4()}/pin", method="PATCH"):
            with pytest.raises(NotChatAppError):
                ConversationPinApi().patch(_completion_app(), _end_user(), uuid4())

    @patch("controllers.web.conversation.WebConversationService.pin")
    def test_pin_success(self, mock_pin: MagicMock, app: Flask) -> None:
        c_id = uuid4()
        with app.test_request_context(f"/conversations/{c_id}/pin", method="PATCH"):
            result = ConversationPinApi().patch(_chat_app(), _end_user(), c_id)

        assert result["result"] == "success"

    @patch("controllers.web.conversation.WebConversationService.pin", side_effect=ConversationNotExistsError())
    def test_pin_not_found(self, mock_pin: MagicMock, app: Flask) -> None:
        c_id = uuid4()
        with app.test_request_context(f"/conversations/{c_id}/pin", method="PATCH"):
            with pytest.raises(NotFound):
                ConversationPinApi().patch(_chat_app(), _end_user(), c_id)


class TestConversationUnPinApi:
    def test_non_chat_mode_raises(self, app: Flask) -> None:
        with app.test_request_context(f"/conversations/{uuid4()}/unpin", method="PATCH"):
            with pytest.raises(NotChatAppError):
                ConversationUnPinApi().patch(_completion_app(), _end_user(), uuid4())

    @patch("controllers.web.conversation.WebConversationService.unpin")
    def test_unpin_success(self, mock_unpin: MagicMock, app: Flask) -> None:
        c_id = uuid4()
        with app.test_request_context(f"/conversations/{c_id}/unpin", method="PATCH"):
            result = ConversationUnPinApi().patch(_chat_app(), _end_user(), c_id)

        assert result["result"] == "success"
