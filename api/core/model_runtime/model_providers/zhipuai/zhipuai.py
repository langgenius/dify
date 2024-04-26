import logging
from typing import Any, Optional

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.model_client_provider import ModelClientProvider
from core.model_runtime.model_providers.__base.model_provider import ModelProvider
from core.model_runtime.model_providers.zhipuai.zhipuai_sdk import ZhipuAI

logger = logging.getLogger(__name__)


class ZhipuaiProvider(ModelProvider, ModelClientProvider):
    def validate_provider_credentials(self, credentials: dict) -> None:
        """
        Validate provider credentials

        if validate failed, raise exception

        :param credentials: provider credentials, credentials form defined in `provider_credential_schema`.
        """
        try:
            model_instance = self.get_model_instance(ModelType.LLM)

            model_instance.validate_credentials(
                model='chatglm_turbo',
                credentials=credentials
            )
        except CredentialsValidateFailedError as ex:
            raise ex
        except Exception as ex:
            logger.exception(f'{self.get_provider_schema().provider} credentials validate failed')
            raise ex

    @staticmethod
    def get_service_client(credentials: Optional[dict] = None, **kwargs: Any) -> ZhipuAI:
        client = ZhipuAI(
            api_key=credentials['api_key'],
        )
        return client
