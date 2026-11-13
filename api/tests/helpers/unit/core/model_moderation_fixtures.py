"""Deterministic provider and quota boundary for exercising real model invocation guards."""

from collections.abc import Generator, Mapping, Sequence
from typing import Any, override

from pydantic.json_schema import JsonValue

from core.app.llm.quota import ModelQuotaReservation
from core.credit_usage import CreditUsageAppTypeInput, CreditUsageCreatedByInput
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import CustomProviderConfiguration
from core.model_manager import LLMModerationPolicy, ModelInstance, ModelManager, QuotaManagedModelInstance
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.plugin_service import PluginService
from core.provider_manager import ProviderManager
from graphon.model_runtime.callbacks.base_callback import Callback
from graphon.model_runtime.entities.llm_entities import (
    LLMPollingResult,
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMUsage,
)
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, PromptMessageTool
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from graphon.model_runtime.model_providers.base.moderation_model import ModerationModel
from models.provider import ProviderType
from services.moderation_adapters import LLMModerationGuard
from services.moderation_service import ModerationPhase, ModerationRejectedError
from tests.helpers.unit.core.model_fixtures import make_model_config


class RecordingLLM(LargeLanguageModel):
    def __init__(self, template: LargeLanguageModel, parts: Sequence[str]) -> None:
        super().__init__(provider_schema=template.provider_schema, model_runtime=template.model_runtime)
        self.parts = parts
        self.invocations = 0
        self.stream_closed = False
        self.last_prompt_messages: list[PromptMessage] | None = None

    @override
    def invoke(
        self,
        model: str,
        credentials: dict[str, Any],
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any] | None = None,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        callbacks: list[Callback] | None = None,
        *,
        request_metadata: Mapping[str, object] | None = None,
    ) -> LLMResult | Generator[LLMResultChunk]:
        self.invocations += 1
        self.last_prompt_messages = prompt_messages
        if stream:
            return self._stream(model)
        return LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(content="".join(self.parts)),
            usage=LLMUsage.empty_usage(),
        )

    def _stream(self, model: str) -> Generator[LLMResultChunk]:
        try:
            for part in self.parts:
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=[],
                    delta=LLMResultChunkDelta(
                        index=0, message=AssistantPromptMessage(content=part), usage=LLMUsage.empty_usage()
                    ),
                )
        finally:
            self.stream_closed = True


class RecordingReservation(ModelQuotaReservation):
    def __init__(self, configuration: ProviderConfiguration, *, commit_before_delivery: bool) -> None:
        super().__init__(
            tenant_id=configuration.tenant_id,
            provider=configuration.provider.provider,
            model_type=ModelType.LLM,
            model="test-model",
            provider_configuration=configuration,
        )
        self._commit_before_delivery = commit_before_delivery
        self.commits: list[LLMUsage | None] = []
        self.released = False

    @property
    @override
    def commit_before_delivery(self) -> bool:
        return self._commit_before_delivery

    @override
    def commit(self, usage: LLMUsage | None = None) -> None:
        super().commit(usage)
        self.commits.append(usage)

    @override
    def release(self) -> None:
        super().release()
        self.released = True


class RecordingQuotaModelInstance(QuotaManagedModelInstance):
    def __init__(
        self, bundle: ProviderModelBundle, *, commit_before_delivery: bool, moderation: LLMModerationPolicy | None
    ) -> None:
        super().__init__(provider_model_bundle=bundle, model="test-model", credentials={}, moderation=moderation)
        self.reservations: list[RecordingReservation] = []
        self.commit_before_delivery = commit_before_delivery

    @override
    def reserve_quota(
        self,
        *,
        request_id: str | None = None,
        app_type: CreditUsageAppTypeInput = None,
        created_by: CreditUsageCreatedByInput = None,
    ) -> RecordingReservation:
        reservation = RecordingReservation(
            self.provider_model_bundle.configuration, commit_before_delivery=self.commit_before_delivery
        )
        self.reservations.append(reservation)
        return reservation


def make_moderated_model(
    *,
    quota: bool,
    parts: Sequence[str],
    commit_before_delivery: bool = True,
    moderation: LLMModerationPolicy | None = None,
) -> tuple[ModelInstance, RecordingLLM]:
    config = make_model_config(provider="test-provider", model="test-model", mode="chat")
    template = config.provider_model_bundle.model_type_instance
    assert isinstance(template, LargeLanguageModel)
    provider = RecordingLLM(template, parts)
    bundle = ProviderModelBundle(configuration=config.provider_model_bundle.configuration, model_type_instance=provider)
    instance = (
        RecordingQuotaModelInstance(bundle, commit_before_delivery=commit_before_delivery, moderation=moderation)
        if quota
        else ModelInstance(provider_model_bundle=bundle, model="test-model", credentials={}, moderation=moderation)
    )
    return instance, provider


def make_failing_moderated_model(
    *, phase: ModerationPhase, unavailable: bool
) -> tuple[RecordingQuotaModelInstance, RecordingLLM]:
    """Bind a real invocation guard that rejects or fails at one phase, retaining provider and quota evidence."""

    def check(_text: str, checked_phase: ModerationPhase) -> None:
        if checked_phase == phase:
            if unavailable:
                raise RuntimeError("Moderation backend is unavailable")
            raise ModerationRejectedError(phase, "Content rejected by moderation")

    guard = LLMModerationGuard(
        tenant_id="test-tenant-id",
        check=check,
        check_input=True,
        check_output=True,
        non_stream_segment_size=2000,
        stream_segment_size=300,
    )
    instance, provider = make_moderated_model(quota=True, parts=["safe"], moderation=guard)
    assert isinstance(instance, RecordingQuotaModelInstance)
    return instance, provider


class RecordingProviderManager(ProviderManager):
    def __init__(self, bundle: ProviderModelBundle) -> None:
        super().__init__(model_runtime=bundle.model_type_instance.model_runtime)
        self.bundle = bundle
        self.lookups = 0

    @override
    def get_provider_model_bundle(self, tenant_id: str, provider: str, model_type: ModelType) -> ProviderModelBundle:
        self.lookups += 1
        if tenant_id != self.bundle.configuration.tenant_id or provider != self.bundle.configuration.provider.provider:
            raise ValueError("Unknown model owner")
        if model_type == ModelType.MODERATION:
            return ProviderModelBundle(
                configuration=self.bundle.configuration,
                model_type_instance=ModerationModel(
                    provider_schema=self.bundle.configuration.provider,
                    model_runtime=self.bundle.model_type_instance.model_runtime,
                ),
            )
        if model_type != ModelType.LLM:
            raise ValueError("Unknown model type")
        return self.bundle


def make_moderated_manager(
    *, moderation: LLMModerationPolicy, cache: bool, system: bool
) -> tuple[ModelManager, RecordingProviderManager, RecordingLLM]:
    instance, provider = make_moderated_model(quota=False, parts=["safe"])
    bundle = instance.provider_model_bundle
    bundle.configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "secret"})
    if system:
        bundle.configuration.using_provider_type = ProviderType.SYSTEM
    provider_manager = RecordingProviderManager(bundle)
    return (
        ModelManager(provider_manager, enable_credentials_cache=cache, moderation=moderation),
        provider_manager,
        provider,
    )


class RecordingPollingRuntime(PluginModelRuntime):
    def __init__(self, *, initial: LLMPollingResult, terminal: LLMPollingResult) -> None:
        super().__init__(
            tenant_id="test-tenant-id", user_id=None, client=PluginModelClient(), plugin_service=PluginService
        )
        self.initial = initial
        self.terminal = terminal
        self.starts = 0
        self.checks = 0

    @override
    def start_llm_polling(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        model_parameters: dict[str, Any],
        prompt_messages: Sequence[PromptMessage],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        json_schema: dict[str, Any] | None,
    ) -> LLMPollingResult:
        self.starts += 1
        return self.initial

    @override
    def check_llm_polling(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        plugin_state: dict[str, JsonValue],
    ) -> LLMPollingResult:
        self.checks += 1
        return self.terminal


class RecordingHostedModerationClient(PluginModelClient):
    """Record installed and direct dispatch without tenant provider discovery or daemon I/O."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str, str, dict[str, Any], str, str | None]] = []
        self.routes: list[str] = []
        self.error: Exception | None = None
        self.identifier_errors: dict[str, Exception] = {}

    @override
    def invoke_moderation(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        text: str,
        plugin_unique_identifier: str | None = None,
    ) -> bool:
        self.routes.append("tenant")
        return self._record(tenant_id, user_id, plugin_id, provider, model, credentials, text, plugin_unique_identifier)

    @override
    def invoke_moderation_direct(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        text: str,
        *,
        plugin_unique_identifier: str,
    ) -> bool:
        self.routes.append("direct")
        return self._record(tenant_id, user_id, plugin_id, provider, model, credentials, text, plugin_unique_identifier)

    def _record(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        text: str,
        plugin_unique_identifier: str | None,
    ) -> bool:
        self.calls.append(
            (
                tenant_id,
                user_id or "",
                plugin_id,
                provider,
                dict(credentials),
                text,
                plugin_unique_identifier,
            )
        )
        if plugin_unique_identifier is not None and plugin_unique_identifier in self.identifier_errors:
            raise self.identifier_errors[plugin_unique_identifier]
        if self.error is not None:
            raise self.error
        return "blocked" in text
