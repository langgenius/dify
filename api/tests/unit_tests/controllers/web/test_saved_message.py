"""Unit tests for controllers.web.saved_message endpoints."""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.common.controller_schemas import SavedMessageCreatePayload, SavedMessageListQuery
from controllers.web.error import NotCompletionAppError
from controllers.web.saved_message import SavedMessageApi, SavedMessageListApi
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from services.errors.message import MessageNotExistsError


def _completion_app() -> App:
    return App(id="app-1", tenant_id="tenant-1", mode=AppMode.COMPLETION)


def _chat_app() -> App:
    return App(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT)


def _end_user() -> EndUser:
    return EndUser(
        id="eu-1",
        tenant_id="tenant-1",
        type=EndUserType.BROWSER,
        session_id="session-1",
    )


# The @model_validate decorator wraps the handler; tests call the undecorated
# function so they can pass the validated pydantic payload directly and skip
# the flask request-parsing step.
_list_get = inspect.unwrap(SavedMessageListApi.get)
_list_post = inspect.unwrap(SavedMessageListApi.post)


# ---------------------------------------------------------------------------
# SavedMessageListApi (GET)
# ---------------------------------------------------------------------------
class TestSavedMessageListApiGet:
    def test_non_completion_mode_raises(self, app: Flask) -> None:
        query = SavedMessageListQuery.model_validate({})
        with app.test_request_context("/saved-messages"):
            with pytest.raises(NotCompletionAppError):
                _list_get(SavedMessageListApi(), query, _chat_app(), _end_user())

    @patch("controllers.web.saved_message.SavedMessageService.pagination_by_last_id")
    def test_happy_path(self, mock_paginate: MagicMock, app: Flask) -> None:
        mock_paginate.return_value = SimpleNamespace(limit=20, has_more=False, data=[])
        query = SavedMessageListQuery.model_validate({"limit": 20})

        with app.test_request_context("/saved-messages?limit=20"):
            result = _list_get(SavedMessageListApi(), query, _completion_app(), _end_user())

        assert result["limit"] == 20
        assert result["has_more"] is False


# ---------------------------------------------------------------------------
# SavedMessageListApi (POST)
# ---------------------------------------------------------------------------
class TestSavedMessageListApiPost:
    def test_non_completion_mode_raises(self, app: Flask) -> None:
        payload = SavedMessageCreatePayload.model_validate({"message_id": str(uuid4())})
        with app.test_request_context("/saved-messages", method="POST"):
            with pytest.raises(NotCompletionAppError):
                _list_post(SavedMessageListApi(), payload, _chat_app(), _end_user())

    @patch("controllers.web.saved_message.SavedMessageService.save")
    def test_save_success(self, mock_save: MagicMock, app: Flask) -> None:
        payload = SavedMessageCreatePayload.model_validate({"message_id": str(uuid4())})

        with app.test_request_context("/saved-messages", method="POST"):
            result = _list_post(SavedMessageListApi(), payload, _completion_app(), _end_user())

        assert result["result"] == "success"

    @patch("controllers.web.saved_message.SavedMessageService.save", side_effect=MessageNotExistsError())
    def test_save_not_found(self, mock_save: MagicMock, app: Flask) -> None:
        payload = SavedMessageCreatePayload.model_validate({"message_id": str(uuid4())})

        with app.test_request_context("/saved-messages", method="POST"):
            with pytest.raises(NotFound, match="Message Not Exists"):
                _list_post(SavedMessageListApi(), payload, _completion_app(), _end_user())


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
        assert result == ""
