from typing import Optional

from flask import Config, Flask
from pydantic import BaseModel

from core.entities.provider_entities import QuotaUnit, RestrictModel
from core.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderQuotaType


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
    provider_map: dict[str, HostingProvider] = {}
    moderation_config: HostedModerationConfig = None

    def init_app(self, app: Flask) -> None:
        config = app.config

        if config.get('EDITION') != 'CLOUD':
            return

        self.provider_map["azure_openai"] = self.init_azure_openai(config)
        self.provider_map["openai"] = self.init_openai(config)
        self.provider_map["anthropic"] = self.init_anthropic(config)
        self.provider_map["minimax"] = self.init_minimax(config)
        self.provider_map["spark"] = self.init_spark(config)
        self.provider_map["zhipuai"] = self.init_zhipuai(config)

        self.moderation_config = self.init_moderation_config(config)

    def init_azure_openai(self, app_config: Config) -> HostingProvider:
        quota_unit = QuotaUnit.TIMES
        if app_config.get("HOSTED_AZURE_OPENAI_ENABLED"):
            credentials = {
                "openai_api_key": app_config.get("HOSTED_AZURE_OPENAI_API_KEY"),
                "openai_api_base": app_config.get("HOSTED_AZURE_OPENAI_API_BASE"),
                "base_model_name": "gpt-35-turbo"
            }

            quotas = []
            hosted_quota_limit = int(app_config.get("HOSTED_AZURE_OPENAI_QUOTA_LIMIT", "1000"))
            trial_quota = TrialHostingQuota(
                quota_limit=hosted_quota_limit,
                restrict_models=[
                    RestrictModel(model="gpt-4", base_model_name="gpt-4", model_type=ModelType.LLM),
                    RestrictModel(model="gpt-4o", base_model_name="gpt-4o", model_type=ModelType.LLM),
                    RestrictModel(model="gpt-4o-mini", base_model_name="gpt-4o-mini", model_type=ModelType.LLM),
                    RestrictModel(model="gpt-4-32k", base_model_name="gpt-4-32k", model_type=ModelType.LLM),
                    RestrictModel(model="gpt-4-1106-preview", base_model_name="gpt-4-1106-preview", model_type=ModelType.LLM),
                    RestrictModel(model="gpt-4-vision-preview", base_model_name="gpt-4-vision-preview", model_type=ModelType.LLM),
                    RestrictModel(model="gpt-35-turbo", base_model_name="gpt-35-turbo", model_type=ModelType.LLM),
                    RestrictModel(model="gpt-35-turbo-1106", base_model_name="gpt-35-turbo-1106", model_type=ModelType.LLM),
                    RestrictModel(model="gpt-35-turbo-instruct", base_model_name="gpt-35-turbo-instruct", model_type=ModelType.LLM),
                    RestrictModel(model="gpt-35-turbo-16k", base_model_name="gpt-35-turbo-16k", model_type=ModelType.LLM),
                    RestrictModel(model="text-davinci-003", base_model_name="text-davinci-003", model_type=ModelType.LLM),
                    RestrictModel(model="text-embedding-ada-002", base_model_name="text-embedding-ada-002", model_type=ModelType.TEXT_EMBEDDING),
                    RestrictModel(model="text-embedding-3-small", base_model_name="text-embedding-3-small", model_type=ModelType.TEXT_EMBEDDING),
                    RestrictModel(model="text-embedding-3-large", base_model_name="text-embedding-3-large", model_type=ModelType.TEXT_EMBEDDING),
                ]
            )
            quotas.append(trial_quota)

            return HostingProvider(
                enabled=True,
                credentials=credentials,
                quota_unit=quota_unit,
                quotas=quotas
            )

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    def init_openai(self, app_config: Config) -> HostingProvider:
        quota_unit = QuotaUnit.CREDITS
        quotas = []

        if app_config.get("HOSTED_OPENAI_TRIAL_ENABLED"):
            hosted_quota_limit = int(app_config.get("HOSTED_OPENAI_QUOTA_LIMIT", "200"))
            trial_models = self.parse_restrict_models_from_env(app_config, "HOSTED_OPENAI_TRIAL_MODELS")
            trial_quota = TrialHostingQuota(
                quota_limit=hosted_quota_limit,
                restrict_models=trial_models
            )
            quotas.append(trial_quota)

        if app_config.get("HOSTED_OPENAI_PAID_ENABLED"):
            paid_models = self.parse_restrict_models_from_env(app_config, "HOSTED_OPENAI_PAID_MODELS")
            paid_quota = PaidHostingQuota(
                restrict_models=paid_models
            )
            quotas.append(paid_quota)

        if len(quotas) > 0:
            credentials = {
                "openai_api_key": app_config.get("HOSTED_OPENAI_API_KEY"),
            }

            if app_config.get("HOSTED_OPENAI_API_BASE"):
                credentials["openai_api_base"] = app_config.get("HOSTED_OPENAI_API_BASE")

            if app_config.get("HOSTED_OPENAI_API_ORGANIZATION"):
                credentials["openai_organization"] = app_config.get("HOSTED_OPENAI_API_ORGANIZATION")

            return HostingProvider(
                enabled=True,
                credentials=credentials,
                quota_unit=quota_unit,
                quotas=quotas
            )

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    def init_anthropic(self, app_config: Config) -> HostingProvider:
        quota_unit = QuotaUnit.TOKENS
        quotas = []

        if app_config.get("HOSTED_ANTHROPIC_TRIAL_ENABLED"):
            hosted_quota_limit = int(app_config.get("HOSTED_ANTHROPIC_QUOTA_LIMIT", "0"))
            trial_quota = TrialHostingQuota(
                quota_limit=hosted_quota_limit
            )
            quotas.append(trial_quota)

        if app_config.get("HOSTED_ANTHROPIC_PAID_ENABLED"):
            paid_quota = PaidHostingQuota()
            quotas.append(paid_quota)

        if len(quotas) > 0:
            credentials = {
                "anthropic_api_key": app_config.get("HOSTED_ANTHROPIC_API_KEY"),
            }

            if app_config.get("HOSTED_ANTHROPIC_API_BASE"):
                credentials["anthropic_api_url"] = app_config.get("HOSTED_ANTHROPIC_API_BASE")

            return HostingProvider(
                enabled=True,
                credentials=credentials,
                quota_unit=quota_unit,
                quotas=quotas
            )

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    def init_minimax(self, app_config: Config) -> HostingProvider:
        quota_unit = QuotaUnit.TOKENS
        if app_config.get("HOSTED_MINIMAX_ENABLED"):
            quotas = [FreeHostingQuota()]

            return HostingProvider(
                enabled=True,
                credentials=None,  # use credentials from the provider
                quota_unit=quota_unit,
                quotas=quotas
            )

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    def init_spark(self, app_config: Config) -> HostingProvider:
        quota_unit = QuotaUnit.TOKENS
        if app_config.get("HOSTED_SPARK_ENABLED"):
            quotas = [FreeHostingQuota()]

            return HostingProvider(
                enabled=True,
                credentials=None,  # use credentials from the provider
                quota_unit=quota_unit,
                quotas=quotas
            )

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    def init_zhipuai(self, app_config: Config) -> HostingProvider:
        quota_unit = QuotaUnit.TOKENS
        if app_config.get("HOSTED_ZHIPUAI_ENABLED"):
            quotas = [FreeHostingQuota()]

            return HostingProvider(
                enabled=True,
                credentials=None,  # use credentials from the provider
                quota_unit=quota_unit,
                quotas=quotas
            )

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    def init_moderation_config(self, app_config: Config) -> HostedModerationConfig:
        if app_config.get("HOSTED_MODERATION_ENABLED") \
                and app_config.get("HOSTED_MODERATION_PROVIDERS"):
            return HostedModerationConfig(
                enabled=True,
                providers=app_config.get("HOSTED_MODERATION_PROVIDERS").split(',')
            )

        return HostedModerationConfig(
            enabled=False
        )

    @staticmethod
    def parse_restrict_models_from_env(app_config: Config, env_var: str) -> list[RestrictModel]:
        models_str = app_config.get(env_var)
        models_list = models_str.split(",") if models_str else []
        return [RestrictModel(model=model_name.strip(), model_type=ModelType.LLM) for model_name in models_list if
                model_name.strip()]

