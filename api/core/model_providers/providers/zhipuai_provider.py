import json
from json import JSONDecodeError
from typing import Type

from langchain.schema import HumanMessage

from core.helper import encrypter
from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.embedding.zhipuai_embedding import ZhipuAIEmbedding
from core.model_providers.models.entity.model_params import ModelKwargsRules, KwargRule, ModelType, ModelMode
from core.model_providers.models.llm.zhipuai_model import ZhipuAIModel
from core.model_providers.providers.base import BaseModelProvider, CredentialsValidateFailedError
from core.third_party.langchain.llms.zhipuai_llm import ZhipuAIChatLLM
from models.provider import ProviderType, ProviderQuotaType


class ZhipuAIProvider(BaseModelProvider):

    @property
    def provider_name(self):
        """
        Returns the name of a provider.
        """
        return 'zhipuai'

    def _get_fixed_model_list(self, model_type: ModelType) -> list[dict]:
        if model_type == ModelType.TEXT_GENERATION:
            return [
                {
                    'id': 'chatglm_pro',
                    'name': 'chatglm_pro',
                    'mode': ModelMode.CHAT.value,
                },
                {
                    'id': 'chatglm_std',
                    'name': 'chatglm_std',
                    'mode': ModelMode.CHAT.value,
                },
                {
                    'id': 'chatglm_lite',
                    'name': 'chatglm_lite',
                    'mode': ModelMode.CHAT.value,
                },
                {
                    'id': 'chatglm_lite_32k',
                    'name': 'chatglm_lite_32k',
                    'mode': ModelMode.CHAT.value,
                }
            ]
        elif model_type == ModelType.EMBEDDINGS:
            return [
                {
                    'id': 'text_embedding',
                    'name': 'text_embedding',
                }
            ]
        else:
            return []

    def _get_text_generation_model_mode(self, model_name) -> str:
        return ModelMode.CHAT.value

    def get_model_class(self, model_type: ModelType) -> Type[BaseProviderModel]:
        """
        Returns the model class.

        :param model_type:
        :return:
        """
        if model_type == ModelType.TEXT_GENERATION:
            model_class = ZhipuAIModel
        elif model_type == ModelType.EMBEDDINGS:
            model_class = ZhipuAIEmbedding
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
            temperature=KwargRule[float](min=0.01, max=1, default=0.95, precision=2),
            top_p=KwargRule[float](min=0.1, max=0.9, default=0.8, precision=1),
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
            raise CredentialsValidateFailedError('ZhipuAI api_key must be provided.')

        try:
            credential_kwargs = {
                'api_key': credentials['api_key']
            }

            llm = ZhipuAIChatLLM(
                temperature=0.01,
                **credential_kwargs
            )

            llm([HumanMessage(content='ping')])
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @classmethod
    def encrypt_provider_credentials(cls, tenant_id: str, credentials: dict) -> dict:
        credentials['api_key'] = encrypter.encrypt_token(tenant_id, credentials['api_key'])
        return credentials

    def get_provider_credentials(self, obfuscated: bool = False) -> dict:
        if self.provider.provider_type == ProviderType.CUSTOM.value \
                or (self.provider.provider_type == ProviderType.SYSTEM.value
                    and self.provider.quota_type == ProviderQuotaType.FREE.value):
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
