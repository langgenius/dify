from core.model_runtime.model_providers.__base.model_provider import ModelProvider
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
import logging

logger = logging.getLogger(__name__)

class OpenLLMProvider(ModelProvider):
    def validate_provider_credentials(self, credentials: dict) -> None:
        """
        Validate provider credentials

        if validate failed, raise exception

        :param credentials: provider credentials, credentials form defined in `provider_credential_schema`.
        """
        try:
            if credentials['model_type'] == 'text-generation':
                model_instance = self.get_model_instance(ModelType.LLM)
            elif credentials['model_type'] == 'embeddings':
                model_instance = self.get_model_instance(ModelType.TEXT_EMBEDDING)
            else:
                raise CredentialsValidateFailedError(f'model type {credentials["model_type"]} is not supported')
            model_instance.validate_credentials(
                model='',
                credentials=credentials
            )
        except CredentialsValidateFailedError as ex:
            raise ex
        except Exception as ex:
            logger.exception(f'{self.get_provider_schema().provider} credentials validate failed')
            raise ex
