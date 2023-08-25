import json
from typing import Type

from langchain.embeddings import LocalAIEmbeddings

from core.helper import encrypter
from core.model_providers.models.embedding.localai_embedding import LocalAIEmbedding
from core.model_providers.models.entity.model_params import ModelKwargsRules, ModelType
from core.model_providers.providers.base import BaseModelProvider, CredentialsValidateFailedError

from core.model_providers.models.base import BaseProviderModel
from models.provider import ProviderType


class LocalAIProvider(BaseModelProvider):
    @property
    def provider_name(self):
        """
        Returns the name of a provider.
        """
        return 'localai'

    def _get_fixed_model_list(self, model_type: ModelType) -> list[dict]:
        return []

    def get_model_class(self, model_type: ModelType) -> Type[BaseProviderModel]:
        """
        Returns the model class.

        :param model_type:
        :return:
        """
        if model_type == ModelType.EMBEDDINGS:
            model_class = LocalAIEmbedding
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
        return ModelKwargsRules()

    @classmethod
    def is_model_credentials_valid_or_raise(cls, model_name: str, model_type: ModelType, credentials: dict):
        """
        check model credentials valid.

        :param model_name:
        :param model_type:
        :param credentials:
        """
        if 'openai_api_base' not in credentials:
            raise CredentialsValidateFailedError('LocalAI Server URL must be provided.')

        try:
            credential_kwargs = {
                'openai_api_base': credentials['openai_api_base'],
            }

            model = LocalAIEmbeddings(
                openai_api_key="1",
                **credential_kwargs
            )

            model.embed_query("ping")
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

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
        credentials['openai_api_base'] = encrypter.encrypt_token(tenant_id, credentials['openai_api_base'])
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
                'openai_api_base': None,
            }

        credentials = json.loads(provider_model.encrypted_config)
        if credentials['openai_api_base']:
            credentials['openai_api_base'] = encrypter.decrypt_token(
                self.provider.tenant_id,
                credentials['openai_api_base']
            )

            if obfuscated:
                credentials['openai_api_base'] = encrypter.obfuscated_token(credentials['openai_api_base'])

        return credentials

    @classmethod
    def is_provider_credentials_valid_or_raise(cls, credentials: dict):
        return

    @classmethod
    def encrypt_provider_credentials(cls, tenant_id: str, credentials: dict) -> dict:
        return {}

    def get_provider_credentials(self, obfuscated: bool = False) -> dict:
        return {}
