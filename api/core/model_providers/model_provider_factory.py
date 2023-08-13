from typing import Type

from sqlalchemy.exc import IntegrityError

from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.base import BaseModelProvider
from core.model_providers.rules import provider_rules
from extensions.ext_database import db
from models.provider import TenantPreferredModelProvider, ProviderType, Provider, ProviderQuotaType

DEFAULT_MODELS = {
    ModelType.TEXT_GENERATION.value: {
        'provider_name': 'openai',
        'model_name': 'gpt-3.5-turbo',
    },
    ModelType.EMBEDDINGS.value: {
        'provider_name': 'openai',
        'model_name': 'text-embedding-ada-002',
    },
    ModelType.SPEECH_TO_TEXT.value: {
        'provider_name': 'openai',
        'model_name': 'whisper-1',
    }
}


class ModelProviderFactory:
    @classmethod
    def get_model_provider_class(cls, provider_name: str) -> Type[BaseModelProvider]:
        if provider_name == 'openai':
            from core.model_providers.providers.openai_provider import OpenAIProvider
            return OpenAIProvider
        elif provider_name == 'anthropic':
            from core.model_providers.providers.anthropic_provider import AnthropicProvider
            return AnthropicProvider
        elif provider_name == 'minimax':
            from core.model_providers.providers.minimax_provider import MinimaxProvider
            return MinimaxProvider
        elif provider_name == 'spark':
            from core.model_providers.providers.spark_provider import SparkProvider
            return SparkProvider
        elif provider_name == 'tongyi':
            from core.model_providers.providers.tongyi_provider import TongyiProvider
            return TongyiProvider
        elif provider_name == 'wenxin':
            from core.model_providers.providers.wenxin_provider import WenxinProvider
            return WenxinProvider
        elif provider_name == 'chatglm':
            from core.model_providers.providers.chatglm_provider import ChatGLMProvider
            return ChatGLMProvider
        elif provider_name == 'azure_openai':
            from core.model_providers.providers.azure_openai_provider import AzureOpenAIProvider
            return AzureOpenAIProvider
        elif provider_name == 'replicate':
            from core.model_providers.providers.replicate_provider import ReplicateProvider
            return ReplicateProvider
        elif provider_name == 'huggingface_hub':
            from core.model_providers.providers.huggingface_hub_provider import HuggingfaceHubProvider
            return HuggingfaceHubProvider
        else:
            raise NotImplementedError

    @classmethod
    def get_provider_names(cls):
        """
        Returns a list of provider names.
        """
        return list(provider_rules.keys())

    @classmethod
    def get_provider_rules(cls):
        """
        Returns a list of provider rules.

        :return:
        """
        return provider_rules

    @classmethod
    def get_provider_rule(cls, provider_name: str):
        """
        Returns provider rule.
        """
        return provider_rules[provider_name]

    @classmethod
    def get_preferred_model_provider(cls, tenant_id: str, model_provider_name: str):
        """
        get preferred model provider.

        :param tenant_id: a string representing the ID of the tenant.
        :param model_provider_name:
        :return:
        """
        # get preferred provider
        preferred_provider = cls._get_preferred_provider(tenant_id, model_provider_name)
        if not preferred_provider or not preferred_provider.is_valid:
            return None

        # init model provider
        model_provider_class = ModelProviderFactory.get_model_provider_class(model_provider_name)
        return model_provider_class(provider=preferred_provider)

    @classmethod
    def get_preferred_type_by_preferred_model_provider(cls,
                                                       tenant_id: str,
                                                       model_provider_name: str,
                                                       preferred_model_provider: TenantPreferredModelProvider):
        """
        get preferred provider type by preferred model provider.

        :param model_provider_name:
        :param preferred_model_provider:
        :return:
        """
        if not preferred_model_provider:
            model_provider_rules = ModelProviderFactory.get_provider_rule(model_provider_name)
            support_provider_types = model_provider_rules['support_provider_types']

            if ProviderType.CUSTOM.value in support_provider_types:
                custom_provider = db.session.query(Provider) \
                    .filter(
                        Provider.tenant_id == tenant_id,
                        Provider.provider_name == model_provider_name,
                        Provider.provider_type == ProviderType.CUSTOM.value,
                        Provider.is_valid == True
                    ).first()

                if custom_provider:
                    return ProviderType.CUSTOM.value

            model_provider = cls.get_model_provider_class(model_provider_name)

            if ProviderType.SYSTEM.value in support_provider_types \
                    and model_provider.is_provider_type_system_supported():
                return ProviderType.SYSTEM.value
            elif ProviderType.CUSTOM.value in support_provider_types:
                return ProviderType.CUSTOM.value
        else:
            return preferred_model_provider.preferred_provider_type

    @classmethod
    def _get_preferred_provider(cls, tenant_id: str, model_provider_name: str):
        """
        get preferred provider of tenant.

        :param tenant_id:
        :param model_provider_name:
        :return:
        """
        # get preferred provider type
        preferred_provider_type = cls._get_preferred_provider_type(tenant_id, model_provider_name)

        # get providers by preferred provider type
        providers = db.session.query(Provider) \
            .filter(
                Provider.tenant_id == tenant_id,
                Provider.provider_name == model_provider_name,
                Provider.provider_type == preferred_provider_type
            ).all()

        no_system_provider = False
        if preferred_provider_type == ProviderType.SYSTEM.value:
            quota_type_to_provider_dict = {}
            for provider in providers:
                quota_type_to_provider_dict[provider.quota_type] = provider

            model_provider_rules = ModelProviderFactory.get_provider_rule(model_provider_name)
            for quota_type_enum in ProviderQuotaType:
                quota_type = quota_type_enum.value
                if quota_type in model_provider_rules['system_config']['supported_quota_types']:
                    if quota_type in quota_type_to_provider_dict.keys():
                        provider = quota_type_to_provider_dict[quota_type]
                        if provider.is_valid and provider.quota_limit > provider.quota_used:
                            return provider
                    elif quota_type == ProviderQuotaType.TRIAL.value:
                        try:
                            provider = Provider(
                                tenant_id=tenant_id,
                                provider_name=model_provider_name,
                                provider_type=ProviderType.SYSTEM.value,
                                is_valid=True,
                                quota_type=ProviderQuotaType.TRIAL.value,
                                quota_limit=model_provider_rules['system_config']['quota_limit'],
                                quota_used=0
                            )
                            db.session.add(provider)
                            db.session.commit()
                        except IntegrityError:
                            db.session.rollback()
                            provider = db.session.query(Provider) \
                                .filter(
                                Provider.tenant_id == tenant_id,
                                Provider.provider_name == model_provider_name,
                                Provider.provider_type == ProviderType.SYSTEM.value,
                                Provider.quota_type == ProviderQuotaType.TRIAL.value
                            ).first()

                        return provider

            no_system_provider = True

        if no_system_provider:
            providers = db.session.query(Provider) \
                .filter(
                Provider.tenant_id == tenant_id,
                Provider.provider_name == model_provider_name,
                Provider.provider_type == ProviderType.CUSTOM.value
            ).all()

        if preferred_provider_type == ProviderType.CUSTOM.value or no_system_provider:
            if providers:
                return providers[0]
            else:
                try:
                    provider = Provider(
                        tenant_id=tenant_id,
                        provider_name=model_provider_name,
                        provider_type=ProviderType.CUSTOM.value,
                        is_valid=False
                    )
                    db.session.add(provider)
                    db.session.commit()
                except IntegrityError:
                    db.session.rollback()
                    provider = db.session.query(Provider) \
                        .filter(
                            Provider.tenant_id == tenant_id,
                            Provider.provider_name == model_provider_name,
                            Provider.provider_type == ProviderType.CUSTOM.value
                        ).first()

                return provider

        return None

    @classmethod
    def _get_preferred_provider_type(cls, tenant_id: str, model_provider_name: str):
        """
        get preferred provider type of tenant.

        :param tenant_id:
        :param model_provider_name:
        :return:
        """
        preferred_model_provider = db.session.query(TenantPreferredModelProvider) \
            .filter(
            TenantPreferredModelProvider.tenant_id == tenant_id,
            TenantPreferredModelProvider.provider_name == model_provider_name
        ).first()

        return cls.get_preferred_type_by_preferred_model_provider(tenant_id, model_provider_name, preferred_model_provider)
