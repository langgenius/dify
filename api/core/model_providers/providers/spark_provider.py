import json
import logging
from json import JSONDecodeError
from typing import Type

from langchain.schema import HumanMessage

from core.helper import encrypter
from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.model_params import ModelKwargsRules, KwargRule, ModelType, ModelMode
from core.model_providers.models.llm.spark_model import SparkModel
from core.model_providers.providers.base import BaseModelProvider, CredentialsValidateFailedError
from core.third_party.langchain.llms.spark import ChatSpark
from core.third_party.spark.spark_llm import SparkError
from models.provider import ProviderType, ProviderQuotaType


class SparkProvider(BaseModelProvider):

    @property
    def provider_name(self):
        """
        Returns the name of a provider.
        """
        return 'spark'

    def _get_fixed_model_list(self, model_type: ModelType) -> list[dict]:
        if model_type == ModelType.TEXT_GENERATION:
            return [
                {
                    'id': 'spark',
                    'name': 'Spark V1.5',
                    'mode': ModelMode.CHAT.value,
                },
                {
                    'id': 'spark-v2',
                    'name': 'Spark V2.0',
                    'mode': ModelMode.CHAT.value,
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
            model_class = SparkModel
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
            temperature=KwargRule[float](min=0, max=1, default=0.5, precision=2),
            top_p=KwargRule[float](enabled=False),
            presence_penalty=KwargRule[float](enabled=False),
            frequency_penalty=KwargRule[float](enabled=False),
            max_tokens=KwargRule[int](min=10, max=4096, default=2048, precision=0),
        )

    @classmethod
    def is_provider_credentials_valid_or_raise(cls, credentials: dict):
        """
        Validates the given credentials.
        """
        if 'app_id' not in credentials:
            raise CredentialsValidateFailedError('Spark app_id must be provided.')

        if 'api_key' not in credentials:
            raise CredentialsValidateFailedError('Spark api_key must be provided.')

        if 'api_secret' not in credentials:
            raise CredentialsValidateFailedError('Spark api_secret must be provided.')

        credential_kwargs = {
            'app_id': credentials['app_id'],
            'api_key': credentials['api_key'],
            'api_secret': credentials['api_secret'],
        }

        try:
            chat_llm = ChatSpark(
                model_name='spark-v2',
                max_tokens=10,
                temperature=0.01,
                **credential_kwargs
            )

            messages = [
                HumanMessage(
                    content="ping"
                )
            ]

            chat_llm(messages)
        except SparkError as ex:
            # try spark v1.5 if v2.1 failed
            try:
                chat_llm = ChatSpark(
                    model_name='spark',
                    max_tokens=10,
                    temperature=0.01,
                    **credential_kwargs
                )

                messages = [
                    HumanMessage(
                        content="ping"
                    )
                ]

                chat_llm(messages)
            except SparkError as ex:
                raise CredentialsValidateFailedError(str(ex))
            except Exception as ex:
                logging.exception('Spark config validation failed')
                raise ex
        except Exception as ex:
            logging.exception('Spark config validation failed')
            raise ex

    @classmethod
    def encrypt_provider_credentials(cls, tenant_id: str, credentials: dict) -> dict:
        credentials['api_key'] = encrypter.encrypt_token(tenant_id, credentials['api_key'])
        credentials['api_secret'] = encrypter.encrypt_token(tenant_id, credentials['api_secret'])
        return credentials

    def get_provider_credentials(self, obfuscated: bool = False) -> dict:
        if self.provider.provider_type == ProviderType.CUSTOM.value \
                or (self.provider.provider_type == ProviderType.SYSTEM.value
                    and self.provider.quota_type == ProviderQuotaType.FREE.value):
            try:
                credentials = json.loads(self.provider.encrypted_config)
            except JSONDecodeError:
                credentials = {
                    'app_id': None,
                    'api_key': None,
                    'api_secret': None,
                }

            if credentials['api_key']:
                credentials['api_key'] = encrypter.decrypt_token(
                    self.provider.tenant_id,
                    credentials['api_key']
                )

                if obfuscated:
                    credentials['api_key'] = encrypter.obfuscated_token(credentials['api_key'])

            if credentials['api_secret']:
                credentials['api_secret'] = encrypter.decrypt_token(
                    self.provider.tenant_id,
                    credentials['api_secret']
                )

                if obfuscated:
                    credentials['api_secret'] = encrypter.obfuscated_token(credentials['api_secret'])

            return credentials
        else:
            return {
                'app_id': None,
                'api_key': None,
                'api_secret': None,
            }

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
