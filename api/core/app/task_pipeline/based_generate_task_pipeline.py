import logging
import time
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import (
    AppGenerateEntity,
)
from core.app.entities.queue_entities import (
    QueueErrorEvent,
)
from core.app.entities.task_entities import (
    ErrorStreamResponse,
    PingStreamResponse,
)
from core.errors.error import QuotaExceededError
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.moderation.output_moderation import ModerationRule, OutputModeration
from models.enums import MessageStatus
from models.model import Message

logger = logging.getLogger(__name__)


class BasedGenerateTaskPipeline:
    """
    BasedGenerateTaskPipeline is a class that generate stream output and state management for Application.
    """

    def __init__(
        self,
        application_generate_entity: AppGenerateEntity,
        queue_manager: AppQueueManager,
        stream: bool,
    ) -> None:
        self._application_generate_entity = application_generate_entity
        self._queue_manager = queue_manager
        self._start_at = time.perf_counter()
        self._output_moderation_handler = self._init_output_moderation()
        self._stream = stream

    def _handle_error(self, *, event: QueueErrorEvent, session: Session | None = None, message_id: str = ""):
        logger.debug("error: %s", event.error)
        e = event.error
        err: Exception

        if isinstance(e, InvokeAuthorizationError):
            err = InvokeAuthorizationError("Incorrect API key provided")
        elif isinstance(e, InvokeError | ValueError):
            err = e
        else:
            err = Exception(e.description if getattr(e, "description", None) is not None else str(e))

        if not message_id or not session:
            return err

        stmt = select(Message).where(Message.id == message_id)
        message = session.scalar(stmt)
        if not message:
            return err

        err_desc = self._error_to_desc(err)
        message.status = MessageStatus.ERROR
        message.error = err_desc
        return err

    def _error_to_desc(self, e: Exception) -> str:
        """
        Error to desc.
        :param e: exception
        :return:
        """
        if isinstance(e, QuotaExceededError):
            return (
                "Your quota for Dify Hosted Model Provider has been exhausted. "
                "Please go to Settings -> Model Provider to complete your own provider credentials."
            )

        message = getattr(e, "description", str(e))
        if not message:
            message = "Internal Server Error, please contact support."

        return message

    def _error_to_stream_response(self, e: Exception):
        """
        Error to stream response.
        :param e: exception
        :return:
        """
        return ErrorStreamResponse(task_id=self._application_generate_entity.task_id, err=e)

    def _ping_stream_response(self) -> PingStreamResponse:
        """
        Ping stream response.
        :return:
        """
        return PingStreamResponse(task_id=self._application_generate_entity.task_id)

    def _init_output_moderation(self) -> Optional[OutputModeration]:
        """
        Init output moderation.
        :return:
        """
        app_config = self._application_generate_entity.app_config
        sensitive_word_avoidance = app_config.sensitive_word_avoidance

        if sensitive_word_avoidance:
            return OutputModeration(
                tenant_id=app_config.tenant_id,
                app_id=app_config.app_id,
                rule=ModerationRule(type=sensitive_word_avoidance.type, config=sensitive_word_avoidance.config),
                queue_manager=self._queue_manager,
            )
        return None

    def _handle_output_moderation_when_task_finished(self, completion: str) -> Optional[str]:
        """
        Handle output moderation when task finished.
        :param completion: completion
        :return:
        """
        # response moderation
        if self._output_moderation_handler:
            self._output_moderation_handler.stop_thread()

            completion, flagged = self._output_moderation_handler.moderation_completion(
                completion=completion, public_event=False
            )

            self._output_moderation_handler = None
            if flagged:
                return completion

        return None
