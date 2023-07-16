import logging
from typing import Optional, Union

import openai
from openai.error import AuthenticationError, OpenAIError

from core import hosted_llm_credentials
from core.llm.error import ProviderTokenNotInitError
from core.llm.moderation import Moderation
from core.llm.provider.base import BaseProvider
from core.llm.provider.errors import ValidateFailedError
from models.provider import ProviderName


class OpenAIProvider(BaseProvider):
    def get_models(self, model_id: Optional[str] = None) -> list[dict]:
        credentials = self.get_credentials(model_id)
        response = openai.Model.list(**credentials)

        return [{
            'id': model['id'],
            'name': model['id'],
        } for model in response['data']]

    def get_credentials(self, model_id: Optional[str] = None) -> dict:
        """
        Returns the credentials for the given tenant_id and provider_name.
        """
        return {
            'openai_api_key': self.get_provider_api_key(model_id=model_id)
        }

    def get_provider_name(self):
        return ProviderName.OPENAI

    def config_validate(self, config: Union[dict | str]):
        """
        Validates the given config.
        """
        try:
            Moderation(self.get_provider_name().value, config).moderate('test')
        except (AuthenticationError, OpenAIError) as ex:
            raise ValidateFailedError(str(ex))
        except Exception as ex:
            logging.exception('OpenAI config validation failed')
            raise ex

    def get_hosted_credentials(self) -> Union[str | dict]:
        if not hosted_llm_credentials.openai or not hosted_llm_credentials.openai.api_key:
            raise ProviderTokenNotInitError(
                f"No valid {self.get_provider_name().value} model provider credentials found. "
                f"Please go to Settings -> Model Provider to complete your provider credentials."
            )

        return hosted_llm_credentials.openai.api_key
