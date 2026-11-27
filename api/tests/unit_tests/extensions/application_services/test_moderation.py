import json
from collections.abc import Callable, Generator, Iterable
from inspect import signature

import httpx
import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from core.app.llm.quota import ModelQuotaReservationState
from core.entities.provider_entities import ProviderQuotaType, QuotaConfiguration, QuotaUnit
from core.helper import ssrf_proxy as ssrf_module
from core.llm_generator.output_parser.structured_output import invoke_llm_with_structured_output
from core.model_manager import ModelInstance, ModelManager, QuotaManagedModelInstance
from core.plugin.impl.model_runtime_factory import create_plugin_model_assembly, create_plugin_model_manager
from core.workflow.node_runtime import DifyPreparedPollingLLM
from enums import DeploymentEdition
from extensions.application_services.moderation import (
    build_llm_moderation_guard,
    build_moderation_service,
    build_platform_moderation_service,
)
from extensions.ext_code_based_extension import code_based_extension
from graphon.model_runtime.entities.llm_entities import (
    LLMPollingResult,
    LLMPollingStatus,
    LLMResult,
    LLMResultWithStructuredOutput,
    LLMUsage,
)
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    SystemPromptMessage,
    UserPromptMessage,
)
from graphon.model_runtime.entities.model_entities import ModelType
from machinery.context import AppRequestContext
from models.provider import ProviderType
from services.agent_llm_inner_service import AgentLLMInnerService, PreparedAgentLLMInvocation
from services.entities.agent_llm_inner import AgentLLMInvokeCaller, AgentLLMInvokeRequest, AgentLLMInvokeTarget
from services.moderation_adapters import ChainedLLMModerationPolicy, LLMModerationGuard
from services.moderation_invocation_errors import PlatformModerationRejectedInvocationError
from services.moderation_service import ModerationRejectedError, ModerationRule, ModerationService
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.helpers.unit.core.model_moderation_fixtures import (
    RecordingPollingRuntime,
    RecordingProviderManager,
    RecordingQuotaModelInstance,
    make_moderated_manager,
    make_moderated_model,
)


@pytest.fixture
def moderation_service(sqlite_engine: Engine) -> ModerationService:
    code_based_extension.init()
    return build_moderation_service(database_client=sessionmaker(sqlite_engine))


def _rule(*, outputs_enabled: bool = True) -> ModerationRule:
    return ModerationRule(
        type="keywords",
        config={
            "inputs_config": {"enabled": True, "preset_response": "Input blocked"},
            "outputs_config": {"enabled": outputs_enabled, "preset_response": "Output blocked"},
            "keywords": "blocked",
        },
    )


@pytest.mark.parametrize("quota", [False, True])
@pytest.mark.parametrize("stream", [False, True])
def test_bound_guard_rejects_input_without_model_or_quota_effects(
    moderation_service: ModerationService, quota: bool, stream: bool
) -> None:
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="test-tenant-id", app_id=""), service=moderation_service, rule=_rule()
    )
    instance, provider = make_moderated_model(quota=quota, parts=["safe"], moderation=guard)

    with pytest.raises(ModerationRejectedError, match="Input blocked"):
        instance.invoke_llm([UserPromptMessage(content="blocked")], stream=stream)

    assert provider.invocations == 0
    if isinstance(instance, RecordingQuotaModelInstance):
        assert not instance.reservations


@pytest.mark.parametrize("quota", [False, True])
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("commit_before_delivery", [False, True])
def test_output_rejection_never_refunds_consumed_model_usage(
    moderation_service: ModerationService, quota: bool, stream: bool, commit_before_delivery: bool
) -> None:
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="test-tenant-id", app_id=""), service=moderation_service, rule=_rule()
    )
    instance, provider = make_moderated_model(
        quota=quota, parts=["blo", "cked"], commit_before_delivery=commit_before_delivery, moderation=guard
    )

    if stream:
        response = instance.invoke_llm([], stream=True)
        assert isinstance(response, Generator)
        with pytest.raises(ModerationRejectedError, match="Output blocked"):
            next(response)
    else:
        with pytest.raises(ModerationRejectedError, match="Output blocked"):
            instance.invoke_llm([], stream=False)

    assert provider.invocations == 1
    if stream:
        assert provider.stream_closed
    if isinstance(instance, RecordingQuotaModelInstance):
        assert len(instance.reservations) == 1
        assert instance.reservations[0].commits
        assert instance.reservations[0].released


@pytest.mark.parametrize("quota", [False, True])
def test_input_only_rule_preserves_live_streaming(moderation_service: ModerationService, quota: bool) -> None:
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="test-tenant-id", app_id=""),
        service=moderation_service,
        rule=_rule(outputs_enabled=False),
    )
    instance, provider = make_moderated_model(quota=quota, parts=["first", "second"], moderation=guard)
    response = instance.invoke_llm([], stream=True)
    assert next(response).delta.message.content == "first"
    assert not provider.stream_closed
    response.close()


def test_guard_snapshots_rule_config(moderation_service: ModerationService) -> None:
    rule = _rule()
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="test-tenant-id", app_id=""), service=moderation_service, rule=rule
    )
    instance, _ = make_moderated_model(quota=False, parts=["blocked"], moderation=guard)
    rule.config["outputs_config"]["enabled"] = False
    with pytest.raises(ModerationRejectedError):
        instance.invoke_llm([], stream=False)


def test_no_guard_preserves_unmoderated_invocation() -> None:
    instance, provider = make_moderated_model(quota=False, parts=["blocked"])
    result = instance.invoke_llm([], stream=False)
    assert isinstance(result, LLMResult)
    assert result.message.content == "blocked"
    assert provider.invocations == 1


@pytest.mark.parametrize("cache", [False, True])
@pytest.mark.parametrize("system", [False, True])
def test_manager_binds_policy_to_every_instance_including_cached_credentials(
    moderation_service: ModerationService, cache: bool, system: bool
) -> None:
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="test-tenant-id", app_id=""), service=moderation_service, rule=_rule()
    )
    manager, _, provider = make_moderated_manager(moderation=guard, cache=cache, system=system)

    for _attempt in range(2):
        instance = manager.get_model_instance("test-tenant-id", "test-provider", ModelType.LLM, "test-model")
        assert instance.moderation is guard
        assert isinstance(instance, QuotaManagedModelInstance) is system
        with pytest.raises(ModerationRejectedError, match="Input blocked"):
            instance.invoke_llm([UserPromptMessage(content="blocked")], stream=False)

    assert provider.invocations == 0
    non_llm = manager.get_model_instance("test-tenant-id", "test-provider", ModelType.MODERATION, "moderation-model")
    assert non_llm.moderation is None


def test_plugin_assembly_and_factories_preserve_policy(moderation_service: ModerationService) -> None:
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="test-tenant-id", app_id=""), service=moderation_service, rule=_rule()
    )
    assert create_plugin_model_assembly(tenant_id="test-tenant-id", moderation=guard).model_manager._moderation is guard
    assert create_plugin_model_manager(tenant_id="test-tenant-id", moderation=guard)._moderation is guard
    assert ModelManager.for_tenant("test-tenant-id", moderation=guard)._moderation is guard


def test_scope_mismatch_fails_before_provider_lookup(moderation_service: ModerationService) -> None:
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="test-tenant-id", app_id=""), service=moderation_service, rule=_rule()
    )
    manager, providers, _ = make_moderated_manager(moderation=guard, cache=True, system=False)

    with pytest.raises(ValueError, match="policy tenant"):
        manager.get_model_instance("another-tenant", "test-provider", ModelType.LLM, "test-model")
    with pytest.raises(ValueError, match="policy tenant"):
        create_plugin_model_assembly(tenant_id="another-tenant", moderation=guard)
    foreign = build_llm_moderation_guard(
        AppRequestContext(tenant_id="another-tenant", app_id=""), service=moderation_service, rule=_rule()
    )
    with pytest.raises(ValueError, match="Moderation policy tenant"):
        make_moderated_model(quota=False, parts=["safe"], moderation=foreign)
    assert providers.lookups == 0


def test_structured_output_uses_assembly_bound_policy(moderation_service: ModerationService) -> None:
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="test-tenant-id", app_id=""), service=moderation_service, rule=_rule()
    )
    instance, provider = make_moderated_model(quota=False, parts=["blocked"], moderation=guard)
    schema = make_model_config(provider="test-provider", model="test-model", mode="chat").model_schema

    with pytest.raises(ModerationRejectedError, match="Output blocked"):
        invoke_llm_with_structured_output(
            provider="test-provider",
            model_schema=schema,
            model_instance=instance,
            prompt_messages=[],
            json_schema={"type": "object"},
            stream=False,
        )
    assert provider.invocations == 1
    assert "moderation" not in signature(instance.invoke_llm).parameters


def test_agent_gateway_inspects_opaque_messages_without_losing_provider_fields(
    moderation_service: ModerationService,
) -> None:
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="test-tenant-id", app_id="app-1"), service=moderation_service, rule=_rule()
    )
    instance, provider = make_moderated_model(quota=False, parts=["safe"], moderation=guard)
    request = AgentLLMInvokeRequest(
        caller=AgentLLMInvokeCaller(
            invocation_id="invocation-1",
            agent_run_id="run-1",
            call_index=1,
            tenant_id="test-tenant-id",
            user_id="user-1",
            user_from="account",
            app_id="app-1",
            invoke_from="debugger",
            agent_mode="workflow_run",
        ),
        target=AgentLLMInvokeTarget(
            provider="test-provider",
            model="test-model",
            prompt_messages=[{"role": "user", "content": "safe", "provider_extensions": {"retain": "unchanged"}}],
        ),
    )
    prepared = PreparedAgentLLMInvocation(request=request, model_instance=instance)
    service = AgentLLMInnerService()

    assert list(service.invoke(prepared))[0].delta.message.content == "safe"
    assert provider.last_prompt_messages == request.target.prompt_messages
    assert request.target.prompt_messages[0]["provider_extensions"] == {"retain": "unchanged"}

    request.target.prompt_messages[0]["content"] = "blocked"
    with pytest.raises(ModerationRejectedError, match="Input blocked"):
        list(service.invoke(prepared))
    assert provider.invocations == 1


def _succeeded(text: str, usage: LLMUsage, *, structured: bool) -> LLMPollingResult:
    if structured:
        return LLMPollingResult(
            status=LLMPollingStatus.SUCCEEDED,
            result=LLMResultWithStructuredOutput(
                model="test-model",
                prompt_messages=[],
                message=AssistantPromptMessage(content=""),
                usage=usage,
                structured_output={"answer": text},
            ),
        )
    return LLMPollingResult(
        status=LLMPollingStatus.SUCCEEDED,
        result=LLMResult(
            model="test-model",
            prompt_messages=[],
            message=AssistantPromptMessage(content=text),
            usage=usage,
        ),
    )


@pytest.mark.parametrize("quota", [False, True])
@pytest.mark.parametrize("immediate", [False, True])
@pytest.mark.parametrize("structured", [False, True])
def test_polling_checks_input_before_submission_and_output_before_delivery(
    moderation_service: ModerationService, quota: bool, immediate: bool, structured: bool
) -> None:
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="test-tenant-id", app_id=""), service=moderation_service, rule=_rule()
    )
    usage = LLMUsage.empty_usage().model_copy(update={"total_tokens": 7})
    running = LLMPollingResult(status=LLMPollingStatus.RUNNING, plugin_state={"task_id": "task-1"})
    terminal = _succeeded("blocked", usage, structured=structured)
    runtime = RecordingPollingRuntime(initial=terminal if immediate else running, terminal=terminal)
    instance, provider = make_moderated_model(quota=quota, parts=[], moderation=guard)
    provider.model_runtime = runtime
    prepared = DifyPreparedPollingLLM(instance)

    with pytest.raises(ModerationRejectedError, match="Input blocked"):
        prepared.start_llm_polling(
            prompt_messages=[UserPromptMessage(content="blocked")],
            model_parameters={},
            tools=[],
            stop=[],
            json_schema=None,
        )
    assert runtime.starts == 0
    assert not isinstance(instance, RecordingQuotaModelInstance) or not instance.reservations

    def start() -> LLMPollingResult:
        return prepared.start_llm_polling(
            prompt_messages=[UserPromptMessage(content="safe")],
            model_parameters={},
            tools=[],
            stop=[],
            json_schema=None,
        )

    if immediate:
        with pytest.raises(ModerationRejectedError, match="Output blocked"):
            start()
    else:
        assert start() == running
        with pytest.raises(ModerationRejectedError, match="Output blocked"):
            prepared.check_llm_polling(plugin_state={"task_id": "task-1"})

    if isinstance(instance, RecordingQuotaModelInstance):
        assert len(instance.reservations) == 1
        assert instance.reservations[0].commits == [usage]
        assert instance.reservations[0].released


@pytest.mark.parametrize(
    ("edition", "provider_type", "quota_type", "quota_unit", "enabled", "expected"),
    [
        (DeploymentEdition.CLOUD, ProviderType.SYSTEM, ProviderQuotaType.TRIAL, QuotaUnit.CREDITS, True, True),
        (DeploymentEdition.CLOUD, ProviderType.SYSTEM, ProviderQuotaType.PAID, QuotaUnit.CREDITS, True, True),
        (DeploymentEdition.CLOUD, ProviderType.SYSTEM, ProviderQuotaType.TRIAL, QuotaUnit.TIMES, True, True),
        (DeploymentEdition.CLOUD, ProviderType.SYSTEM, ProviderQuotaType.PAID, QuotaUnit.TIMES, True, True),
        (DeploymentEdition.CLOUD, ProviderType.SYSTEM, ProviderQuotaType.PAID, QuotaUnit.CREDITS, False, False),
        (DeploymentEdition.COMMUNITY, ProviderType.SYSTEM, ProviderQuotaType.PAID, QuotaUnit.CREDITS, True, False),
        (DeploymentEdition.ENTERPRISE, ProviderType.SYSTEM, ProviderQuotaType.PAID, QuotaUnit.CREDITS, True, False),
        (DeploymentEdition.CLOUD, ProviderType.CUSTOM, ProviderQuotaType.PAID, QuotaUnit.CREDITS, True, False),
        (DeploymentEdition.CLOUD, ProviderType.SYSTEM, ProviderQuotaType.FREE, QuotaUnit.CREDITS, True, False),
        (DeploymentEdition.CLOUD, ProviderType.SYSTEM, ProviderQuotaType.PAID, QuotaUnit.TOKENS, True, False),
    ],
)
def test_platform_binding_respects_switch_and_edition_eligibility(
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    provider_type: ProviderType,
    quota_type: ProviderQuotaType,
    quota_unit: QuotaUnit,
    enabled: bool,
    expected: bool,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=edition,
        HOSTED_MODERATION_ENABLED=enabled,
    )
    config = make_model_config(provider="test-provider", model="test-model", mode="chat")
    bundle = config.provider_model_bundle
    bundle.configuration.using_provider_type = provider_type
    bundle.configuration.system_configuration.current_quota_type = quota_type
    bundle.configuration.system_configuration.quota_configurations = [
        QuotaConfiguration(quota_type=quota_type, quota_unit=quota_unit, quota_limit=100, quota_used=0, is_valid=True)
    ]
    instance = ModelInstance(bundle, "test-model", credentials={"api_key": "user-key"})

    assert isinstance(instance.moderation, LLMModerationGuard) is expected


@pytest.mark.parametrize(
    "edition", [DeploymentEdition.CLOUD, DeploymentEdition.COMMUNITY, DeploymentEdition.ENTERPRISE]
)
@pytest.mark.parametrize("enabled", [False, True])
def test_platform_switch_applies_to_manager_cache_and_preserves_explicit_policy(
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    enabled: bool,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=edition,
        HOSTED_MODERATION_ENABLED=enabled,
    )
    config = make_model_config(provider="test-provider", model="test-model", mode="chat")
    bundle = config.provider_model_bundle
    bundle.configuration.using_provider_type = ProviderType.SYSTEM
    bundle.configuration.system_configuration.current_quota_type = ProviderQuotaType.PAID
    bundle.configuration.system_configuration.quota_configurations = [
        QuotaConfiguration(
            quota_type=ProviderQuotaType.PAID,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=100,
            quota_used=0,
            is_valid=True,
        )
    ]
    expected = enabled and edition == DeploymentEdition.CLOUD
    manager = ModelManager(RecordingProviderManager(bundle), enable_credentials_cache=True)
    for _attempt in range(2):
        instance = manager.get_model_instance("test-tenant-id", "test-provider", ModelType.LLM, "test-model")
        assert isinstance(instance.moderation, LLMModerationGuard) is expected
    moderation_model = manager.get_model_instance(
        "test-tenant-id", "test-provider", ModelType.MODERATION, "omni-moderation-latest"
    )
    assert moderation_model.moderation is None

    def allow(_segments: Iterable[str], _phase: str) -> None:
        return None

    disabled = LLMModerationGuard(
        tenant_id="test-tenant-id",
        check=allow,
        check_input=False,
        check_output=False,
        non_stream_segment_size=2000,
        stream_segment_size=300,
    )
    explicit = ModelInstance(bundle, "test-model", credentials={}, moderation=disabled)
    if expected:
        assert isinstance(explicit.moderation, ChainedLLMModerationPolicy)
    else:
        assert explicit.moderation is disabled

    bundle.configuration.system_configuration.quota_configurations[0].quota_limit = -1
    unlimited = ModelInstance(bundle, "test-model", credentials={})
    assert isinstance(unlimited.moderation, LLMModerationGuard) is expected


def test_platform_moderation_applies_the_configured_segment_and_batch_limits(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(
        HOSTED_OPENAI_API_KEY="server-key",
        HOSTED_MODERATION_CACHE_TTL=0,
        MODERATION_NON_STREAM_SEGMENT_SIZE=4,
        HOSTED_MODERATION_BATCH_MAX_ITEMS=2,
        HOSTED_MODERATION_BATCH_MAX_TEXT_BYTES=6,
    )
    batches: list[list[str]] = []

    def moderate(request: httpx.Request) -> httpx.Response:
        texts: list[str] = json.loads(request.content)["input"]
        batches.append(texts)
        return httpx.Response(200, json={"results": [{"flagged": False} for _ in texts]})

    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="test-tenant-id", app_id=""),
        service=build_platform_moderation_service(),
        rule=ModerationRule(
            type="openai_moderation",
            config={"inputs_config": {"enabled": True}, "outputs_config": {"enabled": False}},
        ),
        platform=True,
    )
    messages = [UserPromptMessage(content=text) for text in ["a", "b", "abcdXY", "\u754c\u754c", "d"]]
    with httpx.Client(transport=httpx.MockTransport(moderate)) as transport:
        monkeypatch.setattr(ssrf_module, "_get_ssrf_client", lambda _verify: transport)
        guard.check_inputs(messages)

    assert batches == [["a", "b"], ["abcd", "XY"], ["\u754c\u754c"], ["d"]]


@pytest.mark.parametrize(
    "scenario",
    [
        "approved",
        "input_rejected",
        "output_rejected",
        "incomplete",
        "api_error",
        "rate_limit",
        "timeout",
        "missing_key",
    ],
)
def test_platform_guard_uses_openai_and_preserves_quota_and_failure_contracts(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    caplog: pytest.LogCaptureFixture,
    scenario: str,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        HOSTED_MODERATION_ENABLED=True,
        HOSTED_MODERATION_CACHE_TTL=0,
        HOSTED_OPENAI_API_KEY=None if scenario == "missing_key" else "server-key",
        HOSTED_OPENAI_API_BASE="https://moderation.example/internal",
        HOSTED_OPENAI_API_ORGANIZATION="server-org",
        HOSTED_OPENAI_TRIAL_ENABLED=False,
        HOSTED_OPENAI_PAID_ENABLED=False,
        MODERATION_NON_STREAM_SEGMENT_SIZE=5,
    )
    unbound, provider = make_moderated_model(quota=False, parts=["safe"])
    bundle = unbound.provider_model_bundle
    bundle.configuration.using_provider_type = ProviderType.SYSTEM
    bundle.configuration.system_configuration.current_quota_type = ProviderQuotaType.TRIAL
    bundle.configuration.system_configuration.quota_configurations = [
        QuotaConfiguration(
            quota_type=ProviderQuotaType.TRIAL,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=100,
            quota_used=0,
            is_valid=True,
        )
    ]
    batches: list[list[str]] = []

    def moderate(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer server-key"
        assert request.headers["OpenAI-Organization"] == "server-org"
        assert str(request.url) == "https://moderation.example/internal/v1/moderations"
        texts: list[str] = json.loads(request.content)["input"]
        batches.append(texts)
        if scenario in {"api_error", "rate_limit"}:
            return httpx.Response(429 if scenario == "rate_limit" else 503, text="private-provider-error")
        if scenario == "timeout":
            raise httpx.ReadTimeout("read timed out", request=request)
        flagged_text = {"input_rejected": "prior", "output_rejected": "safe"}.get(scenario)
        classified = texts[:-1] if scenario == "incomplete" else texts
        return httpx.Response(200, json={"results": [{"flagged": text == flagged_text} for text in classified]})

    instance = RecordingQuotaModelInstance(bundle, commit_before_delivery=True, moderation=None)
    messages: list[PromptMessage] = [
        SystemPromptMessage(content="setup"),
        UserPromptMessage(content="prior"),
        AssistantPromptMessage(content="reply"),
        UserPromptMessage(content="abcdef"),
    ]
    with httpx.Client(transport=httpx.MockTransport(moderate)) as http_client:
        monkeypatch.setattr(ssrf_module, "_get_ssrf_client", lambda _verify: http_client)
        if scenario in {"input_rejected", "output_rejected"}:
            with pytest.raises(PlatformModerationRejectedInvocationError) as rejected:
                instance.invoke_llm(messages, stream=False)
            assert rejected.value.phase == ("input" if scenario == "input_rejected" else "output")
        else:
            assert instance.invoke_llm(messages, stream=False).message.content == "safe"

    generated = scenario != "input_rejected"
    expected_input = ["setup", "prior", "reply", "abcde", "f"]
    expected_batches = [] if scenario == "missing_key" else [expected_input]
    if generated and scenario != "missing_key":
        expected_batches.append(["safe"])
    if generated:
        (reservation,) = instance.reservations
        assert reservation.state == ModelQuotaReservationState.COMMITTED
        assert len(reservation.commits) == 1
    assert batches == expected_batches
    assert provider.invocations == int(generated)
    assert len(instance.reservations) == int(generated)
    skipped = scenario in {"incomplete", "api_error", "rate_limit", "timeout", "missing_key"}
    assert ("Platform moderation unavailable; skipping unchecked segments" in caplog.text) is skipped
    assert "private-provider-error" not in caplog.text
    assert "server-key" not in caplog.text
