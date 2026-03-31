from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError

from core.app.entities.queue_entities import QueueErrorEvent
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.errors.error import QuotaExceededError
from models.enums import MessageStatus


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

    def test_handle_error_updates_message_when_found(self, pipeline):
        event = QueueErrorEvent(error=ValueError("oops"))
        message = SimpleNamespace(status=MessageStatus.NORMAL, error=None)
        session = Mock()
        session.scalar.return_value = message

        err = pipeline.handle_error(event=event, session=session, message_id="msg-1")

        assert err is event.error
        assert message.status == MessageStatus.ERROR
        assert message.error == "oops"

    def test_handle_error_returns_err_when_message_missing(self, pipeline):
        event = QueueErrorEvent(error=ValueError("oops"))
        session = Mock()
        session.scalar.return_value = None

        err = pipeline.handle_error(event=event, session=session, message_id="msg-1")

        assert err is event.error

    def test_error_to_stream_response_and_ping(self, pipeline):
        error_response = pipeline.error_to_stream_response(ValueError("boom"))
        ping_response = pipeline.ping_stream_response()

        assert error_response.task_id == "task-1"
        assert ping_response.task_id == "task-1"

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
