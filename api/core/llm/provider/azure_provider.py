import json
import logging
from typing import Optional, Union

import openai
import requests

from core.llm.provider.base import BaseProvider
from core.llm.provider.errors import ValidateFailedError
from models.provider import ProviderName


AZURE_OPENAI_API_VERSION = '2023-07-01-preview'


class AzureProvider(BaseProvider):
    def get_models(self, model_id: Optional[str] = None, credentials: Optional[dict] = None) -> list[dict]:
        return []

    def check_embedding_model(self, credentials: Optional[dict] = None):
        credentials = self.get_credentials('text-embedding-ada-002') if not credentials else credentials
        try:
            result = openai.Embedding.create(input=['test'],
                                             engine='text-embedding-ada-002',
                                             timeout=60,
                                             api_key=str(credentials.get('openai_api_key')),
                                             api_base=str(credentials.get('openai_api_base')),
                                             api_type='azure',
                                             api_version=str(credentials.get('openai_api_version')))["data"][0][
                "embedding"]
        except openai.error.AuthenticationError as e:
            raise AzureAuthenticationError(str(e))
        except openai.error.APIConnectionError as e:
            raise AzureRequestFailedError(
                'Failed to request Azure OpenAI, please check your API Base Endpoint, The format is `https://xxx.openai.azure.com/`')
        except openai.error.InvalidRequestError as e:
            if e.http_status == 404:
                raise AzureRequestFailedError("Please check your 'gpt-3.5-turbo' or 'text-embedding-ada-002' "
                                              "deployment name is exists in Azure AI")
            else:
                raise AzureRequestFailedError(
                    'Failed to request Azure OpenAI. cause: {}'.format(str(e)))
        except openai.error.OpenAIError as e:
            raise AzureRequestFailedError(
                'Failed to request Azure OpenAI. cause: {}'.format(str(e)))

        if not isinstance(result, list):
            raise AzureRequestFailedError('Failed to request Azure OpenAI.')

    def get_credentials(self, model_id: Optional[str] = None) -> dict:
        """
        Returns the API credentials for Azure OpenAI as a dictionary.
        """
        config = self.get_provider_api_key(model_id=model_id)
        config['openai_api_type'] = 'azure'
        config['openai_api_version'] = AZURE_OPENAI_API_VERSION
        if model_id == 'text-embedding-ada-002':
            config['deployment'] = model_id.replace('.', '') if model_id else None
            config['chunk_size'] = 16
        else:
            config['deployment_name'] = model_id.replace('.', '') if model_id else None
        return config

    def get_provider_name(self):
        return ProviderName.AZURE_OPENAI

    def get_provider_configs(self, obfuscated: bool = False, only_custom: bool = False) -> Union[str | dict]:
        """
        Returns the provider configs.
        """
        try:
            config = self.get_provider_api_key(only_custom=only_custom)
        except:
            config = {
                'openai_api_type': 'azure',
                'openai_api_version': AZURE_OPENAI_API_VERSION,
                'openai_api_base': '',
                'openai_api_key': ''
            }

        if obfuscated:
            if not config.get('openai_api_key'):
                config = {
                    'openai_api_type': 'azure',
                    'openai_api_version': AZURE_OPENAI_API_VERSION,
                    'openai_api_base': '',
                    'openai_api_key': ''
                }

            config['openai_api_key'] = self.obfuscated_token(config.get('openai_api_key'))
            return config

        return config

    def get_token_type(self):
        return dict

    def config_validate(self, config: Union[dict | str]):
        """
        Validates the given config.
        """
        try:
            if not isinstance(config, dict):
                raise ValueError('Config must be a object.')

            if 'openai_api_version' not in config:
                config['openai_api_version'] = AZURE_OPENAI_API_VERSION

            self.check_embedding_model(credentials=config)
        except ValidateFailedError as e:
            raise e
        except AzureAuthenticationError:
            raise ValidateFailedError('Validation failed, please check your API Key.')
        except AzureRequestFailedError as ex:
            raise ValidateFailedError('Validation failed, error: {}.'.format(str(ex)))
        except Exception as ex:
            logging.exception('Azure OpenAI Credentials validation failed')
            raise ValidateFailedError('Validation failed, error: {}.'.format(str(ex)))

    def get_encrypted_token(self, config: Union[dict | str]):
        """
        Returns the encrypted token.
        """
        return json.dumps({
            'openai_api_type': 'azure',
            'openai_api_version': AZURE_OPENAI_API_VERSION,
            'openai_api_base': config['openai_api_base'],
            'openai_api_key': self.encrypt_token(config['openai_api_key'])
        })

    def get_decrypted_token(self, token: str):
        """
        Returns the decrypted token.
        """
        config = json.loads(token)
        config['openai_api_key'] = self.decrypt_token(config['openai_api_key'])
        return config


class AzureAuthenticationError(Exception):
    pass


class AzureRequestFailedError(Exception):
    pass
