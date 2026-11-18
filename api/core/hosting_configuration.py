import hashlib
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from flask import Flask
from pydantic import BaseModel, ValidationError

from configs import dify_config
from core.entities import DEFAULT_PLUGIN_ID
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit, RestrictModel, SystemConfiguration
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from enums import DeploymentEdition
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from graphon.model_runtime.entities.provider_entities import ProviderEntity


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
    credentials: dict[str, Any] | None = None
    quota_unit: QuotaUnit | None = None
    quotas: list[HostingQuota] = []


class HostedModerationConfig(BaseModel):
    enabled: bool = False
    providers: list[str] = []


class HostingConfiguration:
    provider_map: dict[str, HostingProvider]
    moderation_config: HostedModerationConfig | None = None

    def __init__(self):
        self.provider_map = {}
        self.moderation_config = None

    def init_app(self, app: Flask):
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return

        self.provider_map[f"{DEFAULT_PLUGIN_ID}/azure_openai/azure_openai"] = self.init_azure_openai()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/openai/openai"] = self.init_openai()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/anthropic/anthropic"] = self.init_anthropic()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/minimax/minimax"] = self.init_minimax()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/spark/spark"] = self.init_spark()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/zhipuai/zhipuai"] = self.init_zhipuai()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/gemini/google"] = self.init_gemini()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/x/x"] = self.init_xai()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/deepseek/deepseek"] = self.init_deepseek()
        self.provider_map[f"{DEFAULT_PLUGIN_ID}/tongyi/tongyi"] = self.init_tongyi()

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
            hosted_quota_limit = 0
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

    def init_gemini(self) -> HostingProvider:
        quota_unit = QuotaUnit.CREDITS
        quotas: list[HostingQuota] = []

        if dify_config.HOSTED_GEMINI_TRIAL_ENABLED:
            hosted_quota_limit = 0
            trial_models = self.parse_restrict_models_from_env("HOSTED_GEMINI_TRIAL_MODELS")
            trial_quota = TrialHostingQuota(quota_limit=hosted_quota_limit, restrict_models=trial_models)
            quotas.append(trial_quota)

        if dify_config.HOSTED_GEMINI_PAID_ENABLED:
            paid_models = self.parse_restrict_models_from_env("HOSTED_GEMINI_PAID_MODELS")
            paid_quota = PaidHostingQuota(restrict_models=paid_models)
            quotas.append(paid_quota)

        if len(quotas) > 0:
            credentials = {
                "google_api_key": dify_config.HOSTED_GEMINI_API_KEY,
            }

            if dify_config.HOSTED_GEMINI_API_BASE:
                credentials["google_base_url"] = dify_config.HOSTED_GEMINI_API_BASE

            return HostingProvider(enabled=True, credentials=credentials, quota_unit=quota_unit, quotas=quotas)

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    def init_anthropic(self) -> HostingProvider:
        quota_unit = QuotaUnit.CREDITS
        quotas: list[HostingQuota] = []

        if dify_config.HOSTED_ANTHROPIC_TRIAL_ENABLED:
            hosted_quota_limit = 0
            trail_models = self.parse_restrict_models_from_env("HOSTED_ANTHROPIC_TRIAL_MODELS")
            trial_quota = TrialHostingQuota(quota_limit=hosted_quota_limit, restrict_models=trail_models)
            quotas.append(trial_quota)

        if dify_config.HOSTED_ANTHROPIC_PAID_ENABLED:
            paid_models = self.parse_restrict_models_from_env("HOSTED_ANTHROPIC_PAID_MODELS")
            paid_quota = PaidHostingQuota(restrict_models=paid_models)
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

    def init_tongyi(self) -> HostingProvider:
        quota_unit = QuotaUnit.CREDITS
        quotas: list[HostingQuota] = []

        if dify_config.HOSTED_TONGYI_TRIAL_ENABLED:
            hosted_quota_limit = 0
            trail_models = self.parse_restrict_models_from_env("HOSTED_TONGYI_TRIAL_MODELS")
            trial_quota = TrialHostingQuota(quota_limit=hosted_quota_limit, restrict_models=trail_models)
            quotas.append(trial_quota)

        if dify_config.HOSTED_TONGYI_PAID_ENABLED:
            paid_models = self.parse_restrict_models_from_env("HOSTED_TONGYI_PAID_MODELS")
            paid_quota = PaidHostingQuota(restrict_models=paid_models)
            quotas.append(paid_quota)

        if len(quotas) > 0:
            credentials = {
                "dashscope_api_key": dify_config.HOSTED_TONGYI_API_KEY,
                # SNP-494: keep temporary compatibility with tongyi plugin string credential checks.
                "use_international_endpoint": str(dify_config.HOSTED_TONGYI_USE_INTERNATIONAL_ENDPOINT).lower(),
            }

            return HostingProvider(enabled=True, credentials=credentials, quota_unit=quota_unit, quotas=quotas)

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    def init_xai(self) -> HostingProvider:
        quota_unit = QuotaUnit.CREDITS
        quotas: list[HostingQuota] = []

        if dify_config.HOSTED_XAI_TRIAL_ENABLED:
            hosted_quota_limit = 0
            trail_models = self.parse_restrict_models_from_env("HOSTED_XAI_TRIAL_MODELS")
            trial_quota = TrialHostingQuota(quota_limit=hosted_quota_limit, restrict_models=trail_models)
            quotas.append(trial_quota)

        if dify_config.HOSTED_XAI_PAID_ENABLED:
            paid_models = self.parse_restrict_models_from_env("HOSTED_XAI_PAID_MODELS")
            paid_quota = PaidHostingQuota(restrict_models=paid_models)
            quotas.append(paid_quota)

        if len(quotas) > 0:
            credentials = {
                "api_key": dify_config.HOSTED_XAI_API_KEY,
            }

            if dify_config.HOSTED_XAI_API_BASE:
                credentials["endpoint_url"] = dify_config.HOSTED_XAI_API_BASE

            return HostingProvider(enabled=True, credentials=credentials, quota_unit=quota_unit, quotas=quotas)

        return HostingProvider(
            enabled=False,
            quota_unit=quota_unit,
        )

    def init_deepseek(self) -> HostingProvider:
        quota_unit = QuotaUnit.CREDITS
        quotas: list[HostingQuota] = []

        if dify_config.HOSTED_DEEPSEEK_TRIAL_ENABLED:
            hosted_quota_limit = 0
            trail_models = self.parse_restrict_models_from_env("HOSTED_DEEPSEEK_TRIAL_MODELS")
            trial_quota = TrialHostingQuota(quota_limit=hosted_quota_limit, restrict_models=trail_models)
            quotas.append(trial_quota)

        if dify_config.HOSTED_DEEPSEEK_PAID_ENABLED:
            paid_models = self.parse_restrict_models_from_env("HOSTED_DEEPSEEK_PAID_MODELS")
            paid_quota = PaidHostingQuota(restrict_models=paid_models)
            quotas.append(paid_quota)

        if len(quotas) > 0:
            credentials = {
                "api_key": dify_config.HOSTED_DEEPSEEK_API_KEY,
            }

            if dify_config.HOSTED_DEEPSEEK_API_BASE:
                credentials["endpoint_url"] = dify_config.HOSTED_DEEPSEEK_API_BASE

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


_PROVIDER = "langgenius/anthropic/anthropic"
_ALIAS = "claude-opus-4-5"
_SCHEMA_DIGEST = "8e176a84ae186de102bd68deded4d8fde09cce35d67ae1469b5cbd8ae5490e09"
# Source RMC artifact 6ace153b389becc0b381e290322f417ffa1c5872383a8bd183544c8e9d3cfc64
# and official Models GET artifact 9ea9080b6f2cffb64e89fbf16397d9398aa002be49ad2d742c9359e362fcefae
# independently prove the bare alias/schema and its canonical 20251101 model.
# That equivalence does NOT confer a canonical-only whitelist's entitlement.


@dataclass(frozen=True)
class VerifiedHostedAlias:
    schema: AIModelEntity


@dataclass(frozen=True)
class IneligibleHostedAlias:
    reason: Literal["not_requested", "static_present", "not_authorized", "managed_phase"]


@dataclass(frozen=True)
class UnavailableHostedAlias:
    reason: Literal["schema_rpc_failed", "schema_missing", "schema_unreviewed"]


type HostedAliasResolution = VerifiedHostedAlias | IneligibleHostedAlias | UnavailableHostedAlias


def resolve_legacy_hosted_alias(
    *,
    provider: ProviderEntity,
    system: SystemConfiguration,
    model_types: Sequence[ModelType],
    model: str | None,
    has_managed_route: Callable[[], bool],
    read_schema: Callable[[ModelType, str, dict[str, object] | None], AIModelEntity | None],
) -> HostedAliasResolution:
    """Read exact alias metadata only after existing SYSTEM rights are established.

    Preconditions: ``system`` was built by normal verified-hosting admission;
    ``read_schema`` belongs to that same tenant/provider's bound runtime. The
    selected pool must explicitly whitelist the bare LLM, have finite remaining
    credits, and retain original hosted credentials. Static schemas and managed
    migration phases remain owned by their existing paths. A failed metadata
    read is not an authorization denial and never falls back to a dated model.
    """
    if provider.provider != _PROVIDER or ModelType.LLM not in model_types or model not in (None, _ALIAS):
        return IneligibleHostedAlias("not_requested")
    if any(item.model == _ALIAS and item.model_type == ModelType.LLM for item in provider.models):
        return IneligibleHostedAlias("static_present")
    try:
        declaration = PluginModelProviderDeclaration.model_validate(provider)
    except ValidationError:
        return IneligibleHostedAlias("not_authorized")
    if (
        declaration.installation_source != PluginInstallationSource.Marketplace
        or declaration.plugin_unique_identifier.split("@", 1)[0].rsplit(":", 1)[0] != "langgenius/anthropic"
        or not system.enabled
    ):
        return IneligibleHostedAlias("not_authorized")
    selected = [item for item in system.quota_configurations if item.quota_type == system.current_quota_type]
    if len(selected) != 1:
        return IneligibleHostedAlias("not_authorized")
    quota = selected[0]
    restrictions = [item for item in quota.restrict_models if item.model == _ALIAS and item.model_type == ModelType.LLM]
    if (
        quota.quota_type not in {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}
        or quota.quota_unit != QuotaUnit.CREDITS
        or quota.quota_limit <= quota.quota_used
        or quota.quota_used < 0
        or not quota.is_valid
        or len(restrictions) != 1
        or restrictions[0].base_model_name not in (None, _ALIAS)
        or not system.credentials
        or not isinstance(system.credentials.get("anthropic_api_key"), str)
        or not system.credentials["anthropic_api_key"]
        or system.credentials.get("anthropic_api_url") not in (None, "", "https://api.anthropic.com")
    ):
        return IneligibleHostedAlias("not_authorized")
    if has_managed_route():
        return IneligibleHostedAlias("managed_phase")
    credentials: dict[str, object] = dict(system.credentials)
    if restrictions[0].base_model_name is not None:
        credentials["base_model_name"] = restrictions[0].base_model_name
    try:
        schema = read_schema(ModelType.LLM, _ALIAS, credentials)
    except Exception:
        # Neither exception text nor the original credential dictionary is a
        # safe public diagnostic. The caller can log this finite reason only.
        return UnavailableHostedAlias("schema_rpc_failed")
    finally:
        credentials.clear()
    if schema is None:
        return UnavailableHostedAlias("schema_missing")
    if not isinstance(schema, AIModelEntity):
        return UnavailableHostedAlias("schema_unreviewed")
    digest = hashlib.sha256(
        json.dumps(schema.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    if digest != _SCHEMA_DIGEST:
        return UnavailableHostedAlias("schema_unreviewed")
    return VerifiedHostedAlias(schema.model_copy(deep=True))
