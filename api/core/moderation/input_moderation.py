import logging
from collections.abc import Mapping
from typing import Any

from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import ModerationChecked, json_safe

from core.app.app_config.entities import AppConfig
from core.app.entities.app_invoke_entities import get_credit_usage_app_type
from core.model_context import use_credit_usage_metadata
from core.moderation.base import ModerationAction, ModerationError
from core.moderation.factory import ModerationFactory
from libs.datetime_utils import measure_time

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
        trace_scope: TraceScope | None,
    ) -> tuple[bool, Mapping[str, Any], str]:
        """
        Process sensitive_word_avoidance.
        :param app_id: app id
        :param tenant_id: tenant id
        :param app_config: app config
        :param inputs: inputs
        :param query: query
        :param message_id: message id
        :param trace_scope: where the moderation verdict is reported, if anywhere
        :return:
        """
        inputs = dict(inputs)
        if not app_config.sensitive_word_avoidance:
            return False, inputs, query

        sensitive_word_avoidance_config = app_config.sensitive_word_avoidance
        moderation_type = sensitive_word_avoidance_config.type

        with use_credit_usage_metadata({"app_type": get_credit_usage_app_type(app_config.app_mode)}):
            moderation_factory = ModerationFactory(
                name=moderation_type, app_id=app_id, tenant_id=tenant_id, config=sensitive_word_avoidance_config.config
            )

            with measure_time() as timer:
                moderation_result = moderation_factory.moderation_for_inputs(inputs, query)

        if trace_scope is not None:
            trace_scope.emit(
                ModerationChecked(
                    message_id=message_id,
                    inputs={key: json_safe(value) for key, value in inputs.items()},
                    query=moderation_result.query,
                    flagged=moderation_result.flagged,
                    action=moderation_result.action.value,
                    preset_response=moderation_result.preset_response,
                    started_at=timer.started_at,
                    ended_at=timer.ended_at,
                )
            )

        if not moderation_result.flagged:
            return False, inputs, query

        if moderation_result.action == ModerationAction.DIRECT_OUTPUT:
            raise ModerationError(moderation_result.preset_response)
        elif moderation_result.action == ModerationAction.OVERRIDDEN:
            inputs = moderation_result.inputs
            query = moderation_result.query

        return True, inputs, query
