import logging

from core.entities.application_entities import AppOrchestrationConfigEntity
from core.moderation.base import ModerationAction, ModerationException
from core.moderation.factory import ModerationFactory

logger = logging.getLogger(__name__)


class ModerationFeature:
    def check(self, app_id: str,
              tenant_id: str,
              app_orchestration_config_entity: AppOrchestrationConfigEntity,
              inputs: dict,
              query: str) -> tuple[bool, dict, str]:
        """
        Process sensitive_word_avoidance.
        :param app_id: app id
        :param tenant_id: tenant id
        :param app_orchestration_config_entity: app orchestration config entity
        :param inputs: inputs
        :param query: query
        :return:
        """
        if not app_orchestration_config_entity.sensitive_word_avoidance:
            return False, inputs, query

        sensitive_word_avoidance_config = app_orchestration_config_entity.sensitive_word_avoidance
        moderation_type = sensitive_word_avoidance_config.type

        moderation_factory = ModerationFactory(
            name=moderation_type,
            app_id=app_id,
            tenant_id=tenant_id,
            config=sensitive_word_avoidance_config.config
        )

        moderation_result = moderation_factory.moderation_for_inputs(inputs, query)

        if not moderation_result.flagged:
            return False, inputs, query

        if moderation_result.action == ModerationAction.DIRECT_OUTPUT:
            raise ModerationException(moderation_result.preset_response)
        elif moderation_result.action == ModerationAction.OVERRIDED:
            inputs = moderation_result.inputs
            query = moderation_result.query

        return True, inputs, query
