from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from dify_agent.protocol import RunFailureType

from clients.agent_backend.errors import AgentBackendRunFailedError
from core.app.apps.base_app_generate_response_converter import AppGenerateResponseConverter
from core.app.entities.queue_entities import QueueErrorEvent
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.errors.error import QuotaExceededError
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError, InvokeRateLimitError
from services.app.generation.errors import AgentSessionSnapshotIncompatibleError


class TestBasedGenerateTaskPipeline:
    @pytest.fixture
    def pipeline(self):
        app_config = SimpleNamespace(
            tenant_id="tenant-1",
            app_id="app-1",
            sensitive_word_avoidance=None,
        )
        app_generate_entity = SimpleNamespace(task_id="task-1", app_config=app_config)
        return BasedGenerateTaskPipeline(
            application_generate_entity=app_generate_entity,
            queue_manager=Mock(),
            stream=True,
        )

    def test_error_to_desc_quota_exceeded(self, pipeline):
        message = pipeline._error_to_desc(QuotaExceededError())
        assert "quota" in message.lower()

    def test_handle_error_wraps_invoke_authorization(self, pipeline):
        event = QueueErrorEvent(error=InvokeAuthorizationError())
        err = pipeline.handle_error(event=event)
        assert isinstance(err, InvokeAuthorizationError)
        assert str(err) == "Incorrect API key provided"

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

    def test_stream_converter_preserves_agent_session_configuration_error(self):
        data = AppGenerateResponseConverter._error_to_stream_response(AgentSessionSnapshotIncompatibleError())

        assert data == {
            "code": "agent_session_configuration_changed",
            "status": 409,
            "message": (
                "The Agent configuration changed after this conversation started. Start a new conversation to continue."
            ),
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
