import json
import logging
from typing import Optional, Union

import anthropic
from langchain.chat_models import ChatAnthropic
from langchain.schema import HumanMessage

from core import hosted_llm_credentials
from core.llm.error import ProviderTokenNotInitError
from core.llm.provider.base import BaseProvider
from core.llm.provider.errors import ValidateFailedError
from models.provider import ProviderName, ProviderType


class AnthropicProvider(BaseProvider):
    def get_models(self, model_id: Optional[str] = None) -> list[dict]:
        return [
            {
                'id': 'claude-instant-1',
                'name': 'claude-instant-1',
            },
            {
                'id': 'claude-2',
                'name': 'claude-2',
            },
        ]

    def get_credentials(self, model_id: Optional[str] = None) -> dict:
        return self.get_provider_api_key(model_id=model_id)

    def get_provider_name(self):
        return ProviderName.ANTHROPIC

    def get_provider_configs(self, obfuscated: bool = False, only_custom: bool = False) -> Union[str | dict]:
        """
        Returns the provider configs.
        """
        try:
            config = self.get_provider_api_key(only_custom=only_custom)
        except:
            config = {
                'anthropic_api_key': ''
            }

        if obfuscated:
            if not config.get('anthropic_api_key'):
                config = {
                    'anthropic_api_key': ''
                }

            config['anthropic_api_key'] = self.obfuscated_token(config.get('anthropic_api_key'))
            return config

        return config

    def get_encrypted_token(self, config: Union[dict | str]):
        """
        Returns the encrypted token.
        """
        return json.dumps({
            'anthropic_api_key': self.encrypt_token(config['anthropic_api_key'])
        })

    def get_decrypted_token(self, token: str):
        """
        Returns the decrypted token.
        """
        config = json.loads(token)
        config['anthropic_api_key'] = self.decrypt_token(config['anthropic_api_key'])
        return config

    def get_token_type(self):
        return dict

    def config_validate(self, config: Union[dict | str]):
        """
        Validates the given config.
        """
        # check OpenAI / Azure OpenAI credential is valid
        openai_provider = BaseProvider.get_valid_provider(self.tenant_id, ProviderName.OPENAI.value)
        azure_openai_provider = BaseProvider.get_valid_provider(self.tenant_id, ProviderName.AZURE_OPENAI.value)

        provider = None
        if openai_provider:
            provider = openai_provider
        elif azure_openai_provider:
            provider = azure_openai_provider

        if not provider:
            raise ValidateFailedError(f"OpenAI or Azure OpenAI provider must be configured first.")

        if provider.provider_type == ProviderType.SYSTEM.value:
            quota_used = provider.quota_used if provider.quota_used is not None else 0
            quota_limit = provider.quota_limit if provider.quota_limit is not None else 0
            if quota_used >= quota_limit:
                raise ValidateFailedError(f"Your quota for Dify Hosted OpenAI has been exhausted, "
                                          f"please configure OpenAI or Azure OpenAI provider first.")

        try:
            if not isinstance(config, dict):
                raise ValueError('Config must be a object.')

            if 'anthropic_api_key' not in config:
                raise ValueError('anthropic_api_key must be provided.')

            chat_llm = ChatAnthropic(
                model='claude-instant-1',
                anthropic_api_key=config['anthropic_api_key'],
                max_tokens_to_sample=10,
                temperature=0,
                default_request_timeout=60
            )

            messages = [
                HumanMessage(
                    content="ping"
                )
            ]

            chat_llm(messages)
        except anthropic.APIConnectionError as ex:
            raise ValidateFailedError(f"Anthropic: Connection error, cause: {ex.__cause__}")
        except (anthropic.APIStatusError, anthropic.RateLimitError) as ex:
            raise ValidateFailedError(f"Anthropic: Error code: {ex.status_code} - "
                                      f"{ex.body['error']['type']}: {ex.body['error']['message']}")
        except Exception as ex:
            logging.exception('Anthropic config validation failed')
            raise ex

    def get_hosted_credentials(self) -> Union[str | dict]:
        if not hosted_llm_credentials.anthropic or not hosted_llm_credentials.anthropic.api_key:
            raise ProviderTokenNotInitError(
                f"No valid {self.get_provider_name().value} model provider credentials found. "
                f"Please go to Settings -> Model Provider to complete your provider credentials."
            )

        return {'anthropic_api_key': hosted_llm_credentials.anthropic.api_key}
