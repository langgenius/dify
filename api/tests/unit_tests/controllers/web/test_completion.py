"""Unit tests for controllers.web.completion endpoints."""

from __future__ import annotations

import uuid
from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from dify_agent.protocol import RunInputHandoffResponse, RunInputRequest, RunInputResponse
from flask import Flask
from flask_restx import Api
from sqlalchemy.orm import Session
from werkzeug.exceptions import Conflict, InternalServerError, NotFound, ServiceUnavailable, Unauthorized

from controllers.web.completion import (
    ChatApi,
    ChatStopApi,
    CompletionApi,
    CompletionStopApi,
    WebAgentChatInputApi,
    WebAgentChatInterruptApi,
)
from controllers.web.error import (
    AgentNotPublishedError,
    CompletionRequestError,
    NotChatAppError,
    NotCompletionAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from core.app.apps.agent_app.errors import AgentAppNotPublishedError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from graphon.model_runtime.errors.invoke import InvokeError
from models.model import App, AppMode, EndUser
from services.agent.chat_steering import (
    AgentChatBackendUnavailableError,
    AgentChatInputConflictError,
    AgentChatTaskNotFoundError,
)
from tests.helpers.unit.model_factories import make_app, make_end_user


def _app(mode: AppMode) -> App:
    return make_app(name="Web App", mode=mode, enable_api=False, max_active_requests=0)


def _completion_app() -> App:
    return _app(AppMode.COMPLETION)


def _chat_app() -> App:
    return _app(AppMode.CHAT)


def _end_user() -> EndUser:
    return make_end_user(end_user_id="eu-1", app_id="app-1", name="Web User")


@pytest.mark.parametrize(
    ("resource", "mode", "path"),
    [
        (CompletionApi, AppMode.COMPLETION, "/completion-messages"),
        (ChatApi, AppMode.CHAT, "/chat-messages"),
    ],
)
def test_unexpected_generation_error_hides_internal_details(
    app: Flask,
    resource: type[CompletionApi | ChatApi],
    mode: AppMode,
    path: str,
) -> None:
    error = RuntimeError("internal provider failure")
    with (
        patch("controllers.web.completion.AppGenerateService.generate", side_effect=error),
        app.test_request_context(path, method="POST", json={"inputs": {}, "query": "hello"}),
        pytest.raises(InternalServerError) as exc_info,
    ):
        resource().post(_app(mode), _end_user())

    assert exc_info.value.code == 500
    assert "internal provider failure" not in str(exc_info.value)
    assert exc_info.value.__context__ is error


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
        empty_inputs: dict[str, object] = {}
        mock_ns.payload = {"inputs": empty_inputs, "query": "test"}
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
        empty_inputs: dict[str, object] = {}
        mock_ns.payload = {"inputs": empty_inputs}

        with app.test_request_context("/completion-messages", method="POST"):
            with pytest.raises(ProviderNotInitializeError):
                CompletionApi().post(_completion_app(), _end_user())

    @patch(
        "controllers.web.completion.AppGenerateService.generate",
        side_effect=QuotaExceededError(),
    )
    @patch("controllers.web.completion.web_ns")
    def test_quota_exceeded_error(self, mock_ns: MagicMock, mock_gen: MagicMock, app: Flask) -> None:
        empty_inputs: dict[str, object] = {}
        mock_ns.payload = {"inputs": empty_inputs}

        with app.test_request_context("/completion-messages", method="POST"):
            with pytest.raises(ProviderQuotaExceededError):
                CompletionApi().post(_completion_app(), _end_user())

    @patch(
        "controllers.web.completion.AppGenerateService.generate",
        side_effect=ModelCurrentlyNotSupportError(),
    )
    @patch("controllers.web.completion.web_ns")
    def test_model_not_support_error(self, mock_ns: MagicMock, mock_gen: MagicMock, app: Flask) -> None:
        empty_inputs: dict[str, object] = {}
        mock_ns.payload = {"inputs": empty_inputs}

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
        empty_inputs: dict[str, object] = {}
        mock_ns.payload = {"inputs": empty_inputs, "query": "hi"}
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
        empty_inputs: dict[str, object] = {}
        mock_ns.payload = {"inputs": empty_inputs, "query": "x"}

        with app.test_request_context("/chat-messages", method="POST"):
            with pytest.raises(CompletionRequestError):
                ChatApi().post(_chat_app(), _end_user())

    @patch(
        "controllers.web.completion.AppGenerateService.generate",
        side_effect=AgentAppNotPublishedError("Agent has not been published"),
    )
    @patch("controllers.web.completion.web_ns")
    def test_agent_not_published_error_mapped(self, mock_ns: MagicMock, mock_gen: MagicMock, app: Flask) -> None:
        empty_inputs: dict[str, object] = {}
        mock_ns.payload = {"inputs": empty_inputs, "query": "x"}
        app_model = _app(AppMode.AGENT)

        with app.test_request_context("/chat-messages", method="POST"):
            with pytest.raises(AgentNotPublishedError):
                ChatApi().post(app_model, _end_user())

    @patch("controllers.web.completion.AppGenerateService.generate", return_value="response")
    @patch("controllers.web.completion.ConversationService.get_conversation")
    @patch("controllers.web.completion.web_ns")
    def test_conversation_validation_uses_request_session(
        self,
        mock_ns: MagicMock,
        mock_get_conversation: MagicMock,
        mock_generate: MagicMock,
        app: Flask,
        unbound_session: Session,
    ) -> None:
        empty_inputs: dict[str, object] = {}
        mock_ns.payload = {"inputs": empty_inputs, "query": "hi", "conversation_id": str(uuid.uuid4())}
        session = unbound_session

        with app.test_request_context("/chat-messages", method="POST"):
            unwrap(ChatApi.post)(ChatApi(), session, _chat_app(), _end_user())

        assert mock_get_conversation.call_args.kwargs["session"] is session


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


# ---------------------------------------------------------------------------
# Web Agent steering: enqueue + cut-in
# ---------------------------------------------------------------------------
def _agent_app() -> App:
    return _app(AppMode.AGENT)


def _input_receipt(input_id: uuid.UUID) -> RunInputResponse:
    return RunInputResponse(input_id=input_id)


def _handoff_receipt(
    input_id: uuid.UUID, pending: list[tuple[uuid.UUID, str]]
) -> RunInputHandoffResponse:
    return RunInputHandoffResponse(
        input_id=input_id,
        pending_inputs=[RunInputRequest(input_id=pending_id, text=text) for pending_id, text in pending],
    )


class TestWebAgentChatInputApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        body = {"input_id": str(uuid.uuid4()), "text": "hello"}
        with app.test_request_context("/chat-messages/x/inputs", method="POST", json=body):
            with pytest.raises(NotFound):
                WebAgentChatInputApi().post(_chat_app(), _end_user(), uuid.uuid4())

    @patch("controllers.web.completion.enqueue_agent_chat_input")
    def test_enqueue_scopes_to_web_binding(self, mock_enqueue: MagicMock, app: Flask) -> None:
        input_id, task_id = uuid.uuid4(), uuid.uuid4()
        mock_enqueue.side_effect = lambda _scope, request: _input_receipt(request.input_id)
        app_model = _agent_app()
        end_user = _end_user()
        body = {"input_id": str(input_id), "text": "hello"}

        with app.test_request_context("/chat-messages/x/inputs", method="POST", json=body):
            result, status = WebAgentChatInputApi().post(app_model, end_user, task_id)

        assert status == 202
        assert result["input_id"] == str(input_id)
        (call,) = mock_enqueue.call_args_list
        scope, request = call.args
        assert scope.invoke_from == InvokeFrom.WEB_APP
        assert (scope.tenant_id, scope.app_id, scope.user_id, scope.task_id) == (
            app_model.tenant_id,
            app_model.id,
            end_user.id,
            task_id,
        )
        assert scope.cache_key().startswith("agent-web-run:")
        assert (request.input_id, request.text) == (input_id, "hello")

    @pytest.mark.parametrize(
        ("error", "expected"),
        [
            (AgentChatTaskNotFoundError("nope"), NotFound),
            (AgentChatInputConflictError("nope"), Conflict),
            (AgentChatBackendUnavailableError("nope"), ServiceUnavailable),
        ],
    )
    @patch("controllers.web.completion.enqueue_agent_chat_input")
    def test_errors_map_to_http(self, mock_enqueue: MagicMock, error: Exception, expected: type, app: Flask) -> None:
        mock_enqueue.side_effect = error
        body = {"input_id": str(uuid.uuid4()), "text": "hello"}
        with app.test_request_context("/chat-messages/x/inputs", method="POST", json=body):
            with pytest.raises(expected):
                WebAgentChatInputApi().post(_agent_app(), _end_user(), uuid.uuid4())


class TestWebAgentChatInterruptApi:
    def test_wrong_mode_raises(self, app: Flask) -> None:
        with app.test_request_context("/chat-messages/x/inputs/y/interrupt", method="POST", json={"text": "x"}):
            with pytest.raises(NotFound):
                WebAgentChatInterruptApi().post(_chat_app(), _end_user(), uuid.uuid4(), uuid.uuid4())

    @patch("controllers.web.completion.interrupt_agent_chat_input")
    def test_interrupt_carries_text_and_scope(self, mock_interrupt: MagicMock, app: Flask) -> None:
        task_id, input_id, older = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        mock_interrupt.return_value = _handoff_receipt(input_id, [(older, "earlier"), (input_id, "urgent")])
        app_model = _agent_app()
        end_user = _end_user()
        body = {"text": "urgent"}

        with app.test_request_context("/chat-messages/x/inputs/y/interrupt", method="POST", json=body):
            result, status = WebAgentChatInterruptApi().post(app_model, end_user, task_id, input_id)

        assert status == 200
        assert result["pending_inputs"] == [
            {"input_id": str(older), "text": "earlier"},
            {"input_id": str(input_id), "text": "urgent"},
        ]
        (call,) = mock_interrupt.call_args_list
        scope, request = call.args
        assert scope.invoke_from == InvokeFrom.WEB_APP
        assert scope.task_id == task_id
        assert (request.input_id, request.text) == (input_id, "urgent")

    @pytest.mark.parametrize(
        ("error", "expected"),
        [
            (AgentChatTaskNotFoundError("nope"), NotFound),
            (AgentChatInputConflictError("nope"), Conflict),
            (AgentChatBackendUnavailableError("nope"), ServiceUnavailable),
        ],
    )
    @patch("controllers.web.completion.interrupt_agent_chat_input")
    def test_errors_map_to_http(
        self, mock_interrupt: MagicMock, error: Exception, expected: type, app: Flask
    ) -> None:
        mock_interrupt.side_effect = error
        with app.test_request_context("/chat-messages/x/inputs/y/interrupt", method="POST", json={"text": "x"}):
            with pytest.raises(expected):
                WebAgentChatInterruptApi().post(_agent_app(), _end_user(), uuid.uuid4(), uuid.uuid4())


# ---------------------------------------------------------------------------
# Route wiring: the real WebApiResource JWT decorators apply over HTTP
# ---------------------------------------------------------------------------
class TestWebAgentSteeringRouteWiring:
    def _api(self, app: Flask) -> None:
        api = Api(app)
        api.add_resource(
            WebAgentChatInterruptApi,
            "/chat-messages/<uuid:task_id>/inputs/<uuid:input_id>/interrupt",
        )

    def test_unauthorized_request_never_reaches_service(self, app: Flask) -> None:
        self._api(app)
        url = f"/chat-messages/{uuid.uuid4()}/inputs/{uuid.uuid4()}/interrupt"
        with (
            patch("controllers.web.wraps.decode_jwt_token", side_effect=Unauthorized()),
            patch("controllers.web.completion.interrupt_agent_chat_input") as mock_interrupt,
        ):
            response = app.test_client().post(url, json={"text": "hi"})
        assert response.status_code == 401
        mock_interrupt.assert_not_called()

    def test_admitted_request_scopes_to_jwt_identity(self, app: Flask) -> None:
        self._api(app)
        app_model = _agent_app()
        end_user = _end_user()
        task_id, input_id = uuid.uuid4(), uuid.uuid4()
        url = f"/chat-messages/{task_id}/inputs/{input_id}/interrupt"
        with (
            patch("controllers.web.wraps.decode_jwt_token", return_value=(app_model, end_user)),
            patch("controllers.web.completion.interrupt_agent_chat_input") as mock_interrupt,
        ):
            mock_interrupt.return_value = _handoff_receipt(input_id, [(input_id, "hi")])
            response = app.test_client().post(url, json={"text": "hi"})

        assert response.status_code == 200
        (call,) = mock_interrupt.call_args_list
        scope, request = call.args
        assert scope.invoke_from == InvokeFrom.WEB_APP
        assert (scope.tenant_id, scope.app_id, scope.user_id, scope.task_id) == (
            app_model.tenant_id,
            app_model.id,
            end_user.id,
            task_id,
        )
        assert (request.input_id, request.text) == (input_id, "hi")
