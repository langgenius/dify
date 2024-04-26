import logging
from typing import Any, Optional

from anthropic import AnthropicBedrock

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.model_client_provider import ModelClientProvider
from core.model_runtime.model_providers.__base.model_provider import ModelProvider

logger = logging.getLogger(__name__)


class BedrockProvider(ModelProvider, ModelClientProvider):
    def validate_provider_credentials(self, credentials: dict) -> None:
        """
        Validate provider credentials

        if validate failed, raise exception

        :param credentials: provider credentials, credentials form defined in `provider_credential_schema`.
        """
        try:
            model_instance = self.get_model_instance(ModelType.LLM)

            # Use `amazon.titan-text-lite-v1` model by default for validating credentials
            model_for_validation = credentials.get('model_for_validation', 'amazon.titan-text-lite-v1')
            model_instance.validate_credentials(
                model=model_for_validation,
                credentials=credentials
            )
        except CredentialsValidateFailedError as ex:
            raise ex
        except Exception as ex:
            logger.exception(f'{self.get_provider_schema().provider} credentials validate failed')
            raise ex

    @staticmethod
    def get_service_client(credentials: Optional[dict] = None, **kwargs: Any) -> AnthropicBedrock:
        client = AnthropicBedrock(
            aws_access_key=credentials["aws_access_key_id"],
            aws_secret_key=credentials["aws_secret_access_key"],
            aws_region=credentials["aws_region"],
        )
        return client
