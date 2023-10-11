import json
from json import JSONDecodeError
from typing import Type

from langchain.schema import HumanMessage

from core.helper import encrypter
from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.embedding.minimax_embedding import MinimaxEmbedding
from core.model_providers.models.entity.model_params import ModelKwargsRules, KwargRule, ModelType
from core.model_providers.models.llm.minimax_model import MinimaxModel
from core.model_providers.providers.base import BaseModelProvider, CredentialsValidateFailedError
from core.third_party.langchain.llms.minimax_llm import MinimaxChatLLM
from models.provider import ProviderType, ProviderQuotaType


class MinimaxProvider(BaseModelProvider):

    @property
    def provider_name(self):
        """
        Returns the name of a provider.
        """
        return 'minimax'

    def _get_fixed_model_list(self, model_type: ModelType) -> list[dict]:
        if model_type == ModelType.TEXT_GENERATION:
            return [
                {
                    'id': 'abab5.5-chat',
                    'name': 'abab5.5-chat',
                },
                {
                    'id': 'abab5-chat',
                    'name': 'abab5-chat',
                }
            ]
        elif model_type == ModelType.EMBEDDINGS:
            return [
                {
                    'id': 'embo-01',
                    'name': 'embo-01',
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
            model_class = MinimaxModel
        elif model_type == ModelType.EMBEDDINGS:
            model_class = MinimaxEmbedding
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
            'abab5.5-chat': 16384,
            'abab5-chat': 6144,
        }

        return ModelKwargsRules(
            temperature=KwargRule[float](min=0.01, max=1, default=0.9, precision=2),
            top_p=KwargRule[float](min=0, max=1, default=0.95, precision=2),
            presence_penalty=KwargRule[float](enabled=False),
            frequency_penalty=KwargRule[float](enabled=False),
            max_tokens=KwargRule[int](min=10, max=model_max_tokens.get(model_name, 6144), default=1024, precision=0),
        )

    @classmethod
    def is_provider_credentials_valid_or_raise(cls, credentials: dict):
        """
        Validates the given credentials.
        """
        if 'minimax_group_id' not in credentials:
            raise CredentialsValidateFailedError('MiniMax Group ID must be provided.')

        if 'minimax_api_key' not in credentials:
            raise CredentialsValidateFailedError('MiniMax API Key must be provided.')

        try:
            credential_kwargs = {
                'minimax_group_id': credentials['minimax_group_id'],
                'minimax_api_key': credentials['minimax_api_key'],
            }

            llm = MinimaxChatLLM(
                model='abab5.5-chat',
                max_tokens=10,
                temperature=0.01,
                **credential_kwargs
            )

            llm([HumanMessage(content='ping')])
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @classmethod
    def encrypt_provider_credentials(cls, tenant_id: str, credentials: dict) -> dict:
        credentials['minimax_api_key'] = encrypter.encrypt_token(tenant_id, credentials['minimax_api_key'])
        return credentials

    def get_provider_credentials(self, obfuscated: bool = False) -> dict:
        if self.provider.provider_type == ProviderType.CUSTOM.value \
                or (self.provider.provider_type == ProviderType.SYSTEM.value
                    and self.provider.quota_type == ProviderQuotaType.FREE.value):
            try:
                credentials = json.loads(self.provider.encrypted_config)
            except JSONDecodeError:
                credentials = {
                    'minimax_group_id': None,
                    'minimax_api_key': None,
                }

            if credentials['minimax_api_key']:
                credentials['minimax_api_key'] = encrypter.decrypt_token(
                    self.provider.tenant_id,
                    credentials['minimax_api_key']
                )

                if obfuscated:
                    credentials['minimax_api_key'] = encrypter.obfuscated_token(credentials['minimax_api_key'])

            return credentials

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
