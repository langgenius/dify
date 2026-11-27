"""Composition for generic moderation policies bound during model assembly."""

from __future__ import annotations

from collections.abc import Iterable
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.entities.provider_configuration import ProviderModelBundle
from core.helper.ssrf_proxy import ssrf_proxy
from extensions.application_services.moderation_policy import platform_moderation_enabled
from extensions.ext_redis import redis_client
from machinery.context import AppRequestContext
from repositories.api_based_extension_repository import APIBasedExtensionRepository
from services.api_based_extension_adapters import WorkspaceTokenCipher
from services.hosted_moderation_adapters import OpenAIHostedModerationClient, RedisHostedModerationVerdictCache
from services.hosted_moderation_service import BatchedHostedModerationService
from services.moderation_adapters import (
    ChainedLLMModerationPolicy,
    ExtensionModerationGateway,
    LLMModerationGuard,
    ModerationCheck,
)
from services.moderation_service import (
    ModerationPhase,
    ModerationRule,
    ModerationSegmentChecker,
    ModerationService,
    moderation_phase_config,
)

if TYPE_CHECKING:
    from core.model_manager import LLMModerationPolicy


def build_platform_moderation_service() -> BatchedHostedModerationService:
    """Bind platform credentials, batch limits, and optional Redis without I/O or credit effects."""
    api_key = dify_config.HOSTED_OPENAI_API_KEY
    client: OpenAIHostedModerationClient | None = None
    cache: RedisHostedModerationVerdictCache | None = None
    if api_key and api_key.strip():
        client = OpenAIHostedModerationClient(
            http_client=ssrf_proxy,
            api_key=api_key,
            base_url=dify_config.HOSTED_OPENAI_API_BASE,
            organization=dify_config.HOSTED_OPENAI_API_ORGANIZATION,
        )
        ttl = dify_config.HOSTED_MODERATION_CACHE_TTL
        if ttl:
            cache = RedisHostedModerationVerdictCache(redis_client, ttl=ttl, hash_key=client.cache_key)
    return BatchedHostedModerationService(
        client=client,
        cache=cache,
        batch_max_items=dify_config.HOSTED_MODERATION_BATCH_MAX_ITEMS,
        batch_max_text_bytes=dify_config.HOSTED_MODERATION_BATCH_MAX_TEXT_BYTES,
    )


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
    context: AppRequestContext, *, service: ModerationSegmentChecker, rule: ModerationRule, platform: bool = False
) -> LLMModerationGuard:
    """Bind an admitted scope and snapshot of a rule for model assembly.

    Missing or malformed phase enablement fails during assembly. Disabled phases
    do not inspect content, and disabled output moderation preserves live streaming.
    Platform rejection rendering is reserved for a trusted OpenAI service and
    matching rule. Only the platform batch service supplies a cache-only checker
    that can enforce existing verdicts without retrying an unavailable backend.
    """
    rule = rule.model_copy(deep=True)
    if platform and rule.type != "openai_moderation":
        raise ValueError("Platform moderation requires an OpenAI rule.")
    inputs = moderation_phase_config(rule, "input")
    outputs = moderation_phase_config(rule, "output")

    def check(segments: Iterable[str], phase: ModerationPhase) -> None:
        """Resolve verdicts for the runtime phase or raise the service's typed failure."""
        service.check_segments(context, rule=rule, segments=segments, phase=phase)

    check_cached: ModerationCheck | None = None
    if platform and isinstance(service, BatchedHostedModerationService):

        def check_cache_only(segments: Iterable[str], phase: ModerationPhase) -> None:
            """Enforce existing verdicts without making or caching a new classification."""
            service.check_segments(context, rule=rule, segments=segments, phase=phase, cache_only=True)

        check_cached = check_cache_only

    return LLMModerationGuard(
        tenant_id=context.tenant_id,
        check=check,
        check_input=inputs["enabled"],
        check_output=outputs["enabled"],
        non_stream_segment_size=dify_config.MODERATION_NON_STREAM_SEGMENT_SIZE,
        stream_segment_size=dify_config.MODERATION_BUFFER_SIZE,
        platform=platform,
        check_cached=check_cached,
    )
