import logging
from collections.abc import Mapping
from typing import Any

from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import ModerationChecked, json_safe

from core.app.app_config.entities import AppConfig
from core.app.entities.app_invoke_entities import get_credit_usage_app_type
from core.model_context import use_credit_usage_metadata
from core.moderation.base import ModerationAction, ModerationError, ModerationInputsResult
from core.moderation.factory import ModerationFactory, get_app_moderation
from extensions.application_services.moderation_policy import platform_owns_openai_moderation
from libs.datetime_utils import measure_time

logger = logging.getLogger(__name__)


def evaluate_app_input(
    app_config: AppConfig, inputs: Mapping[str, object], query: str, *, platform_owned: bool
) -> ModerationInputsResult | None:
    """Delegate to the injected app port; standalone callers retain their legacy backend."""
    moderation = get_app_moderation()
    if moderation is not None:
        return moderation.evaluate_input(app_config, inputs, query, platform_owned=platform_owned)
    rule = app_config.sensitive_word_avoidance
    if rule is None:
        return None
    if rule.type == "openai_moderation" and platform_owned:
        return ModerationInputsResult(
            flagged=False, action=ModerationAction.DIRECT_OUTPUT, inputs=dict(inputs), query=query
        )
    return ModerationFactory(rule.type, app_config.app_id, app_config.tenant_id, rule.config).moderation_for_inputs(
        dict(inputs), query
    )


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
        *,
        platform_owned: bool | None = None,
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
        :param platform_owned: whether platform guards own OpenAI checks for this invocation;
            None falls back to the deployment-level gate
        :return:
        """
        inputs = dict(inputs)
        if not app_config.sensitive_word_avoidance:
            return False, inputs, query
        if platform_owned is None:
            platform_owned = app_config.sensitive_word_avoidance.type == "openai_moderation" and (
                platform_owns_openai_moderation()
            )

        with use_credit_usage_metadata({"app_type": get_credit_usage_app_type(app_config.app_mode)}):
            with measure_time() as timer:
                moderation_result = evaluate_app_input(app_config, inputs, query, platform_owned=platform_owned)
        if moderation_result is None:
            return False, inputs, query

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
