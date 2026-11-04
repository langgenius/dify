from collections.abc import Generator
from inspect import signature

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from core.llm_generator.output_parser.structured_output import invoke_llm_with_structured_output
from core.model_manager import ModelManager, QuotaManagedModelInstance
from core.plugin.impl.model_runtime_factory import create_plugin_model_assembly, create_plugin_model_manager
from core.workflow.node_runtime import DifyPreparedPollingLLM
from extensions.application_services.moderation import build_llm_moderation_guard, build_moderation_service
from extensions.ext_code_based_extension import code_based_extension
from graphon.model_runtime.entities.llm_entities import (
    LLMPollingResult,
    LLMPollingStatus,
    LLMResult,
    LLMResultWithStructuredOutput,
    LLMUsage,
)
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from machinery.context import AppRequestContext
from services.agent_llm_inner_service import AgentLLMInnerService, PreparedAgentLLMInvocation
from services.entities.agent_llm_inner import AgentLLMInvokeCaller, AgentLLMInvokeRequest, AgentLLMInvokeTarget
from services.moderation_service import ModerationRejectedError, ModerationRule, ModerationService
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.helpers.unit.core.model_moderation_fixtures import (
    RecordingPollingRuntime,
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
