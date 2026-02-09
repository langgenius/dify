"""Unit tests for controllers.web.saved_message endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.web.error import NotCompletionAppError
from controllers.web.saved_message import SavedMessageApi, SavedMessageListApi
from services.errors.message import MessageNotExistsError


def _completion_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode="completion")


def _chat_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode="chat")


def _end_user() -> SimpleNamespace:
    return SimpleNamespace(id="eu-1")


# ---------------------------------------------------------------------------
# SavedMessageListApi (GET)
# ---------------------------------------------------------------------------
class TestSavedMessageListApiGet:
    def test_non_completion_mode_raises(self, app: Flask) -> None:
        with app.test_request_context("/saved-messages"):
            with pytest.raises(NotCompletionAppError):
                SavedMessageListApi().get(_chat_app(), _end_user())

    @patch("controllers.web.saved_message.SavedMessageService.pagination_by_last_id")
    def test_happy_path(self, mock_paginate: MagicMock, app: Flask) -> None:
        mock_paginate.return_value = SimpleNamespace(limit=20, has_more=False, data=[])

        with app.test_request_context("/saved-messages?limit=20"):
            result = SavedMessageListApi().get(_completion_app(), _end_user())

        assert result["limit"] == 20
        assert result["has_more"] is False


# ---------------------------------------------------------------------------
# SavedMessageListApi (POST)
# ---------------------------------------------------------------------------
class TestSavedMessageListApiPost:
    def test_non_completion_mode_raises(self, app: Flask) -> None:
        with app.test_request_context("/saved-messages", method="POST"):
            with pytest.raises(NotCompletionAppError):
                SavedMessageListApi().post(_chat_app(), _end_user())

    @patch("controllers.web.saved_message.SavedMessageService.save")
    @patch("controllers.web.saved_message.web_ns")
    def test_save_success(self, mock_ns: MagicMock, mock_save: MagicMock, app: Flask) -> None:
        msg_id = str(uuid4())
        mock_ns.payload = {"message_id": msg_id}

        with app.test_request_context("/saved-messages", method="POST"):
            result = SavedMessageListApi().post(_completion_app(), _end_user())

        assert result["result"] == "success"

    @patch("controllers.web.saved_message.SavedMessageService.save", side_effect=MessageNotExistsError())
    @patch("controllers.web.saved_message.web_ns")
    def test_save_not_found(self, mock_ns: MagicMock, mock_save: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"message_id": str(uuid4())}

        with app.test_request_context("/saved-messages", method="POST"):
            with pytest.raises(NotFound, match="Message Not Exists"):
                SavedMessageListApi().post(_completion_app(), _end_user())


# ---------------------------------------------------------------------------
# SavedMessageApi (DELETE)
# ---------------------------------------------------------------------------
class TestSavedMessageApi:
    def test_non_completion_mode_raises(self, app: Flask) -> None:
        msg_id = uuid4()
        with app.test_request_context(f"/saved-messages/{msg_id}", method="DELETE"):
            with pytest.raises(NotCompletionAppError):
                SavedMessageApi().delete(_chat_app(), _end_user(), msg_id)

    @patch("controllers.web.saved_message.SavedMessageService.delete")
    def test_delete_success(self, mock_delete: MagicMock, app: Flask) -> None:
        msg_id = uuid4()
        with app.test_request_context(f"/saved-messages/{msg_id}", method="DELETE"):
            result, status = SavedMessageApi().delete(_completion_app(), _end_user(), msg_id)

        assert status == 204
        assert result["result"] == "success"
