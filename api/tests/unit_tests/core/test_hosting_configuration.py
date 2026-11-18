import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

import pytest

from core.entities.model_entities import ModelStatus
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations
from core.entities.provider_entities import (
    CustomConfiguration,
    CustomProviderConfiguration,
    ModelSettings,
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    RestrictModel,
    SystemConfiguration,
)
from core.hosting_configuration import (
    HostedAliasResolution,
    IneligibleHostedAlias,
    UnavailableHostedAlias,
    VerifiedHostedAlias,
    resolve_legacy_hosted_alias,
)
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType, PriceConfig
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod
from models.provider import ProviderType

ALIAS = "claude-opus-4-5"
DATED = "claude-opus-4-5-20251101"
PROVIDER = "langgenius/anthropic/anthropic"
UID = "langgenius/anthropic:0.3.41@8cf64e60ff25e58d5624bb54938fbe06ee7ab062b499a7124c48b100125f0378"


def _source_schema() -> AIModelEntity:
    facts = json.loads(
        (Path(__file__).parent.parent / "services/fixtures/model_billing_anthropic0341_opus45_source.json").read_text()
    )
    return AIModelEntity.model_validate(facts["sourceSchema"])


def _provider() -> PluginModelProviderDeclaration:
    return PluginModelProviderDeclaration(
        provider=PROVIDER,
        plugin_unique_identifier=UID,
        installation_source=PluginInstallationSource.Marketplace,
        label=I18nObject(en_US="Anthropic"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL, ConfigurateMethod.CUSTOMIZABLE_MODEL],
        models=[_source_schema().model_copy(update={"model": DATED})],
    )


def _system() -> SystemConfiguration:
    return SystemConfiguration(
        enabled=True,
        current_quota_type=ProviderQuotaType.PAID,
        credentials={"anthropic_api_key": "unit-test-placeholder"},
        quota_configurations=[
            QuotaConfiguration(
                quota_type=ProviderQuotaType.PAID,
                quota_unit=QuotaUnit.CREDITS,
                quota_limit=100,
                quota_used=2,
                is_valid=True,
                restrict_models=[RestrictModel(model=ALIAS, model_type=ModelType.LLM)],
            )
        ],
    )


@dataclass
class SchemaReader:
    schema: AIModelEntity | None = field(default_factory=_source_schema)
    fail: bool = False
    calls: list[tuple[ModelType, str, str | None]] = field(default_factory=list)

    def __call__(self, kind: ModelType, model: str, credentials: dict[str, object] | None) -> AIModelEntity | None:
        if credentials is None or credentials.get("anthropic_api_key") != "unit-test-placeholder":
            raise AssertionError("normal hosted credential ownership required")
        base = credentials.get("base_model_name")
        if base is not None and not isinstance(base, str):
            raise AssertionError("unexpected base model")
        self.calls.append((kind, model, base))
        if self.fail:
            raise RuntimeError("private upstream error must not be logged")
        return self.schema


@dataclass
class PhaseReader:
    managed: bool = False
    calls: int = 0

    def __call__(self) -> bool:
        self.calls += 1
        return self.managed


def _resolve(
    provider: PluginModelProviderDeclaration,
    system: SystemConfiguration,
    reader: SchemaReader,
    phase: PhaseReader,
    *,
    model: str | None = None,
    model_types: Sequence[ModelType] = (ModelType.LLM,),
) -> HostedAliasResolution:
    return resolve_legacy_hosted_alias(
        provider=provider,
        system=system,
        model_types=model_types,
        model=model,
        has_managed_route=phase,
        read_schema=reader,
    )


@pytest.mark.parametrize("quota_type", [ProviderQuotaType.PAID, ProviderQuotaType.TRIAL])
@pytest.mark.parametrize("version", ["0.3.39", "0.3.41", "99.0.0"])
def test_exact_whitelisted_source_alias_preserves_schema_and_does_not_lock_latest(
    quota_type: ProviderQuotaType, version: str
) -> None:
    provider, system, reader, phase = _provider(), _system(), SchemaReader(), PhaseReader()
    provider.plugin_unique_identifier = f"langgenius/anthropic:{version}@" + "a" * 64
    system.current_quota_type = system.quota_configurations[0].quota_type = quota_type
    system.quota_configurations[0].restrict_models[0].base_model_name = ALIAS
    original = (provider.model_dump(), system.model_dump())
    result = _resolve(provider, system, reader, phase)
    assert isinstance(result, VerifiedHostedAlias)
    assert result.schema == _source_schema()
    assert result.schema is not reader.schema
    assert result.schema.pricing is None
    assert [rule.name for rule in result.schema.parameter_rules] == [
        "max_tokens",
        "thinking",
        "temperature",
        "top_p",
        "top_k",
        "thinking_budget",
    ]
    assert reader.calls == [(ModelType.LLM, ALIAS, ALIAS)]
    assert phase.calls == 1
    assert (provider.model_dump(), system.model_dump()) == original


@pytest.mark.parametrize(
    "case",
    [
        "disabled",
        "free",
        "tokens",
        "times",
        "unlimited",
        "empty",
        "dated_only",
        "wrong_kind",
        "exhausted",
        "invalid",
        "negative_used",
        "no_pool",
        "duplicate_pool",
        "no_credentials",
        "no_key",
        "other_url",
        "local",
        "other_plugin",
        "other_provider",
        "base_override",
    ],
)
def test_ineligible_pool_or_source_is_not_metadata_failure_and_never_reads_schema(case: str) -> None:
    provider, system, reader, phase = _provider(), _system(), SchemaReader(), PhaseReader()
    quota = system.quota_configurations[0]
    match case:
        case "disabled":
            system.enabled = False
        case "free":
            system.current_quota_type = quota.quota_type = ProviderQuotaType.FREE
        case "tokens":
            quota.quota_unit = QuotaUnit.TOKENS
        case "times":
            quota.quota_unit = QuotaUnit.TIMES
        case "unlimited":
            quota.quota_limit = -1
        case "empty":
            quota.restrict_models = []
        case "dated_only":
            quota.restrict_models[0].model = DATED
        case "wrong_kind":
            quota.restrict_models[0].model_type = ModelType.TEXT_EMBEDDING
        case "exhausted":
            quota.quota_used = quota.quota_limit
        case "invalid":
            quota.is_valid = False
        case "negative_used":
            quota.quota_used = -1
        case "no_pool":
            system.current_quota_type = ProviderQuotaType.TRIAL
        case "duplicate_pool":
            system.quota_configurations.append(quota.model_copy(deep=True))
        case "no_credentials":
            system.credentials = None
        case "no_key":
            system.credentials = {}
        case "other_url":
            system.credentials = {
                "anthropic_api_key": "unit-test-placeholder",
                "anthropic_api_url": "https://other.invalid",
            }
        case "local":
            provider.installation_source = PluginInstallationSource.Package
        case "other_plugin":
            provider.plugin_unique_identifier = "other/anthropic:0.3.41@" + "a" * 64
        case "other_provider":
            provider.provider = "langgenius/openai/openai"
        case "base_override":
            quota.restrict_models[0].base_model_name = DATED
    result = _resolve(provider, system, reader, phase)
    assert isinstance(result, IneligibleHostedAlias)
    assert reader.calls == []
    assert phase.calls == 0


@pytest.mark.parametrize("case", ["missing", "rpc", "different_id", "parameter", "pricing"])
def test_missing_or_unreviewed_metadata_is_not_reported_as_denied_rights(case: str) -> None:
    reader = SchemaReader()
    if case == "missing":
        reader.schema = None
    elif case == "rpc":
        reader.fail = True
    else:
        schema = _source_schema()
        if case == "different_id":
            schema.model = DATED
        elif case == "parameter":
            schema.parameter_rules[0].max = 129000
        else:
            schema.pricing = PriceConfig(input=Decimal(1), output=Decimal(5), unit=Decimal("0.000001"), currency="USD")
        reader.schema = schema
    result = _resolve(_provider(), _system(), reader, PhaseReader())
    assert isinstance(result, UnavailableHostedAlias)
    assert len(reader.calls) == 1


def test_static_exact_source_schema_has_precedence_even_when_different() -> None:
    provider, reader, phase = _provider(), SchemaReader(fail=True), PhaseReader()
    provider.models.append(_source_schema().model_copy(update={"deprecated": True}))
    result = _resolve(provider, _system(), reader, phase)
    assert result == IneligibleHostedAlias("static_present")
    assert reader.calls == []
    assert phase.calls == 0


@pytest.mark.parametrize("model", ["arbitrary-dynamic", "claude-retired", DATED])
def test_no_arbitrary_or_retired_model_enumeration(model: str) -> None:
    reader, phase = SchemaReader(), PhaseReader()
    assert _resolve(_provider(), _system(), reader, phase, model=model) == IneligibleHostedAlias("not_requested")
    assert reader.calls == []
    assert phase.calls == 0


def test_managed_phase_keeps_existing_migration_schema_owner() -> None:
    reader = SchemaReader()
    assert _resolve(_provider(), _system(), reader, PhaseReader(True)) == IneligibleHostedAlias("managed_phase")
    assert reader.calls == []


def test_unknown_migration_state_fails_closed_without_source_schema_rpc() -> None:
    from core.model_invocation_routing import ModelRouteUnavailable

    reader = SchemaReader()

    def unavailable_state() -> bool:
        raise ModelRouteUnavailable

    with pytest.raises(ModelRouteUnavailable):
        resolve_legacy_hosted_alias(
            provider=_provider(),
            system=_system(),
            model_types=[ModelType.LLM],
            model=ALIAS,
            has_managed_route=unavailable_state,
            read_schema=reader,
        )
    assert reader.calls == []


def test_other_model_type_filter_never_fetches_llm_alias() -> None:
    reader, phase = SchemaReader(), PhaseReader()
    result = _resolve(_provider(), _system(), reader, phase, model_types=[ModelType.TEXT_EMBEDDING])
    assert result == IneligibleHostedAlias("not_requested")
    assert reader.calls == []
    assert phase.calls == 0


@pytest.mark.parametrize("using", [ProviderType.SYSTEM, ProviderType.CUSTOM])
@pytest.mark.parametrize("disabled", [False, True])
@pytest.mark.parametrize("managed", [False, True])
def test_normal_provider_listing_has_no_byok_or_admin_enablement_change(
    monkeypatch: pytest.MonkeyPatch, using: ProviderType, disabled: bool, managed: bool
) -> None:
    from core import model_invocation_routing
    from core.plugin.impl.model import PluginModelClient
    from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime

    provider, system = _provider(), _system()
    if managed:
        system._tokener_source_schemas = (_source_schema(),)
        system._tokener_source_plugin_unique_identifier = UID
    configuration = ProviderConfiguration(
        tenant_id="alias-only-test-tenant",
        provider=provider,
        preferred_provider_type=using,
        using_provider_type=using,
        system_configuration=system,
        custom_configuration=CustomConfiguration(
            provider=CustomProviderConfiguration(credentials={"custom": "placeholder"})
        ),
        model_settings=[ModelSettings(model=ALIAS, model_type=ModelType.LLM, enabled=not disabled)],
    )
    runtime = create_plugin_model_runtime(tenant_id=configuration.tenant_id, user_id="caller")
    runtime.bind_provider_schema(provider)
    configuration.bind_model_runtime(runtime)
    calls: list[tuple[str, str, str, str]] = []

    def read_schema(
        _client: PluginModelClient,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict[str, object],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> AIModelEntity:
        assert user_id is not None
        assert plugin_unique_identifier is not None
        calls.append((tenant_id, user_id, plugin_unique_identifier, model))
        assert plugin_id == "langgenius/anthropic"
        assert provider == "anthropic"
        assert model_type == ModelType.LLM.value
        assert credentials == {"anthropic_api_key": "unit-test-placeholder"}
        return _source_schema()

    monkeypatch.setattr(PluginModelClient, "get_model_schema", read_schema)
    monkeypatch.setattr(
        model_invocation_routing, "migration_routing_state", lambda _tenant: {"phase": "active"} if managed else None
    )
    # The actual PluginModelRuntime's cache boundary only; no fake model runtime,
    # provider declaration, schema, or credentials bypasses the normal assembly.
    from core.plugin.impl import model_runtime

    monkeypatch.setattr(model_runtime.redis_client, "get", lambda _key: None)
    monkeypatch.setattr(model_runtime.redis_client, "setex", lambda *_args: None)
    before = configuration.model_dump()
    configurations = ProviderConfigurations(tenant_id=configuration.tenant_id)
    configurations[PROVIDER] = configuration
    models = configurations.get_models(provider=PROVIDER, model_type=ModelType.LLM)
    aliases = [item for item in models if item.model == ALIAS]
    if using == ProviderType.SYSTEM:
        assert len(aliases) == 1
        assert aliases[0].status == (ModelStatus.DISABLED if disabled else ModelStatus.ACTIVE)
        assert calls == ([] if managed else [(configuration.tenant_id, "caller", UID, ALIAS)])
    else:
        assert aliases == []
        assert calls == []
    assert configuration.model_dump() == before


def test_normal_model_config_validator_accepts_alias_without_rewriting_app_or_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import model_invocation_routing
    from core.app.app_config.easy_ui_based_app.model_config import manager as validator_module
    from core.app.app_config.easy_ui_based_app.model_config.manager import ModelConfigManager
    from core.plugin.impl import model_runtime
    from core.plugin.impl.model import PluginModelClient
    from core.plugin.impl.model_runtime_factory import PluginModelAssembly
    from core.plugin.plugin_service import PluginService
    from core.provider_manager import ProviderManager

    provider = _provider()
    configuration = ProviderConfiguration(
        tenant_id="alias-validator-tenant",
        provider=provider,
        preferred_provider_type=ProviderType.SYSTEM,
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=_system(),
        custom_configuration=CustomConfiguration(),
        model_settings=[],
    )
    configurations = ProviderConfigurations(tenant_id=configuration.tenant_id)
    configurations[PROVIDER] = configuration
    assembly = PluginModelAssembly(tenant_id=configuration.tenant_id)
    configuration.bind_model_runtime(assembly.model_runtime)
    calls: list[str] = []

    def providers(
        _service: type[PluginService], tenant_id: str, client: PluginModelClient
    ) -> Sequence[PluginModelProviderDeclaration]:
        assert tenant_id == configuration.tenant_id
        assert client is assembly.model_runtime.client
        return [provider]

    def schemas(_client: PluginModelClient, **kwargs: object) -> AIModelEntity:
        assert kwargs["tenant_id"] == configuration.tenant_id
        assert kwargs["plugin_unique_identifier"] == UID
        assert kwargs["model"] == ALIAS
        assert kwargs["credentials"] == configuration.system_configuration.credentials
        calls.append(ALIAS)
        return _source_schema()

    def tenant_configs(_manager: ProviderManager, tenant_id: str) -> ProviderConfigurations:
        assert tenant_id == configuration.tenant_id
        return configurations

    monkeypatch.setattr(PluginService, "fetch_plugin_model_providers", classmethod(providers))
    monkeypatch.setattr(PluginModelClient, "get_model_schema", schemas)
    monkeypatch.setattr(ProviderManager, "get_configurations", tenant_configs)
    monkeypatch.setattr(validator_module, "create_plugin_model_assembly", lambda **_kwargs: assembly)
    monkeypatch.setattr(model_invocation_routing, "migration_routing_state", lambda _tenant: None)
    monkeypatch.setattr(model_runtime.redis_client, "get", lambda _key: None)
    monkeypatch.setattr(model_runtime.redis_client, "setex", lambda *_args: None)
    stop: list[str] = []
    app_config = {
        "model": {
            "provider": PROVIDER,
            "name": ALIAS,
            "mode": "chat",
            "completion_params": {"max_tokens": 32, "stop": stop},
        }
    }
    before = json.dumps(app_config, sort_keys=True)
    provider_before = provider.model_dump()
    validated, fields = ModelConfigManager.validate_and_set_defaults(configuration.tenant_id, app_config)
    assert json.dumps(validated, sort_keys=True) == before
    assert fields == ["model"]
    assert calls == [ALIAS]
    assert provider.model_dump() == provider_before


def test_wrong_normal_rpc_response_shape_is_unavailable_without_private_error_logging(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from core import model_invocation_routing
    from core.plugin.impl import model_runtime
    from core.plugin.impl.model import PluginModelClient
    from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime

    provider = _provider()
    configuration = ProviderConfiguration(
        tenant_id="alias-malformed-tenant",
        provider=provider,
        preferred_provider_type=ProviderType.SYSTEM,
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=_system(),
        custom_configuration=CustomConfiguration(),
        model_settings=[],
    )
    runtime = create_plugin_model_runtime(tenant_id=configuration.tenant_id)
    runtime.bind_provider_schema(provider)
    configuration.bind_model_runtime(runtime)

    def malformed(_client: PluginModelClient, **_kwargs: object) -> object:
        return {"private": "must-not-appear-in-logs"}

    monkeypatch.setattr(PluginModelClient, "get_model_schema", malformed)
    monkeypatch.setattr(model_invocation_routing, "migration_routing_state", lambda _tenant: None)
    monkeypatch.setattr(model_runtime.redis_client, "get", lambda _key: None)
    assert ALIAS not in {item.model for item in configuration.get_provider_models()}
    assert "schema_rpc_failed" in caplog.text
    assert "must-not-appear-in-logs" not in caplog.text
