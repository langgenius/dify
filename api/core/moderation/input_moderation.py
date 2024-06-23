import logging
from typing import Any, Optional

from core.app.app_config.entities import AppConfig
from core.moderation.base import ModerationAction, ModerationException
from core.moderation.factory import ModerationFactory
from core.ops.trace_queue_manager import TraceQueueManager, TraceTask, TraceTaskName
from core.ops.utils import measure_time

logger = logging.getLogger(__name__)


class InputModeration:
    def check(
        self, app_id: str,
        tenant_id: str,
        app_config: AppConfig,
        inputs: dict,
        query: str,
        message_id: str,
        tracing_instance: Optional[Any] = None
    ) -> tuple[bool, dict, str]:
        """
        Process sensitive_word_avoidance.
        :param app_id: app id
        :param tenant_id: tenant id
        :param app_config: app config
        :param inputs: inputs
        :param query: query
        :param message_id: message id
        :param tracing_instance: tracing instance
        :return:
        """
        if not app_config.sensitive_word_avoidance:
            return False, inputs, query

        sensitive_word_avoidance_config = app_config.sensitive_word_avoidance
        moderation_type = sensitive_word_avoidance_config.type

        moderation_factory = ModerationFactory(
            name=moderation_type,
            app_id=app_id,
            tenant_id=tenant_id,
            config=sensitive_word_avoidance_config.config
        )

        with measure_time() as timer:
            moderation_result = moderation_factory.moderation_for_inputs(inputs, query)

        if tracing_instance:
            trace_manager = TraceQueueManager()
            trace_manager.add_trace_task(
                TraceTask(
                    tracing_instance,
                    TraceTaskName.MODERATION_TRACE,
                    message_id=message_id,
                    moderation_result=moderation_result,
                    inputs=inputs,
                    timer=timer
                )
            )
        
        if not moderation_result.flagged:
            return False, inputs, query

        if moderation_result.action == ModerationAction.DIRECT_OUTPUT:
            raise ModerationException(moderation_result.preset_response)
        elif moderation_result.action == ModerationAction.OVERRIDED:
            inputs = moderation_result.inputs
            query = moderation_result.query

        return True, inputs, query
