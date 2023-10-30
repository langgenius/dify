import logging
import random

import openai

from core.model_providers.error import LLMBadRequestError
from core.model_providers.providers.base import BaseModelProvider
from core.model_providers.providers.hosted import hosted_config, hosted_model_providers
from models.provider import ProviderType


def check_moderation(model_provider: BaseModelProvider, text: str) -> bool:
    if hosted_config.moderation.enabled is True and hosted_model_providers.openai:
        if model_provider.provider.provider_type == ProviderType.SYSTEM.value \
                and model_provider.provider_name in hosted_config.moderation.providers:
            # 2000 text per chunk
            length = 2000
            text_chunks = [text[i:i + length] for i in range(0, len(text), length)]

            if len(text_chunks) == 0:
                return True

            text_chunk = random.choice(text_chunks)

            try:
                moderation_result = openai.Moderation.create(input=text_chunk,
                                                             api_key=hosted_model_providers.openai.api_key)
            except Exception as ex:
                logging.exception(ex)
                raise LLMBadRequestError('Rate limit exceeded, please try again later.')

            for result in moderation_result.results:
                if result['flagged'] is True:
                    return False

    return True
