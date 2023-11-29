import json
from json import JSONDecodeError
from typing import Type

from core.helper import encrypter
from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.embedding.jina_embedding import JinaEmbedding
from core.model_providers.models.entity.model_params import ModelType, ModelKwargsRules
from core.model_providers.providers.base import BaseModelProvider, CredentialsValidateFailedError
from core.third_party.langchain.embeddings.jina_embedding import JinaEmbeddings
from models.provider import ProviderType


class JinaProvider(BaseModelProvider):

    @property
    def provider_name(self):
        """
        Returns the name of a provider.
        """
        return 'jina'

    def _get_fixed_model_list(self, model_type: ModelType) -> list[dict]:
        if model_type == ModelType.EMBEDDINGS:
            return [
                {
                    'id': 'jina-embeddings-v2-base-en',
                    'name': 'jina-embeddings-v2-base-en',
                },
                {
                    'id': 'jina-embeddings-v2-small-en',
                    'name': 'jina-embeddings-v2-small-en',
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
        if model_type == ModelType.EMBEDDINGS:
            model_class = JinaEmbedding
        else:
            raise NotImplementedError

        return model_class

    @classmethod
    def is_provider_credentials_valid_or_raise(cls, credentials: dict):
        """
        Validates the given credentials.
        """
        if 'api_key' not in credentials:
            raise CredentialsValidateFailedError('Jina API Key must be provided.')

        try:
            credential_kwargs = {
                'api_key': credentials['api_key'],
            }

            embedding = JinaEmbeddings(
                model='jina-embeddings-v2-small-en',
                **credential_kwargs
            )

            embedding.embed_query("ping")
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

    def _get_text_generation_model_mode(self, model_name) -> str:
        raise NotImplementedError

    def get_model_parameter_rules(self, model_name: str, model_type: ModelType) -> ModelKwargsRules:
        raise NotImplementedError
