import logging

from core.app.entities.app_invoke_entities import EasyUIBasedAppGenerateEntity
from core.helper import moderation
from core.model_runtime.entities.message_entities import PromptMessage

logger = logging.getLogger(__name__)


class HostingModerationFeature:
    def check(
        self, application_generate_entity: EasyUIBasedAppGenerateEntity, prompt_messages: list[PromptMessage]
    ) -> bool:
        """
        Check hosting moderation
        :param application_generate_entity: application generate entity
        :param prompt_messages: prompt messages
        :return:
        """
        model_config = application_generate_entity.model_conf

        text = ""
        for prompt_message in prompt_messages:
            if isinstance(prompt_message.content, str):
                text += prompt_message.content + "\n"

        moderation_result = moderation.check_moderation(model_config, text)

        return moderation_result
