import os
from typing import Any, Union

from pydantic import BaseModel
from yaml import FullLoader, load

from core.helper import encrypter
from core.helper.tool_provider_cache import ToolProviderCredentialsCache, ToolProviderCredentialsCacheType
from core.tools.entities.tool_entities import (
    ModelToolConfiguration,
    ModelToolProviderConfiguration,
    ToolProviderCredentials,
)
from core.tools.provider.tool_provider import ToolProviderController


class ToolConfiguration(BaseModel):
    tenant_id: str
    provider_controller: ToolProviderController

    def _deep_copy(self, credentials: dict[str, str]) -> dict[str, str]:
        """
        deep copy credentials
        """
        return {key: value for key, value in credentials.items()}
    
    def encrypt_tool_credentials(self, credentials: dict[str, str]) -> dict[str, str]:
        """
        encrypt tool credentials with tenant id

        return a deep copy of credentials with encrypted values
        """
        credentials = self._deep_copy(credentials)

        # get fields need to be decrypted
        fields = self.provider_controller.get_credentials_schema()
        for field_name, field in fields.items():
            if field.type == ToolProviderCredentials.CredentialsType.SECRET_INPUT:
                if field_name in credentials:
                    encrypted = encrypter.encrypt_token(self.tenant_id, credentials[field_name])
                    credentials[field_name] = encrypted
        
        return credentials
    
    def mask_tool_credentials(self, credentials: dict[str, Any]) -> dict[str, Any]:
        """
        mask tool credentials

        return a deep copy of credentials with masked values
        """
        credentials = self._deep_copy(credentials)

        # get fields need to be decrypted
        fields = self.provider_controller.get_credentials_schema()
        for field_name, field in fields.items():
            if field.type == ToolProviderCredentials.CredentialsType.SECRET_INPUT:
                if field_name in credentials:
                    if len(credentials[field_name]) > 6:
                        credentials[field_name] = \
                            credentials[field_name][:2] + \
                            '*' * (len(credentials[field_name]) - 4) +\
                            credentials[field_name][-2:]
                    else:
                        credentials[field_name] = '*' * len(credentials[field_name])

        return credentials

    def decrypt_tool_credentials(self, credentials: dict[str, str]) -> dict[str, str]:
        """
        decrypt tool credentials with tenant id

        return a deep copy of credentials with decrypted values
        """
        cache = ToolProviderCredentialsCache(
            tenant_id=self.tenant_id, 
            identity_id=f'{self.provider_controller.app_type.value}.{self.provider_controller.identity.name}',
            cache_type=ToolProviderCredentialsCacheType.PROVIDER
        )
        cached_credentials = cache.get()
        if cached_credentials:
            return cached_credentials
        credentials = self._deep_copy(credentials)
        # get fields need to be decrypted
        fields = self.provider_controller.get_credentials_schema()
        for field_name, field in fields.items():
            if field.type == ToolProviderCredentials.CredentialsType.SECRET_INPUT:
                if field_name in credentials:
                    try:
                        credentials[field_name] = encrypter.decrypt_token(self.tenant_id, credentials[field_name])
                    except:
                        pass

        cache.set(credentials)
        return credentials
    
    def delete_tool_credentials_cache(self):
        cache = ToolProviderCredentialsCache(
            tenant_id=self.tenant_id, 
            identity_id=f'{self.provider_controller.app_type.value}.{self.provider_controller.identity.name}',
            cache_type=ToolProviderCredentialsCacheType.PROVIDER
        )
        cache.delete()

class ModelToolConfigurationManager:
    """
    Model as tool configuration
    """
    _configurations: dict[str, ModelToolProviderConfiguration] = {}
    _model_configurations: dict[str, ModelToolConfiguration] = {}
    _inited = False

    @classmethod
    def _init_configuration(cls):
        """
        init configuration
        """
        
        absolute_path = os.path.abspath(os.path.dirname(__file__))
        model_tools_path = os.path.join(absolute_path, '..', 'model_tools')

        # get all .yaml file
        files = [f for f in os.listdir(model_tools_path) if f.endswith('.yaml')]

        for file in files:
            provider = file.split('.')[0]
            with open(os.path.join(model_tools_path, file), encoding='utf-8') as f:
                configurations = ModelToolProviderConfiguration(**load(f, Loader=FullLoader))
                models = configurations.models or []
                for model in models:
                    model_key = f'{provider}.{model.model}'
                    cls._model_configurations[model_key] = model

                cls._configurations[provider] = configurations
        cls._inited = True

    @classmethod
    def get_configuration(cls, provider: str) -> Union[ModelToolProviderConfiguration, None]:
        """
        get configuration by provider
        """
        if not cls._inited:
            cls._init_configuration()
        return cls._configurations.get(provider, None)
    
    @classmethod
    def get_all_configuration(cls) -> dict[str, ModelToolProviderConfiguration]:
        """
        get all configurations
        """
        if not cls._inited:
            cls._init_configuration()
        return cls._configurations
    
    @classmethod
    def get_model_configuration(cls, provider: str, model: str) -> Union[ModelToolConfiguration, None]:
        """
        get model configuration
        """
        key = f'{provider}.{model}'

        if not cls._inited:
            cls._init_configuration()

        return cls._model_configurations.get(key, None)