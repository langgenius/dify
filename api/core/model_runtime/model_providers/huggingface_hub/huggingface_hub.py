import logging
from typing import Any, Optional

from huggingface_hub import InferenceClient

from core.model_runtime.model_providers.__base.model_client_provider import ModelClientProvider
from core.model_runtime.model_providers.__base.model_provider import ModelProvider

logger = logging.getLogger(__name__)


class HuggingfaceHubProvider(ModelProvider, ModelClientProvider):

    def validate_provider_credentials(self, credentials: dict) -> None:
        pass

    @staticmethod
    def get_service_client(credentials: Optional[dict] = None, **kwargs: Any) -> InferenceClient:
        client = InferenceClient(
            token=credentials['huggingfacehub_api_token'],
        )
        return client
