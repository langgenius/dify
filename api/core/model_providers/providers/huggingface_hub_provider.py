import json
from typing import Type

from huggingface_hub import HfApi
from langchain.llms import HuggingFaceEndpoint

from core.helper import encrypter
from core.model_providers.models.entity.model_params import KwargRule, ModelKwargsRules, ModelType
from core.model_providers.models.llm.huggingface_hub_model import HuggingfaceHubModel
from core.model_providers.providers.base import BaseModelProvider, CredentialsValidateFailedError

from core.model_providers.models.base import BaseProviderModel
from models.provider import ProviderType


class HuggingfaceHubProvider(BaseModelProvider):
    @property
    def provider_name(self):
        """
        Returns the name of a provider.
        """
        return 'huggingface_hub'

    def _get_fixed_model_list(self, model_type: ModelType) -> list[dict]:
        return []

    def get_model_class(self, model_type: ModelType) -> Type[BaseProviderModel]:
        """
        Returns the model class.

        :param model_type:
        :return:
        """
        if model_type == ModelType.TEXT_GENERATION:
            model_class = HuggingfaceHubModel
        else:
            raise NotImplementedError

        return model_class

    def get_model_parameter_rules(self, model_name: str, model_type: ModelType) -> ModelKwargsRules:
        """
        get model parameter rules.

        :param model_name:
        :param model_type:
        :return:
        """
        return ModelKwargsRules(
            temperature=KwargRule[float](min=0, max=2, default=1),
            top_p=KwargRule[float](min=0.01, max=0.99, default=0.7),
            presence_penalty=KwargRule[float](enabled=False),
            frequency_penalty=KwargRule[float](enabled=False),
            max_tokens=KwargRule[int](alias='max_new_tokens', min=10, max=1500, default=200),
        )

    @classmethod
    def is_model_credentials_valid_or_raise(cls, model_name: str, model_type: ModelType, credentials: dict):
        """
        check model credentials valid.

        :param model_name:
        :param model_type:
        :param credentials:
        """
        if model_type != ModelType.TEXT_GENERATION:
            raise NotImplementedError

        if 'huggingfacehub_api_type' not in credentials \
                or credentials['huggingfacehub_api_type'] not in ['hosted_inference_api', 'inference_endpoints']:
            raise CredentialsValidateFailedError('Hugging Face Hub API Type invalid, '
                                                 'must be hosted_inference_api or inference_endpoints.')

        if 'huggingfacehub_api_token' not in credentials:
            raise CredentialsValidateFailedError('Hugging Face Hub API Token must be provided.')

        hfapi = HfApi(token=credentials['huggingfacehub_api_token'])

        try:
            hfapi.whoami()
        except Exception:
            raise CredentialsValidateFailedError("Invalid API Token.")

        if credentials['huggingfacehub_api_type'] == 'inference_endpoints':
            if 'huggingfacehub_endpoint_url' not in credentials:
                raise CredentialsValidateFailedError('Hugging Face Hub Endpoint URL must be provided.')

            try:
                llm = HuggingFaceEndpoint(
                    endpoint_url=credentials['huggingfacehub_endpoint_url'],
                    task="text2text-generation",
                    model_kwargs={"temperature": 0.5, "max_new_tokens": 200},
                    huggingfacehub_api_token=credentials['huggingfacehub_api_token']
                )

                llm("ping")
            except Exception as e:
                raise CredentialsValidateFailedError(f"{e.__class__.__name__}:{str(e)}")
        else:
            try:
                model_info = hfapi.model_info(repo_id=model_name)
                if not model_info:
                    raise ValueError(f'Model {model_name} not found.')

                if 'inference' in model_info.cardData and not model_info.cardData['inference']:
                    raise ValueError(f'Inference API has been turned off for this model {model_name}.')

                VALID_TASKS = ("text2text-generation", "text-generation", "summarization")
                if model_info.pipeline_tag not in VALID_TASKS:
                    raise ValueError(f"Model {model_name} is not a valid task, "
                                     f"must be one of {VALID_TASKS}.")
            except Exception as e:
                raise CredentialsValidateFailedError(f"{e.__class__.__name__}:{str(e)}")

    @classmethod
    def encrypt_model_credentials(cls, tenant_id: str, model_name: str, model_type: ModelType,
                                  credentials: dict) -> dict:
        """
        encrypt model credentials for save.

        :param tenant_id:
        :param model_name:
        :param model_type:
        :param credentials:
        :return:
        """
        credentials['huggingfacehub_api_token'] = encrypter.encrypt_token(tenant_id, credentials['huggingfacehub_api_token'])

        if credentials['huggingfacehub_api_type'] == 'hosted_inference_api':
            hfapi = HfApi(token=credentials['huggingfacehub_api_token'])
            model_info = hfapi.model_info(repo_id=model_name)
            if not model_info:
                raise ValueError(f'Model {model_name} not found.')

            if 'inference' in model_info.cardData and not model_info.cardData['inference']:
                raise ValueError(f'Inference API has been turned off for this model {model_name}.')

            credentials['task_type'] = model_info.pipeline_tag

        return credentials

    def get_model_credentials(self, model_name: str, model_type: ModelType, obfuscated: bool = False) -> dict:
        """
        get credentials for llm use.

        :param model_name:
        :param model_type:
        :param obfuscated:
        :return:
        """
        if self.provider.provider_type != ProviderType.CUSTOM.value:
            raise NotImplementedError

        provider_model = self._get_provider_model(model_name, model_type)

        if not provider_model.encrypted_config:
            return {
                'huggingfacehub_api_token': None,
                'task_type': None
            }

        credentials = json.loads(provider_model.encrypted_config)
        if credentials['huggingfacehub_api_token']:
            credentials['huggingfacehub_api_token'] = encrypter.decrypt_token(
                self.provider.tenant_id,
                credentials['huggingfacehub_api_token']
            )

            if obfuscated:
                credentials['huggingfacehub_api_token'] = encrypter.obfuscated_token(credentials['huggingfacehub_api_token'])

        return credentials

    @classmethod
    def is_provider_credentials_valid_or_raise(cls, credentials: dict):
        return

    @classmethod
    def encrypt_provider_credentials(cls, tenant_id: str, credentials: dict) -> dict:
        return {}

    def get_provider_credentials(self, obfuscated: bool = False) -> dict:
        return {}
