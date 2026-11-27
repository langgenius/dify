from collections.abc import Callable, Iterator
from io import BytesIO
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
import redis
from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import CreditUsageCreatedBy
from core.entities.model_entities import ModelStatus
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations, ProviderModelBundle
from core.entities.provider_entities import (
    CustomConfiguration,
    CustomModelConfiguration,
    CustomProviderConfiguration,
    ModelLoadBalancingConfiguration,
    ModelSettings,
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    RestrictModel,
    SystemConfiguration,
)
from core.errors.error import (
    InsufficientHostedCreditsError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.hosting_configuration import HostingConfiguration
from core.model_manager import (
    HostedCreditFallbackModelInstance,
    LBModelManager,
    ModelInstance,
    ModelManager,
    QuotaManagedModelInstance,
)
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.impl.model_runtime_factory import create_plugin_model_assembly, create_plugin_model_runtime
from enums import DeploymentEdition
from extensions.ext_redis import redis_client
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from graphon.model_runtime.entities.text_embedding_entities import EmbeddingResult
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from graphon.model_runtime.model_providers.base.tts_model import TTSModel
from graphon.model_runtime.protocols.tts_runtime import TTSChunk
from models.provider import ProviderType
from services.billing_client import billing
from services.billing_service import BillingService
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.helpers.unit.core.model_moderation_fixtures import (
    RecordingLLM,
    RecordingProviderManager,
    make_tenant_moderation_provider,
)


@pytest.fixture
def lb_model_manager(monkeypatch: pytest.MonkeyPatch) -> LBModelManager:
    load_balancing_configs = [
        ModelLoadBalancingConfiguration(id="id1", name="__inherit__", credentials={}),
        ModelLoadBalancingConfiguration(id="id2", name="first", credentials={"openai_api_key": "fake_key"}),
        ModelLoadBalancingConfiguration(id="id3", name="second", credentials={"openai_api_key": "fake_key"}),
    ]

    lb_model_manager = LBModelManager(
        tenant_id="tenant_id",
        provider="openai",
        model_type=ModelType.LLM,
        model="gpt-4",
        load_balancing_configs=load_balancing_configs,
        managed_credentials={"openai_api_key": "fake_key"},
    )

    monkeypatch.setattr(lb_model_manager, "cooldown", MagicMock(return_value=None))

    def is_cooldown(config: ModelLoadBalancingConfiguration) -> bool:
        return config.id == "id1"

    monkeypatch.setattr(lb_model_manager, "in_cooldown", MagicMock(side_effect=is_cooldown))

    return lb_model_manager


def test_model_manager_with_cache_enabled_reuses_stored_credentials() -> None:
    """With ``enable_credentials_cache=True``, later calls for the same key return cached creds."""
    provider_manager = MagicMock()
    bundle = MagicMock()
    bundle.configuration.provider.provider = "openai"
    bundle.configuration.tenant_id = "tenant-1"
    bundle.configuration.model_settings = list[object]()
    bundle.model_type_instance.model_type = ModelType.LLM
    get_creds = MagicMock(return_value={"api_key": "first"})
    bundle.configuration.get_current_credentials = get_creds
    provider_manager.get_provider_model_bundle.return_value = bundle

    manager = ModelManager(provider_manager, enable_credentials_cache=True)
    first = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    assert first.credentials == {"api_key": "first"}
    get_creds.assert_called_once()

    get_creds.return_value = {"api_key": "second"}
    second = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    assert second.credentials == {"api_key": "first"}
    get_creds.assert_called_once()


def test_tenant_only_model_does_not_reuse_system_credentials_from_cache() -> None:
    provider, _ = make_tenant_moderation_provider()
    manager = ModelManager(provider, enable_credentials_cache=True)
    tenant_id = provider.bundle.configuration.tenant_id
    model = "omni-moderation-latest"
    system_instance = manager.get_model_instance(tenant_id, "openai", ModelType.MODERATION, model)
    tenant_instance = manager.get_model_instance(
        tenant_id, "openai", ModelType.MODERATION, model, require_custom_credentials=True
    )

    assert isinstance(system_instance, QuotaManagedModelInstance)
    assert system_instance.credentials == {"openai_api_key": "system-key"}
    assert type(tenant_instance) is ModelInstance
    assert tenant_instance.credentials == {"openai_api_key": "tenant-key"}
    assert provider.bundle.configuration.using_provider_type == ProviderType.SYSTEM


def test_tenant_only_model_requires_an_explicit_provider() -> None:
    provider, _ = make_tenant_moderation_provider()
    manager = ModelManager(provider)

    with pytest.raises(ValueError, match="explicit provider"):
        manager.get_model_instance(
            provider.bundle.configuration.tenant_id,
            "",
            ModelType.MODERATION,
            "omni-moderation-latest",
            require_custom_credentials=True,
        )
    assert provider.lookups == 0


def test_missing_tenant_credentials_do_not_fall_back_to_system() -> None:
    provider, client = make_tenant_moderation_provider()
    config = provider.bundle.configuration
    config.custom_configuration.provider = None
    manager = ModelManager(provider)

    with pytest.raises(ProviderTokenNotInitError):
        manager.get_model_instance(
            config.tenant_id, "openai", ModelType.MODERATION, "omni-moderation-latest", require_custom_credentials=True
        )
    assert not client.calls


def _build_model_manager_bundle(
    *,
    provider_type: ProviderType,
    restrict_models: list[RestrictModel],
    model_type: ModelType = ModelType.LLM,
    quota_type: ProviderQuotaType = ProviderQuotaType.TRIAL,
) -> tuple[ModelManager, MagicMock]:
    provider_manager = MagicMock()
    bundle = MagicMock()
    bundle.configuration.provider.provider = "openai"
    bundle.configuration.tenant_id = "tenant-1"
    bundle.configuration.model_settings = list[object]()
    bundle.configuration.using_provider_type = provider_type
    bundle.configuration.system_configuration.current_quota_type = quota_type
    bundle.configuration.system_configuration.quota_configurations = [
        QuotaConfiguration(
            quota_type=quota_type,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=200,
            quota_used=0,
            is_valid=True,
            restrict_models=restrict_models,
        )
    ]
    bundle.configuration.get_current_credentials.return_value = {"api_key": "hosted"}
    bundle.model_type_instance.model_type = model_type
    provider_manager.get_provider_model_bundle.return_value = bundle
    return ModelManager(provider_manager), bundle


def test_model_manager_wraps_allowlisted_system_llm() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )

    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")

    assert isinstance(model_instance, HostedCreditFallbackModelInstance)


def test_model_manager_uses_quota_only_for_hosted_free_models() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[],
        quota_type=ProviderQuotaType.FREE,
    )

    instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")

    assert type(instance) is QuotaManagedModelInstance


@pytest.mark.parametrize("model_type", list(ModelType))
def test_model_manager_wraps_every_system_model_type(model_type: ModelType) -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="hosted-model", model_type=model_type)],
        model_type=model_type,
    )

    model_instance = manager.get_model_instance("tenant-1", "openai", model_type, "hosted-model")

    assert isinstance(model_instance, QuotaManagedModelInstance)


def test_model_manager_does_not_wrap_custom_non_llm_model() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.CUSTOM,
        restrict_models=[],
        model_type=ModelType.TEXT_EMBEDDING,
    )

    model_instance = manager.get_model_instance(
        "tenant-1", "openai", ModelType.TEXT_EMBEDDING, "text-embedding-3-small"
    )

    assert type(model_instance) is ModelInstance


def test_model_manager_rejects_system_model_by_exact_name() -> None:
    manager, bundle = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )

    with pytest.raises(ModelCurrentlyNotSupportError, match="llm/gpt-4o is not allowed"):
        manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4o")

    bundle.configuration.get_current_credentials.assert_not_called()


def test_model_manager_matches_allowlist_name_across_model_types() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="shared-model", model_type=ModelType.TEXT_EMBEDDING)],
    )

    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "shared-model")

    assert isinstance(model_instance, QuotaManagedModelInstance)


def _make_hosted_credit_model(quota_type: ProviderQuotaType) -> tuple[HostedCreditFallbackModelInstance, RecordingLLM]:
    config = make_model_config(provider="openai", model="gpt-4", mode="chat")
    bundle = config.provider_model_bundle
    configuration = bundle.configuration
    configuration.provider.models = [config.model_schema]
    configuration.preferred_provider_type = ProviderType.SYSTEM
    configuration.using_provider_type = ProviderType.SYSTEM
    configuration.system_configuration = SystemConfiguration(
        enabled=True,
        current_quota_type=quota_type,
        credentials={"api_key": "hosted"},
        quota_configurations=[
            QuotaConfiguration(
                quota_type=quota_type, quota_unit=QuotaUnit.CREDITS, quota_limit=100, quota_used=99, is_valid=True
            )
        ],
    )
    template = bundle.model_type_instance
    assert isinstance(template, LargeLanguageModel)
    runtime = template.model_runtime
    assert isinstance(runtime, PluginModelRuntime)
    configuration.bind_model_runtime(runtime)
    llm = RecordingLLM(template, parts=["ok"])
    manager = ModelManager(
        RecordingProviderManager(ProviderModelBundle(configuration=configuration, model_type_instance=llm))
    )
    instance = manager.get_model_instance(configuration.tenant_id, config.provider, ModelType.LLM, config.model)
    assert isinstance(instance, HostedCreditFallbackModelInstance)
    return instance, llm


def test_exhausted_hosted_pool_keeps_only_zero_credit_models_on_system(config_overrides: Callable[..., None]) -> None:
    """Free models keep hosted credentials; paid, unoffered, and explicitly custom routes do not."""
    config_overrides(HOSTED_MODEL_CREDIT_CONFIG="gpt-4:0,custom-only:0")
    hosted, llm = _make_hosted_credit_model(ProviderQuotaType.TRIAL)
    bundle = hosted.provider_model_bundle
    configuration = bundle.configuration
    quota = configuration.system_configuration.quota_configurations[0]
    quota.quota_used = quota.quota_limit
    quota.is_valid = False
    quota.restrict_models = [RestrictModel(model=name, model_type=ModelType.LLM) for name in ("gpt-4", "gpt-4o")]
    schema = configuration.provider.models[0]
    configuration.provider.models.extend(
        schema.model_copy(update={"model": name}) for name in ("gpt-4o", "custom-only")
    )
    assert [m.model for m in configuration.get_provider_models(only_active=True)] == ["gpt-4"]

    configuration.using_provider_type = ProviderType.CUSTOM
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "custom"})
    manager = ModelManager(RecordingProviderManager(bundle), enable_credentials_cache=True)
    for name in ("gpt-4", "gpt-4o", "custom-only"):
        instance = manager.get_model_instance(configuration.tenant_id, hosted.provider, ModelType.LLM, name)
        assert instance.invoke_llm([], stream=False).message.content == "ok"
    custom = manager.get_model_instance(
        configuration.tenant_id, hosted.provider, ModelType.LLM, "gpt-4", require_custom_credentials=True
    )
    assert custom.credentials == {"api_key": "custom"}
    assert llm.credential_calls == [{"api_key": "hosted"}, {"api_key": "custom"}, {"api_key": "custom"}]
    assert configuration.using_provider_type == ProviderType.CUSTOM

    configuration.preferred_provider_type = ProviderType.CUSTOM
    preferred = manager.get_model_instance(configuration.tenant_id, hosted.provider, ModelType.LLM, "gpt-4")
    assert preferred.credentials == custom.credentials


@pytest.mark.parametrize("bucket", [ProviderQuotaType.TRIAL, ProviderQuotaType.PAID])
@pytest.mark.parametrize("remaining", [0, 1])
def test_zero_credit_access_uses_only_the_selected_bucket(
    config_overrides: Callable[..., None], bucket: ProviderQuotaType, remaining: int
) -> None:
    """Neither a zero price nor another bucket's offer grants hosted access."""
    config_overrides(
        HOSTED_OPENAI_TRIAL_ENABLED=True,
        HOSTED_OPENAI_TRIAL_MODELS="gpt-4o-mini",
        HOSTED_OPENAI_PAID_ENABLED=True,
        HOSTED_OPENAI_PAID_MODELS="gpt-4o",
        HOSTED_MODEL_CREDIT_CONFIG="gpt-4o-mini:0,gpt-4o:0",
    )
    instance, llm = _make_hosted_credit_model(bucket)
    bundle = instance.provider_model_bundle
    config = bundle.configuration
    schema = config.provider.models[0]
    offers = {ProviderQuotaType.TRIAL: "gpt-4o-mini", ProviderQuotaType.PAID: "gpt-4o"}
    config.provider.models = [schema.model_copy(update={"model": name}) for name in offers.values()]
    config.system_configuration.quota_configurations = [
        QuotaConfiguration(
            quota_type=offer.quota_type,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=1,
            quota_used=1 - remaining,
            is_valid=bool(remaining),
            restrict_models=offer.restrict_models,
        )
        for offer in HostingConfiguration().init_openai().quotas
    ]
    manager = ModelManager(RecordingProviderManager(bundle))
    for quota_type, name in offers.items():
        entry = config.get_provider_model(ModelType.LLM, name)
        assert entry is not None
        if quota_type == bucket:
            assert entry.status == ModelStatus.ACTIVE
            allowed = manager.get_model_instance(config.tenant_id, instance.provider, ModelType.LLM, name)
            assert allowed.invoke_llm([], stream=False).message.content == "ok"
        else:
            assert entry.status == ModelStatus.NO_PERMISSION
            with pytest.raises(ModelCurrentlyNotSupportError, match=name):
                manager.get_model_instance(config.tenant_id, instance.provider, ModelType.LLM, name)
    assert llm.credential_calls == [{"api_key": "hosted"}]


@pytest.mark.parametrize("route", [ProviderType.SYSTEM, ProviderType.CUSTOM])
def test_disabled_zero_credit_offer_cannot_use_cached_credentials(
    config_overrides: Callable[..., None], route: ProviderType
) -> None:
    config_overrides(HOSTED_MODEL_CREDIT_CONFIG="gpt-4:0")
    instance, llm = _make_hosted_credit_model(ProviderQuotaType.TRIAL)
    bundle = instance.provider_model_bundle
    config = bundle.configuration
    config.using_provider_type = route
    config.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "workspace"})
    quota = config.system_configuration.quota_configurations[0]
    quota.is_valid = False
    quota.quota_used = quota.quota_limit
    manager = ModelManager(RecordingProviderManager(bundle), enable_credentials_cache=True)
    args = (config.tenant_id, instance.provider, ModelType.LLM, instance.model_name)
    assert manager.get_model_instance(*args).credentials == {"api_key": "hosted"}
    assert manager.get_model_instance(*args, require_custom_credentials=True).credentials == {"api_key": "workspace"}

    config.model_settings = [ModelSettings(model=instance.model_name, model_type=ModelType.LLM, enabled=False)]
    with pytest.raises(ValueError, match="disabled"):
        manager.get_model_instance(*args)
    assert not llm.credential_calls


@pytest.mark.usefixtures("unbound_session_factory")
@pytest.mark.parametrize("hosted_embedding", [False, True])
def test_zero_credit_fallback_requires_the_requested_hosted_model_type(
    config_overrides: Callable[..., None], hosted_embedding: bool
) -> None:
    """A name-only bucket entry covers actual hosted types, never a workspace-only namesake."""
    name = "shared"
    provider = "langgenius/example/example"
    config_overrides(HOSTED_MODEL_CREDIT_CONFIG=f"{name}:0")
    llm = AIModelEntity(
        model=name,
        label=I18nObject(en_US=name),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
    )
    embedding = llm.model_copy(update={"model_type": ModelType.TEXT_EMBEDDING})
    config = ProviderConfiguration(
        tenant_id="tenant-1",
        provider=ProviderEntity(
            provider=provider,
            label=llm.label,
            supported_model_types=[ModelType.LLM, ModelType.TEXT_EMBEDDING],
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL, ConfigurateMethod.CUSTOMIZABLE_MODEL],
            models=[llm, embedding] if hosted_embedding else [llm],
        ),
        preferred_provider_type=ProviderType.SYSTEM,
        using_provider_type=ProviderType.CUSTOM,
        system_configuration=SystemConfiguration(
            enabled=True,
            credentials={"api_key": "hosted"},
            current_quota_type=ProviderQuotaType.PAID,
            quota_configurations=[
                QuotaConfiguration(
                    quota_type=ProviderQuotaType.PAID,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=1,
                    quota_used=1,
                    is_valid=False,
                    restrict_models=[RestrictModel(model=name, model_type=ModelType.LLM)],
                )
            ],
        ),
        custom_configuration=CustomConfiguration(
            provider=None,
            models=[
                CustomModelConfiguration(
                    model=name, model_type=ModelType.TEXT_EMBEDDING, credentials={"api_key": "workspace"}
                )
            ],
        ),
        model_settings=[],
    )
    assembly = create_plugin_model_assembly(tenant_id=config.tenant_id)
    runtime = assembly.model_runtime
    config.bind_model_runtime(runtime)
    catalog = ProviderConfigurations(tenant_id=config.tenant_id)
    catalog[provider] = config
    providers = assembly.provider_manager
    providers._configurations_cache[config.tenant_id] = catalog
    manager = ModelManager(providers, enable_credentials_cache=True)
    result = EmbeddingResult.model_validate(
        {
            "model": name,
            "embeddings": [[1.0]],
            "usage": {
                "tokens": 1,
                "total_tokens": 1,
                "unit_price": 0,
                "price_unit": 1,
                "total_price": 0,
                "currency": "USD",
                "latency": 0,
            },
        }
    )
    with (
        patch.object(runtime, "get_model_schema", return_value=embedding),
        patch.object(runtime, "invoke_text_embedding", return_value=result) as invoke,
    ):
        entries = catalog.get_models(model_type=ModelType.TEXT_EMBEDDING, only_active=True)
        assert [(entry.model, entry.fetch_from) for entry in entries] == [
            (name, FetchFrom.PREDEFINED_MODEL if hosted_embedding else FetchFrom.CUSTOMIZABLE_MODEL)
        ]
        chat = manager.get_model_instance(config.tenant_id, provider, ModelType.LLM, name)
        assert chat.credentials == {"api_key": "hosted"}
        embed = manager.get_model_instance(config.tenant_id, provider, ModelType.TEXT_EMBEDDING, name)
        assert embed.invoke_text_embedding(["text"]) is result
        assert invoke.call_args.kwargs["credentials"] == {"api_key": "hosted" if hosted_embedding else "workspace"}
    assert config.using_provider_type == ProviderType.CUSTOM


def test_hosted_credit_denial_uses_custom_only_for_this_invocation(config_overrides: Callable[..., None]) -> None:
    instance, llm = _make_hosted_credit_model(ProviderQuotaType.TRIAL)
    configuration = instance.provider_model_bundle.configuration
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, HOSTED_MODEL_CREDIT_CONFIG="gpt-4:2")
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "custom"})

    first_id, second_id = str(uuid4()), str(uuid4())
    with (
        patch(
            "core.app.llm.quota._get_provider_configuration",
            return_value=configuration.model_copy(update={"using_provider_type": ProviderType.CUSTOM}),
        ) as fresh_provider_lookup,
        patch.object(
            BillingService,
            "quota_reserve",
            side_effect=[
                billing.QuotaReserveReply(reservation_id="", available=1, reserved=0),
                billing.QuotaReserveReply(reservation_id="reserved", available=8, reserved=2),
            ],
        ) as billing_reserve,
        patch.object(BillingService, "quota_commit") as commit,
        patch.object(BillingService, "quota_release") as release,
    ):
        assert (
            instance.invoke_llm([], stream=False, request_metadata={"invocation_id": first_id}).message.content == "ok"
        )
        commit.assert_not_called()
        assert llm.credential_calls == [{"api_key": "custom"}]
        assert instance.credentials == {"api_key": "hosted"}
        assert configuration.using_provider_type == configuration.preferred_provider_type == ProviderType.SYSTEM

        assert (
            instance.invoke_llm([], stream=False, request_metadata={"invocation_id": second_id}).message.content == "ok"
        )
        commit.assert_called_once()
        assert commit.call_args.kwargs["actual_amount"] == 2
        assert llm.credential_calls == [{"api_key": "custom"}, {"api_key": "hosted"}]
        release.assert_not_called()

    fresh_provider_lookup.assert_not_called()
    assert [call.kwargs["amount"] for call in billing_reserve.call_args_list] == [2, 2]
    assert [call.kwargs["bucket"] for call in billing_reserve.call_args_list] == ["trial", "trial"]
    assert [call.kwargs["request_id"] for call in billing_reserve.call_args_list] == [first_id, second_id]


def test_paid_hosted_stream_uses_model_level_custom_credentials(config_overrides: Callable[..., None]) -> None:
    instance, llm = _make_hosted_credit_model(ProviderQuotaType.PAID)
    configuration = instance.provider_model_bundle.configuration
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, HOSTED_MODEL_CREDIT_CONFIG="gpt-4:2")
    configuration.custom_configuration.models = [
        CustomModelConfiguration(model="gpt-4", model_type=ModelType.LLM, credentials={"api_key": "custom"})
    ]

    with (
        patch.object(
            BillingService,
            "quota_reserve",
            return_value=billing.QuotaReserveReply(reservation_id="", available=1, reserved=0),
        ) as reserve,
        patch.object(PluginModelRuntime, "get_model_schema", return_value=configuration.provider.models[0]),
    ):
        assert [chunk.delta.message.content for chunk in instance.invoke_llm([], stream=True)] == ["ok"]

    assert reserve.call_args.kwargs["bucket"] == "paid"
    assert llm.credential_calls == [{"api_key": "custom"}]


def test_quota_only_model_does_not_replace_executor_on_reservation_denial(
    config_overrides: Callable[..., None],
) -> None:
    decorated, llm = _make_hosted_credit_model(ProviderQuotaType.TRIAL)
    bundle = decorated.provider_model_bundle
    bundle.configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "custom"})
    instance = QuotaManagedModelInstance(bundle, decorated.model_name)
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, HOSTED_MODEL_CREDIT_CONFIG="gpt-4:2")

    with (
        patch("core.app.llm.quota._get_provider_configuration", return_value=bundle.configuration) as provider_lookup,
        patch.object(
            BillingService,
            "quota_reserve",
            return_value=billing.QuotaReserveReply(reservation_id="", available=1, reserved=0),
        ),
        pytest.raises(InsufficientHostedCreditsError, match="Insufficient credits remaining"),
    ):
        instance.invoke_llm(prompt_messages=[], stream=False)

    provider_lookup.assert_called_once_with(tenant_id=bundle.configuration.tenant_id, provider=decorated.provider)
    assert not llm.credential_calls


@pytest.mark.parametrize("custom_state", ["missing", "empty", "unrelated"])
def test_hosted_credit_denial_without_eligible_custom_preserves_quota_error(
    config_overrides: Callable[..., None], custom_state: str
) -> None:
    instance, llm = _make_hosted_credit_model(ProviderQuotaType.TRIAL)
    configuration = instance.provider_model_bundle.configuration
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, HOSTED_MODEL_CREDIT_CONFIG="gpt-4:2")
    if custom_state == "empty":
        configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={})
    if custom_state == "unrelated":
        configuration.custom_configuration.models = [
            CustomModelConfiguration(model="gpt-4o", model_type=ModelType.LLM, credentials={"api_key": "custom"})
        ]

    with (
        patch.object(
            BillingService,
            "quota_reserve",
            return_value=billing.QuotaReserveReply(reservation_id="", available=1, reserved=0),
        ) as billing_reserve,
        pytest.raises(InsufficientHostedCreditsError, match="Insufficient credits remaining"),
    ):
        instance.invoke_llm(prompt_messages=[], stream=False)

    billing_reserve.assert_called_once()
    assert not llm.credential_calls


@pytest.mark.parametrize("failure", [TimeoutError("billing timeout"), QuotaExceededError("other quota failure")])
def test_hosted_credit_fallback_does_not_catch_other_reservation_errors(
    config_overrides: Callable[..., None], failure: Exception
) -> None:
    instance, llm = _make_hosted_credit_model(ProviderQuotaType.PAID)
    configuration = instance.provider_model_bundle.configuration
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "custom"})
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    with patch.object(BillingService, "quota_reserve", side_effect=failure), pytest.raises(type(failure)) as raised:
        instance.invoke_llm(prompt_messages=[], stream=False)

    assert raised.value is failure
    assert not llm.credential_calls


@pytest.mark.parametrize("failure", [TimeoutError("commit timeout"), InsufficientHostedCreditsError("late denial")])
def test_hosted_credit_fallback_does_not_retry_after_model_invocation(
    config_overrides: Callable[..., None], failure: Exception
) -> None:
    instance, llm = _make_hosted_credit_model(ProviderQuotaType.PAID)
    configuration = instance.provider_model_bundle.configuration
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "custom"})
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    with (
        patch.object(
            BillingService,
            "quota_reserve",
            return_value=billing.QuotaReserveReply(reservation_id="reserved", available=0, reserved=1),
        ),
        patch.object(BillingService, "quota_commit", side_effect=failure),
        patch.object(BillingService, "quota_release") as release,
        pytest.raises(type(failure)) as raised,
    ):
        instance.invoke_llm(prompt_messages=[], stream=False)

    assert raised.value is failure
    assert llm.credential_calls == [{"api_key": "hosted"}]
    release.assert_called_once()


def test_quota_managed_non_streaming_invocation_finalizes_reservation() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    usage = LLMUsage.empty_usage().model_copy(update={"total_tokens": 12})
    result = LLMResult(model="gpt-4", prompt_messages=[], message=AssistantPromptMessage(content="answer"), usage=usage)
    reservation = MagicMock(commit_before_delivery=True)

    invocation_id = str(uuid4())
    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation) as reserve_quota,
        patch.object(ModelInstance, "_invoke_llm", return_value=result) as invoke,
    ):
        response = model_instance.invoke_llm(
            prompt_messages=[],
            stream=False,
            request_metadata={"invocation_id": invocation_id, "created_by": CreditUsageCreatedBy.APP.value},
        )

    assert response is result
    reserve_quota.assert_called_once_with(
        request_id=invocation_id,
        created_by=CreditUsageCreatedBy.APP.value,
    )
    invoke.assert_called_once()
    reservation.commit.assert_called_once_with(usage)
    reservation.release.assert_called_once_with()


def test_quota_managed_stream_commits_before_first_chunk() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    chunk = LLMResultChunk(
        model="gpt-4",
        prompt_messages=[],
        delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="hello")),
    )
    reservation = MagicMock(commit_before_delivery=True)
    events: list[str] = []
    reservation.commit.side_effect = lambda _usage: events.append("commit")

    invocation_id = str(uuid4())
    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation) as reserve_quota,
        patch.object(ModelInstance, "_invoke_llm", return_value=(item for item in [chunk])),
    ):
        response = model_instance.invoke_llm(
            prompt_messages=[],
            stream=True,
            request_metadata={"invocation_id": invocation_id},
        )
        assert next(response) is chunk
        events.append("delivered")
        with pytest.raises(StopIteration):
            next(response)

    assert events == ["commit", "delivered"]
    reserve_quota.assert_called_once_with(request_id=invocation_id)
    reservation.release.assert_called_once_with()


def test_quota_managed_stream_releases_when_provider_fails_before_first_chunk() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    reservation = MagicMock(commit_before_delivery=True)

    def failing_stream() -> Iterator[LLMResultChunk]:
        raise RuntimeError("provider failed")
        yield

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, "_invoke_llm", return_value=failing_stream()),
        pytest.raises(RuntimeError, match="provider failed"),
    ):
        list(model_instance.invoke_llm(prompt_messages=[], stream=True))

    reservation.commit.assert_not_called()
    reservation.release.assert_called_once_with()


def test_quota_managed_usage_stream_commits_before_delivering_buffered_chunks() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    usage = LLMUsage.empty_usage().model_copy(update={"total_tokens": 12})
    chunks = [
        LLMResultChunk(
            model="gpt-4",
            prompt_messages=[],
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="hello")),
        ),
        LLMResultChunk(
            model="gpt-4",
            prompt_messages=[],
            delta=LLMResultChunkDelta(index=1, message=AssistantPromptMessage(content=" world"), usage=usage),
        ),
    ]
    reservation = MagicMock(commit_before_delivery=False)
    events: list[str] = []
    reservation.commit.side_effect = lambda _usage: events.append("commit")

    def provider_stream() -> Iterator[LLMResultChunk]:
        for index, chunk in enumerate(chunks):
            events.append(f"provider-{index}")
            yield chunk

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, "_invoke_llm", return_value=provider_stream()),
    ):
        response = model_instance.invoke_llm(prompt_messages=[], stream=True)
        assert next(response) is chunks[0]
        events.append("delivered")
        assert list(response) == [chunks[1]]

    assert events == ["provider-0", "provider-1", "commit", "delivered"]
    reservation.commit.assert_called_once_with(usage)
    reservation.release.assert_called_once_with()


def test_quota_managed_usage_stream_does_not_deliver_when_settlement_fails() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    chunk = LLMResultChunk(
        model="gpt-4",
        prompt_messages=[],
        delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="hello")),
    )
    reservation = MagicMock(commit_before_delivery=False)
    reservation.commit.side_effect = ValueError("terminal usage is required")

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, "_invoke_llm", return_value=(item for item in [chunk])),
        pytest.raises(ValueError, match="terminal usage is required"),
    ):
        next(model_instance.invoke_llm(prompt_messages=[], stream=True))

    reservation.release.assert_called_once_with()


@pytest.mark.parametrize(
    ("model_type", "method_name", "invoke_model"),
    [
        (
            ModelType.TEXT_EMBEDDING,
            "invoke_text_embedding",
            lambda model_instance: model_instance.invoke_text_embedding(texts=["hello"]),
        ),
        (
            ModelType.TEXT_EMBEDDING,
            "invoke_multimodal_embedding",
            lambda model_instance: model_instance.invoke_multimodal_embedding(
                multimodel_documents=[{"content": "image"}]
            ),
        ),
        (
            ModelType.RERANK,
            "invoke_rerank",
            lambda model_instance: model_instance.invoke_rerank(query="hello", docs=["document"]),
        ),
        (
            ModelType.RERANK,
            "invoke_multimodal_rerank",
            lambda model_instance: model_instance.invoke_multimodal_rerank(query=MagicMock(), docs=[MagicMock()]),
        ),
        (
            ModelType.MODERATION,
            "invoke_moderation",
            lambda model_instance: model_instance.invoke_moderation(text="hello"),
        ),
        (
            ModelType.SPEECH2TEXT,
            "invoke_speech2text",
            lambda model_instance: model_instance.invoke_speech2text(file=BytesIO(b"audio")),
        ),
    ],
)
def test_quota_managed_non_llm_invocation_finalizes_reservation(
    model_type: ModelType,
    method_name: str,
    invoke_model: Callable[[ModelInstance], object],
) -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="hosted-model", model_type=model_type)],
        model_type=model_type,
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", model_type, "hosted-model")
    result = MagicMock()
    reservation = MagicMock()

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, method_name, return_value=result) as invoke,
    ):
        response = invoke_model(model_instance)

    assert response is result
    invoke.assert_called_once()
    reservation.commit.assert_called_once_with()
    reservation.release.assert_called_once_with()


def test_quota_managed_non_llm_invocation_releases_when_provider_fails() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="embedding-model", model_type=ModelType.TEXT_EMBEDDING)],
        model_type=ModelType.TEXT_EMBEDDING,
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.TEXT_EMBEDDING, "embedding-model")
    reservation = MagicMock()

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, "invoke_text_embedding", side_effect=RuntimeError("provider failed")),
        pytest.raises(RuntimeError, match="provider failed"),
    ):
        model_instance.invoke_text_embedding(texts=["hello"])

    reservation.commit.assert_not_called()
    reservation.release.assert_called_once_with()


def test_quota_managed_tts_commits_before_first_chunk() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="tts-model", model_type=ModelType.TTS)],
        model_type=ModelType.TTS,
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.TTS, "tts-model")
    reservation = MagicMock()
    events: list[str] = []
    reservation.commit.side_effect = lambda: events.append("commit")

    def provider_stream() -> Iterator[bytes]:
        events.append("provider")
        yield b"audio"

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, "invoke_tts", return_value=provider_stream()),
    ):
        response = iter(model_instance.invoke_tts(content_text="hello", voice="voice"))
        assert next(response) == b"audio"
        events.append("delivered")
        with pytest.raises(StopIteration):
            next(response)

    assert events == ["provider", "commit", "delivered"]
    reservation.commit.assert_called_once_with()
    reservation.release.assert_called_once_with()


def test_model_instance_adapts_tts_chunks_to_audio_bytes() -> None:
    manager, bundle = _build_model_manager_bundle(
        provider_type=ProviderType.CUSTOM,
        restrict_models=[],
        model_type=ModelType.TTS,
    )
    tts_model = TTSModel(
        provider_schema=ProviderEntity(
            provider="openai",
            label=I18nObject(en_US="OpenAI"),
            supported_model_types=[ModelType.TTS],
            configurate_methods=[],
        ),
        model_runtime=create_plugin_model_runtime(tenant_id="tenant-1"),
    )
    bundle.model_type_instance = tts_model
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.TTS, "tts-model")

    with patch.object(
        tts_model.model_runtime, "invoke_tts", return_value=iter([TTSChunk(data=b"audio", mime_type="audio/wav")])
    ):
        assert list(model_instance.invoke_tts(content_text="hello", voice="voice")) == [b"audio"]


def test_quota_managed_tts_releases_when_provider_fails_before_first_chunk() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="tts-model", model_type=ModelType.TTS)],
        model_type=ModelType.TTS,
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.TTS, "tts-model")
    reservation = MagicMock()

    def failing_stream() -> Iterator[bytes]:
        raise RuntimeError("provider failed")
        yield b""

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, "invoke_tts", return_value=failing_stream()),
        pytest.raises(RuntimeError, match="provider failed"),
    ):
        list(model_instance.invoke_tts(content_text="hello"))

    reservation.commit.assert_not_called()
    reservation.release.assert_called_once_with()


def test_quota_managed_non_inference_helper_does_not_reserve_quota() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="embedding-model", model_type=ModelType.TEXT_EMBEDDING)],
        model_type=ModelType.TEXT_EMBEDDING,
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.TEXT_EMBEDDING, "embedding-model")

    with (
        patch.object(model_instance, "reserve_quota") as reserve,
        patch.object(ModelInstance, "get_text_embedding_num_tokens", return_value=[1]) as count_tokens,
    ):
        result = model_instance.get_text_embedding_num_tokens(["hello"])

    assert result == [1]
    count_tokens.assert_called_once_with(["hello"])
    reserve.assert_not_called()


def test_lb_model_manager_fetch_next(mocker: MockerFixture, lb_model_manager: LBModelManager) -> None:
    # initialize redis client
    redis_client.initialize(redis.Redis())

    assert len(lb_model_manager._load_balancing_configs) == 3

    config1 = lb_model_manager._load_balancing_configs[0]
    config2 = lb_model_manager._load_balancing_configs[1]
    config3 = lb_model_manager._load_balancing_configs[2]

    assert lb_model_manager.in_cooldown(config1) is True
    assert lb_model_manager.in_cooldown(config2) is False
    assert lb_model_manager.in_cooldown(config3) is False

    start_index = 0

    def incr(key: str) -> int:
        nonlocal start_index
        start_index += 1
        return start_index

    with (
        patch.object(redis_client, "incr", side_effect=incr),
        patch.object(redis_client, "set", return_value=None),
        patch.object(redis_client, "expire", return_value=None),
    ):
        config = lb_model_manager.fetch_next()
        assert config == config2

        config = lb_model_manager.fetch_next()
        assert config == config3
