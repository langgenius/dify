"""Composition for generic moderation policies bound during model assembly."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.entities.provider_configuration import ProviderModelBundle
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.plugin.impl.model import PluginModelClient
from core.plugin.plugin_service import PluginService
from enums import DeploymentEdition
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
    VerifiedTenantModerationPluginResolver,
)
from services.moderation_service import ModerationPhase, ModerationRule, ModerationService

if TYPE_CHECKING:
    from core.model_manager import LLMModerationPolicy


def platform_moderation_enabled(bundle: ProviderModelBundle) -> bool:
    """Select Cloud AI-credit LLMs only when enabled; other models are excluded without provider I/O."""
    if (
        dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD
        or not dify_config.HOSTED_MODERATION_ENABLED
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


def build_platform_moderation_service() -> ModerationService:
    """Construct a platform-funded tenant-first gateway; defer discovery and fallback errors until checking."""
    return ModerationService(
        gateway=HostedOpenAIModerationGateway(
            client=PluginModelClient(),
            credentials=platform_moderation_credentials(),
            plugin_unique_identifier=dify_config.HOSTED_MODERATION_PLUGIN_UNIQUE_IDENTIFIER,
            tenant_plugins=VerifiedTenantModerationPluginResolver(PluginService()),
        )
    )


def platform_moderation_credentials() -> dict[str, str] | None:
    """Read server-owned credentials without enabling an OpenAI LLM provider or its quotas."""
    api_key = dify_config.HOSTED_OPENAI_API_KEY
    if not api_key or not api_key.strip():
        return None
    credentials = {"openai_api_key": api_key}
    if dify_config.HOSTED_OPENAI_API_BASE:
        credentials["openai_api_base"] = dify_config.HOSTED_OPENAI_API_BASE
    if dify_config.HOSTED_OPENAI_API_ORGANIZATION:
        credentials["openai_organization"] = dify_config.HOSTED_OPENAI_API_ORGANIZATION
    return credentials


def bind_hosted_llm_moderation(
    bundle: ProviderModelBundle, *, policy: LLMModerationPolicy | None
) -> LLMModerationPolicy | None:
    """Bind both phases when enabled without I/O; explicit policies supplement rather than replace them."""
    if not platform_moderation_enabled(bundle):
        return policy
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id=bundle.configuration.tenant_id, app_id=""),
        service=build_platform_moderation_service(),
        rule=ModerationRule(
            type="openai_moderation",
            config={
                "inputs_config": {"enabled": True, "preset_response": "Model input was rejected by moderation."},
                "outputs_config": {"enabled": True, "preset_response": "Model output was rejected by moderation."},
            },
        ),
        platform=True,
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
    context: AppRequestContext, *, service: ModerationService, rule: ModerationRule, platform: bool = False
) -> LLMModerationGuard:
    """Bind an admitted scope and snapshot of a rule for model assembly.

    Missing or malformed phase enablement fails during assembly. Disabled phases
    do not inspect content, and disabled output moderation preserves live streaming.
    Platform sharing is reserved for a trusted OpenAI service and matching rule.
    """
    rule = rule.model_copy(deep=True)
    if platform and rule.type != "openai_moderation":
        raise ValueError("Platform moderation sharing requires an OpenAI rule.")
    from extensions.application_services.app_moderation import current_moderation_session

    scope = current_moderation_session(context.tenant_id) if platform else None
    if scope is not None and context.app_id and context.app_id != scope.app_id:
        scope = None
    if scope is not None:
        scope.enabled = True
        context = AppRequestContext(tenant_id=context.tenant_id, app_id=scope.app_id)
    inputs = rule.config.get("inputs_config")
    if not isinstance(inputs, dict) or not isinstance(inputs.get("enabled"), bool):
        raise ValueError("inputs_config.enabled must be a bool")
    outputs = rule.config.get("outputs_config")
    if not isinstance(outputs, dict) or not isinstance(outputs.get("enabled"), bool):
        raise ValueError("outputs_config.enabled must be a bool")

    def check(text: str, phase: ModerationPhase) -> None:
        """Apply the bound rule through the application use case for a runtime phase."""
        if scope is None:
            service.check(context, rule=rule, text=text, phase=phase)
        else:
            scope.check(text, phase, lambda: service.check(context, rule=rule, text=text, phase=phase))

    return LLMModerationGuard(
        tenant_id=context.tenant_id,
        check=check,
        check_input=inputs["enabled"],
        check_output=outputs["enabled"],
        non_stream_segment_size=dify_config.MODERATION_NON_STREAM_SEGMENT_SIZE,
        stream_segment_size=dify_config.MODERATION_BUFFER_SIZE,
        platform=platform,
        output_observer=scope.record_output if scope is not None else None,
    )
