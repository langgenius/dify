import json
from json import JSONDecodeError
from typing import Type

from langchain.llms import ChatGLM

from core.helper import encrypter
from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.model_params import ModelKwargsRules, KwargRule, ModelType
from core.model_providers.models.llm.chatglm_model import ChatGLMModel
from core.model_providers.providers.base import BaseModelProvider, CredentialsValidateFailedError
from models.provider import ProviderType


class ChatGLMProvider(BaseModelProvider):

    @property
    def provider_name(self):
        """
        Returns the name of a provider.
        """
        return 'chatglm'

    def _get_fixed_model_list(self, model_type: ModelType) -> list[dict]:
        if model_type == ModelType.TEXT_GENERATION:
            return [
                {
                    'id': 'chatglm2-6b',
                    'name': 'ChatGLM2-6B',
                },
                {
                    'id': 'chatglm-6b',
                    'name': 'ChatGLM-6B',
                }
            ]
        else:
            return []

    def get_model_class(self, model_type: ModelType) -> Type[BaseProviderModel]:
        """
        Returns the model class.

        :param model_type:
        :return:
        """
        if model_type == ModelType.TEXT_GENERATION:
            model_class = ChatGLMModel
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
        model_max_tokens = {
            'chatglm-6b': 2000,
            'chatglm2-6b': 32000,
        }

        return ModelKwargsRules(
            temperature=KwargRule[float](min=0, max=2, default=1),
            top_p=KwargRule[float](min=0, max=1, default=0.7),
            presence_penalty=KwargRule[float](enabled=False),
            frequency_penalty=KwargRule[float](enabled=False),
            max_tokens=KwargRule[int](alias='max_token', min=10, max=model_max_tokens.get(model_name), default=2048),
        )

    @classmethod
    def is_provider_credentials_valid_or_raise(cls, credentials: dict):
        """
        Validates the given credentials.
        """
        if 'api_base' not in credentials:
            raise CredentialsValidateFailedError('ChatGLM Endpoint URL must be provided.')

        try:
            credential_kwargs = {
                'endpoint_url': credentials['api_base']
            }

            llm = ChatGLM(
                max_token=10,
                **credential_kwargs
            )

            llm("ping")
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @classmethod
    def encrypt_provider_credentials(cls, tenant_id: str, credentials: dict) -> dict:
        credentials['api_base'] = encrypter.encrypt_token(tenant_id, credentials['api_base'])
        return credentials

    def get_provider_credentials(self, obfuscated: bool = False) -> dict:
        if self.provider.provider_type == ProviderType.CUSTOM.value:
            try:
                credentials = json.loads(self.provider.encrypted_config)
            except JSONDecodeError:
                credentials = {
                    'api_base': None
                }

            if credentials['api_base']:
                credentials['api_base'] = encrypter.decrypt_token(
                    self.provider.tenant_id,
                    credentials['api_base']
                )

                if obfuscated:
                    credentials['api_base'] = encrypter.obfuscated_token(credentials['api_base'])

            return credentials

        return {}

    @classmethod
    def is_model_credentials_valid_or_raise(cls, model_name: str, model_type: ModelType, credentials: dict):
        """
        check model credentials valid.

        :param model_name:
        :param model_type:
        :param credentials:
        """
        return

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
        return {}

    def get_model_credentials(self, model_name: str, model_type: ModelType, obfuscated: bool = False) -> dict:
        """
        get credentials for llm use.

        :param model_name:
        :param model_type:
        :param obfuscated:
        :return:
        """
        return self.get_provider_credentials(obfuscated)
