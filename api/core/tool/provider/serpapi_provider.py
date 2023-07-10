from typing import Optional

from core.tool.provider.base import BaseToolProvider
from core.tool.provider.errors import ToolValidateFailedError
from models.tool import ToolProviderName


class SerpAPIToolProvider(BaseToolProvider):
    def get_provider_name(self) -> ToolProviderName:
        """
        Returns the name of the provider.

        :return:
        """
        return ToolProviderName.SERPAPI

    def get_credentials(self, obfuscated: bool = False) -> Optional[dict]:
        """
        Returns the credentials for SerpAPI as a dictionary.

        :param obfuscated: obfuscate credentials if True
        :return:
        """
        tool_provider = self.get_provider(must_enabled=True)
        if not tool_provider:
            return None

        config = tool_provider.config
        if not config:
            return None

        if config.get('api_key'):
            config['api_key'] = self.decrypt_token(config.get('api_key'), obfuscated)

        return config

    def credentials_to_func_kwargs(self) -> Optional[dict]:
        """
        Returns the credentials function kwargs as a dictionary.

        :return:
        """
        credentials = self.get_credentials()
        if not credentials:
            return None

        return {
            'serpapi_api_key': credentials.get('api_key')
        }

    def credentials_validate(self, credentials: dict):
        """
        Validates the given credentials.

        :param credentials:
        :return:
        """
        if 'api_key' not in credentials or not credentials.get('api_key'):
            raise ToolValidateFailedError("SerpAPI api_key is required.")
