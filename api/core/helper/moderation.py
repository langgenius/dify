import logging
import random

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.model_providers.openai.moderation.moderation import OpenAIModerationModel
from extensions.ext_hosting_provider import hosting_configuration
from models.provider import ProviderType

logger = logging.getLogger(__name__)


def check_moderation(model_config: ModelConfigWithCredentialsEntity, text: str) -> bool:
    moderation_config = hosting_configuration.moderation_config
    if (moderation_config and moderation_config.enabled is True
            and 'openai' in hosting_configuration.provider_map
            and hosting_configuration.provider_map['openai'].enabled is True
    ):
        using_provider_type = model_config.provider_model_bundle.configuration.using_provider_type
        provider_name = model_config.provider
        if using_provider_type == ProviderType.SYSTEM \
                and provider_name in moderation_config.providers:
            hosting_openai_config = hosting_configuration.provider_map['openai']

            # 2000 text per chunk
            length = 2000
            text_chunks = [text[i:i + length] for i in range(0, len(text), length)]

            if len(text_chunks) == 0:
                return True

            text_chunk = random.choice(text_chunks)

            try:
                model_type_instance = OpenAIModerationModel()
                moderation_result = model_type_instance.invoke(
                    model='text-moderation-stable',
                    credentials=hosting_openai_config.credentials,
                    text=text_chunk
                )

                if moderation_result is True:
                    return True
            except Exception as ex:
                logger.exception(ex)
                raise InvokeBadRequestError('Rate limit exceeded, please try again later.')

    return False
