from decimal import Decimal
from unittest.mock import Mock

import pytest
from dify_agent.protocol import RunFailureType
from sqlalchemy.orm import Session

from clients.agent_backend.errors import AgentBackendRunFailedError
from core.app.app_config.entities import (
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.base_app_generate_response_converter import AppGenerateResponseConverter
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import QueueErrorEvent
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.errors.error import QuotaExceededError
from core.plugin.impl.exc import PluginDaemonInternalError, PluginInvokeError, PluginRuntimeError
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError, InvokeRateLimitError
from models.enums import ConversationFromSource, MessageStatus
from models.model import AppMode, Message


def _persist_message(session: Session, *, message_id: str) -> Message:
    message = Message(
        id=message_id,
        app_id="app-1",
        model_provider=None,
        model_id=None,
        override_model_configs=None,
        conversation_id="conversation-1",
        _inputs={},
        query="query",
        message={},
        message_unit_price=Decimal(0),
        answer="",
        answer_unit_price=Decimal(0),
        parent_message_id=None,
        total_price=None,
        currency="USD",
        status=MessageStatus.NORMAL,
        error=None,
        message_metadata=None,
        invoke_from=InvokeFrom.WEB_APP,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id="account-1",
        workflow_run_id=None,
        app_mode=AppMode.COMPLETION,
    )
    session.add(message)
    session.commit()
    session.expunge_all()
    return message


class TestBasedGenerateTaskPipeline:
    @pytest.fixture
    def pipeline(self) -> BasedGenerateTaskPipeline[AppGenerateEntity]:
        app_config = EasyUIBasedAppConfig(
            tenant_id="tenant-1",
            app_id="app-1",
            app_mode=AppMode.AGENT,
            app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
            app_model_config_dict={},
            model=ModelConfigEntity(provider="openai", model="gpt-test", mode="chat"),
            prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
        )
        app_generate_entity = AppGenerateEntity(
            task_id="task-1",
            app_config=app_config,
            inputs={},
            files=[],
            user_id="user-1",
            stream=True,
            invoke_from=InvokeFrom.DEBUGGER,
        )
        return BasedGenerateTaskPipeline(
            application_generate_entity=app_generate_entity,
            queue_manager=MessageBasedAppQueueManager(
                task_id="task-1",
                user_id="user-1",
                invoke_from=InvokeFrom.DEBUGGER,
                conversation_id="conversation-1",
                app_mode=AppMode.AGENT,
                message_id="message-1",
            ),
            stream=True,
        )

    def test_error_to_desc_quota_exceeded(self, pipeline):
        message = pipeline._error_to_desc(QuotaExceededError())
        assert "quota" in message.lower()

    def test_handle_error_wraps_invoke_authorization(
        self, pipeline: BasedGenerateTaskPipeline[AppGenerateEntity]
    ) -> None:
        event = QueueErrorEvent(error=InvokeAuthorizationError())
        backend_error = AgentBackendRunFailedError("run-1", {}, reason="InvokeAuthorizationError")
        event.error.__cause__ = backend_error
        err = pipeline.handle_error(event=event)
        assert isinstance(err, InvokeAuthorizationError)
        assert str(err) == "Incorrect API key provided"
        assert err.__cause__ is event.error
        assert err.__cause__.__cause__ is backend_error

    @pytest.mark.parametrize(
        "error",
        [
            PluginRuntimeError("runtime failed"),
            PluginDaemonInternalError("daemon failed"),
            PluginInvokeError("invoke failed"),
        ],
    )
    def test_handle_error_preserves_plugin_failures(
        self, pipeline: BasedGenerateTaskPipeline[AppGenerateEntity], error: Exception
    ) -> None:
        assert pipeline.handle_error(event=QueueErrorEvent(error=error)) is error

    def test_handle_error_preserves_unexpected_failure_as_cause(
        self, pipeline: BasedGenerateTaskPipeline[AppGenerateEntity]
    ) -> None:
        error = RuntimeError("private failure")
        result = pipeline.handle_error(event=QueueErrorEvent(error=error))
        assert type(result) is Exception
        assert result.__cause__ is error

    def test_handle_error_preserves_invoke_error(self, pipeline):
        event = QueueErrorEvent(error=InvokeError("bad"))
        err = pipeline.handle_error(event=event)
        assert err is event.error

    def test_handle_error_preserves_agent_backend_run_failed_error(self, pipeline):
        event = QueueErrorEvent(
            error=AgentBackendRunFailedError(
                "run-1",
                {"reason": "knowledge_retrieve_failed"},
                message="Knowledge retrieval failed",
                reason="knowledge_retrieve_failed",
            )
        )

        err = pipeline.handle_error(event=event)

        assert err is event.error
        assert "Knowledge retrieval failed" in str(err)
        assert "agent_run_id=run-1" in str(err)

    @pytest.mark.parametrize("sqlite_session", [(Message,)], indirect=True)
    def test_handle_error_updates_message_when_found(self, pipeline, sqlite_session: Session):
        event = QueueErrorEvent(error=ValueError("oops"))
        _persist_message(sqlite_session, message_id="msg-1")

        err = pipeline.handle_error(event=event, session=sqlite_session, message_id="msg-1")

        assert err is event.error
        sqlite_session.flush()
        sqlite_session.expire_all()
        updated_message = sqlite_session.get(Message, "msg-1")
        assert updated_message is not None
        assert updated_message.status == MessageStatus.ERROR
        assert updated_message.error == "oops"

    @pytest.mark.parametrize("sqlite_session", [(Message,)], indirect=True)
    def test_handle_error_returns_err_when_message_missing(self, pipeline, sqlite_session: Session):
        event = QueueErrorEvent(error=ValueError("oops"))
        _persist_message(sqlite_session, message_id="other-message")

        err = pipeline.handle_error(event=event, session=sqlite_session, message_id="msg-1")

        assert err is event.error
        untouched_message = sqlite_session.get(Message, "other-message")
        assert untouched_message is not None
        assert untouched_message.status == MessageStatus.NORMAL
        assert untouched_message.error is None

    def test_error_to_stream_response_and_ping(self, pipeline):
        error_response = pipeline.error_to_stream_response(ValueError("boom"))
        ping_response = pipeline.ping_stream_response()

        assert error_response.task_id == "task-1"
        assert ping_response.task_id == "task-1"

    def test_stream_converter_maps_invoke_rate_limit_error(self):
        data = AppGenerateResponseConverter._error_to_stream_response(InvokeRateLimitError("quota exceeded"))

        assert data == {"code": "rate_limit_error", "status": 429, "message": "quota exceeded"}

    def test_stream_converter_maps_agent_backend_run_failed_error(self):
        data = AppGenerateResponseConverter._error_to_stream_response(
            AgentBackendRunFailedError(
                "run-1",
                {"reason": "knowledge_retrieve_failed"},
                message="Knowledge retrieval failed",
                reason="knowledge_retrieve_failed",
            )
        )

        assert data == {
            "code": "completion_request_error",
            "status": 400,
            "message": "Knowledge retrieval failed (agent_run_id=run-1)",
        }

    def test_stream_converter_maps_agent_run_limit_error(self):
        data = AppGenerateResponseConverter._error_to_stream_response(
            AgentBackendRunFailedError(
                "run-1",
                {},
                message="run limit reached",
                error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED,
            )
        )

        assert data == {
            "code": "agent_run_limit_exceeded",
            "status": 400,
            "message": "run limit reached (agent_run_id=run-1)",
        }

    def test_handle_output_moderation_when_flagged(self, pipeline):
        handler = Mock()
        handler.moderation_completion.return_value = ("filtered", True)
        pipeline.output_moderation_handler = handler

        result = pipeline.handle_output_moderation_when_task_finished("raw")

        assert result == "filtered"
        handler.stop_thread.assert_called_once()
        assert pipeline.output_moderation_handler is None

    def test_handle_output_moderation_when_not_flagged(self, pipeline):
        handler = Mock()
        handler.moderation_completion.return_value = ("safe", False)
        pipeline.output_moderation_handler = handler

        result = pipeline.handle_output_moderation_when_task_finished("raw")

        assert result is None
        handler.stop_thread.assert_called_once()
        assert pipeline.output_moderation_handler is None
