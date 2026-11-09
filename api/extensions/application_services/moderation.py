"""Composition for generic moderation policies bound during model assembly."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.entities import DEFAULT_PLUGIN_ID
from core.entities.provider_configuration import ProviderModelBundle
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.plugin.impl.model import PluginModelClient
from enums import DeploymentEdition
from extensions.ext_hosting_provider import hosting_configuration
from graphon.model_runtime.entities.model_entities import ModelType
from machinery.context import AppRequestContext
from models.provider import ProviderType
from repositories.api_based_extension_repository import APIBasedExtensionRepository
from services.api_based_extension_adapters import WorkspaceTokenCipher
from services.moderation_adapters import (
    ChainedLLMModerationPolicy,
    ExtensionModerationGateway,
    HostedOpenAIModerationGateway,
    LLMModerationGuard,
)
from services.moderation_service import ModerationPhase, ModerationRule, ModerationService

if TYPE_CHECKING:
    from core.model_manager import LLMModerationPolicy


def bind_hosted_llm_moderation(
    bundle: ProviderModelBundle, *, policy: LLMModerationPolicy | None
) -> LLMModerationPolicy | None:
    """Automatically bind platform-funded moderation to Cloud AI-credit LLMs.

    Cloud SYSTEM LLMs whose current TRIAL/PAID quota uses the credit-pool meter
    require both phases. This includes CREDITS and legacy TIMES metering, which
    reserves one credit per call. Other models/deployments return the explicit policy unchanged
    without constructing a hosted gateway. Binding performs no provider I/O.
    The SRE-pinned plugin identifier is required for eligible models. No tenant
    installation, provider discovery, or user model/quota reservation is used.
    """
    if (
        dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD
        or bundle.model_type_instance.model_type != ModelType.LLM
        or bundle.configuration.using_provider_type != ProviderType.SYSTEM
    ):
        return policy
    configuration = bundle.configuration.system_configuration
    if configuration.current_quota_type not in {ProviderQuotaType.TRIAL, ProviderQuotaType.PAID}:
        return policy
    quota = next(
        (quota for quota in configuration.quota_configurations if quota.quota_type == configuration.current_quota_type),
        None,
    )
    if quota is None or quota.quota_unit not in {QuotaUnit.CREDITS, QuotaUnit.TIMES}:
        return policy
    provider = hosting_configuration.provider_map.get(f"{DEFAULT_PLUGIN_ID}/openai/openai")
    credentials = provider.credentials if provider is not None and provider.enabled else None
    plugin_unique_identifier = dify_config.HOSTED_MODERATION_PLUGIN_UNIQUE_IDENTIFIER.strip()
    if not plugin_unique_identifier:
        raise ValueError("HOSTED_MODERATION_PLUGIN_UNIQUE_IDENTIFIER is required for Cloud credit-metered models.")
    hosted_service = ModerationService(
        gateway=HostedOpenAIModerationGateway(
            client=PluginModelClient(),
            credentials=credentials,
            plugin_unique_identifier=plugin_unique_identifier,
        )
    )
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id=bundle.configuration.tenant_id, app_id=""),
        service=hosted_service,
        rule=ModerationRule(
            type="openai_moderation",
            config={
                "inputs_config": {"enabled": True, "preset_response": "Model input was rejected by moderation."},
                "outputs_config": {"enabled": True, "preset_response": "Model output was rejected by moderation."},
            },
        ),
    )
    return ChainedLLMModerationPolicy((guard, policy)) if policy is not None else guard


def build_moderation_service(*, database_client: sessionmaker[Session]) -> ModerationService:
    """Wire the three registered legacy moderation backends without performing I/O."""
    return ModerationService(
        gateway=ExtensionModerationGateway(
            extensions=APIBasedExtensionRepository(session_factory=database_client), cipher=WorkspaceTokenCipher()
        )
    )


def build_llm_moderation_guard(
    context: AppRequestContext, *, service: ModerationService, rule: ModerationRule
) -> LLMModerationGuard:
    """Bind an admitted scope and snapshot of a rule for model assembly.

    Missing or malformed phase enablement fails during assembly. Disabled phases
    do not inspect content, and disabled output moderation preserves live streaming.
    """
    rule = rule.model_copy(deep=True)
    inputs = rule.config.get("inputs_config")
    if not isinstance(inputs, dict) or not isinstance(inputs.get("enabled"), bool):
        raise ValueError("inputs_config.enabled must be a bool")
    outputs = rule.config.get("outputs_config")
    if not isinstance(outputs, dict) or not isinstance(outputs.get("enabled"), bool):
        raise ValueError("outputs_config.enabled must be a bool")

    def check(text: str, phase: ModerationPhase) -> None:
        """Apply the bound rule through the application use case for a runtime phase."""
        service.check(context, rule=rule, text=text, phase=phase)

    return LLMModerationGuard(
        tenant_id=context.tenant_id,
        check=check,
        check_input=inputs["enabled"],
        check_output=outputs["enabled"],
        non_stream_segment_size=dify_config.MODERATION_NON_STREAM_SEGMENT_SIZE,
        stream_segment_size=dify_config.MODERATION_BUFFER_SIZE,
    )
