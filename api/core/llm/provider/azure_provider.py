import json
import logging
from typing import Optional, Union

import requests

from core.llm.provider.base import BaseProvider
from core.llm.provider.errors import ValidateFailedError
from models.provider import ProviderName


class AzureProvider(BaseProvider):
    def get_models(self, model_id: Optional[str] = None, credentials: Optional[dict] = None) -> list[dict]:
        credentials = self.get_credentials(model_id) if not credentials else credentials
        url = "{}/openai/deployments?api-version={}".format(
            str(credentials.get('openai_api_base')),
            str(credentials.get('openai_api_version'))
        )

        headers = {
            "api-key": str(credentials.get('openai_api_key')),
            "content-type": "application/json; charset=utf-8"
        }

        response = requests.get(url, headers=headers)

        if response.status_code == 200:
            result = response.json()
            return [{
                'id': deployment['id'],
                'name': '{} ({})'.format(deployment['id'], deployment['model'])
            } for deployment in result['data'] if deployment['status'] == 'succeeded']
        else:
            if response.status_code == 401:
                raise AzureAuthenticationError()
            else:
                raise AzureRequestFailedError('Failed to request Azure OpenAI. Status code: {}'.format(response.status_code))

    def get_credentials(self, model_id: Optional[str] = None) -> dict:
        """
        Returns the API credentials for Azure OpenAI as a dictionary.
        """
        config = self.get_provider_api_key(model_id=model_id)
        config['openai_api_type'] = 'azure'
        config['deployment_name'] = model_id.replace('.', '') if model_id else None
        return config

    def get_provider_name(self):
        return ProviderName.AZURE_OPENAI

    def get_provider_configs(self, obfuscated: bool = False) -> Union[str | dict]:
        """
        Returns the provider configs.
        """
        try:
            config = self.get_provider_api_key()
        except:
            config = {
                'openai_api_type': 'azure',
                'openai_api_version': '2023-03-15-preview',
                'openai_api_base': '',
                'openai_api_key': ''
            }

        if obfuscated:
            if not config.get('openai_api_key'):
                config = {
                    'openai_api_type': 'azure',
                    'openai_api_version': '2023-03-15-preview',
                    'openai_api_base': '',
                    'openai_api_key': ''
                }

            config['openai_api_key'] = self.obfuscated_token(config.get('openai_api_key'))
            return config

        return config

    def get_token_type(self):
        # TODO: change to dict when implemented
        return dict

    def config_validate(self, config: Union[dict | str]):
        """
        Validates the given config.
        """
        try:
            if not isinstance(config, dict):
                raise ValueError('Config must be a object.')

            if 'openai_api_version' not in config:
                config['openai_api_version'] = '2023-03-15-preview'

            models = self.get_models(credentials=config)

            if not models:
                raise ValidateFailedError("Please add deployments for 'text-davinci-003', "
                                          "'gpt-3.5-turbo', 'text-embedding-ada-002'.")

            fixed_model_ids = [
                'text-davinci-003',
                'gpt-35-turbo',
                'text-embedding-ada-002'
            ]

            current_model_ids = [model['id'] for model in models]

            missing_model_ids = [fixed_model_id for fixed_model_id in fixed_model_ids if
                                 fixed_model_id not in current_model_ids]

            if missing_model_ids:
                raise ValidateFailedError("Please add deployments for '{}'.".format(", ".join(missing_model_ids)))
        except AzureAuthenticationError:
            raise ValidateFailedError('Validation failed, please check your API Key.')
        except (requests.ConnectionError, requests.RequestException):
            raise ValidateFailedError('Validation failed, please check your API Base Endpoint.')
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
            'openai_api_version': '2023-03-15-preview',
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
