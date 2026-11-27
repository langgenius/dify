"""Admission shared by hosted model assembly and app OpenAI routing."""

from __future__ import annotations

from typing import TYPE_CHECKING

from configs import dify_config
from core.app.entities.app_invoke_entities import (
    AgentAppGenerateEntity,
    AppGenerateEntity,
    EasyUIBasedAppGenerateEntity,
)
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from enums import DeploymentEdition
from graphon.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderType

if TYPE_CHECKING:
    from core.entities.provider_configuration import ProviderModelBundle


def platform_moderation_configured() -> bool:
    """Return whether the deployment enables hosted moderation, before model admission."""
    return dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and dify_config.HOSTED_MODERATION_ENABLED


def platform_moderation_enabled(bundle: ProviderModelBundle) -> bool:
    """Admit only Cloud AI-credit LLMs, without selecting credentials or doing provider I/O."""
    if (
        not platform_moderation_configured()
        or bundle.model_type_instance.model_type != ModelType.LLM
        or bundle.configuration.using_provider_type != ProviderType.SYSTEM
    ):
        return False
    configuration = bundle.configuration.system_configuration
    return configuration.current_quota_type in {ProviderQuotaType.TRIAL, ProviderQuotaType.PAID} and any(
        quota.quota_type == configuration.current_quota_type
        and quota.quota_unit in {QuotaUnit.CREDITS, QuotaUnit.TIMES}
        for quota in configuration.quota_configurations
    )


def platform_owns_openai_moderation(app: AppGenerateEntity | None = None) -> bool:
    """Decide whether a trusted app invocation should skip its tenant OpenAI rule.

    Direct apps use the same admitted model bundle as the platform guard. For
    workflows, remote Agents, and standalone callers (None), keep the deployment
    gate: no single in-process model bundle describes the full app response.
    This decision does not perform provider or quota I/O.
    """
    if isinstance(app, EasyUIBasedAppGenerateEntity) and not isinstance(app, AgentAppGenerateEntity):
        return platform_moderation_enabled(app.model_conf.provider_model_bundle)
    return platform_moderation_configured()
