from collections.abc import Callable, Generator
from inspect import signature

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.entities.provider_configuration import ProviderModelBundle
from core.entities.provider_entities import (
    CustomModelConfiguration,
    CustomProviderConfiguration,
    ModelLoadBalancingConfiguration,
    ModelSettings,
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
)
from core.llm_generator.output_parser.structured_output import invoke_llm_with_structured_output
from core.model_manager import ModelInstance, ModelManager, QuotaManagedModelInstance
from core.plugin.impl.model_runtime_factory import create_plugin_model_assembly, create_plugin_model_manager
from core.workflow.node_runtime import DifyPreparedPollingLLM
from enums import DeploymentEdition
from extensions.application_services.moderation import (
    build_llm_moderation_guard,
    build_moderation_service,
    platform_moderation_credentials,
)
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
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from machinery.context import AppRequestContext
from models.account import Tenant
from models.enums import CredentialSourceType
from models.model_billing import TenantModelBillingProfile
from models.provider import ProviderCredential, ProviderType
from models.tokener import TenantTokenerIntegration
from services.agent_llm_inner_service import AgentLLMInnerService, PreparedAgentLLMInvocation
from services.entities.agent_llm_inner import AgentLLMInvokeCaller, AgentLLMInvokeRequest, AgentLLMInvokeTarget
from services.moderation_adapters import (
    ChainedLLMModerationPolicy,
    HostedOpenAIModerationGateway,
    LLMModerationGuard,
)
from services.moderation_invocation_errors import ModerationUnavailableInvocationError
from services.moderation_service import (
    ModerationPhase,
    ModerationRejectedError,
    ModerationRequest,
    ModerationRule,
    ModerationService,
    ModerationVerdict,
)
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.helpers.unit.core.model_moderation_fixtures import (
    RecordingLLM,
    RecordingPollingRuntime,
    RecordingProviderManager,
    RecordingQuotaModelInstance,
    make_moderated_manager,
    make_moderated_model,
)

TOKENER_PROVIDER = "langgenius/tokener/tokener"


@pytest.fixture
def native_moderation_bundle(sqlite_session: Session) -> tuple[ProviderModelBundle, RecordingLLM, str]:
    """Use real native profile/integration ownership, not an editable credential label."""
    tenant = Tenant(name="Native moderation")
    sqlite_session.add(tenant)
    sqlite_session.flush()
    credential = ProviderCredential(
        tenant_id=tenant.id,
        provider_name=TOKENER_PROVIDER,
        credential_name="ordinary-label",
        encrypted_config='{"api_key":"ENCRYPTED_TEST_ONLY"}',
    )
    sqlite_session.add(credential)
    sqlite_session.flush()
    sqlite_session.add_all(
        [
            TenantModelBillingProfile(tenant_id=tenant.id, model_billing_source="tokener"),
            TenantTokenerIntegration(tenant_id=tenant.id, provider_credential_id=credential.id),
        ]
    )
    sqlite_session.commit()
    bundle = make_model_config(provider=TOKENER_PROVIDER, model="gpt-4o-mini", mode="chat").provider_model_bundle
    bundle.configuration.tenant_id = tenant.id
    bundle.configuration.custom_configuration.provider = CustomProviderConfiguration(
        credentials={"api_key": "managed-test-only"}, current_credential_id=credential.id
    )
    template = bundle.model_type_instance
    assert isinstance(template, LargeLanguageModel)
    runtime = RecordingLLM(template, ["approved"])
    bundle.model_type_instance = runtime
    return bundle, runtime, credential.id


@pytest.fixture
def native_moderation_calls(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> list[tuple[ModerationPhase, str]]:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        HOSTED_MODERATION_ENABLED=True,
        TOKENER_PROVIDER_NAME=TOKENER_PROVIDER,
    )
    calls: list[tuple[ModerationPhase, str]] = []

    def check(
        _gateway: HostedOpenAIModerationGateway,
        context: AppRequestContext,
        *,
        rule: ModerationRule,
        request: ModerationRequest,
        phase: ModerationPhase,
    ) -> ModerationVerdict:
        assert context.tenant_id
        assert rule.type == "openai_moderation"
        calls.append((phase, request.text))
        return ModerationVerdict(flagged="blocked" in request.text, message="blocked")

    monkeypatch.setattr(HostedOpenAIModerationGateway, "check", check)
    return calls


@pytest.fixture
def native_lb_index(monkeypatch: pytest.MonkeyPatch) -> Callable[[int], None]:
    """Exercise the real LB selector while replacing only its Redis command I/O."""
    from core import model_manager

    monkeypatch.setattr(model_manager.redis_client, "expire", lambda *_args: True)
    monkeypatch.setattr(model_manager.redis_client, "exists", lambda *_args: False)

    def select(index: int) -> None:
        monkeypatch.setattr(model_manager.redis_client, "incr", lambda _key: index)

    return select


def test_native_managed_selection_checks_both_phases_and_rejects_before_provider(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
) -> None:
    bundle, runtime, managed_id = native_moderation_bundle
    instance = ModelInstance(bundle, "gpt-4o-mini")
    assert instance.credential_id == managed_id
    instance.invoke_llm([UserPromptMessage(content="safe")], stream=False)
    assert native_moderation_calls == [("input", "safe"), ("output", "approved")]
    with pytest.raises(ModerationRejectedError):
        instance.invoke_llm([UserPromptMessage(content="blocked")], stream=False)
    assert runtime.invocations == 1


def test_native_output_guard_preserves_explicit_policy_and_closes_rejected_stream(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
) -> None:
    bundle, runtime, _managed_id = native_moderation_bundle
    runtime.parts = ["blocked"]

    def allow(_text: str, _phase: ModerationPhase) -> None:
        return None

    explicit = LLMModerationGuard(
        tenant_id=bundle.configuration.tenant_id,
        check=allow,
        check_input=False,
        check_output=False,
        non_stream_segment_size=2000,
        stream_segment_size=300,
    )
    instance = ModelInstance(bundle, "gpt-4o-mini", moderation=explicit)
    assert isinstance(instance.moderation, ChainedLLMModerationPolicy)
    response = instance.invoke_llm([UserPromptMessage(content="safe")], stream=True)
    assert isinstance(response, Generator)
    with pytest.raises(ModerationRejectedError):
        list(response)
    assert native_moderation_calls == [("input", "safe"), ("output", "blocked")]
    assert runtime.invocations == 1
    assert runtime.stream_closed


@pytest.mark.parametrize(
    ("edition", "enabled"),
    [(DeploymentEdition.CLOUD, False), (DeploymentEdition.COMMUNITY, True), (DeploymentEdition.ENTERPRISE, True)],
)
def test_native_eligibility_retains_the_existing_platform_edition_and_switch(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    enabled: bool,
) -> None:
    bundle, runtime, _managed_id = native_moderation_bundle
    config_overrides(DEPLOYMENT_EDITION=edition, HOSTED_MODERATION_ENABLED=enabled)
    # Identity selection itself keeps the normal enterprise policy dependency;
    # this test supplies the already-resolved credentials as the cache does.
    provider = bundle.configuration.custom_configuration.provider
    assert provider is not None
    instance = ModelInstance(bundle, "gpt-4o-mini", credentials=provider.credentials, credential_id=_managed_id)
    instance.invoke_llm([UserPromptMessage(content="safe")], stream=False)
    assert native_moderation_calls == []
    assert runtime.invocations == 1


def test_null_native_profile_does_not_enable_platform_moderation(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
    sqlite_session: Session,
) -> None:
    bundle, runtime, _managed_id = native_moderation_bundle
    profile = sqlite_session.get(TenantModelBillingProfile, bundle.configuration.tenant_id)
    assert profile is not None
    profile.model_billing_source = None
    sqlite_session.commit()
    instance = ModelInstance(bundle, "gpt-4o-mini")
    instance.invoke_llm([UserPromptMessage(content="safe")], stream=False)
    assert native_moderation_calls == []
    assert runtime.invocations == 1


@pytest.mark.parametrize("model_override", [False, True])
def test_native_byok_and_raw_credentials_never_inherit_bound_provider_identity(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
    model_override: bool,
) -> None:
    bundle, runtime, managed_id = native_moderation_bundle
    if model_override:
        bundle.configuration.custom_configuration.models = [
            CustomModelConfiguration(
                model="gpt-4o-mini",
                model_type=ModelType.LLM,
                credentials={"api_key": "managed-test-only"},
                current_credential_id=managed_id,
            )
        ]
        instance = ModelInstance(bundle, "gpt-4o-mini")
    else:
        instance = ModelInstance(bundle, "gpt-4o-mini", credentials={"api_key": "managed-test-only"})
    instance.invoke_llm([UserPromptMessage(content="safe")], stream=False)
    assert native_moderation_calls == []
    assert runtime.invocations == 1


def test_empty_model_override_keeps_normal_provider_fallback_identity(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
) -> None:
    bundle, _runtime, managed_id = native_moderation_bundle
    bundle.configuration.custom_configuration.models = [
        CustomModelConfiguration(
            model="gpt-4o-mini",
            model_type=ModelType.LLM,
            credentials=None,
            current_credential_id="unused-empty-model-credential",
        )
    ]
    instance = ModelInstance(bundle, "gpt-4o-mini")
    assert instance.credential_id == managed_id
    instance.invoke_llm([UserPromptMessage(content="safe")], stream=False)
    assert len(native_moderation_calls) == 2


@pytest.mark.parametrize("cache_managed", [False, True])
def test_native_manager_cache_preserves_identity_with_the_cached_credential(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
    cache_managed: bool,
) -> None:
    bundle, _runtime, managed_id = native_moderation_bundle
    provider = bundle.configuration.custom_configuration.provider
    assert provider is not None
    provider.current_credential_id = managed_id if cache_managed else "byok-before-cache"
    manager = ModelManager(RecordingProviderManager(bundle), enable_credentials_cache=True)
    first = manager.get_model_instance(bundle.configuration.tenant_id, TOKENER_PROVIDER, ModelType.LLM, "gpt-4o-mini")
    provider.current_credential_id = "byok-after-cache" if cache_managed else managed_id
    provider.credentials = {"api_key": "changed-test-only"}
    second = manager.get_model_instance(bundle.configuration.tenant_id, TOKENER_PROVIDER, ModelType.LLM, "gpt-4o-mini")
    assert second.credentials == first.credentials
    assert second.credential_id == first.credential_id
    second.invoke_llm([UserPromptMessage(content="safe")], stream=False)
    assert len(native_moderation_calls) == (2 if cache_managed else 0)


def test_mixed_native_load_balancing_checks_only_the_actual_provider_bound_selection(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
    native_lb_index: Callable[[int], None],
) -> None:
    bundle, runtime, managed_id = native_moderation_bundle
    choices = [
        ModelLoadBalancingConfiguration(id="inline", name="byok", credentials={"api_key": "managed-test-only"}),
        ModelLoadBalancingConfiguration(
            id="model",
            name="model-specific",
            credentials={"api_key": "managed-test-only"},
            credential_source_type=CredentialSourceType.CUSTOM_MODEL,
            credential_id=managed_id,
        ),
        ModelLoadBalancingConfiguration(
            id="managed",
            name="renamed",
            credentials={"api_key": "managed-test-only"},
            credential_source_type=CredentialSourceType.PROVIDER,
            credential_id=managed_id,
        ),
        ModelLoadBalancingConfiguration(id="inherit", name="__inherit__", credentials={}),
    ]
    bundle.configuration.model_settings = [
        ModelSettings(
            model="gpt-4o-mini",
            model_type=ModelType.LLM,
            load_balancing_enabled=True,
            load_balancing_configs=choices,
        )
    ]
    instance = ModelInstance(bundle, "gpt-4o-mini")
    lb = instance.load_balancing_manager
    assert lb is not None
    for index, expected_checks in enumerate((0, 0, 2, 4)):
        native_lb_index(index + 1)
        instance.invoke_llm([UserPromptMessage(content="safe")], stream=False)
        assert len(native_moderation_calls) == expected_checks
    assert runtime.invocations == 4


def test_inherited_lb_credentials_do_not_cross_instance_cache_snapshots(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
    native_lb_index: Callable[[int], None],
) -> None:
    bundle, _runtime, managed_id = native_moderation_bundle
    inherited = ModelLoadBalancingConfiguration(id="inherit", name="__inherit__", credentials={})
    bundle.configuration.model_settings = [
        ModelSettings(
            model="gpt-4o-mini",
            model_type=ModelType.LLM,
            load_balancing_enabled=True,
            load_balancing_configs=[inherited],
        )
    ]
    managed = ModelInstance(bundle, "gpt-4o-mini")
    provider = bundle.configuration.custom_configuration.provider
    assert provider is not None
    provider.current_credential_id = "byok-after-first-instance"
    provider.credentials = {"api_key": "byok-test-only"}
    byok = ModelInstance(bundle, "gpt-4o-mini")
    assert managed.credential_id == managed_id
    assert managed.credentials != byok.credentials
    assert inherited.credentials == {}
    native_lb_index(1)
    managed.invoke_llm([UserPromptMessage(content="safe")], stream=False)
    assert len(native_moderation_calls) == 2
    byok.invoke_llm([UserPromptMessage(content="safe")], stream=False)
    assert len(native_moderation_calls) == 2


def test_native_profile_read_failure_fails_closed_before_provider(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from repositories.model_billing_profile_repository import ModelBillingProfileRepository
    from services.model_billing_profile_service import ModelBillingProfileResolutionError

    def unavailable(_repository: ModelBillingProfileRepository, tenant_id: str) -> None:
        assert tenant_id
        raise RuntimeError("profile store unavailable")

    bundle, runtime, _managed_id = native_moderation_bundle
    instance = ModelInstance(bundle, "gpt-4o-mini")
    monkeypatch.setattr(ModelBillingProfileRepository, "get", unavailable)
    with pytest.raises(ModelBillingProfileResolutionError):
        instance.invoke_llm([UserPromptMessage(content="safe")], stream=False)
    assert native_moderation_calls == []
    assert runtime.invocations == 0


def test_native_bound_identity_read_failure_fails_closed_before_provider(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from repositories.tokener_bootstrap_repository import TokenerBootstrapRepository

    def unavailable(_repository: TokenerBootstrapRepository, tenant_id: str, provider: str) -> tuple[str | None, bool]:
        assert tenant_id
        assert provider == TOKENER_PROVIDER
        raise RuntimeError("credential binding store unavailable")

    bundle, runtime, _managed_id = native_moderation_bundle
    instance = ModelInstance(bundle, "gpt-4o-mini")
    monkeypatch.setattr(TokenerBootstrapRepository, "bound_credential", unavailable)
    with pytest.raises(RuntimeError, match="^credential binding store unavailable$"):
        instance.invoke_llm([UserPromptMessage(content="safe")], stream=False)
    assert native_moderation_calls == []
    assert runtime.invocations == 0


def test_native_moderation_failure_cannot_retry_into_a_byok_load_balancer(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle, runtime, managed_id = native_moderation_bundle
    choices = [
        ModelLoadBalancingConfiguration(
            id="managed",
            name="managed",
            credentials={"api_key": "managed-test-only"},
            credential_source_type=CredentialSourceType.PROVIDER,
            credential_id=managed_id,
        ),
        ModelLoadBalancingConfiguration(id="byok", name="byok", credentials={"api_key": "byok-test-only"}),
    ]
    bundle.configuration.model_settings = [
        ModelSettings(
            model="gpt-4o-mini",
            model_type=ModelType.LLM,
            load_balancing_enabled=True,
            load_balancing_configs=choices,
        )
    ]
    instance = ModelInstance(bundle, "gpt-4o-mini")
    lb = instance.load_balancing_manager
    assert lb is not None
    selections: list[str] = []

    def choose() -> ModelLoadBalancingConfiguration:
        selected = choices[len(selections)]
        selections.append(selected.id)
        return selected

    def unavailable(*_args: object, **_kwargs: object) -> ModerationVerdict:
        raise InvokeAuthorizationError("moderation unavailable")

    monkeypatch.setattr(lb, "fetch_next", choose)
    monkeypatch.setattr(HostedOpenAIModerationGateway, "check", unavailable)
    with pytest.raises(ModerationUnavailableInvocationError):
        instance.invoke_llm([UserPromptMessage(content="safe")], stream=False)
    assert selections == ["managed"]
    assert runtime.invocations == 0
    assert native_moderation_calls == []


@pytest.mark.parametrize("immediate", [False, True])
def test_native_polling_uses_the_fixed_credential_policy_through_terminal_output(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
    immediate: bool,
) -> None:
    bundle, provider, _managed_id = native_moderation_bundle
    running = LLMPollingResult(status=LLMPollingStatus.RUNNING, plugin_state={"task_id": "native-polling"})
    terminal = _succeeded("blocked", LLMUsage.empty_usage(), structured=False)
    runtime = RecordingPollingRuntime(initial=terminal if immediate else running, terminal=terminal)
    provider.model_runtime = runtime
    instance = ModelInstance(bundle, "gpt-4o-mini")
    prepared = DifyPreparedPollingLLM(instance)
    policy = instance.moderation
    assert isinstance(policy, LLMModerationGuard)
    if immediate:
        with pytest.raises(ModerationRejectedError):
            prepared.start_llm_polling(
                prompt_messages=[UserPromptMessage(content="safe")],
                model_parameters={},
                tools=None,
                stop=None,
                json_schema=None,
            )
    else:
        result = prepared.start_llm_polling(
            prompt_messages=[UserPromptMessage(content="safe")],
            model_parameters={},
            tools=None,
            stop=None,
            json_schema=None,
        )
        assert result.status == LLMPollingStatus.RUNNING
        assert instance.moderation is policy
        with pytest.raises(ModerationRejectedError):
            prepared.check_llm_polling(plugin_state={"task_id": "native-polling"})
    assert native_moderation_calls == [("input", "safe"), ("output", "blocked")]
    assert runtime.starts == 1


@pytest.mark.parametrize("managed", [False, True])
def test_native_polling_checks_only_the_base_credential_actually_used_for_submission(
    native_moderation_bundle: tuple[ProviderModelBundle, RecordingLLM, str],
    native_moderation_calls: list[tuple[ModerationPhase, str]],
    managed: bool,
) -> None:
    bundle, provider, _managed_id = native_moderation_bundle
    terminal = _succeeded("approved", LLMUsage.empty_usage(), structured=False)
    runtime = RecordingPollingRuntime(initial=terminal, terminal=terminal)
    provider.model_runtime = runtime
    instance = (
        ModelInstance(bundle, "gpt-4o-mini")
        if managed
        else ModelInstance(bundle, "gpt-4o-mini", credentials={"api_key": "managed-test-only"})
    )
    prepared = DifyPreparedPollingLLM(instance)
    if managed:
        with pytest.raises(ModerationRejectedError):
            prepared.start_llm_polling(
                prompt_messages=[UserPromptMessage(content="blocked")],
                model_parameters={},
                tools=None,
                stop=None,
                json_schema=None,
            )
        assert runtime.starts == 0
        assert native_moderation_calls == [("input", "blocked")]
    else:
        assert (
            prepared.start_llm_polling(
                prompt_messages=[UserPromptMessage(content="blocked")],
                model_parameters={},
                tools=None,
                stop=None,
                json_schema=None,
            ).status
            == LLMPollingStatus.SUCCEEDED
        )
        assert runtime.starts == 1
        assert native_moderation_calls == []


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
        HOSTED_MODERATION_PLUGIN_UNIQUE_IDENTIFIER="langgenius/openai:1.0.0@checksum",
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
        HOSTED_MODERATION_PLUGIN_UNIQUE_IDENTIFIER="langgenius/openai:1.0.0@checksum",
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

    def allow(_text: str, _phase: str) -> None:
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


def test_missing_sre_pinned_plugin_identifier_still_binds_tenant_first_policy(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, HOSTED_MODERATION_ENABLED=True)
    config = make_model_config(provider="test-provider", model="test-model", mode="chat")
    bundle = config.provider_model_bundle
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

    def allow(_text: str, _phase: str) -> None:
        return None

    explicit = LLMModerationGuard(
        tenant_id="test-tenant-id",
        check=allow,
        check_input=False,
        check_output=False,
        non_stream_segment_size=2000,
        stream_segment_size=300,
    )
    guarded = ModelInstance(bundle, "test-model", credentials={})
    explicitly_guarded = ModelInstance(bundle, "test-model", credentials={}, moderation=explicit)

    assert isinstance(guarded.moderation, LLMModerationGuard)
    assert isinstance(explicitly_guarded.moderation, ChainedLLMModerationPolicy)


def test_platform_credentials_do_not_depend_on_cloud_provider_enablement(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        HOSTED_OPENAI_TRIAL_ENABLED=False,
        HOSTED_OPENAI_PAID_ENABLED=False,
        HOSTED_OPENAI_API_KEY="server-key",
        HOSTED_OPENAI_API_BASE="https://example.com/v1",
        HOSTED_OPENAI_API_ORGANIZATION="server-org",
    )
    assert platform_moderation_credentials() == {
        "openai_api_key": "server-key",
        "openai_api_base": "https://example.com/v1",
        "openai_organization": "server-org",
    }
