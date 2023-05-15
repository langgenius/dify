from typing import Optional

from core.llm.provider.base import BaseProvider
from models.provider import ProviderName


class AnthropicProvider(BaseProvider):
    def get_models(self, model_id: Optional[str] = None) -> list[dict]:
        credentials = self.get_credentials(model_id)
        # todo
        return []

    def get_credentials(self, model_id: Optional[str] = None) -> dict:
        """
        Returns the API credentials for Azure OpenAI as a dictionary, for the given tenant_id.
        The dictionary contains keys: azure_api_type, azure_api_version, azure_api_base, and azure_api_key.
        """
        return {
            'anthropic_api_key': self.get_provider_api_key(model_id=model_id)
        }

    def get_provider_name(self):
        return ProviderName.ANTHROPIC