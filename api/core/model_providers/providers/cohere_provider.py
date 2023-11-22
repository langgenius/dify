import json
from json import JSONDecodeError
from typing import Type

from langchain.schema import HumanMessage

from core.helper import encrypter
from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.model_params import ModelKwargsRules, KwargRule, ModelType, ModelMode
from core.model_providers.models.reranking.cohere_reranking import CohereReranking
from core.model_providers.providers.base import BaseModelProvider, CredentialsValidateFailedError
from models.provider import ProviderType


class CohereProvider(BaseModelProvider):

    @property
    def provider_name(self):
        """
        Returns the name of a provider.
        """
        return 'cohere'
    
    def _get_text_generation_model_mode(self, model_name) -> str:
        return ModelMode.CHAT.value

    def _get_fixed_model_list(self, model_type: ModelType) -> list[dict]:
        if model_type == ModelType.RERANKING:
            return [
                {
                    'id': 'rerank-english-v2.0',
                    'name': 'rerank-english-v2.0'
                },
                {
                    'id': 'rerank-multilingual-v2.0',
                    'name': 'rerank-multilingual-v2.0'
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
        if model_type == ModelType.RERANKING:
            model_class = CohereReranking
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
            temperature=KwargRule[float](min=0, max=1, default=0.3, precision=2),
            top_p=KwargRule[float](min=0, max=0.99, default=0.85, precision=2),
            presence_penalty=KwargRule[float](enabled=False),
            frequency_penalty=KwargRule[float](enabled=False),
            max_tokens=KwargRule[int](enabled=False),
        )

    @classmethod
    def is_provider_credentials_valid_or_raise(cls, credentials: dict):
        """
        Validates the given credentials.
        """
        if 'api_key' not in credentials:
            raise CredentialsValidateFailedError('Cohere api_key must be provided.')

        try:
            credential_kwargs = {
                'api_key': credentials['api_key'],
            }
            # todo validate
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @classmethod
    def encrypt_provider_credentials(cls, tenant_id: str, credentials: dict) -> dict:
        credentials['api_key'] = encrypter.encrypt_token(tenant_id, credentials['api_key'])
        return credentials

    def get_provider_credentials(self, obfuscated: bool = False) -> dict:
        if self.provider.provider_type == ProviderType.CUSTOM.value:
            try:
                credentials = json.loads(self.provider.encrypted_config)
            except JSONDecodeError:
                credentials = {
                    'api_key': None,
                }

            if credentials['api_key']:
                credentials['api_key'] = encrypter.decrypt_token(
                    self.provider.tenant_id,
                    credentials['api_key']
                )

                if obfuscated:
                    credentials['api_key'] = encrypter.obfuscated_token(credentials['api_key'])

            return credentials
        else:
            return {}

    def should_deduct_quota(self):
        return True

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
