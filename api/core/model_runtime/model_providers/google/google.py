import logging
from typing import Any, Optional

import google.generativeai.client as GoogleGenerativeAiClient

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.model_client_provider import ModelClientProvider
from core.model_runtime.model_providers.__base.model_provider import ModelProvider

logger = logging.getLogger(__name__)


class GoogleProvider(ModelProvider, ModelClientProvider):
    def validate_provider_credentials(self, credentials: dict) -> None:
        """
        Validate provider credentials

        if validate failed, raise exception

        :param credentials: provider credentials, credentials form defined in `provider_credential_schema`.
        """
        try:
            model_instance = self.get_model_instance(ModelType.LLM)

            # Use `gemini-pro` model for validate,
            model_instance.validate_credentials(
                model='gemini-pro',
                credentials=credentials
            )
        except CredentialsValidateFailedError as ex:
            raise ex
        except Exception as ex:
            logger.exception(f'{self.get_provider_schema().provider} credentials validate failed')
            raise ex

    @staticmethod
    def get_service_client(credentials: Optional[dict] = None, **kwargs: Any) -> Any:
        new_client_manager = GoogleGenerativeAiClient._ClientManager()
        new_client_manager.configure(
            api_key=credentials["google_api_key"],
        )
        client = new_client_manager.make_client(name=kwargs['name'])
        return client
