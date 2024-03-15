import logging
import os

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.model_provider import ModelProvider

logger = logging.getLogger(__name__)

class BedrockProvider(ModelProvider):
    def validate_provider_credentials(self, credentials: dict) -> None:
        """
        Validate provider credentials

        if validate failed, raise exception

        :param credentials: provider credentials, credentials form defined in `provider_credential_schema`.
        """
        try:
            model_instance = self.get_model_instance(ModelType.LLM)

            default_bedrock_validate_model_name = 'amazon.titan-text-lite-v1'
            bedrock_validate_model_name = os.getenv('AWS_BEDROCK_VALIDATE_MODEL')
            if bedrock_validate_model_name == "":
                bedrock_validate_model_name = default_bedrock_validate_model_name

            model_instance.validate_credentials(
                model=bedrock_validate_model_name,
                credentials=credentials
            )
        except CredentialsValidateFailedError as ex:
            raise ex
        except Exception as ex:
            logger.exception(f'{self.get_provider_schema().provider} credentials validate failed')
            raise ex
