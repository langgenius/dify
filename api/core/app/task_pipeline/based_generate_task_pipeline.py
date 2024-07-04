import logging
import time
from typing import Optional, Union

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
    TaskState,
)
from core.errors.error import QuotaExceededError
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.moderation.output_moderation import ModerationRule, OutputModeration
from extensions.ext_database import db
from models.account import Account
from models.model import EndUser, Message

logger = logging.getLogger(__name__)


class BasedGenerateTaskPipeline:
    """
    BasedGenerateTaskPipeline is a class that generate stream output and state management for Application.
    """

    _task_state: TaskState
    _application_generate_entity: AppGenerateEntity

    def __init__(self, application_generate_entity: AppGenerateEntity,
                 queue_manager: AppQueueManager,
                 user: Union[Account, EndUser],
                 stream: bool) -> None:
        """
        Initialize GenerateTaskPipeline.
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param user: user
        :param stream: stream
        """
        self._application_generate_entity = application_generate_entity
        self._queue_manager = queue_manager
        self._user = user
        self._start_at = time.perf_counter()
        self._output_moderation_handler = self._init_output_moderation()
        self._stream = stream

    def _handle_error(self, event: QueueErrorEvent, message: Optional[Message] = None) -> Exception:
        """
        Handle error event.
        :param event: event
        :param message: message
        :return:
        """
        logger.debug("error: %s", event.error)
        e = event.error

        if isinstance(e, InvokeAuthorizationError):
            err = InvokeAuthorizationError('Incorrect API key provided')
        elif isinstance(e, InvokeError) or isinstance(e, ValueError):
            err = e
        else:
            err = Exception(e.description if getattr(e, 'description', None) is not None else str(e))

        if message:
            message = db.session.query(Message).filter(Message.id == message.id).first()
            err_desc = self._error_to_desc(err)
            message.status = 'error'
            message.error = err_desc

            db.session.commit()

        return err

    def _error_to_desc(cls, e: Exception) -> str:
        """
        Error to desc.
        :param e: exception
        :return:
        """
        if isinstance(e, QuotaExceededError):
            return ("Your quota for Dify Hosted Model Provider has been exhausted. "
                    "Please go to Settings -> Model Provider to complete your own provider credentials.")

        message = getattr(e, 'description', str(e))
        if not message:
            message = 'Internal Server Error, please contact support.'

        return message

    def _error_to_stream_response(self, e: Exception) -> ErrorStreamResponse:
        """
        Error to stream response.
        :param e: exception
        :return:
        """
        return ErrorStreamResponse(
            task_id=self._application_generate_entity.task_id,
            err=e
        )

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
                rule=ModerationRule(
                    type=sensitive_word_avoidance.type,
                    config=sensitive_word_avoidance.config
                ),
                queue_manager=self._queue_manager
            )

    def _handle_output_moderation_when_task_finished(self, completion: str) -> Optional[str]:
        """
        Handle output moderation when task finished.
        :param completion: completion
        :return:
        """
        # response moderation
        if self._output_moderation_handler:
            self._output_moderation_handler.stop_thread()

            completion = self._output_moderation_handler.moderation_completion(
                completion=completion,
                public_event=False
            )

            self._output_moderation_handler = None

            return completion

        return None
