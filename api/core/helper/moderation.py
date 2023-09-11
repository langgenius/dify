import logging

import openai
from flask import current_app

from core.model_providers.error import LLMBadRequestError
from core.model_providers.providers.base import BaseModelProvider
from models.provider import ProviderType


def check_moderation(model_provider: BaseModelProvider, text: str) -> bool:
    if current_app.config['HOSTED_MODERATION_ENABLED'] and current_app.config['HOSTED_MODERATION_PROVIDERS']:
        moderation_providers = current_app.config['HOSTED_MODERATION_PROVIDERS'].split(',')

        if model_provider.provider.provider_type == ProviderType.SYSTEM.value \
                and model_provider.provider_name in moderation_providers:
            # 2000 text per chunk
            length = 2000
            chunks = [text[i:i + length] for i in range(0, len(text), length)]

            try:
                moderation_result = openai.Moderation.create(input=chunks,
                                                             api_key=current_app.config['HOSTED_OPENAI_API_KEY'])
            except Exception as ex:
                logging.exception(ex)
                raise LLMBadRequestError('Rate limit exceeded, please try again later.')

            for result in moderation_result.results:
                if result['flagged'] is True:
                    return False

    return True
