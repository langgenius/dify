from typing import Union

from flask import current_app

from core.llm.provider.llm_provider_service import LLMProviderService
from models.account import Tenant
from models.provider import *


class ProviderService:

    @staticmethod
    def init_supported_provider(tenant, edition):
        """Initialize the model provider, check whether the supported provider has a record"""

        providers = Provider.query.filter_by(tenant_id=tenant.id).all()

        openai_provider_exists = False
        azure_openai_provider_exists = False

        # TODO: The cloud version needs to construct the data of the SYSTEM type

        for provider in providers:
            if provider.provider_name == ProviderName.OPENAI.value and provider.provider_type == ProviderType.CUSTOM.value:
                openai_provider_exists = True
            if provider.provider_name == ProviderName.AZURE_OPENAI.value and provider.provider_type == ProviderType.CUSTOM.value:
                azure_openai_provider_exists = True

        # Initialize the model provider, check whether the supported provider has a record

        # Create default providers if they don't exist
        if not openai_provider_exists:
            openai_provider = Provider(
                tenant_id=tenant.id,
                provider_name=ProviderName.OPENAI.value,
                provider_type=ProviderType.CUSTOM.value,
                is_valid=False
            )
            db.session.add(openai_provider)

        if not azure_openai_provider_exists:
            azure_openai_provider = Provider(
                tenant_id=tenant.id,
                provider_name=ProviderName.AZURE_OPENAI.value,
                provider_type=ProviderType.CUSTOM.value,
                is_valid=False
            )
            db.session.add(azure_openai_provider)

        if not openai_provider_exists or not azure_openai_provider_exists:
            db.session.commit()

    @staticmethod
    def get_obfuscated_api_key(tenant, provider_name: ProviderName):
        llm_provider_service = LLMProviderService(tenant.id, provider_name.value)
        return llm_provider_service.get_provider_configs(obfuscated=True)

    @staticmethod
    def get_token_type(tenant, provider_name: ProviderName):
        llm_provider_service = LLMProviderService(tenant.id, provider_name.value)
        return llm_provider_service.get_token_type()

    @staticmethod
    def validate_provider_configs(tenant, provider_name: ProviderName, configs: Union[dict | str]):
        if current_app.config['DISABLE_PROVIDER_CONFIG_VALIDATION']:
            return
        llm_provider_service = LLMProviderService(tenant.id, provider_name.value)
        return llm_provider_service.config_validate(configs)

    @staticmethod
    def get_encrypted_token(tenant, provider_name: ProviderName, configs: Union[dict | str]):
        llm_provider_service = LLMProviderService(tenant.id, provider_name.value)
        return llm_provider_service.get_encrypted_token(configs)

    @staticmethod
    def create_system_provider(tenant: Tenant, provider_name: str = ProviderName.OPENAI.value,
                               is_valid: bool = True):
        if current_app.config['EDITION'] != 'CLOUD':
            return

        provider = db.session.query(Provider).filter(
            Provider.tenant_id == tenant.id,
            Provider.provider_name == provider_name,
            Provider.provider_type == ProviderType.SYSTEM.value
        ).one_or_none()

        if not provider:
            provider = Provider(
                tenant_id=tenant.id,
                provider_name=provider_name,
                provider_type=ProviderType.SYSTEM.value,
                quota_type=ProviderQuotaType.TRIAL.value,
                quota_limit=200,
                encrypted_config='',
                is_valid=is_valid,
            )
            db.session.add(provider)
            db.session.commit()
