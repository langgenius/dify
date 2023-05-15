from typing import Optional

from core.llm.provider.base import BaseProvider
from models.provider import ProviderName


class HuggingfaceProvider(BaseProvider):
    def get_models(self, model_id: Optional[str] = None) -> list[dict]:
        credentials = self.get_credentials(model_id)
        # todo
        return []

    def get_credentials(self, model_id: Optional[str] = None) -> dict:
        """
        Returns the API credentials for Huggingface as a dictionary, for the given tenant_id.
        """
        return {
            'huggingface_api_key': self.get_provider_api_key(model_id=model_id)
        }

    def get_provider_name(self):
        return ProviderName.HUGGINGFACEHUB