from typing import Optional, Union

from core.llm.provider.anthropic_provider import AnthropicProvider
from core.llm.provider.azure_provider import AzureProvider
from core.llm.provider.base import BaseProvider
from core.llm.provider.huggingface_provider import HuggingfaceProvider
from core.llm.provider.openai_provider import OpenAIProvider
from models.provider import Provider


class LLMProviderService:

    def __init__(self, tenant_id: str, provider_name: str):
        self.provider = self.init_provider(tenant_id, provider_name)

    def init_provider(self, tenant_id: str, provider_name: str) -> BaseProvider:
        if provider_name == 'openai':
            return OpenAIProvider(tenant_id)
        elif provider_name == 'azure_openai':
            return AzureProvider(tenant_id)
        elif provider_name == 'anthropic':
            return AnthropicProvider(tenant_id)
        elif provider_name == 'huggingface':
            return HuggingfaceProvider(tenant_id)
        else:
            raise Exception('provider {} not found'.format(provider_name))

    def get_models(self, model_id: Optional[str] = None) -> list[dict]:
        return self.provider.get_models(model_id)

    def get_credentials(self, model_id: Optional[str] = None) -> dict:
        return self.provider.get_credentials(model_id)

    def get_provider_configs(self, obfuscated: bool = False, only_custom: bool = False) -> Union[str | dict]:
        return self.provider.get_provider_configs(obfuscated=obfuscated, only_custom=only_custom)

    def get_provider_db_record(self) -> Optional[Provider]:
        return self.provider.get_provider()

    def config_validate(self, config: Union[dict | str]):
        """
        Validates the given config.

        :param config:
        :raises: ValidateFailedError
        """
        return self.provider.config_validate(config)

    def get_token_type(self):
        return self.provider.get_token_type()

    def get_encrypted_token(self, config: Union[dict | str]):
        return self.provider.get_encrypted_token(config)
