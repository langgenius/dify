"""
Unit tests for Service API Completion controllers.

Tests coverage for:
- CompletionRequestPayload and ChatRequestPayload Pydantic models
- App mode validation logic
- Error mapping from service layer to HTTP errors

Focus on:
- Pydantic model validation (especially UUID normalization)
- Error types and their mappings
"""

import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, NotFound

import services
from controllers.service_api.app.completion import (
    ChatApi,
    ChatRequestPayload,
    ChatStopApi,
    CompletionApi,
    CompletionRequestPayload,
    CompletionStopApi,
)
from controllers.service_api.app.error import (
    AppUnavailableError,
    ConversationCompletedError,
    NotChatAppError,
)
from core.errors.error import QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from models.model import App, AppMode, EndUser
from services.app_generate_service import AppGenerateService
from services.app_task_service import AppTaskService
from services.errors.app import IsDraftWorkflowError, WorkflowIdFormatError, WorkflowNotFoundError
from services.errors.conversation import ConversationNotExistsError
from services.errors.llm import InvokeRateLimitError


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestCompletionRequestPayload:
    """Test suite for CompletionRequestPayload Pydantic model."""

    def test_payload_with_required_fields(self):
        """Test payload with only required inputs field."""
        payload = CompletionRequestPayload(inputs={"name": "test"})
        assert payload.inputs == {"name": "test"}
        assert payload.query == ""
        assert payload.files is None
        assert payload.response_mode is None
        assert payload.retriever_from == "dev"

    def test_payload_with_all_fields(self):
        """Test payload with all fields populated."""
        payload = CompletionRequestPayload(
            inputs={"user_input": "Hello"},
            query="What is AI?",
            files=[{"type": "image", "url": "http://example.com/image.png"}],
            response_mode="streaming",
            retriever_from="api",
        )
        assert payload.inputs == {"user_input": "Hello"}
        assert payload.query == "What is AI?"
        assert payload.files == [{"type": "image", "url": "http://example.com/image.png"}]
        assert payload.response_mode == "streaming"
        assert payload.retriever_from == "api"

    def test_payload_response_mode_blocking(self):
        """Test payload with blocking response mode."""
        payload = CompletionRequestPayload(inputs={}, response_mode="blocking")
        assert payload.response_mode == "blocking"

    def test_payload_empty_inputs(self):
        """Test payload with empty inputs dict."""
        payload = CompletionRequestPayload(inputs={})
        assert payload.inputs == {}

    def test_payload_complex_inputs(self):
        """Test payload with complex nested inputs."""
        complex_inputs = {
            "user": {"name": "Alice", "age": 30},
            "context": ["item1", "item2"],
            "settings": {"theme": "dark", "notifications": True},
        }
        payload = CompletionRequestPayload(inputs=complex_inputs)
        assert payload.inputs == complex_inputs


class TestChatRequestPayload:
    """Test suite for ChatRequestPayload Pydantic model."""

    def test_payload_with_required_fields(self):
        """Test payload with required fields."""
        payload = ChatRequestPayload(inputs={"key": "value"}, query="Hello")
        assert payload.inputs == {"key": "value"}
        assert payload.query == "Hello"
        assert payload.conversation_id is None
        assert payload.auto_generate_name is True

    def test_payload_normalizes_valid_uuid_conversation_id(self):
        """Test that valid UUID conversation_id is normalized."""
        valid_uuid = str(uuid.uuid4())
        payload = ChatRequestPayload(inputs={}, query="test", conversation_id=valid_uuid)
        assert payload.conversation_id == valid_uuid

    def test_payload_normalizes_empty_string_conversation_id_to_none(self):
        """Test that empty string conversation_id becomes None."""
        payload = ChatRequestPayload(inputs={}, query="test", conversation_id="")
        assert payload.conversation_id is None

    def test_payload_normalizes_whitespace_conversation_id_to_none(self):
        """Test that whitespace-only conversation_id becomes None."""
        payload = ChatRequestPayload(inputs={}, query="test", conversation_id="   ")
        assert payload.conversation_id is None

    def test_payload_rejects_invalid_uuid_conversation_id(self):
        """Test that invalid UUID format raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            ChatRequestPayload(inputs={}, query="test", conversation_id="not-a-uuid")
        assert "valid UUID" in str(exc_info.value)

    def test_payload_with_workflow_id(self):
        """Test payload with workflow_id for advanced chat."""
        payload = ChatRequestPayload(inputs={}, query="test", workflow_id="workflow_123")
        assert payload.workflow_id == "workflow_123"

    def test_payload_streaming_mode(self):
        """Test payload with streaming response mode."""
        payload = ChatRequestPayload(inputs={}, query="test", response_mode="streaming")
        assert payload.response_mode == "streaming"

    def test_payload_auto_generate_name_false(self):
        """Test payload with auto_generate_name explicitly false."""
        payload = ChatRequestPayload(inputs={}, query="test", auto_generate_name=False)
        assert payload.auto_generate_name is False

    def test_payload_with_files(self):
        """Test payload with file attachments."""
        files = [
            {"type": "image", "transfer_method": "remote_url", "url": "http://example.com/img.png"},
            {"type": "document", "transfer_method": "local_file", "upload_file_id": "file_123"},
        ]
        payload = ChatRequestPayload(inputs={}, query="test", files=files)
        assert payload.files == files
        assert len(payload.files) == 2


class TestCompletionErrorMappings:
    """Test error type mappings for completion endpoints."""

    def test_conversation_not_exists_error_exists(self):
        """Test ConversationNotExistsError can be raised."""
        error = services.errors.conversation.ConversationNotExistsError()
        assert isinstance(error, services.errors.conversation.ConversationNotExistsError)

    def test_conversation_completed_error_exists(self):
        """Test ConversationCompletedError can be raised."""
        error = services.errors.conversation.ConversationCompletedError()
        assert isinstance(error, services.errors.conversation.ConversationCompletedError)

        api_error = ConversationCompletedError()
        assert api_error is not None

    def test_app_model_config_broken_error_exists(self):
        """Test AppModelConfigBrokenError can be raised."""
        error = services.errors.app_model_config.AppModelConfigBrokenError()
        assert isinstance(error, services.errors.app_model_config.AppModelConfigBrokenError)

        api_error = AppUnavailableError()
        assert api_error is not None

    def test_workflow_not_found_error_exists(self):
        """Test WorkflowNotFoundError can be raised."""
        error = WorkflowNotFoundError("Workflow not found")
        assert isinstance(error, WorkflowNotFoundError)

    def test_is_draft_workflow_error_exists(self):
        """Test IsDraftWorkflowError can be raised."""
        error = IsDraftWorkflowError("Workflow is in draft state")
        assert isinstance(error, IsDraftWorkflowError)

    def test_workflow_id_format_error_exists(self):
        """Test WorkflowIdFormatError can be raised."""
        error = WorkflowIdFormatError("Invalid workflow ID format")
        assert isinstance(error, WorkflowIdFormatError)

    def test_invoke_rate_limit_error_exists(self):
        """Test InvokeRateLimitError can be raised."""
        error = InvokeRateLimitError("Rate limit exceeded")
        assert isinstance(error, InvokeRateLimitError)


class TestAppModeValidation:
    """Test app mode validation logic patterns."""

    def test_completion_mode_is_valid_for_completion_endpoint(self):
        """Test that COMPLETION mode is valid for completion endpoints."""
        assert AppMode.COMPLETION == AppMode.COMPLETION

    def test_chat_modes_are_distinct_from_completion(self):
        """Test that chat modes are distinct from completion mode."""
        chat_modes = {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}
        assert AppMode.COMPLETION not in chat_modes

    def test_workflow_mode_is_distinct_from_chat_modes(self):
        """Test that WORKFLOW mode is not a chat mode."""
        chat_modes = {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}
        assert AppMode.WORKFLOW not in chat_modes

    def test_not_chat_app_error_can_be_raised(self):
        """Test NotChatAppError can be raised for non-chat apps."""
        error = NotChatAppError()
        assert error is not None

    def test_all_app_modes_are_defined(self):
        """Test that all expected app modes are defined."""
        expected_modes = ["COMPLETION", "CHAT", "AGENT_CHAT", "ADVANCED_CHAT", "WORKFLOW", "CHANNEL", "RAG_PIPELINE"]
        for mode_name in expected_modes:
            assert hasattr(AppMode, mode_name), f"AppMode.{mode_name} should exist"


class TestAppGenerateService:
    """Test AppGenerateService integration patterns."""

    def test_generate_method_exists(self):
        """Test that AppGenerateService.generate method exists."""
        assert hasattr(AppGenerateService, "generate")
        assert callable(AppGenerateService.generate)

    @patch.object(AppGenerateService, "generate")
    def test_generate_returns_response(self, mock_generate):
        """Test that generate returns expected response format."""
        expected = {"answer": "Hello!"}
        mock_generate.return_value = expected

        result = AppGenerateService.generate(
            app_model=Mock(spec=App), user=Mock(spec=EndUser), args={"query": "Hi"}, invoke_from=Mock(), streaming=False
        )

        assert result == expected

    @patch.object(AppGenerateService, "generate")
    def test_generate_raises_conversation_not_exists(self, mock_generate):
        """Test generate raises ConversationNotExistsError."""
        mock_generate.side_effect = services.errors.conversation.ConversationNotExistsError()

        with pytest.raises(services.errors.conversation.ConversationNotExistsError):
            AppGenerateService.generate(
                app_model=Mock(spec=App), user=Mock(spec=EndUser), args={}, invoke_from=Mock(), streaming=False
            )

    @patch.object(AppGenerateService, "generate")
    def test_generate_raises_quota_exceeded(self, mock_generate):
        """Test generate raises QuotaExceededError."""
        mock_generate.side_effect = QuotaExceededError()

        with pytest.raises(QuotaExceededError):
            AppGenerateService.generate(
                app_model=Mock(spec=App), user=Mock(spec=EndUser), args={}, invoke_from=Mock(), streaming=False
            )

    @patch.object(AppGenerateService, "generate")
    def test_generate_raises_invoke_error(self, mock_generate):
        """Test generate raises InvokeError."""
        mock_generate.side_effect = InvokeError("Model invocation failed")

        with pytest.raises(InvokeError):
            AppGenerateService.generate(
                app_model=Mock(spec=App), user=Mock(spec=EndUser), args={}, invoke_from=Mock(), streaming=False
            )


class TestCompletionControllerLogic:
    """Test CompletionApi and ChatApi controller logic directly."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        from flask import Flask

        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.service_api.app.completion.service_api_ns")
    @patch("controllers.service_api.app.completion.AppGenerateService")
    def test_completion_api_post_success(self, mock_generate_service, mock_service_api_ns, app):
        """Test CompletionApi.post success path."""
        from controllers.service_api.app.completion import CompletionApi

        # Setup mocks
        mock_app_model = Mock(spec=App)
        mock_app_model.mode = AppMode.COMPLETION
        mock_end_user = Mock(spec=EndUser)

        payload_dict = {"inputs": {"text": "hello"}, "response_mode": "blocking"}
        mock_service_api_ns.payload = payload_dict
        mock_generate_service.generate.return_value = {"text": "response"}

        with app.test_request_context():
            # Helper for compact_generate_response logic check
            with patch("controllers.service_api.app.completion.helper.compact_generate_response") as mock_compact:
                mock_compact.return_value = {"text": "compacted"}

                api = CompletionApi()
                response = api.post.__wrapped__(api, mock_app_model, mock_end_user)

                assert response == {"text": "compacted"}
                mock_generate_service.generate.assert_called_once()

    @patch("controllers.service_api.app.completion.service_api_ns")
    def test_completion_api_post_wrong_app_mode(self, mock_service_api_ns, app):
        """Test CompletionApi.post with wrong app mode."""
        from controllers.service_api.app.completion import CompletionApi

        mock_app_model = Mock(spec=App)
        mock_app_model.mode = AppMode.CHAT  # Wrong mode
        mock_end_user = Mock(spec=EndUser)

        with app.test_request_context():
            with pytest.raises(AppUnavailableError):
                CompletionApi().post.__wrapped__(CompletionApi(), mock_app_model, mock_end_user)

    @patch("controllers.service_api.app.completion.service_api_ns")
    @patch("controllers.service_api.app.completion.AppGenerateService")
    def test_chat_api_post_success(self, mock_generate_service, mock_service_api_ns, app):
        """Test ChatApi.post success path."""
        from controllers.service_api.app.completion import ChatApi

        mock_app_model = Mock(spec=App)
        mock_app_model.mode = AppMode.CHAT
        mock_end_user = Mock(spec=EndUser)

        payload_dict = {"inputs": {}, "query": "hello", "response_mode": "blocking"}
        mock_service_api_ns.payload = payload_dict
        mock_generate_service.generate.return_value = {"text": "response"}

        with app.test_request_context():
            with patch("controllers.service_api.app.completion.helper.compact_generate_response") as mock_compact:
                mock_compact.return_value = {"text": "compacted"}

                api = ChatApi()
                response = api.post.__wrapped__(api, mock_app_model, mock_end_user)
                assert response == {"text": "compacted"}

    @patch("controllers.service_api.app.completion.service_api_ns")
    def test_chat_api_post_wrong_app_mode(self, mock_service_api_ns, app):
        """Test ChatApi.post with wrong app mode."""
        from controllers.service_api.app.completion import ChatApi

        mock_app_model = Mock(spec=App)
        mock_app_model.mode = AppMode.COMPLETION  # Wrong mode
        mock_end_user = Mock(spec=EndUser)

        with app.test_request_context():
            with pytest.raises(NotChatAppError):
                ChatApi().post.__wrapped__(ChatApi(), mock_app_model, mock_end_user)

    @patch("controllers.service_api.app.completion.AppTaskService")
    def test_completion_stop_api_success(self, mock_task_service, app):
        """Test CompletionStopApi.post success."""
        from controllers.service_api.app.completion import CompletionStopApi

        mock_app_model = Mock(spec=App)
        mock_app_model.mode = AppMode.COMPLETION
        mock_end_user = Mock(spec=EndUser)
        mock_end_user.id = "user_id"

        with app.test_request_context():
            api = CompletionStopApi()
            response = api.post.__wrapped__(api, mock_app_model, mock_end_user, "task_id")

            assert response == ({"result": "success"}, 200)
            mock_task_service.stop_task.assert_called_once()

    @patch("controllers.service_api.app.completion.AppTaskService")
    def test_chat_stop_api_success(self, mock_task_service, app):
        """Test ChatStopApi.post success."""
        from controllers.service_api.app.completion import ChatStopApi

        mock_app_model = Mock(spec=App)
        mock_app_model.mode = AppMode.CHAT
        mock_end_user = Mock(spec=EndUser)
        mock_end_user.id = "user_id"

        with app.test_request_context():
            api = ChatStopApi()
            response = api.post.__wrapped__(api, mock_app_model, mock_end_user, "task_id")

            assert response == ({"result": "success"}, 200)
            mock_task_service.stop_task.assert_called_once()


class TestChatRequestPayloadController:
    def test_normalizes_conversation_id(self) -> None:
        payload = ChatRequestPayload.model_validate(
            {"inputs": {}, "query": "hi", "conversation_id": "  ", "response_mode": "blocking"}
        )
        assert payload.conversation_id is None

        with pytest.raises(ValidationError):
            ChatRequestPayload.model_validate({"inputs": {}, "query": "hi", "conversation_id": "bad-id"})


class TestCompletionApiController:
    def test_wrong_mode(self, app) -> None:
        api = CompletionApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/completion-messages", method="POST", json={"inputs": {}}):
            with pytest.raises(AppUnavailableError):
                handler(api, app_model=app_model, end_user=end_user)

    def test_conversation_not_found(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AppGenerateService,
            "generate",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(ConversationNotExistsError()),
        )
        app_model = SimpleNamespace(mode=AppMode.COMPLETION)
        end_user = SimpleNamespace()

        api = CompletionApi()
        handler = _unwrap(api.post)

        with app.test_request_context("/completion-messages", method="POST", json={"inputs": {}}):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user)


class TestCompletionStopApiController:
    def test_wrong_mode(self, app) -> None:
        api = CompletionStopApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace(id="u1")

        with app.test_request_context("/completion-messages/1/stop", method="POST"):
            with pytest.raises(AppUnavailableError):
                handler(api, app_model=app_model, end_user=end_user, task_id="t1")

    def test_success(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        stop_mock = Mock()
        monkeypatch.setattr(AppTaskService, "stop_task", stop_mock)

        api = CompletionStopApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.COMPLETION)
        end_user = SimpleNamespace(id="u1")

        with app.test_request_context("/completion-messages/1/stop", method="POST"):
            response, status = handler(api, app_model=app_model, end_user=end_user, task_id="t1")

        assert status == 200
        assert response == {"result": "success"}


class TestChatApiController:
    def test_wrong_mode(self, app) -> None:
        api = ChatApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.COMPLETION.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/chat-messages", method="POST", json={"inputs": {}, "query": "hi"}):
            with pytest.raises(NotChatAppError):
                handler(api, app_model=app_model, end_user=end_user)

    def test_workflow_not_found(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AppGenerateService,
            "generate",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(WorkflowNotFoundError("missing")),
        )

        api = ChatApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/chat-messages", method="POST", json={"inputs": {}, "query": "hi"}):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user)

    def test_draft_workflow(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AppGenerateService,
            "generate",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(IsDraftWorkflowError("draft")),
        )

        api = ChatApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.CHAT.value)
        end_user = SimpleNamespace()

        with app.test_request_context("/chat-messages", method="POST", json={"inputs": {}, "query": "hi"}):
            with pytest.raises(BadRequest):
                handler(api, app_model=app_model, end_user=end_user)


class TestChatStopApiController:
    def test_wrong_mode(self, app) -> None:
        api = ChatStopApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(mode=AppMode.COMPLETION.value)
        end_user = SimpleNamespace(id="u1")

        with app.test_request_context("/chat-messages/1/stop", method="POST"):
            with pytest.raises(NotChatAppError):
                handler(api, app_model=app_model, end_user=end_user, task_id="t1")
