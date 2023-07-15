from typing import Union

from flask import current_app

from core.llm.provider.llm_provider_service import LLMProviderService
from models.account import Tenant
from models.provider import *


class ProviderService:

    @staticmethod
    def init_supported_provider(tenant):
        """Initialize the model provider, check whether the supported provider has a record"""

        need_init_provider_names = [ProviderName.OPENAI.value, ProviderName.AZURE_OPENAI.value, ProviderName.ANTHROPIC.value]

        providers = db.session.query(Provider).filter(
            Provider.tenant_id == tenant.id,
            Provider.provider_type == ProviderType.CUSTOM.value,
            Provider.provider_name.in_(need_init_provider_names)
        ).all()

        exists_provider_names = []
        for provider in providers:
            exists_provider_names.append(provider.provider_name)

        not_exists_provider_names = list(set(need_init_provider_names) - set(exists_provider_names))

        if not_exists_provider_names:
            # Initialize the model provider, check whether the supported provider has a record
            for provider_name in not_exists_provider_names:
                provider = Provider(
                    tenant_id=tenant.id,
                    provider_name=provider_name,
                    provider_type=ProviderType.CUSTOM.value,
                    is_valid=False
                )
                db.session.add(provider)

            db.session.commit()

    @staticmethod
    def get_obfuscated_api_key(tenant, provider_name: ProviderName, only_custom: bool = False):
        llm_provider_service = LLMProviderService(tenant.id, provider_name.value)
        return llm_provider_service.get_provider_configs(obfuscated=True, only_custom=only_custom)

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
    def create_system_provider(tenant: Tenant, provider_name: str = ProviderName.OPENAI.value, quota_limit: int = 200,
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
                quota_limit=quota_limit,
                encrypted_config='',
                is_valid=is_valid,
            )
            db.session.add(provider)
            db.session.commit()
