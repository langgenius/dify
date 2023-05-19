import base64
from abc import ABC, abstractmethod
from typing import Optional, Union

from core import hosted_llm_credentials
from core.llm.error import QuotaExceededError, ModelCurrentlyNotSupportError, ProviderTokenNotInitError
from extensions.ext_database import db
from libs import rsa
from models.account import Tenant
from models.provider import Provider, ProviderType, ProviderName


class BaseProvider(ABC):
    def __init__(self, tenant_id: str):
        self.tenant_id = tenant_id

    def get_provider_api_key(self, model_id: Optional[str] = None, prefer_custom: bool = True) -> Union[str | dict]:
        """
        Returns the decrypted API key for the given tenant_id and provider_name.
        If the provider is of type SYSTEM and the quota is exceeded, raises a QuotaExceededError.
        If the provider is not found or not valid, raises a ProviderTokenNotInitError.
        """
        provider = self.get_provider(prefer_custom)
        if not provider:
            raise ProviderTokenNotInitError()

        if provider.provider_type == ProviderType.SYSTEM.value:
            quota_used = provider.quota_used if provider.quota_used is not None else 0
            quota_limit = provider.quota_limit if provider.quota_limit is not None else 0

            if model_id and model_id == 'gpt-4':
                raise ModelCurrentlyNotSupportError()

            if quota_used >= quota_limit:
                raise QuotaExceededError()

            return self.get_hosted_credentials()
        else:
            return self.get_decrypted_token(provider.encrypted_config)

    def get_provider(self, prefer_custom: bool) -> Optional[Provider]:
        """
        Returns the Provider instance for the given tenant_id and provider_name.
        If both CUSTOM and System providers exist, the preferred provider will be returned based on the prefer_custom flag.
        """
        return BaseProvider.get_valid_provider(self.tenant_id, self.get_provider_name().value, prefer_custom)

    @classmethod
    def get_valid_provider(cls, tenant_id: str, provider_name: str = None, prefer_custom: bool = False) -> Optional[Provider]:
        """
        Returns the Provider instance for the given tenant_id and provider_name.
        If both CUSTOM and System providers exist, the preferred provider will be returned based on the prefer_custom flag.
        """
        query = db.session.query(Provider).filter(
            Provider.tenant_id == tenant_id
        )

        if provider_name:
            query = query.filter(Provider.provider_name == provider_name)

        providers = query.order_by(Provider.provider_type.desc() if prefer_custom else Provider.provider_type).all()

        custom_provider = None
        system_provider = None

        for provider in providers:
            if provider.provider_type == ProviderType.CUSTOM.value and provider.is_valid and provider.encrypted_config:
                custom_provider = provider
            elif provider.provider_type == ProviderType.SYSTEM.value and provider.is_valid:
                system_provider = provider

        if custom_provider:
            return custom_provider
        elif system_provider:
            return system_provider
        else:
            return None

    def get_hosted_credentials(self) -> str:
        if self.get_provider_name() != ProviderName.OPENAI:
            raise ProviderTokenNotInitError()

        if not hosted_llm_credentials.openai or not hosted_llm_credentials.openai.api_key:
            raise ProviderTokenNotInitError()

        return hosted_llm_credentials.openai.api_key

    def get_provider_configs(self, obfuscated: bool = False) -> Union[str | dict]:
        """
        Returns the provider configs.
        """
        try:
            config = self.get_provider_api_key()
        except:
            config = ''

        if obfuscated:
            return self.obfuscated_token(config)

        return config

    def obfuscated_token(self, token: str):
        return token[:6] + '*' * (len(token) - 8) + token[-2:]

    def get_token_type(self):
        return str

    def get_encrypted_token(self, config: Union[dict | str]):
        return self.encrypt_token(config)

    def get_decrypted_token(self, token: str):
        return self.decrypt_token(token)

    def encrypt_token(self, token):
        tenant = db.session.query(Tenant).filter(Tenant.id == self.tenant_id).first()
        encrypted_token = rsa.encrypt(token, tenant.encrypt_public_key)
        return base64.b64encode(encrypted_token).decode()

    def decrypt_token(self, token):
        return rsa.decrypt(base64.b64decode(token), self.tenant_id)

    @abstractmethod
    def get_provider_name(self):
        raise NotImplementedError

    @abstractmethod
    def get_credentials(self, model_id: Optional[str] = None) -> dict:
        raise NotImplementedError

    @abstractmethod
    def get_models(self, model_id: Optional[str] = None) -> list[dict]:
        raise NotImplementedError

    @abstractmethod
    def config_validate(self, config: str):
        raise NotImplementedError
