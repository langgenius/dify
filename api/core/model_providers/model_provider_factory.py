from typing import Type

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
        if not preferred_provider:
            return None

        # init model provider
        model_provider_class = ModelProviderFactory.get_model_provider_class(model_provider_name)
        return model_provider_class(provider=preferred_provider)

    @classmethod
    def get_preferred_type_by_preferred_model_provider(cls,
                                                       model_provider_name: str,
                                                       preferred_model_provider: TenantPreferredModelProvider):
        """
        get preferred provider type by preferred model provider.

        :param model_provider_name:
        :param preferred_model_provider:
        :return:
        """
        preferred_provider_type = None
        if not preferred_model_provider:
            model_provider_rules = ModelProviderFactory.get_provider_rule(model_provider_name)
            if ProviderType.SYSTEM.value in model_provider_rules['support_provider_types']:
                preferred_provider_type = ProviderType.SYSTEM.value
            elif ProviderType.CUSTOM.value in model_provider_rules['support_provider_types']:
                preferred_provider_type = ProviderType.CUSTOM.value
        else:
            preferred_provider_type = preferred_model_provider.preferred_provider_type

        return preferred_provider_type

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
                Provider.provider_type == preferred_provider_type,
                Provider.is_valid == True
            ).all()

        if preferred_provider_type == ProviderType.SYSTEM.value:
            quota_type_to_provider_dict = {}
            for provider in providers:
                if provider.quota_type == 'trail':
                    provider.quota_type = ProviderQuotaType.TRIAL.value
                    db.session.commit()
                quota_type_to_provider_dict[provider.quota_type] = provider

            model_provider_rules = ModelProviderFactory.get_provider_rule(model_provider_name)

            if ProviderQuotaType.PAID.value in model_provider_rules['system_config']['supported_quota_types'] \
                    and ProviderQuotaType.PAID.value in quota_type_to_provider_dict.keys():
                provider = quota_type_to_provider_dict[ProviderQuotaType.PAID.value]
                if provider.quota_limit > provider.quota_used:
                    return quota_type_to_provider_dict[ProviderQuotaType.PAID.value]

            if ProviderQuotaType.TRIAL.value in model_provider_rules['system_config']['supported_quota_types'] \
                    and ProviderQuotaType.TRIAL.value in quota_type_to_provider_dict.keys():
                return quota_type_to_provider_dict[ProviderQuotaType.TRIAL.value]
        elif preferred_provider_type == ProviderType.CUSTOM.value:
            return providers[0] if providers else None

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

        return cls.get_preferred_type_by_preferred_model_provider(model_provider_name, preferred_model_provider)
