"""Unit tests for controllers.web.completion endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.web.completion import ChatApi, ChatStopApi, CompletionApi, CompletionStopApi
from controllers.web.error import (
    CompletionRequestError,
    NotChatAppError,
    NotCompletionAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError


def _completion_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode="completion")


def _chat_app() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode="chat")


def _end_user() -> SimpleNamespace:
    return SimpleNamespace(id="eu-1")


# ---------------------------------------------------------------------------
# CompletionApi
# ---------------------------------------------------------------------------
class TestCompletionApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        with app.test_request_context("/completion-messages", method="POST"):
            with pytest.raises(NotCompletionAppError):
                CompletionApi().post(_chat_app(), _end_user())

    @patch("controllers.web.completion.helper.compact_generate_response", return_value={"answer": "hi"})
    @patch("controllers.web.completion.AppGenerateService.generate")
    @patch("controllers.web.completion.web_ns")
    def test_happy_path(self, mock_ns: MagicMock, mock_gen: MagicMock, mock_compact: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"inputs": {}, "query": "test"}
        mock_gen.return_value = "response-obj"

        with app.test_request_context("/completion-messages", method="POST"):
            result = CompletionApi().post(_completion_app(), _end_user())

        assert result == {"answer": "hi"}

    @patch(
        "controllers.web.completion.AppGenerateService.generate",
        side_effect=ProviderTokenNotInitError(description="not init"),
    )
    @patch("controllers.web.completion.web_ns")
    def test_provider_not_init_error(self, mock_ns: MagicMock, mock_gen: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"inputs": {}}

        with app.test_request_context("/completion-messages", method="POST"):
            with pytest.raises(ProviderNotInitializeError):
                CompletionApi().post(_completion_app(), _end_user())

    @patch(
        "controllers.web.completion.AppGenerateService.generate",
        side_effect=QuotaExceededError(),
    )
    @patch("controllers.web.completion.web_ns")
    def test_quota_exceeded_error(self, mock_ns: MagicMock, mock_gen: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"inputs": {}}

        with app.test_request_context("/completion-messages", method="POST"):
            with pytest.raises(ProviderQuotaExceededError):
                CompletionApi().post(_completion_app(), _end_user())

    @patch(
        "controllers.web.completion.AppGenerateService.generate",
        side_effect=ModelCurrentlyNotSupportError(),
    )
    @patch("controllers.web.completion.web_ns")
    def test_model_not_support_error(self, mock_ns: MagicMock, mock_gen: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"inputs": {}}

        with app.test_request_context("/completion-messages", method="POST"):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                CompletionApi().post(_completion_app(), _end_user())


# ---------------------------------------------------------------------------
# CompletionStopApi
# ---------------------------------------------------------------------------
class TestCompletionStopApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        with app.test_request_context("/completion-messages/task-1/stop", method="POST"):
            with pytest.raises(NotCompletionAppError):
                CompletionStopApi().post(_chat_app(), _end_user(), "task-1")

    @patch("controllers.web.completion.AppTaskService.stop_task")
    def test_stop_success(self, mock_stop: MagicMock, app: Flask) -> None:
        with app.test_request_context("/completion-messages/task-1/stop", method="POST"):
            result, status = CompletionStopApi().post(_completion_app(), _end_user(), "task-1")

        assert status == 200
        assert result == {"result": "success"}


# ---------------------------------------------------------------------------
# ChatApi
# ---------------------------------------------------------------------------
class TestChatApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        with app.test_request_context("/chat-messages", method="POST"):
            with pytest.raises(NotChatAppError):
                ChatApi().post(_completion_app(), _end_user())

    @patch("controllers.web.completion.helper.compact_generate_response", return_value={"answer": "reply"})
    @patch("controllers.web.completion.AppGenerateService.generate")
    @patch("controllers.web.completion.web_ns")
    def test_happy_path(self, mock_ns: MagicMock, mock_gen: MagicMock, mock_compact: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"inputs": {}, "query": "hi"}
        mock_gen.return_value = "response"

        with app.test_request_context("/chat-messages", method="POST"):
            result = ChatApi().post(_chat_app(), _end_user())

        assert result == {"answer": "reply"}

    @patch(
        "controllers.web.completion.AppGenerateService.generate",
        side_effect=InvokeError(description="rate limit"),
    )
    @patch("controllers.web.completion.web_ns")
    def test_invoke_error_mapped(self, mock_ns: MagicMock, mock_gen: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"inputs": {}, "query": "x"}

        with app.test_request_context("/chat-messages", method="POST"):
            with pytest.raises(CompletionRequestError):
                ChatApi().post(_chat_app(), _end_user())


# ---------------------------------------------------------------------------
# ChatStopApi
# ---------------------------------------------------------------------------
class TestChatStopApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        with app.test_request_context("/chat-messages/task-1/stop", method="POST"):
            with pytest.raises(NotChatAppError):
                ChatStopApi().post(_completion_app(), _end_user(), "task-1")

    @patch("controllers.web.completion.AppTaskService.stop_task")
    def test_stop_success(self, mock_stop: MagicMock, app: Flask) -> None:
        with app.test_request_context("/chat-messages/task-1/stop", method="POST"):
            result, status = ChatStopApi().post(_chat_app(), _end_user(), "task-1")

        assert status == 200
        assert result == {"result": "success"}
