import logging
from collections.abc import Mapping
from typing import Any

from core.app.app_config.entities import AppConfig
from core.moderation.base import ModerationAction, ModerationError
from core.moderation.factory import ModerationFactory
from core.ops.ops_trace_manager import TraceQueueManager
from core.ops.utils import measure_time
from core.telemetry import TelemetryContext, TelemetryEvent, TelemetryFacade

logger = logging.getLogger(__name__)


class InputModeration:
    def check(
        self,
        app_id: str,
        tenant_id: str,
        app_config: AppConfig,
        inputs: Mapping[str, Any],
        query: str,
        message_id: str,
        trace_manager: TraceQueueManager | None = None,
    ) -> tuple[bool, Mapping[str, Any], str]:
        """
        Process sensitive_word_avoidance.
        :param app_id: app id
        :param tenant_id: tenant id
        :param app_config: app config
        :param inputs: inputs
        :param query: query
        :param message_id: message id
        :param trace_manager: trace manager
        :return:
        """
        inputs = dict(inputs)
        if not app_config.sensitive_word_avoidance:
            return False, inputs, query

        sensitive_word_avoidance_config = app_config.sensitive_word_avoidance
        moderation_type = sensitive_word_avoidance_config.type

        moderation_factory = ModerationFactory(
            name=moderation_type, app_id=app_id, tenant_id=tenant_id, config=sensitive_word_avoidance_config.config
        )

        with measure_time() as timer:
            moderation_result = moderation_factory.moderation_for_inputs(inputs, query)

        if trace_manager:
            TelemetryFacade.emit(
                TelemetryEvent(
                    name="moderation",
                    context=TelemetryContext(tenant_id=tenant_id, app_id=app_id),
                    payload={
                        "message_id": message_id,
                        "moderation_result": moderation_result,
                        "inputs": inputs,
                        "timer": timer,
                    },
                ),
                trace_manager=trace_manager,
            )

        if not moderation_result.flagged:
            return False, inputs, query

        if moderation_result.action == ModerationAction.DIRECT_OUTPUT:
            raise ModerationError(moderation_result.preset_response)
        elif moderation_result.action == ModerationAction.OVERRIDDEN:
            inputs = moderation_result.inputs
            query = moderation_result.query

        return True, inputs, query
