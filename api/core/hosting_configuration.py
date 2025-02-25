from typing import Optional

from flask import Flask
from pydantic import BaseModel

from configs import dify_config
from core.entities import DEFAULT_PLUGIN_ID
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit, RestrictModel
from core.model_runtime.entities.model_entities import ModelType


class HostingQuota(BaseModel):
    quota_type: ProviderQuotaType
    restrict_models: list[RestrictModel] = []


class TrialHostingQuota(HostingQuota):
    quota_type: ProviderQuotaType = ProviderQuotaType.TRIAL
    quota_limit: int = 0
    """Quota limit for the hosting provider models. -1 means unlimited."""


class PaidHostingQuota(HostingQuota):
    quota_type: ProviderQuotaType = ProviderQuotaType.PAID


class FreeHostingQuota(HostingQuota):
    quota_type: ProviderQuotaType = ProviderQuotaType.FREE


class HostingProvider(BaseModel):
    enabled: bool = False
    credentials: Optional[dict] = None
    quota_unit: Optional[QuotaUnit] = None
    quotas: list[HostingQuota] = []


class HostedModerationConfig(BaseModel):
    enabled: bool = False
    providers: list[str] = []


class HostingConfiguration:
    provider_map: dict[str, HostingProvider]
    moderation_config: Optional[HostedModerationConfig] = None

    def __init__(self) -> None:
        self.provider_map = {}
        self.moderation_config = None

    def init_app(self, app: Flask) -> None:
        if dify_config.EDITION != "CLOUD":
            return

        self.provider_map[f"{DEFAULT_PLUGIN_ID}/azure_openai/azure_openai"] = self.init_azure_openai()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/openai/openai"] = self.init_openai()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/anthropic/anthropic"] = self.init_anthropic()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/minimax/minimax"] = self.init_minimax()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/spark/spark"] = self.init_spark()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/zhipuai/zhipuai"] = self.init_zhipuai()

        self.moderation_config = self.init_moderation_config()

    @staticmethod
    def init_azure_openai() -> HostingProvider:
        quota_unit = QuotaUnit.TIMES
        if dify_config.HOSTED_AZURE_OPENAI_ENABLED:
            credentials = {
                "openai_api_key": dify_config.HOSTED_AZURE_OPENAI_API_KEY,
                "openai_api_base": dify_config.HOSTED_AZURE_OPENAI_API_BASE,
                "base_model_name": "gpt-35-turbo",
            }

            quotas: list[HostingQuota] = []
            hosted_quota_limit = dify_config.HOSTED_AZURE_OPENAI_QUOTA_LIMIT
            trial_quota = TrialHostingQuota(
                quota_limit=hosted_quota_limit,
                restrict_models=[
                    RestrictModel(model="gpt-4", base_model_name="gpt-4", model_type=ModelType.LLM),
                    RestrictModel(model="gpt-4o", base_model_name="gpt-4o", model_type=ModelType.LLM),
                    RestrictModel(model="gpt-4o-mini", base_model_name="gpt-4o-mini", model_type=ModelType.LLM),
                    RestrictModel(model="gpt-4-32k", base_model_name="gpt-4-32k", model_type=ModelType.LLM),
                    RestrictModel(
                        model="gpt-4-1106-preview", base_model_name="gpt-4-1106-preview", model_type=ModelType.LLM
                    ),
                    RestrictModel(
                        model="gpt-4-vision-preview", base_model_name="gpt-4-vision-preview", model_type=ModelType.LLM
                    ),
                    RestrictModel(model="gpt-35-turbo", base_model_name="gpt-35-turbo", model_type=ModelType.LLM),
                    RestrictModel(
                        model="gpt-35-turbo-1106", base_model_name="gpt-35-turbo-1106", model_type=ModelType.LLM
                    ),
                    RestrictModel(
                        model="gpt-35-turbo-instruct", base_model_name="gpt-35-turbo-instruct", model_type=ModelType.LLM
                    ),
                    RestrictModel(
                        model="gpt-35-turbo-16k", base_model_name="gpt-35-turbo-16k", model_type=ModelType.LLM
                    ),
                    RestrictModel(
                        model="text-davinci-003", base_model_name="text-davinci-003", model_type=ModelType.LLM
                    ),
                    RestrictModel(
                        model="text-embedding-ada-002",
                        base_model_name="text-embedding-ada-002",
                        model_type=ModelType.TEXT_EMBEDDING,
                    ),
                    RestrictModel(
                        model="text-embedding-3-small",
                        base_model_name="text-embedding-3-small",
                        model_type=ModelType.TEXT_EMBEDDING,
                    ),
                    RestrictModel(
                        model="text-embedding-3-large",
                        base_model_name="text-embedding-3-large",
                        model_type=ModelType.TEXT_EMBEDDING,
                    ),
                ],
            )
            quotas.append(trial_quota)

            return HostingProvider(enabled=True, credentials=credentials, quota_unit=quota_unit, quotas=quotas)

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    def init_openai(self) -> HostingProvider:
        quota_unit = QuotaUnit.CREDITS
        quotas: list[HostingQuota] = []

        if dify_config.HOSTED_OPENAI_TRIAL_ENABLED:
            hosted_quota_limit = dify_config.HOSTED_OPENAI_QUOTA_LIMIT
            trial_models = self.parse_restrict_models_from_env("HOSTED_OPENAI_TRIAL_MODELS")
            trial_quota = TrialHostingQuota(quota_limit=hosted_quota_limit, restrict_models=trial_models)
            quotas.append(trial_quota)

        if dify_config.HOSTED_OPENAI_PAID_ENABLED:
            paid_models = self.parse_restrict_models_from_env("HOSTED_OPENAI_PAID_MODELS")
            paid_quota = PaidHostingQuota(restrict_models=paid_models)
            quotas.append(paid_quota)

        if len(quotas) > 0:
            credentials = {
                "openai_api_key": dify_config.HOSTED_OPENAI_API_KEY,
            }

            if dify_config.HOSTED_OPENAI_API_BASE:
                credentials["openai_api_base"] = dify_config.HOSTED_OPENAI_API_BASE

            if dify_config.HOSTED_OPENAI_API_ORGANIZATION:
                credentials["openai_organization"] = dify_config.HOSTED_OPENAI_API_ORGANIZATION

            return HostingProvider(enabled=True, credentials=credentials, quota_unit=quota_unit, quotas=quotas)

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    @staticmethod
    def init_anthropic() -> HostingProvider:
        quota_unit = QuotaUnit.TOKENS
        quotas: list[HostingQuota] = []

        if dify_config.HOSTED_ANTHROPIC_TRIAL_ENABLED:
            hosted_quota_limit = dify_config.HOSTED_ANTHROPIC_QUOTA_LIMIT
            trial_quota = TrialHostingQuota(quota_limit=hosted_quota_limit)
            quotas.append(trial_quota)

        if dify_config.HOSTED_ANTHROPIC_PAID_ENABLED:
            paid_quota = PaidHostingQuota()
            quotas.append(paid_quota)

        if len(quotas) > 0:
            credentials = {
                "anthropic_api_key": dify_config.HOSTED_ANTHROPIC_API_KEY,
            }

            if dify_config.HOSTED_ANTHROPIC_API_BASE:
                credentials["anthropic_api_url"] = dify_config.HOSTED_ANTHROPIC_API_BASE

            return HostingProvider(enabled=True, credentials=credentials, quota_unit=quota_unit, quotas=quotas)

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    @staticmethod
    def init_minimax() -> HostingProvider:
        quota_unit = QuotaUnit.TOKENS
        if dify_config.HOSTED_MINIMAX_ENABLED:
            quotas: list[HostingQuota] = [FreeHostingQuota()]

            return HostingProvider(
                enabled=True,
                credentials=None,  # use credentials from the provider
                quota_unit=quota_unit,
                quotas=quotas,
            )

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    @staticmethod
    def init_spark() -> HostingProvider:
        quota_unit = QuotaUnit.TOKENS
        if dify_config.HOSTED_SPARK_ENABLED:
            quotas: list[HostingQuota] = [FreeHostingQuota()]

            return HostingProvider(
                enabled=True,
                credentials=None,  # use credentials from the provider
                quota_unit=quota_unit,
                quotas=quotas,
            )

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    @staticmethod
    def init_zhipuai() -> HostingProvider:
        quota_unit = QuotaUnit.TOKENS
        if dify_config.HOSTED_ZHIPUAI_ENABLED:
            quotas: list[HostingQuota] = [FreeHostingQuota()]

            return HostingProvider(
                enabled=True,
                credentials=None,  # use credentials from the provider
                quota_unit=quota_unit,
                quotas=quotas,
            )

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    @staticmethod
    def init_moderation_config() -> HostedModerationConfig:
        if dify_config.HOSTED_MODERATION_ENABLED and dify_config.HOSTED_MODERATION_PROVIDERS:
            providers = dify_config.HOSTED_MODERATION_PROVIDERS.split(",")
            hosted_providers = []
            for provider in providers:
                if "/" not in provider:
                    provider = f"{DEFAULT_PLUGIN_ID}/{provider}/{provider}"
                hosted_providers.append(provider)

            return HostedModerationConfig(enabled=True, providers=hosted_providers)

        return HostedModerationConfig(enabled=False)

    @staticmethod
    def parse_restrict_models_from_env(env_var: str) -> list[RestrictModel]:
        models_str = dify_config.model_dump().get(env_var)
        models_list = models_str.split(",") if models_str else []
        return [
            RestrictModel(model=model_name.strip(), model_type=ModelType.LLM)
            for model_name in models_list
            if model_name.strip()
        ]
