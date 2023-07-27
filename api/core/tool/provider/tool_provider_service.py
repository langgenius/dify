from typing import Optional

from core.tool.provider.base import BaseToolProvider
from core.tool.provider.serpapi_provider import SerpAPIToolProvider


class ToolProviderService:

    def __init__(self, tenant_id: str, provider_name: str):
        self.provider = self._init_provider(tenant_id, provider_name)

    def _init_provider(self, tenant_id: str, provider_name: str) -> BaseToolProvider:
        if provider_name == 'serpapi':
            return SerpAPIToolProvider(tenant_id)
        else:
            raise Exception('tool provider {} not found'.format(provider_name))

    def get_credentials(self, obfuscated: bool = False) -> Optional[dict]:
        """
        Returns the credentials for Tool as a dictionary.

        :param obfuscated:
        :return:
        """
        return self.provider.get_credentials(obfuscated)

    def credentials_validate(self, credentials: dict):
        """
        Validates the given credentials.

        :param credentials:
        :raises: ValidateFailedError
        """
        return self.provider.credentials_validate(credentials)

    def encrypt_credentials(self, credentials: dict):
        """
        Encrypts the given credentials.

        :param credentials:
        :return:
        """
        return self.provider.encrypt_credentials(credentials)
