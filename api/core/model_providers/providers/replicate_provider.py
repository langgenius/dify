import json
import logging
from typing import Type

import replicate
from replicate.exceptions import ReplicateError

from core.helper import encrypter
from core.model_providers.models.entity.model_params import KwargRule, KwargRuleType, ModelKwargsRules, ModelType, \
    ModelMode
from core.model_providers.models.llm.replicate_model import ReplicateModel
from core.model_providers.providers.base import BaseModelProvider, CredentialsValidateFailedError

from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.embedding.replicate_embedding import ReplicateEmbedding
from models.provider import ProviderType


class ReplicateProvider(BaseModelProvider):
    @property
    def provider_name(self):
        """
        Returns the name of a provider.
        """
        return 'replicate'

    def _get_fixed_model_list(self, model_type: ModelType) -> list[dict]:
        return []

    def _get_text_generation_model_mode(self, model_name) -> str:
        return ModelMode.CHAT.value if model_name.endswith('-chat') else ModelMode.COMPLETION.value

    def get_model_class(self, model_type: ModelType) -> Type[BaseProviderModel]:
        """
        Returns the model class.

        :param model_type:
        :return:
        """
        if model_type == ModelType.TEXT_GENERATION:
            model_class = ReplicateModel
        elif model_type == ModelType.EMBEDDINGS:
            model_class = ReplicateEmbedding
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
        model_credentials = self.get_model_credentials(model_name, model_type)

        model = replicate.Client(api_token=model_credentials.get("replicate_api_token")).models.get(model_name)

        try:
            version = model.versions.get(model_credentials['model_version'])
        except ReplicateError as e:
            raise CredentialsValidateFailedError(f"Model {model_name}:{model_credentials['model_version']} not exists, "
                                                 f"cause: {e.__class__.__name__}:{str(e)}")
        except Exception as e:
            logging.exception("Model validate failed.")
            raise e

        model_kwargs_rules = ModelKwargsRules()
        for key, value in version.openapi_schema['components']['schemas']['Input']['properties'].items():
            if key not in ['debug', 'prompt'] and value['type'] in ['number', 'integer']:
                if key == ['temperature', 'top_p']:
                    kwarg_rule = KwargRule[float](
                        type=KwargRuleType.FLOAT.value if value['type'] == 'number' else KwargRuleType.INTEGER.value,
                        min=float(value.get('minimum')) if value.get('minimum') is not None else None,
                        max=float(value.get('maximum')) if value.get('maximum') is not None else None,
                        default=float(value.get('default')) if value.get('default') is not None else None,
                        precision = 2
                    )
                    if key == 'temperature':
                        model_kwargs_rules.temperature = kwarg_rule
                    else:
                        model_kwargs_rules.top_p = kwarg_rule
                elif key in ['max_length', 'max_new_tokens']:
                    model_kwargs_rules.max_tokens = KwargRule[int](
                        alias=key,
                        type=KwargRuleType.INTEGER.value,
                        min=int(value.get('minimum')) if value.get('minimum') is not None else 1,
                        max=int(value.get('maximum')) if value.get('maximum') is not None else 8000,
                        default=int(value.get('default')) if value.get('default') is not None else 500,
                        precision = 0
                    )

        return model_kwargs_rules

    @classmethod
    def is_model_credentials_valid_or_raise(cls, model_name: str, model_type: ModelType, credentials: dict):
        """
        check model credentials valid.

        :param model_name:
        :param model_type:
        :param credentials:
        """
        if 'replicate_api_token' not in credentials:
            raise CredentialsValidateFailedError('Replicate API Key must be provided.')

        if 'model_version' not in credentials:
            raise CredentialsValidateFailedError('Replicate Model Version must be provided.')

        if model_name.count("/") != 1:
            raise CredentialsValidateFailedError('Replicate Model Name must be provided, '
                                                 'format: {user_name}/{model_name}')

        version = credentials['model_version']
        try:
            model = replicate.Client(api_token=credentials.get("replicate_api_token")).models.get(model_name)
            rst = model.versions.get(version)

            if model_type == ModelType.EMBEDDINGS \
                    and 'Embedding' not in rst.openapi_schema['components']['schemas']:
                raise CredentialsValidateFailedError(f"Model {model_name}:{version} is not a Embedding model.")
            elif model_type == ModelType.TEXT_GENERATION \
                    and ('items' not in rst.openapi_schema['components']['schemas']['Output']
                         or 'type' not in rst.openapi_schema['components']['schemas']['Output']['items']
                         or rst.openapi_schema['components']['schemas']['Output']['items']['type'] != 'string'):
                raise CredentialsValidateFailedError(f"Model {model_name}:{version} is not a Text Generation model.")
        except ReplicateError as e:
            raise CredentialsValidateFailedError(
                f"Model {model_name}:{version} not exists, cause: {e.__class__.__name__}:{str(e)}")
        except Exception as e:
            logging.exception("Replicate config validation failed.")
            raise e

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
        credentials['replicate_api_token'] = encrypter.encrypt_token(tenant_id, credentials['replicate_api_token'])
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
                'replicate_api_token': None,
            }

        credentials = json.loads(provider_model.encrypted_config)
        if credentials['replicate_api_token']:
            credentials['replicate_api_token'] = encrypter.decrypt_token(
                self.provider.tenant_id,
                credentials['replicate_api_token']
            )

            if obfuscated:
                credentials['replicate_api_token'] = encrypter.obfuscated_token(credentials['replicate_api_token'])

        return credentials

    @classmethod
    def is_provider_credentials_valid_or_raise(cls, credentials: dict):
        return

    @classmethod
    def encrypt_provider_credentials(cls, tenant_id: str, credentials: dict) -> dict:
        return {}

    def get_provider_credentials(self, obfuscated: bool = False) -> dict:
        return {}
