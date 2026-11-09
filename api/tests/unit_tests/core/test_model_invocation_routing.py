from __future__ import annotations

import json
from contextlib import nullcontext
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Never, cast, override
from unittest.mock import Mock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations, ProviderModelBundle
from core.entities.provider_entities import (
    CustomConfiguration,
    HostedSourceProtocolFact,
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    RestrictModel,
    SystemConfiguration,
)
from core.model_invocation_routing import (
    FrozenModelInvocation,
    LegacyModelBinding,
    LegacyModelCredentials,
    ModelInvocationReprepare,
    ModelMigrationProcessing,
    ModelRouteUnavailable,
    ModelRouteUnmapped,
    RoutedModelCredentials,
    SettlementOwner,
    bind_legacy_credentials,
    compatibility_quota_type,
    embedding_dimensions_contract,
    has_compatibility_route,
    managed_credentials,
    redirect_payload,
    routed_credentials,
    settlement_owner,
    validate_invocation_admission,
)
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from core.provider_manager import ProviderManager
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType, ParameterRule, ParameterType
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from models.provider import ProviderType, TenantPreferredModelProvider
from services.entities.model_billing_migration import canonical_hash
from services.model_billing_mapping_service import source_mapping_revision
from tests.helpers.unit.config_override import apply_config_overrides, config_overrides_context
from tests.helpers.unit.model_billing_source_profiles import (
    DAEMON_REVISION,
    EMBEDDING_MODELS,
    EMBEDDING_REVISION,
    GPT55_REVISION,
    SOURCE_PROVIDER,
    embedding_profiles,
    embedding_schemas,
    full_daemon_registry,
    full_embedding_registry,
    full_gpt55_registry,
    gpt55_daemon_schemas,
    gpt55_schemas,
)
from tests.unit_tests.core.test_provider_manager import TENANT_ID, ProviderCase
from tests.unit_tests.core.test_provider_manager import provider_case as provider_case  # noqa: PLC0414

TEST_ENCRYPTED_CONFIG = '{"api_key":"encrypted","endpoint_url":"https://fixture.invalid"}'


class InventoryProviderManager(ProviderManager):
    """Use real provider configuration values at the external discovery boundary."""

    def __init__(self, configurations: ProviderConfigurations) -> None:
        super().__init__(model_runtime=create_plugin_model_runtime(tenant_id=configurations.tenant_id))
        self.configurations = configurations

    @override
    def get_configurations(self, tenant_id: str) -> ProviderConfigurations:
        assert tenant_id == self.configurations.tenant_id
        return self.configurations


@pytest.mark.parametrize("case", ["mixed", "retired_only", "unlisted_missing", "old_revision"])
@pytest.mark.parametrize("eligibility_policy_version", [None, "free-legacy-v1"])
def test_retirement_inventory_contract_with_real_source_configuration(
    monkeypatch: pytest.MonkeyPatch, case: str, eligibility_policy_version: str | None
) -> None:
    from core.model_invocation_routing import migration_inventory
    from tests.unit_tests.services.test_model_billing_mapping_service import mapping, schema

    source = schema()
    names = ["retired"] if case == "retired_only" else ["gpt-4o", "retired"]
    if case == "unlisted_missing":
        names.append("unlisted")
    if case == "old_revision":
        names = ["gpt-4o"]
    system = SystemConfiguration(
        enabled=True,
        current_quota_type=ProviderQuotaType.PAID,
        quota_configurations=[
            QuotaConfiguration(
                quota_type=pool,
                quota_unit=QuotaUnit.CREDITS,
                quota_limit=200,
                quota_used=7,
                is_valid=True,
                restrict_models=[RestrictModel(model=name, model_type=ModelType.LLM) for name in names],
            )
            for pool in (ProviderQuotaType.PAID, ProviderQuotaType.TRIAL)
        ],
    )
    provider = ProviderConfiguration(
        tenant_id="retirement-tenant",
        provider=ProviderEntity(
            provider="langgenius/openai/openai",
            label=I18nObject(en_US="OpenAI"),
            supported_model_types=[ModelType.LLM],
            configurate_methods=[],
            models=[] if case == "retired_only" else [source],
        ),
        preferred_provider_type=ProviderType.SYSTEM,
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=system,
        custom_configuration=CustomConfiguration(provider=None),
        model_settings=[],
    )
    configurations = ProviderConfigurations(tenant_id=provider.tenant_id)
    configurations.configurations[provider.provider.provider] = provider
    manager = InventoryProviderManager(configurations)
    before = provider.model_dump()
    lookups: list[str] = []

    def discover(*, tenant_id: str) -> ProviderManager:
        assert tenant_id == provider.tenant_id
        return manager

    def lookup(_client: PluginModelClient, *args: object, **_kwargs: object) -> None:
        lookups.append(str(args[5]))

    monkeypatch.setattr("core.plugin.impl.model_runtime_factory.create_plugin_provider_manager", discover)
    monkeypatch.setattr(PluginModelClient, "get_model_schema", lookup)
    apply_config_overrides(
        monkeypatch,
        TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps(
            [mapping(source, revision="old"), mapping(source, revision="new")]
        ),
        TOKENER_LEGACY_RETIRED_MODELS_JSON=json.dumps(
            [
                {
                    "schema_version": 1,
                    "mapping_revision": "new",
                    "provider_id": provider.provider.provider,
                    "model_type": "llm",
                    "model": "retired",
                }
            ]
        ),
    )
    if case == "unlisted_missing":
        with pytest.raises(ModelRouteUnmapped):
            migration_inventory(provider.tenant_id, "new", eligibility_policy_version=eligibility_policy_version)
        assert lookups == ["unlisted"]
    else:
        result = migration_inventory(
            provider.tenant_id,
            "old" if case == "old_revision" else "new",
            eligibility_policy_version=eligibility_policy_version,
        )
        assert lookups == []
        if case == "old_revision":
            assert result["inventory_hash"] == canonical_hash(result["models"])
            assert "retired_sources" not in result
            assert "retirement_policy_digest" not in result
        else:
            assert result["model_count"] == (0 if case == "retired_only" else 1)
            assert result["retired_sources"] == [
                {
                    "provider": provider.provider.provider,
                    "model_type": "llm",
                    "model": "retired",
                    "pool_types": ["paid", "trial"],
                }
            ]
            assert result["inventory_hash"] != canonical_hash(result["models"])
    assert provider.model_dump() == before


@pytest.mark.parametrize("eligibility_policy_version", [None, "", "paid-legacy-v1", "free-legacy-v2", "free-legacy-v1"])
@pytest.mark.parametrize("byok_only", [False, True])
def test_empty_inventory_requires_exact_free_policy(
    monkeypatch: pytest.MonkeyPatch, eligibility_policy_version: str | None, byok_only: bool
) -> None:
    from core.model_invocation_routing import migration_inventory
    from tests.unit_tests.services.test_model_billing_mapping_service import mapping, schema

    configurations = ProviderConfigurations(tenant_id="empty-source-tenant")
    if byok_only:
        configurations.configurations["langgenius/openai/openai"] = ProviderConfiguration(
            tenant_id=configurations.tenant_id,
            provider=ProviderEntity(
                provider="langgenius/openai/openai",
                label=I18nObject(en_US="OpenAI"),
                supported_model_types=[ModelType.LLM],
                configurate_methods=[],
                models=[schema()],
            ),
            preferred_provider_type=ProviderType.CUSTOM,
            using_provider_type=ProviderType.CUSTOM,
            system_configuration=SystemConfiguration(enabled=False),
            custom_configuration=CustomConfiguration(provider=None),
            model_settings=[],
        )
    manager = InventoryProviderManager(configurations)

    def discover(*, tenant_id: str) -> ProviderManager:
        assert tenant_id == configurations.tenant_id
        return manager

    monkeypatch.setattr("core.plugin.impl.model_runtime_factory.create_plugin_provider_manager", discover)
    apply_config_overrides(
        monkeypatch,
        TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps([mapping(schema(), revision="free-fixture-v1")]),
        TOKENER_LEGACY_RETIRED_MODELS_JSON="[]",
    )
    before = configurations.model_dump()
    if eligibility_policy_version == "free-legacy-v1":
        result = migration_inventory(
            configurations.tenant_id, "free-fixture-v1", eligibility_policy_version=eligibility_policy_version
        )
        assert result == {
            "inventory_hash": canonical_hash([]),
            "model_mapping_version": "free-fixture-v1",
            "model_count": 0,
            "models": [],
            "source_ownership": {},
        }
    else:
        with pytest.raises(ModelRouteUnmapped):
            migration_inventory(
                configurations.tenant_id, "free-fixture-v1", eligibility_policy_version=eligibility_policy_version
            )
    assert configurations.model_dump() == before


def credential_pin() -> dict[str, str]:
    return {
        "tenant_id": plan().tenant_id,
        "provider_name": "langgenius/tokener/tokener",
        "provider_credential_id": plan().credential_id,
        "credential_fingerprint": plan().expected_credential_fingerprint,
    }


@pytest.mark.parametrize(
    "case",
    [
        "matched",
        "uid_mismatch",
        "catalog_mismatch",
        "partial_negative",
        "custom_override",
        "model_setting",
        "target_missing",
        "parameter_digest",
        "ambiguous",
        "binding_uid_mismatch",
        "binding_missing",
        "binding_duplicate",
        "binding_remote",
        "binding_rpc_error",
        "binding_serverless_default",
        "binding_serverless_opted",
        "binding_serverless_remote_source",
        "binding_local_disallowed",
    ],
)
def test_source_capability_inventory_uses_exact_complete_bound_catalog(
    monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    from core.entities.provider_entities import CustomModelConfiguration, ModelSettings
    from core.model_invocation_routing import migration_inventory
    from core.plugin.entities.plugin import PluginInstallationSource
    from core.plugin.entities.plugin_daemon import PluginModelProviderBinding, PluginModelProviderDeclaration
    from services.model_billing_mapping_service import source_catalog_digest
    from tests.unit_tests.services.test_model_billing_mapping_service import mapping, schema, system
    from tests.unit_tests.services.test_model_billing_source_capability_policy import (
        METHODS,
        PROVIDER,
        TYPES,
        UID,
        declaration,
    )

    models = [schema()]
    restrictions = ["gpt-4o", "absent"]
    if case == "target_missing":
        models.append(schema("unmapped"))
        restrictions.append("unmapped")
    elif case == "ambiguous":
        models.append(schema(model_type=ModelType.TEXT_EMBEDDING))
    original_system = system([RestrictModel(model=name, model_type=ModelType.LLM) for name in restrictions])
    provider = ProviderConfiguration(
        tenant_id="source-capability-tenant",
        provider=PluginModelProviderDeclaration(
            provider=PROVIDER,
            label=I18nObject(en_US="OpenAI"),
            supported_model_types=TYPES,
            configurate_methods=METHODS,
            models=models,
            plugin_unique_identifier=UID.replace("0.4.2", "0.4.3") if case == "uid_mismatch" else UID,
            installation_source=PluginInstallationSource.Marketplace,
        ),
        preferred_provider_type=ProviderType.SYSTEM,
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=original_system,
        custom_configuration=CustomConfiguration(
            provider=None,
            models=[CustomModelConfiguration(model="absent", model_type=ModelType.LLM, credentials=None)]
            if case == "custom_override"
            else [],
        ),
        model_settings=[ModelSettings(model="absent", model_type=ModelType.LLM)] if case == "model_setting" else [],
    )
    configurations = ProviderConfigurations(tenant_id=provider.tenant_id)
    configurations.configurations[PROVIDER] = provider
    manager = InventoryProviderManager(configurations)

    def discover(*, tenant_id: str) -> ProviderManager:
        assert tenant_id == provider.tenant_id
        return manager

    record = declaration()
    if case in {"binding_serverless_opted", "binding_local_disallowed"}:
        record["schema_version"] = 2
        record["allowed_runtime_types"] = ["serverless"]
    record["catalog_digest"] = source_catalog_digest(models, METHODS, TYPES)
    if case == "catalog_mismatch":
        record["catalog_digest"] = "sha256:" + "c" * 64
    elif case == "partial_negative":
        record["unavailable"] = [record["unavailable"][0]]
    route = mapping(schema(), revision="new")
    if case == "parameter_digest":
        route["source_schema_digest"] = "sha256:" + "d" * 64
    apply_config_overrides(
        monkeypatch,
        TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps([route]),
        TOKENER_LEGACY_RETIRED_MODELS_JSON="[]",
        TOKENER_LEGACY_SOURCE_CAPABILITIES_JSON=json.dumps([record]),
    )
    monkeypatch.setattr("core.plugin.impl.model_runtime_factory.create_plugin_provider_manager", discover)
    lookups: list[str] = []

    def lookup(_client: PluginModelClient, *args: object, **_kwargs: object) -> None:
        lookups.append(str(args[5]))

    monkeypatch.setattr(PluginModelClient, "get_model_schema", lookup)
    binding = PluginModelProviderBinding(
        provider="openai",
        installation_id="installation",
        plugin_id="langgenius/openai",
        plugin_unique_identifier=UID.replace("0.4.2", "0.4.3") if case == "binding_uid_mismatch" else UID,
        runtime_type=(
            "serverless" if case.startswith("binding_serverless") else "remote" if case == "binding_remote" else "local"
        ),
        source=(
            PluginInstallationSource.Remote
            if case in {"binding_remote", "binding_serverless_remote_source"}
            else PluginInstallationSource.Marketplace
        ),
        version="0.4.2",
        verified=True,
    )

    def bindings(_client: PluginModelClient, tenant_id: str) -> list[PluginModelProviderBinding]:
        assert tenant_id == provider.tenant_id
        if case == "binding_rpc_error":
            raise RuntimeError("binding RPC failed")
        return [] if case == "binding_missing" else [binding, binding] if case == "binding_duplicate" else [binding]

    monkeypatch.setattr(PluginModelClient, "fetch_model_provider_bindings", bindings)
    before = provider.model_dump()
    if case in {"binding_rpc_error", "binding_duplicate"}:
        with pytest.raises(RuntimeError if case == "binding_rpc_error" else ModelRouteUnavailable):
            migration_inventory(provider.tenant_id, "new")
        assert lookups == []
        assert provider.model_dump() == before
        return
    if case in {"matched", "binding_serverless_opted"}:
        result = migration_inventory(provider.tenant_id, "new")
        assert result["model_count"] == 1
        assert {item["model"] for item in result["models"]} == {"gpt-4o"}
        assert {(item["model_type"], item["model"]) for item in result["unavailable_sources"]} == {
            (kind.value, "absent") for kind in TYPES
        }
        assert result["inventory_hash"] != canonical_hash(result["models"])
        assert result["source_capability_policy_digest"].startswith("sha256:")
        assert result["source_ownership"][PROVIDER]["quotas"] == {"paid": {"unmetered": False}}
        assert lookups == []
    else:
        with pytest.raises(ModelRouteUnmapped):
            migration_inventory(provider.tenant_id, "new")
        if case in {
            "uid_mismatch",
            "catalog_mismatch",
            "partial_negative",
            "custom_override",
            "model_setting",
            "binding_uid_mismatch",
            "binding_missing",
            "binding_remote",
            "binding_serverless_default",
            "binding_serverless_remote_source",
            "binding_local_disallowed",
        }:
            assert lookups == ["absent", "absent"]
    assert provider.model_dump() == before


@pytest.mark.parametrize("case", ["matched", "host_override", "uid_mismatch", "catalog_mismatch", "eligible_unmapped"])
def test_runtime_source_inventory_audits_real_reason_without_mutating_custom_configuration(
    monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    from core.entities.provider_entities import CustomModelConfiguration, CustomProviderConfiguration
    from core.model_invocation_routing import migration_inventory
    from core.plugin.entities.plugin import PluginInstallationSource
    from core.plugin.entities.plugin_daemon import PluginModelProviderBinding, PluginModelProviderDeclaration
    from tests.unit_tests.services.test_model_billing_mapping_service import mapping, schema, section, system
    from tests.unit_tests.services.test_model_billing_source_capability_policy import (
        LONG_MODEL,
        METHODS,
        TONGYI_PROVIDER,
        TONGYI_UID,
        TYPES,
        runtime_declaration,
    )

    models = [schema(), schema(LONG_MODEL)]
    if case == "eligible_unmapped":
        models.append(schema("qwen-unmapped"))
    original_system = system([RestrictModel(model=item.model, model_type=item.model_type) for item in models])
    original_system.credentials = {"use_international_endpoint": "true", "dashscope_api_key": "system-test-key"}
    if case == "host_override":
        original_system.credentials["api_host"] = "workspace.cn-beijing.maas.aliyuncs.com"
    uid = TONGYI_UID.replace("0.2.26", "0.2.27") if case == "uid_mismatch" else TONGYI_UID
    provider = ProviderConfiguration(
        tenant_id="runtime-source-capability-tenant",
        provider=PluginModelProviderDeclaration(
            provider=TONGYI_PROVIDER,
            label=I18nObject(en_US="Tongyi"),
            supported_model_types=TYPES,
            configurate_methods=METHODS,
            models=models,
            plugin_unique_identifier=uid,
            installation_source=PluginInstallationSource.Marketplace,
        ),
        preferred_provider_type=ProviderType.CUSTOM,
        using_provider_type=ProviderType.CUSTOM,
        system_configuration=original_system,
        custom_configuration=CustomConfiguration(
            provider=CustomProviderConfiguration(
                credentials={"dashscope_api_key": "byok-test-key", "api_host": "dashscope.aliyuncs.com"}
            ),
            models=[CustomModelConfiguration(model=LONG_MODEL, model_type=ModelType.LLM, credentials=None)],
        ),
        model_settings=[],
    )
    configurations = ProviderConfigurations(tenant_id=provider.tenant_id)
    configurations.configurations[TONGYI_PROVIDER] = provider
    manager = InventoryProviderManager(configurations)

    def discover(*, tenant_id: str) -> ProviderManager:
        assert tenant_id == provider.tenant_id
        return manager

    def bindings(_client: PluginModelClient, tenant_id: str) -> list[PluginModelProviderBinding]:
        assert tenant_id == provider.tenant_id
        return [
            PluginModelProviderBinding(
                provider="tongyi",
                installation_id="runtime-source-installation",
                plugin_id="langgenius/tongyi",
                plugin_unique_identifier=uid,
                runtime_type="local",
                source=PluginInstallationSource.Marketplace,
                version="0.2.26",
                verified=True,
            )
        ]

    def forbidden_lookup(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("The positive source catalog must not be reported as schema=None")

    record = runtime_declaration(models)
    if case == "catalog_mismatch":
        record["catalog_digest"] = "sha256:" + "f" * 64
    route = mapping(schema(), revision="new")
    section(route, "source")["provider_id"] = TONGYI_PROVIDER
    apply_config_overrides(
        monkeypatch,
        TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps([route]),
        TOKENER_LEGACY_RETIRED_MODELS_JSON="[]",
        TOKENER_LEGACY_SOURCE_CAPABILITIES_JSON=json.dumps([record]),
    )
    monkeypatch.setattr("core.plugin.impl.model_runtime_factory.create_plugin_provider_manager", discover)
    monkeypatch.setattr(PluginModelClient, "fetch_model_provider_bindings", bindings)
    monkeypatch.setattr(PluginModelClient, "get_model_schema", forbidden_lookup)
    before = provider.model_dump()
    if case == "matched":
        result = migration_inventory(provider.tenant_id, "new")
        assert [item["model"] for item in result["models"]] == ["gpt-4o"]
        assert result["unavailable_sources"] == [
            {
                "provider": TONGYI_PROVIDER,
                "plugin_unique_identifier": TONGYI_UID,
                "model_type": "llm",
                "model": LONG_MODEL,
                "pool_types": ["paid"],
                "reason": "source_runtime_unavailable",
                "proof_id": record["unavailable"][0]["proof_id"],
            }
        ]
    else:
        with pytest.raises(ModelRouteUnmapped):
            migration_inventory(provider.tenant_id, "new")
    assert provider.model_dump() == before
    assert provider.using_provider_type == ProviderType.CUSTOM


def plan() -> FrozenModelInvocation:
    return replace(
        FrozenModelInvocation(
            tenant_id="11111111-1111-4111-8111-111111111111",
            route_id="22222222-2222-4222-8222-222222222222",
            logical_provider="langgenius/openai/openai",
            logical_model="gpt-4o",
            model_type=ModelType.LLM,
            route_epoch=3,
            mapping_revision="fixture-v1",
            credential_id="33333333-3333-4333-8333-333333333333",
            expected_credential_fingerprint=canonical_hash({"encrypted_config": TEST_ENCRYPTED_CONFIG}),
            plugin_unique_identifier="langgenius/tokener:0.1.3@fixture",
            target_model="fixture-target",
            operations=("model/schema", "llm/invoke", "llm/num_tokens"),
        ),
    )


def configuration(
    pool: ProviderQuotaType = ProviderQuotaType.PAID,
    unit: QuotaUnit = QuotaUnit.CREDITS,
    limit: int = 100,
    provider_type: ProviderType = ProviderType.SYSTEM,
) -> ProviderConfiguration:
    from tests.unit_tests.services.test_model_billing_mapping_service import schema

    return ProviderConfiguration.model_construct(
        tenant_id=plan().tenant_id,
        provider=ProviderEntity.model_construct(provider="langgenius/openai/openai", models=[schema()]),
        using_provider_type=provider_type,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=pool,
            quota_configurations=[
                QuotaConfiguration(
                    quota_type=pool,
                    quota_unit=unit,
                    quota_limit=limit,
                    quota_used=100,
                    is_valid=False,
                    restrict_models=[RestrictModel(model="gpt-4o", model_type=ModelType.LLM)],
                )
            ],
        ),
    )


@pytest.mark.parametrize(
    ("pool", "unit", "limit", "provider_type", "expected"),
    [
        (ProviderQuotaType.PAID, QuotaUnit.CREDITS, 100, ProviderType.SYSTEM, SettlementOwner.SHARED_CREDIT_POOL),
        (ProviderQuotaType.TRIAL, QuotaUnit.TIMES, 100, ProviderType.SYSTEM, SettlementOwner.SHARED_CREDIT_POOL),
        (ProviderQuotaType.PAID, QuotaUnit.TIMES, 100, ProviderType.SYSTEM, SettlementOwner.SHARED_CREDIT_POOL),
        (ProviderQuotaType.FREE, QuotaUnit.TIMES, 100, ProviderType.SYSTEM, SettlementOwner.PROVIDER_FREE),
        (ProviderQuotaType.TRIAL, QuotaUnit.CREDITS, -1, ProviderType.SYSTEM, SettlementOwner.UNMETERED),
        (ProviderQuotaType.PAID, QuotaUnit.CREDITS, 100, ProviderType.CUSTOM, SettlementOwner.CUSTOM),
    ],
)
def test_owner_matches_real_reservation_policy(
    pool: ProviderQuotaType, unit: QuotaUnit, limit: int, provider_type: ProviderType, expected: SettlementOwner
) -> None:
    config = configuration(pool, unit, limit, provider_type)
    assert settlement_owner(config.system_configuration, config.using_provider_type) == expected


@pytest.mark.parametrize("phase", ["claimed", "granting", "activating", "blocked"])
def test_cutover_blocks_before_any_key_lookup(mocker: MockerFixture, phase: str) -> None:
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state",
        return_value={"phase": phase, "blocked_from": "claimed"},
    )
    keys = mocker.patch("core.model_invocation_routing.managed_credentials")
    with pytest.raises(ModelMigrationProcessing):
        routed_credentials(configuration(), ModelType.LLM, "gpt-4o")
    keys.assert_not_called()


@pytest.mark.parametrize(
    "config",
    [
        configuration(provider_type=ProviderType.CUSTOM),
        configuration(pool=ProviderQuotaType.FREE),
        configuration(limit=-1),
    ],
)
def test_byok_free_unmetered_do_not_query_migration_or_redirect(
    mocker: MockerFixture, config: ProviderConfiguration
) -> None:
    state = mocker.patch("core.model_invocation_routing.migration_routing_state")
    assert routed_credentials(config, ModelType.LLM, "gpt-4o") is None
    state.assert_not_called()


def test_active_missing_mapping_fails_without_legacy_fallback(mocker: MockerFixture) -> None:
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state",
        return_value={"phase": "active", "persisted_model_billing_source": "tokener"},
    )
    mocker.patch("core.model_invocation_routing.model_mappings", return_value={})
    with pytest.raises(ModelRouteUnmapped):
        routed_credentials(configuration(), ModelType.LLM, "gpt-4o")


def test_cancelled_after_claim_never_reopens_legacy() -> None:
    assert has_compatibility_route({"phase": "cancelled", "claimed_at": "2026-09-28T00:00:00Z"})
    assert not has_compatibility_route({"phase": "cancelled"})


def test_credential_capability_is_non_secret_and_survives_in_process_copy() -> None:
    credentials = RoutedModelCredentials(plan())
    assert credentials
    assert json.dumps(credentials) == "{}"
    assert "fixture-target" not in repr(credentials)
    assert deepcopy(credentials).plan == credentials.plan
    assert credentials.copy().plan == credentials.plan


def test_target_key_is_loaded_from_exact_tenant_and_managed_id(mocker: MockerFixture) -> None:
    fake_session = Mock()
    fake_session.scalar.return_value = SimpleNamespace(encrypted_config=TEST_ENCRYPTED_CONFIG)
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(fake_session))
    policy = mocker.patch("core.helper.credential_utils.runtime_check_credential_policy_compliance")
    decrypt = mocker.patch("core.helper.encrypter.decrypt_token", return_value="TEST_TARGET_KEY")
    values = managed_credentials(plan())
    statement = fake_session.scalar.call_args.args[0].compile()
    assert set(statement.params.values()) == {plan().tenant_id, plan().credential_id, "langgenius/tokener/tokener"}
    decrypt.assert_called_once_with(tenant_id=plan().tenant_id, token="encrypted")
    assert policy.call_args.kwargs["credential_id"] == plan().credential_id
    assert values["api_key"] == "TEST_TARGET_KEY"


def test_missing_managed_id_does_not_use_active_byok(mocker: MockerFixture) -> None:
    fake_session = Mock()
    fake_session.scalar.return_value = None
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(fake_session))
    with pytest.raises(ModelRouteUnavailable):
        managed_credentials(plan())


def test_wire_is_versioned_and_only_target_gets_key(mocker: MockerFixture) -> None:
    mocker.patch("core.model_invocation_routing.managed_credentials", return_value={"api_key": "TEST_TARGET_KEY"})
    payload = PluginModelClient._dispatch_payload(
        user_id=None,
        data={
            "provider": "openai",
            "model": "gpt-4o",
            "model_type": "llm",
            "stream": True,
            "credentials": RoutedModelCredentials(plan()),
            "prompt_messages": [],
        },
    )
    assert payload["data"]["credentials"] == {}
    assert payload["redirect"]["target"]["credentials"] == {"api_key": "TEST_TARGET_KEY"}
    client = PluginModelClient()
    url, _, body, _, _ = client._prepare_request(
        f"plugin/{plan().tenant_id}/dispatch/llm/invoke",
        {"Content-Type": "application/json", "X-Plugin-ID": "langgenius/openai"},
        payload,
        None,
        None,
    )
    assert url.endswith(f"plugin/{plan().tenant_id}/dispatch/redirect/v1/llm/invoke")
    assert json.loads(body)["redirect"]["target"]["model"] == "fixture-target"
    assert "_route_context" not in json.loads(body)
    with pytest.raises(ValueError, match="binding mismatch"):
        client._prepare_request("plugin/other-tenant/dispatch/llm/invoke", {}, payload, None, None)
    with pytest.raises(ValueError, match="binding mismatch"):
        client._prepare_request(f"plugin/{plan().tenant_id}/dispatch/model/polling/start", {}, payload, None, None)


def test_ordinary_user_dict_cannot_forge_redirect() -> None:
    payload = PluginModelClient._dispatch_payload(
        user_id="user",
        data={
            "credentials": {"api_key": "BYOK", "redirect": {"target": "forged"}},
        },
    )
    assert "redirect" not in payload


def test_route_rejects_different_model_before_loading_key(mocker: MockerFixture) -> None:
    load = mocker.patch("core.model_invocation_routing.managed_credentials")
    with pytest.raises(ModelRouteUnavailable):
        redirect_payload(plan(), {"model": "wrong", "model_type": "llm"})
    load.assert_not_called()


def test_schema_identity_changes_with_epoch_mapping_and_installed_package() -> None:
    baseline = plan().cache_identity
    assert replace(plan(), route_id="different-call").cache_identity == baseline
    assert replace(plan(), route_epoch=4).cache_identity != baseline
    assert replace(plan(), mapping_revision="v2").cache_identity != baseline
    assert replace(plan(), plugin_unique_identifier="other-package").cache_identity != baseline
    assert replace(plan(), expected_credential_fingerprint="sha256:" + "a" * 64).cache_identity != baseline


def test_tokener_quota_path_does_not_reserve_legacy(mocker: MockerFixture) -> None:
    from core.app.llm.quota import reserve_model_quota_for_model

    reserve = mocker.patch("services.credit_pool_service.CreditPoolService.reserve_credits")
    reservation = reserve_model_quota_for_model(
        tenant_id=plan().tenant_id,
        provider="openai",
        model_type=ModelType.LLM,
        model="gpt-4o",
        provider_configuration=configuration(),
        invocation_credentials=RoutedModelCredentials(plan()),
    )
    reservation.commit()
    reservation.release()
    assert reservation.settlement_backend == "tokener"
    assert reservation.commit_before_delivery
    reserve.assert_not_called()


def legacy_credentials() -> LegacyModelCredentials:
    return LegacyModelCredentials(
        {"api_key": "TEST_LEGACY_KEY"},
        LegacyModelBinding(
            tenant_id=plan().tenant_id,
            logical_provider=plan().logical_provider,
            logical_model=plan().logical_model,
            model_type=ModelType.LLM,
            route_epoch=0,
        ),
    )


@pytest.mark.parametrize("phase", ["claimed", "granting", "active"])
def test_legacy_schema_binding_cannot_cross_cutover_before_reservation(mocker: MockerFixture, phase: str) -> None:
    credentials = legacy_credentials()
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state", return_value={"phase": phase, "route_epoch": 1}
    )
    with pytest.raises(ModelInvocationReprepare):
        validate_invocation_admission(
            credentials, tenant_id=plan().tenant_id, provider="openai", model_type=ModelType.LLM, model="gpt-4o"
        )
    assert credentials["api_key"] == "TEST_LEGACY_KEY"


def test_prepared_tokener_epoch_change_requires_new_schema(mocker: MockerFixture) -> None:
    credentials = RoutedModelCredentials(plan())
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state",
        return_value={
            "phase": "active",
            "route_epoch": 4,
            "model_mapping_version": "fixture-v1",
        },
    )
    with pytest.raises(ModelInvocationReprepare):
        validate_invocation_admission(
            credentials, tenant_id=plan().tenant_id, provider="openai", model_type=ModelType.LLM, model="gpt-4o"
        )
    assert credentials.plan.route_epoch == 3


def test_legacy_binding_rechecks_race_when_constructing_credentials(mocker: MockerFixture) -> None:
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state", return_value={"phase": "claimed", "route_epoch": 1}
    )
    with pytest.raises(ModelInvocationReprepare):
        bind_legacy_credentials(configuration(), ModelType.LLM, "gpt-4o", {"api_key": "OLD"})


def test_original_unmetered_pool_is_not_replaced_by_another_finite_pool() -> None:
    quotas = [
        QuotaConfiguration(
            quota_type=ProviderQuotaType.PAID, quota_unit=QuotaUnit.CREDITS, quota_limit=0, quota_used=0, is_valid=False
        ),
        QuotaConfiguration(
            quota_type=ProviderQuotaType.TRIAL,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=100,
            quota_used=0,
            is_valid=True,
        ),
    ]
    selected = compatibility_quota_type(
        "openai",
        quotas,
        {
            "source_ownership": {
                "langgenius/openai/openai": {
                    "current_quota_type": "trial",
                    "quotas": {
                        "paid": {"unmetered": False},
                        "trial": {"unmetered": True},
                    },
                },
            }
        },
    )
    assert selected == ProviderQuotaType.TRIAL
    assert quotas[1].quota_limit == -1
    assert (
        settlement_owner(
            SystemConfiguration(enabled=True, current_quota_type=selected, quota_configurations=quotas),
            ProviderType.SYSTEM,
        )
        == SettlementOwner.UNMETERED
    )


def test_missing_source_ownership_never_guesses_pool() -> None:
    with pytest.raises(ModelRouteUnavailable):
        compatibility_quota_type("openai", configuration().system_configuration.quota_configurations, {})


@pytest.mark.parametrize(
    ("free_used", "expected"), [(1, SettlementOwner.PROVIDER_FREE), (10, SettlementOwner.SHARED_CREDIT_POOL)]
)
def test_v2_ownership_uses_live_free_allowance_then_the_prevalidated_managed_fallback(
    free_used: int,
    expected: SettlementOwner,
) -> None:
    quotas = [
        QuotaConfiguration(
            quota_type=kind,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=limit,
            quota_used=used,
            is_valid=True,
            restrict_models=[RestrictModel(model="gpt-4o", model_type=ModelType.LLM)],
        )
        for kind, limit, used in (
            (ProviderQuotaType.PAID, 100, 5),
            (ProviderQuotaType.FREE, 10, free_used),
            (ProviderQuotaType.TRIAL, 20, 3),
        )
    ]
    stable = {
        "schema_version": 2,
        "shared_pool_types": ["paid", "trial"],
        "quotas": {kind: {"unit": "credits", "unmetered": False} for kind in ("paid", "free", "trial")},
    }
    system = SystemConfiguration(enabled=True, quota_configurations=quotas)
    system.current_quota_type = compatibility_quota_type(
        "openai", system.quota_configurations, {"source_ownership": {"langgenius/openai/openai": stable}}
    )
    assert settlement_owner(system, ProviderType.SYSTEM) == expected
    assert system.quota_configurations[0].quota_limit == 0  # Metadata closure, not an issued quota/grant.
    assert system.quota_configurations[1].quota_used == free_used
    assert system.quota_configurations[1].quota_limit == 10


def test_v2_shared_fallback_keeps_processing_pause_and_never_forces_byok_or_unlimited(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import model_invocation_routing as module

    config = configuration()
    stable = {
        "schema_version": 2,
        "shared_pool_types": ["paid"],
        "quotas": {"paid": {"unit": "credits", "unmetered": False}, "trial": {"unit": "credits", "unmetered": True}},
    }
    config.system_configuration.quota_configurations.append(
        QuotaConfiguration(
            quota_type=ProviderQuotaType.TRIAL,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=-1,
            quota_used=700,
            is_valid=True,
        )
    )
    config.system_configuration.current_quota_type = compatibility_quota_type(
        "openai",
        config.system_configuration.quota_configurations,
        {"source_ownership": {"langgenius/openai/openai": stable}},
    )
    assert config.system_configuration.current_quota_type == ProviderQuotaType.TRIAL
    assert settlement_owner(config.system_configuration, ProviderType.SYSTEM) == SettlementOwner.UNMETERED
    assert routed_credentials(config, ModelType.LLM, "gpt-4o") is None
    config.using_provider_type = ProviderType.CUSTOM
    assert routed_credentials(config, ModelType.LLM, "gpt-4o") is None
    config = configuration()
    shared_only = {
        "schema_version": 2,
        "shared_pool_types": ["paid"],
        "quotas": {"paid": {"unit": "credits", "unmetered": False}},
    }
    config.system_configuration.current_quota_type = compatibility_quota_type(
        "openai",
        config.system_configuration.quota_configurations,
        {"source_ownership": {"langgenius/openai/openai": shared_only}},
    )
    monkeypatch.setattr(module, "migration_routing_state", lambda _tenant: {"phase": "claimed", "route_epoch": 1})
    with pytest.raises(ModelMigrationProcessing):
        routed_credentials(config, ModelType.LLM, "gpt-4o")


def test_v2_free_exhaustion_builds_original_provider_redirect_after_publication(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from core import model_invocation_routing as module
    from models.account import Tenant
    from models.provider import ProviderCredential
    from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
    from tests.unit_tests.services.test_model_billing_mapping_service import mapping, schema

    config = configuration()
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="v2 fallback")
        tenant.id = config.tenant_id
        session.add(tenant)
        credential = ProviderCredential(
            tenant_id=tenant.id,
            provider_name="langgenius/tokener/tokener",
            credential_name="managed",
            encrypted_config=TEST_ENCRYPTED_CONFIG,
        )
        session.add(credential)
        session.flush()
        session.add(
            TenantTokenerIntegration(
                tenant_id=tenant.id,
                status=TenantTokenerIntegrationStatus.READY,
                provider_credential_id=credential.id,
                plugin_unique_identifier="langgenius/tokener:9.0.0@" + "a" * 64,
            )
        )
    state = {
        "phase": "active",
        "route_epoch": 4,
        "model_mapping_version": "stable-v2",
        "persisted_model_billing_source": "tokener",
        "source_ownership": {
            "langgenius/openai/openai": {
                "schema_version": 2,
                "shared_pool_types": ["paid"],
                "quotas": {
                    "paid": {"unit": "credits", "unmetered": False},
                    "free": {"unit": "credits", "unmetered": False},
                },
            }
        },
        "preparation": {
            "tenant_id": tenant.id,
            "provider_name": "langgenius/tokener/tokener",
            "provider_credential_id": credential.id,
            "credential_fingerprint": canonical_hash({"encrypted_config": TEST_ENCRYPTED_CONFIG}),
        },
    }
    config.system_configuration.quota_configurations.append(
        QuotaConfiguration(
            quota_type=ProviderQuotaType.FREE,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=10,
            quota_used=10,
            is_valid=False,
        )
    )
    config.system_configuration.current_quota_type = compatibility_quota_type(
        "openai", config.system_configuration.quota_configurations, state
    )
    monkeypatch.setattr(module, "migration_routing_state", lambda _tenant: state)
    monkeypatch.setattr(module.session_factory, "create_session", sqlite_session_factory)
    monkeypatch.setattr(
        module.dify_config,
        "TOKENER_LEGACY_MODEL_MAPPING_JSON",
        json.dumps([mapping(schema(), revision="stable-v2", target="managed-fallback")]),
    )
    credentials = routed_credentials(config, ModelType.LLM, "gpt-4o")
    assert isinstance(credentials, RoutedModelCredentials)
    assert credentials.plan.logical_provider == "langgenius/openai/openai"
    assert credentials.plan.logical_model == "gpt-4o"
    assert credentials.plan.target_model == "managed-fallback"


@pytest.mark.parametrize(
    ("paid_used", "trial_used", "selected", "valid"),
    [
        (1, 0, ProviderQuotaType.PAID, True),
        (100, 4, ProviderQuotaType.TRIAL, True),
        (100, 20, ProviderQuotaType.PAID, False),
    ],
)
def test_v2_finite_tokens_consumption_and_exhaustion_never_create_managed_payment_authority(
    paid_used: int,
    trial_used: int,
    selected: ProviderQuotaType,
    valid: bool,
) -> None:
    config = configuration(unit=QuotaUnit.TOKENS)
    config.system_configuration.quota_configurations = [
        QuotaConfiguration(
            quota_type=kind, quota_unit=QuotaUnit.TOKENS, quota_limit=limit, quota_used=used, is_valid=limit > used
        )
        for kind, limit, used in ((ProviderQuotaType.PAID, 100, paid_used), (ProviderQuotaType.TRIAL, 20, trial_used))
    ]
    stable = {
        "schema_version": 2,
        "shared_pool_types": list[str](),
        "quotas": {"paid": {"unit": "tokens", "unmetered": False}, "trial": {"unit": "tokens", "unmetered": False}},
    }
    system = config.system_configuration
    system.current_quota_type = compatibility_quota_type(
        "openai", system.quota_configurations, {"source_ownership": {"langgenius/openai/openai": stable}}
    )
    assert system.current_quota_type == selected
    assert next(quota for quota in system.quota_configurations if quota.quota_type == selected).is_valid is valid
    assert [(quota.quota_limit, quota.quota_used) for quota in system.quota_configurations] == [
        (100, paid_used),
        (20, trial_used),
    ]
    assert settlement_owner(system, ProviderType.SYSTEM) == SettlementOwner.UNMETERED
    assert routed_credentials(config, ModelType.LLM, "gpt-4o") is None


def test_free_provider_ownership_survives_cutover() -> None:
    quota = configuration(pool=ProviderQuotaType.FREE).system_configuration.quota_configurations[0]
    quota.is_valid = True
    quota.quota_used = 5
    assert (
        compatibility_quota_type(
            "openai",
            [quota],
            {
                "source_ownership": {
                    "langgenius/openai/openai": {
                        "current_quota_type": "free",
                        "quotas": {"free": {"unmetered": False}},
                    },
                }
            },
        )
        == ProviderQuotaType.FREE
    )
    assert quota.quota_used == 5
    assert quota.quota_limit == 100


def test_plan_provider_is_bound_before_key_lookup(mocker: MockerFixture) -> None:
    load = mocker.patch("core.model_invocation_routing.managed_credentials")
    with pytest.raises(ModelRouteUnavailable):
        redirect_payload(plan(), {"provider": "azure_openai", "model": "gpt-4o", "model_type": "llm"})
    load.assert_not_called()


def test_transport_rejects_another_plugin_with_same_provider_name(mocker: MockerFixture) -> None:
    mocker.patch("core.model_invocation_routing.managed_credentials", return_value={"api_key": "TEST_TARGET_KEY"})
    payload = PluginModelClient._dispatch_payload(
        user_id="user",
        data={
            "provider": "openai",
            "model": "gpt-4o",
            "model_type": "llm",
            "credentials": RoutedModelCredentials(plan()),
        },
    )
    with pytest.raises(ValueError, match="provider binding"):
        PluginModelClient()._prepare_request(
            f"plugin/{plan().tenant_id}/dispatch/llm/invoke", {"X-Plugin-ID": "other/openai"}, payload, None, None
        )


@pytest.mark.parametrize("credentials", [legacy_credentials(), RoutedModelCredentials(plan())])
def test_pydantic_internal_model_config_preserves_only_trusted_binding(
    credentials: LegacyModelCredentials | RoutedModelCredentials,
) -> None:
    from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity

    calls: list[dict[str, object]] = []

    def validate(value: object, _outer_location: str | int | None = None, /) -> dict[str, object]:
        assert isinstance(value, dict)
        values = cast(dict[str, object], value)
        calls.append(values)
        return dict(values)

    assert ModelConfigWithCredentialsEntity.preserve_trusted_invocation_binding(credentials, validate) is credentials
    assert not calls
    plain = {"api_key": "BYOK", "plan": "untrusted"}
    assert type(ModelConfigWithCredentialsEntity.preserve_trusted_invocation_binding(plain, validate)) is dict
    assert calls == [plain]


def test_direct_factory_uses_system_quota_admission(mocker: MockerFixture) -> None:
    from core.model_manager import ModelInstance, QuotaManagedModelInstance, create_model_instance

    bundle = ProviderModelBundle.model_construct(
        configuration=configuration(), model_type_instance=Mock(model_type=ModelType.LLM)
    )
    mocker.patch.object(ModelInstance, "_get_load_balancing_manager", return_value=None)
    instance = create_model_instance(bundle, "gpt-4o", credentials=legacy_credentials())
    assert isinstance(instance, QuotaManagedModelInstance)
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state", return_value={"phase": "active", "route_epoch": 1}
    )
    reserve = mocker.patch("core.app.llm.quota.reserve_model_quota_for_model")
    with pytest.raises(ModelInvocationReprepare):
        instance.reserve_quota()
    reserve.assert_not_called()


def test_already_reserved_legacy_call_settles_original_backend_after_cutover(mocker: MockerFixture) -> None:
    from core.app.llm.quota import ModelQuotaReservation

    reservation_owner = Mock()
    reservation = ModelQuotaReservation(
        tenant_id=plan().tenant_id,
        provider="openai",
        model_type=ModelType.LLM,
        model="gpt-4o",
        provider_configuration=configuration(),
        credit_pool_reservation=reservation_owner,
    )
    state = mocker.patch(
        "core.model_invocation_routing.migration_routing_state", return_value={"phase": "active", "route_epoch": 1}
    )
    reservation.commit()
    reservation.release()
    reservation_owner.commit.assert_called_once()
    reservation_owner.release.assert_not_called()
    state.assert_not_called()


def test_embedding_compatibility_uses_real_parameter_rules() -> None:
    rule = ParameterRule(
        name="dimensions",
        label=I18nObject(en_US="Dimensions"),
        type=ParameterType.INT,
        default=1536,
        min=1,
        max=1536,
        options=[],
    )
    digest = embedding_dimensions_contract(AIModelEntity.model_construct(parameter_rules=[rule]))
    assert digest.startswith("sha256:")
    rule.default = 3072
    assert embedding_dimensions_contract(AIModelEntity.model_construct(parameter_rules=[rule])) != digest
    assert embedding_dimensions_contract(AIModelEntity.model_construct(parameter_rules=[])) == "fixed_by_model_fixture"


def test_routed_schema_keeps_logical_model_identity(mocker: MockerFixture) -> None:
    from core.plugin.impl.model_runtime import PluginModelRuntime

    client = Mock()
    schema = Mock()
    schema.model = "fixture-target"
    logical_schema = Mock()
    schema.model_copy.return_value = logical_schema
    client.get_model_schema.return_value = schema
    mocker.patch("core.plugin.impl.model_runtime.redis_client.get", return_value=None)
    mocker.patch("core.plugin.impl.model_runtime.redis_client.setex")
    runtime = PluginModelRuntime(plan().tenant_id, None, client, Mock())
    result = runtime.get_model_schema(
        provider=plan().logical_provider,
        model_type=ModelType.LLM,
        model="gpt-4o",
        credentials=RoutedModelCredentials(plan()),
    )
    assert result is logical_schema
    schema.model_copy.assert_called_once_with(update={"model": "gpt-4o"})
    assert schema.model == "fixture-target"


@pytest.mark.parametrize("pin_source", ["preparation", "provisioned_binding"])
@pytest.mark.parametrize("edited", [False, True])
@pytest.mark.parametrize("empty_sources", [False, True])
def test_readiness_uses_redirect_and_pins_installed_version(
    mocker: MockerFixture, pin_source: str, edited: bool, empty_sources: bool
) -> None:
    from core.model_invocation_routing import validate_migration_readiness
    from graphon.model_runtime.entities.model_entities import ModelPropertyKey
    from services.entities.model_billing_mapping import ModelMapping
    from tests.unit_tests.services.test_model_billing_mapping_service import mapping, schema

    inventory: dict[str, object] = {
        "models": []
        if empty_sources
        else [{"provider": plan().logical_provider, "model_type": "llm", "model": "gpt-4o"}],
        "inventory_hash": "fixture",
        "source_ownership": {},
    }
    inventory_call = mocker.patch("core.model_invocation_routing.migration_inventory", return_value=inventory)
    eligibility_policy_version = "free-legacy-v1" if empty_sources else None
    rule = ModelMapping.model_validate(mapping(schema(), revision="fixture-v1", target="fixture-target"))
    registry = mocker.patch(
        "core.model_invocation_routing.model_mappings",
        return_value={(plan().logical_provider, ModelType.LLM, "gpt-4o"): rule},
    )
    session = Mock()
    session.scalar.side_effect = [
        SimpleNamespace(
            provider_credential_id=plan().credential_id, plugin_unique_identifier=plan().plugin_unique_identifier
        ),
        SimpleNamespace(encrypted_config='{"api_key":"changed"}' if edited else TEST_ENCRYPTED_CONFIG),
    ]
    mocker.patch("core.model_invocation_routing.migration_routing_state", return_value={pin_source: credential_pin()})
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(session))
    client = Mock()
    client._request_with_plugin_daemon_response.return_value = {
        "protocols": ["model-redirect/v1"],
        "operations": list(plan().operations),
    }
    client.get_model_schema.return_value = SimpleNamespace(
        model_type=ModelType.LLM, model_properties={ModelPropertyKey.MODE: "chat"}
    )
    mocker.patch("core.plugin.impl.model.PluginModelClient", return_value=client)
    if edited:
        with pytest.raises(ModelRouteUnavailable):
            validate_migration_readiness(
                plan().tenant_id, "fixture-v1", eligibility_policy_version=eligibility_policy_version
            )
        registry.assert_called_once_with("fixture-v1")
        client.get_model_schema.assert_not_called()
        return
    readiness = validate_migration_readiness(
        plan().tenant_id, "fixture-v1", eligibility_policy_version=eligibility_policy_version
    )
    inventory_call.assert_called_once_with(
        plan().tenant_id, "fixture-v1", eligibility_policy_version=eligibility_policy_version
    )
    registry.assert_called_once_with("fixture-v1")
    assert readiness["credential_fingerprint"] == plan().expected_credential_fingerprint
    if empty_sources:
        client.get_model_schema.assert_not_called()
        return
    args = client.get_model_schema.call_args.args
    assert args[2:6] == ("langgenius/openai", "openai", "llm", "gpt-4o")
    assert isinstance(args[6], RoutedModelCredentials)
    assert args[6].plan.plugin_unique_identifier == plan().plugin_unique_identifier
    assert args[6].plan.expected_credential_fingerprint == plan().expected_credential_fingerprint


def test_workflow_credential_cache_reprepares_after_cutover(mocker: MockerFixture) -> None:
    from core.app.llm.model_access import DifyCredentialsProvider

    provider = object.__new__(DifyCredentialsProvider)
    provider.tenant_id = plan().tenant_id
    provider.credentials_cache = {("openai", "gpt-4o"): legacy_credentials()}
    provider.provider_model_cache = {("openai", "gpt-4o"): Mock()}
    provider.provider_manager = Mock()
    configuration = Mock()
    configuration.get_current_credentials.return_value = RoutedModelCredentials(plan())
    provider.provider_manager.get_configurations.return_value.get.return_value = configuration
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state",
        return_value={
            "phase": "active",
            "route_epoch": 3,
            "model_mapping_version": "fixture-v1",
        },
    )
    resolved = provider.fetch("openai", "gpt-4o")
    assert isinstance(resolved, RoutedModelCredentials)
    provider.provider_manager.clear_configurations_cache.assert_called_once_with(plan().tenant_id)
    assert resolved.plan.route_epoch == 3


def test_plain_dict_cannot_construct_trusted_route_capability() -> None:
    with pytest.raises(TypeError, match="trusted"):
        RoutedModelCredentials({"plan": "forged"})
    with pytest.raises(TypeError, match="trusted"):
        LegacyModelCredentials({"api_key": "key"}, {"route_epoch": 0})


@pytest.mark.parametrize("case", ["valid", "identity", "wrong_uid", "wrong_rules"])
def test_tts_route_and_preparation_bind_the_same_verified_source_contract(
    mocker: MockerFixture, monkeypatch: pytest.MonkeyPatch, case: str
) -> None:
    from core.model_invocation_routing import migration_inventory
    from core.plugin.entities.plugin import PluginInstallationSource
    from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
    from tests.unit_tests.services.test_model_billing_mapping_service import mapping, system
    from tests.unit_tests.services.test_model_billing_tts_adapter import contract_for, source_schema

    source = source_schema()
    contract = contract_for(source)
    record = mapping(source, revision="voice-v1", target=source.model)
    if case != "identity":
        record["parameter_adapter"] = {
            "id": contract.adapter_id,
            "revision": contract.algorithm_revision,
            "rules_digest": "sha256:" + "f" * 64 if case == "wrong_rules" else contract.rules_digest,
        }
    apply_config_overrides(
        monkeypatch,
        TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps([record]),
        TOKENER_LEGACY_RETIRED_MODELS_JSON="[]",
        TOKENER_LEGACY_SOURCE_CAPABILITIES_JSON="[]",
    )
    provider = ProviderConfiguration(
        tenant_id=plan().tenant_id,
        provider=PluginModelProviderDeclaration(
            provider=contract.source_provider,
            label=I18nObject(en_US="OpenAI"),
            supported_model_types=[ModelType.TTS],
            configurate_methods=[],
            models=[source],
            installation_source=PluginInstallationSource.Marketplace,
            plugin_unique_identifier="wrong" if case == "wrong_uid" else contract.source_plugin_unique_identifier,
        ),
        preferred_provider_type=ProviderType.SYSTEM,
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=system([RestrictModel(model=source.model, model_type=ModelType.TTS)]),
        custom_configuration=CustomConfiguration(provider=None),
        model_settings=[],
    )
    configurations = ProviderConfigurations(tenant_id=provider.tenant_id)
    configurations.configurations[contract.source_provider] = provider
    manager = InventoryProviderManager(configurations)
    mocker.patch("core.plugin.impl.model_runtime_factory.create_plugin_provider_manager", return_value=manager)
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state",
        return_value={
            "phase": "active",
            "persisted_model_billing_source": "tokener",
            "route_epoch": 3,
            "model_mapping_version": "voice-v1",
            "preparation": credential_pin(),
            "source_ownership": {},
        },
    )
    session = Mock()
    session.scalar.return_value = SimpleNamespace(
        status="ready",
        provider_credential_id=plan().credential_id,
        plugin_unique_identifier=plan().plugin_unique_identifier,
    )
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(session))
    if case in {"wrong_uid", "wrong_rules"}:
        with pytest.raises(ModelRouteUnmapped):
            migration_inventory(provider.tenant_id, "voice-v1")
        with pytest.raises(ModelRouteUnmapped):
            routed_credentials(provider, ModelType.TTS, source.model)
        session.scalar.assert_not_called()
        return
    inventory = migration_inventory(provider.tenant_id, "voice-v1")
    credentials = routed_credentials(provider, ModelType.TTS, source.model)
    assert credentials is not None
    if case == "identity":
        assert credentials.plan.tts_voice_contract is None
        assert "source_adapter_rules_digest" not in inventory["models"][0]
    else:
        assert credentials.plan.tts_voice_contract == contract
        assert inventory["models"][0]["source_adapter_rules_digest"] == contract.rules_digest
        assert credentials.plan.cache_identity != replace(credentials.plan, tts_voice_contract=None).cache_identity


@pytest.mark.parametrize(
    ("index", "case"),
    [
        (index, case)
        for index in range(26)
        for case in [
            "valid",
            "identity",
            "wrong_uid",
            "wrong_rules",
            "wrong_target",
            "byok",
            "native_schema_fallback",
            "binding_missing",
            "binding_mismatch",
            "binding_remote",
            "binding_duplicate",
            "serverless",
            "binding_serverless_mismatch",
            "binding_serverless_remote_source",
            "binding_unknown",
        ]
    ]
    + [
        (index, case)
        for index in (16, 17)
        for case in ("explicit_chat", "explicit_responses", "missing_system_settings")
    ]
    + [(index, case) for index in range(17, 26) for case in ("runtime_schema_drift", "runtime_schema_missing")]
    + [
        (index, case)
        for index in (17, 18, 19, 21, 22, 23, 24, 25)
        for case in ("runtime_target_catalog", "runtime_target_codec")
    ],
)
def test_source_profile_inventory_route_readiness_and_private_marker_use_same_exact_contract(
    monkeypatch: pytest.MonkeyPatch, index: int, case: str
) -> None:
    from sqlalchemy import Table, create_engine, update
    from sqlalchemy.orm import Session

    from core.entities.provider_entities import CustomProviderConfiguration
    from core.model_invocation_routing import migration_inventory, validate_migration_readiness
    from core.plugin.entities.plugin import PluginInstallationSource
    from core.plugin.entities.plugin_daemon import PluginModelProviderBinding, PluginModelProviderDeclaration
    from graphon.model_runtime.entities.model_entities import ModelPropertyKey
    from models.account import Tenant
    from models.provider import ProviderCredential
    from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
    from services.model_billing_anthropic_adapter import ANTHROPIC_SOURCE_PROVIDER
    from services.model_billing_mapping_service import source_parameter_marker
    from tests.unit_tests.services.test_model_billing_anthropic_adapter import (
        contract_for,
        model_mapping,
        peer_binding_index,
        source_schema,
    )
    from tests.unit_tests.services.test_model_billing_mapping_service import mapping, system

    runtime_source_schema: AIModelEntity | None = None
    if index in {16, 17}:
        from services.entities.model_billing_mapping import ModelMapping
        from services.model_billing_openai_chat_adapter import (
            OPENAI_CHAT_SOURCE_PROVIDER,
            build_openai_chat_source_contract,
        )
        from tests.unit_tests.services.test_model_billing_openai_chat_adapter import (
            PROFILE,
            RUNTIME_PROFILE,
            build_inputs,
        )

        source = AIModelEntity.model_validate(
            RUNTIME_PROFILE["source_catalog_schema"] if index == 17 else PROFILE["source_schema"]
        )
        contract = build_openai_chat_source_contract(**build_inputs(runtime=index == 17))
        if index == 17:
            runtime_source_schema = AIModelEntity.model_validate(RUNTIME_PROFILE["source_schema"])
        provider_id = OPENAI_CHAT_SOURCE_PROVIDER
        initial_record = mapping(source, revision="anthropic-profile-v1", target=contract.target_model)
        initial_record["parameter_adapter"] = {
            "id": contract.adapter_id,
            "revision": contract.algorithm_revision,
            "rules_digest": contract.rules_digest,
        }
        record = ModelMapping.model_validate(initial_record).model_dump(mode="json")
    elif index >= 18:
        from services.entities.model_billing_mapping import ModelMapping
        from services.model_billing_anthropic_adapter import build_anthropic_source_contract
        from tests.unit_tests.services.test_model_billing_mapping_service import section

        fixture_root = Path(__file__).resolve().parents[1] / "services/fixtures"
        evidence = json.loads((fixture_root / "model_billing_anthropic_runtime_v2_bindings.json").read_text())[
            "bindings"
        ][index - 18]
        marker = evidence["marker"]
        source = source_schema(8 + index - 18)
        runtime_schemas = json.loads((fixture_root / "model_billing_anthropic_runtime_v2_schemas.json").read_text())[
            "schemas"
        ]
        runtime_source_schema = AIModelEntity.model_validate(runtime_schemas[evidence["source_runtime_schema_digest"]])
        contract = build_anthropic_source_contract(
            adapter_id="anthropic_source_v1",
            adapter_revision="2",
            expected_rules_digest=marker["rules_digest"],
            source_provider=ANTHROPIC_SOURCE_PROVIDER,
            source_model=marker["source_model"],
            source_plugin_unique_identifier=marker["source_plugin_uid"],
            source_schema=source,
            expected_source_schema_digest=marker["source_schema_digest"],
            target_model=evidence["target_model"],
        )
        provider_id = ANTHROPIC_SOURCE_PROVIDER
        initial_record = mapping(source, revision="anthropic-profile-v1", target=contract.target_model)
        section(initial_record, "source")["provider_id"] = provider_id
        initial_record["parameter_adapter"] = {
            "id": contract.adapter_id,
            "revision": contract.algorithm_revision,
            "rules_digest": contract.rules_digest,
        }
        record = ModelMapping.model_validate(initial_record).model_dump(mode="json")
    else:
        source = source_schema(index)
        contract = contract_for(index)
        provider_id = ANTHROPIC_SOURCE_PROVIDER
        record = model_mapping(index).model_dump(mode="json")
    expected_marker = source_parameter_marker(
        contract,
        source_provider=provider_id,
        source_model=source.model,
        model_type=ModelType.LLM,
        target_model=contract.target_model,
    )
    provider_name = provider_id.rsplit("/", 1)[1]
    if case == "identity":
        record["parameter_adapter"]["id"] = "identity_v1"
    elif case == "wrong_rules":
        record["parameter_adapter"]["rules_digest"] = "sha256:" + "f" * 64
    elif case == "wrong_target":
        record["target"]["model"] = "wrong-snapshot"
    apply_config_overrides(
        monkeypatch,
        TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps([record]),
        TOKENER_LEGACY_RETIRED_MODELS_JSON="[]",
        TOKENER_LEGACY_SOURCE_CAPABILITIES_JSON="[]",
    )
    provider = ProviderConfiguration(
        tenant_id=plan().tenant_id,
        provider=PluginModelProviderDeclaration(
            provider=provider_id,
            label=I18nObject(en_US="Anthropic"),
            supported_model_types=[ModelType.LLM],
            configurate_methods=[],
            models=[source],
            installation_source=PluginInstallationSource.Marketplace,
            plugin_unique_identifier="wrong" if case == "wrong_uid" else contract.source_plugin_unique_identifier,
        ),
        preferred_provider_type=ProviderType.CUSTOM if case == "byok" else ProviderType.SYSTEM,
        using_provider_type=ProviderType.CUSTOM if case == "byok" else ProviderType.SYSTEM,
        system_configuration=system([RestrictModel(model=source.model, model_type=ModelType.LLM)]),
        custom_configuration=CustomConfiguration(
            provider=CustomProviderConfiguration(credentials={"anthropic_api_key": "BYOK-TEST-KEY"})
        ),
        model_settings=[],
    )
    if index == 20 and case != "identity":
        # The real short Opus alias is NOT in0339's management catalog. Model
        # availability carries only the actual immutable dynamic RPC schema;
        # migration_inventory must perform the real source lookup, not invent
        # a catalog row or substitute the dated model's declaration.
        provider.provider.models = []
        provider.system_configuration._tokener_source_schemas = (source,)
        provider.system_configuration._tokener_source_plugin_unique_identifier = (
            contract.source_plugin_unique_identifier
        )
    if case == "explicit_chat":
        assert provider.system_configuration.credentials is not None
        provider.system_configuration.credentials["api_protocol"] = "chat"
    elif case == "explicit_responses":
        assert provider.system_configuration.credentials is not None
        provider.system_configuration.credentials["api_protocol"] = "responses"
    elif case == "missing_system_settings":
        provider.system_configuration.credentials = None
    if index in {16, 17} and provider.system_configuration.credentials is not None:
        source_uid = getattr(provider.provider, "plugin_unique_identifier", None)
        assert isinstance(source_uid, str)
        provider.system_configuration._tokener_source_protocol_fact = HostedSourceProtocolFact(
            provider=provider_id,
            plugin_unique_identifier=source_uid,
            catalog_schema_digests=((source.model_type, source.model, contract.source_schema_digest),),
            selector="chat" if case == "explicit_chat" else "responses" if case == "explicit_responses" else "absent",
        )
    configurations = ProviderConfigurations(tenant_id=provider.tenant_id)
    configurations.configurations[provider_id] = provider
    manager = InventoryProviderManager(configurations)

    def discover(*, tenant_id: str) -> ProviderManager:
        assert tenant_id == provider.tenant_id
        return manager

    monkeypatch.setattr("core.plugin.impl.model_runtime_factory.create_plugin_provider_manager", discover)

    def source_bindings(_client: PluginModelClient, tenant_id: str) -> list[PluginModelProviderBinding]:
        assert tenant_id == provider.tenant_id
        if case == "binding_missing":
            return []
        fresh = PluginModelProviderBinding(
            provider=provider_name,
            installation_id="fresh-source-profile-installation",
            plugin_id=provider_id.rsplit("/", 1)[0],
            plugin_unique_identifier=(
                contract.source_plugin_unique_identifier + "changed"
                if case in {"binding_mismatch", "binding_serverless_mismatch"}
                else contract.source_plugin_unique_identifier
            ),
            runtime_type=(
                "serverless"
                if "serverless" in case
                else "remote"
                if case == "binding_remote"
                else "unknown"
                if case == "binding_unknown"
                else "local"
            ),
            source=PluginInstallationSource.Remote
            if case in {"binding_remote", "binding_serverless_remote_source"}
            else PluginInstallationSource.Marketplace,
            version="reviewed-source-fixture",
            verified=True,
        )
        return [fresh, fresh] if case == "binding_duplicate" else [fresh]

    monkeypatch.setattr(PluginModelClient, "fetch_model_provider_bindings", source_bindings)
    source_runtime_reads: list[str] = []

    def actual_source_runtime_schema(
        _client: PluginModelClient, *args: object, **kwargs: object
    ) -> AIModelEntity | None:
        assert runtime_source_schema is not None
        assert args[6] == provider.system_configuration.credentials
        assert not isinstance(args[6], RoutedModelCredentials)
        assert kwargs["plugin_unique_identifier"] == contract.source_plugin_unique_identifier
        source_runtime_reads.append("exact_immutable_original_source_schema")
        if case == "runtime_schema_missing":
            return None
        result = runtime_source_schema.model_copy(deep=True)
        if case == "runtime_schema_drift":
            result.model_properties[ModelPropertyKey.CONTEXT_SIZE] = 42
        return result

    if index >= 17:
        monkeypatch.setattr(PluginModelClient, "get_model_schema", actual_source_runtime_schema)
    state: dict[str, object] = {
        "phase": "active",
        "persisted_model_billing_source": "tokener",
        "route_epoch": 3,
        "model_mapping_version": "anthropic-profile-v1",
        "preparation": credential_pin(),
        "source_ownership": {},
    }
    monkeypatch.setattr("core.model_invocation_routing.migration_routing_state", lambda _tenant_id: state)
    before = provider.model_dump()
    if case in {
        "binding_missing",
        "binding_mismatch",
        "binding_remote",
        "binding_duplicate",
        "binding_serverless_mismatch",
        "binding_serverless_remote_source",
        "binding_unknown",
    }:
        with pytest.raises(ModelRouteUnavailable):
            migration_inventory(provider.tenant_id, "anthropic-profile-v1")
        assert provider.model_dump() == before
        return
    if case in {"wrong_uid", "wrong_rules", "wrong_target", "explicit_responses", "missing_system_settings"}:
        with pytest.raises(ModelRouteUnavailable if case == "wrong_uid" else ModelRouteUnmapped):
            migration_inventory(provider.tenant_id, "anthropic-profile-v1")
        with pytest.raises(ModelRouteUnmapped):
            routed_credentials(provider, ModelType.LLM, source.model)
        assert provider.model_dump() == before
        return
    if case in {"runtime_schema_drift", "runtime_schema_missing"}:
        with pytest.raises(ModelRouteUnmapped):
            migration_inventory(provider.tenant_id, "anthropic-profile-v1")
        assert source_runtime_reads == ["exact_immutable_original_source_schema"]
        assert provider.model_dump() == before
        return
    inventory = migration_inventory(provider.tenant_id, "anthropic-profile-v1")
    if case == "byok":
        assert routed_credentials(provider, ModelType.LLM, source.model) is None
        byok = {"api_key": "BYOK-TEST-KEY", "_dify_source_contract": expected_marker}
        payload = PluginModelClient._dispatch_payload(user_id=None, data={"credentials": byok})
        assert "redirect" not in payload
        assert payload["data"]["credentials"] == byok
        assert provider.model_dump() == before
        return

    # Real ORM models/session/query execution against an isolated in-memory DB;
    # no fake session or production/dev database is used by this unit test.
    engine = create_engine("sqlite://")
    for table in (Tenant.__table__, ProviderCredential.__table__, TenantTokenerIntegration.__table__):
        assert isinstance(table, Table)
        table.create(engine)
    tenant = Tenant(name="source-contract-test")
    tenant.id = provider.tenant_id
    credential = ProviderCredential(
        tenant_id=provider.tenant_id,
        provider_name="langgenius/tokener/tokener",
        credential_name="managed-test",
        encrypted_config=TEST_ENCRYPTED_CONFIG,
    )
    credential.id = plan().credential_id
    with Session(engine) as session:
        session.add_all([tenant, credential])
        session.add(
            TenantTokenerIntegration(
                tenant_id=provider.tenant_id,
                status=TenantTokenerIntegrationStatus.READY,
                provider_credential_id=plan().credential_id,
                plugin_unique_identifier=plan().plugin_unique_identifier,
            )
        )
        session.commit()
    monkeypatch.setattr("core.model_invocation_routing.session_factory.create_session", lambda: Session(engine))
    decrypted: list[str] = []

    def decrypt(*, tenant_id: str, token: str) -> str:
        assert tenant_id == provider.tenant_id
        assert token == "encrypted"
        decrypted.append(token)
        return "MANAGED-TEST-KEY"

    def credential_policy(*, credential_id: str, provider: str, credential_type: object) -> None:
        from core.entities import PluginCredentialType

        assert credential_id == plan().credential_id
        assert provider == "langgenius/tokener/tokener"
        assert credential_type == PluginCredentialType.MODEL

    monkeypatch.setattr("core.helper.encrypter.decrypt_token", decrypt)
    monkeypatch.setattr("core.helper.credential_utils.runtime_check_credential_policy_compliance", credential_policy)
    credentials = routed_credentials(provider, ModelType.LLM, source.model)
    assert credentials is not None
    frozen = credentials.plan
    assert frozen.expected_credential_fingerprint == plan().expected_credential_fingerprint
    if case == "identity":
        assert frozen.source_parameter_contract is None
        assert "source_parameter_contract" not in inventory["models"][0]
    else:
        assert frozen.source_parameter_contract == contract
        assert inventory["models"][0]["source_parameter_contract"] == expected_marker
        if index in {16, 17}:
            assert inventory["models"][0]["source_parameter_settings"] == {
                "api_protocol": "chat" if case == "explicit_chat" else "default_chat"
            }
        assert frozen.cache_identity != replace(frozen, source_parameter_contract=None).cache_identity
        assert (
            frozen.cache_identity
            != replace(
                frozen,
                source_parameter_contract=contract_for(0 if index >= 16 else peer_binding_index(index)),
            ).cache_identity
        )
    payload = PluginModelClient._dispatch_payload(
        user_id=None,
        data={
            "provider": provider_name,
            "model": source.model,
            "model_type": "llm",
            "credentials": credentials,
            "model_parameters": {"_dify_source_contract": {"forged": True}},
        },
    )
    assert payload["data"]["credentials"] == {}
    target = payload["redirect"]["target"]
    assert target["model"] == contract.target_model
    assert target["credentials"]["api_key"] == "MANAGED-TEST-KEY"
    assert (target["credentials"].get("_dify_source_contract")) == (None if case == "identity" else expected_marker)

    def capabilities(_client: PluginModelClient, method: str, path: str, _response_type: object) -> dict[str, object]:
        assert method == "GET"
        assert path.endswith("/redirect/v1/capabilities")
        return {"protocols": ["model-redirect/v1"], "operations": list(frozen.operations)}

    def target_schema(_client: PluginModelClient, *args: object, **_kwargs: object) -> AIModelEntity:
        prepared = args[6]
        if not isinstance(prepared, RoutedModelCredentials) and index >= 17:
            result = actual_source_runtime_schema(_client, *args, **_kwargs)
            assert result is not None
            return result
        assert isinstance(prepared, RoutedModelCredentials)
        assert prepared.plan.source_parameter_contract == frozen.source_parameter_contract
        original_schema = runtime_source_schema if index >= 17 and case != "identity" else source
        assert original_schema is not None
        result = original_schema.model_copy(deep=True, update={"model": contract.target_model})
        if case == "runtime_target_catalog":
            result = source.model_copy(deep=True)
        elif case == "runtime_target_codec":
            if index == 17:
                from tests.unit_tests.services.test_model_billing_openai_chat_adapter import PROFILE

                result = AIModelEntity.model_validate(PROFILE["source_schema"])
            else:
                result = source.model_copy(deep=True)
        if case == "native_schema_fallback":
            result.model_properties[ModelPropertyKey.CONTEXT_SIZE] = 42
        return result

    monkeypatch.setattr(PluginModelClient, "_request_with_plugin_daemon_response", capabilities)
    monkeypatch.setattr(PluginModelClient, "get_model_schema", target_schema)
    if case in {"native_schema_fallback", "runtime_target_catalog", "runtime_target_codec"}:
        with pytest.raises(ModelRouteUnmapped):
            validate_migration_readiness(provider.tenant_id, "anthropic-profile-v1")
        assert provider.model_dump() == before
        engine.dispose()
        return
    readiness = validate_migration_readiness(provider.tenant_id, "anthropic-profile-v1")
    assert readiness["inventory_hash"] == inventory["inventory_hash"]
    assert readiness["credential_fingerprint"] == frozen.expected_credential_fingerprint
    assert provider.model_dump() == before
    if index >= 17 and case != "identity":
        assert source_runtime_reads
        assert inventory["models"][0]["source_runtime_schema_digest"] == contract.source_runtime_schema_digest
    with Session(engine) as session:
        session.execute(
            update(ProviderCredential)
            .where(ProviderCredential.tenant_id == provider.tenant_id, ProviderCredential.id == frozen.credential_id)
            .values(encrypted_config='{"api_key":"EDITED-CIPHERTEXT"}')
        )
        session.commit()
    decrypt_count = len(decrypted)
    with pytest.raises(ModelRouteUnavailable):
        redirect_payload(frozen, {"provider": provider_name, "model": source.model, "model_type": "llm"})
    assert len(decrypted) == decrypt_count
    engine.dispose()


def test_invalid_frozen_source_profile_fails_before_managed_key_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.unit_tests.services.test_model_billing_anthropic_adapter import contract_for

    contract = contract_for()
    frozen = replace(
        plan(),
        logical_provider="langgenius/anthropic/anthropic",
        logical_model=contract.source_model,
        target_model=contract.target_model,
        source_parameter_contract=replace(contract, rules_digest="sha256:" + "f" * 64),
    )

    def forbidden_key_lookup(_plan: FrozenModelInvocation) -> dict[str, object]:
        raise AssertionError("Unreviewed source profile must fail before any managed key is loaded")

    monkeypatch.setattr("core.model_invocation_routing.managed_credentials", forbidden_key_lookup)
    with pytest.raises(ModelRouteUnavailable):
        redirect_payload(frozen, {"provider": "anthropic", "model": contract.source_model, "model_type": "llm"})


def test_invalid_frozen_runtime_schema_fails_before_managed_key_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.model_billing_openai_chat_adapter import build_openai_chat_source_contract
    from tests.unit_tests.services.test_model_billing_openai_chat_adapter import build_inputs

    contract = build_openai_chat_source_contract(**build_inputs(runtime=True))
    frozen = replace(
        plan(),
        logical_provider="langgenius/openai/openai",
        logical_model=contract.source_model,
        target_model=contract.target_model,
        source_parameter_contract=replace(contract, source_runtime_schema_digest=contract.source_schema_digest),
    )

    def forbidden_key_lookup(_plan: FrozenModelInvocation) -> dict[str, object]:
        raise AssertionError("A substituted runtime boundary must fail before managed-key lookup")

    monkeypatch.setattr("core.model_invocation_routing.managed_credentials", forbidden_key_lookup)
    with pytest.raises(ModelRouteUnavailable):
        redirect_payload(frozen, {"provider": "openai", "model": contract.source_model, "model_type": "llm"})


def test_llm_inventory_is_real_strict_canonical_json_without_null_dimension(mocker: MockerFixture) -> None:
    import hashlib

    from core.model_invocation_routing import migration_inventory
    from graphon.model_runtime.entities.common_entities import I18nObject
    from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey
    from services.entities.model_billing_migration import canonical_hash

    schema = AIModelEntity(
        model="gpt-4o",
        label=I18nObject(en_US="GPT-4o"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={ModelPropertyKey.MODE: "chat"},
    )
    digest = (
        "sha256:"
        + hashlib.sha256(
            json.dumps(
                schema.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
            ).encode()
        ).hexdigest()
    )
    record = SimpleNamespace(
        mapping_revision="fixture-v1",
        pool_types=["paid"],
        source_schema_digest=digest,
        parameter_adapter=SimpleNamespace(id="identity_v1"),
        operations=plan().operations,
        source=SimpleNamespace(mode="chat"),
        target=SimpleNamespace(model="fixture-target"),
    )
    mocker.patch(
        "core.model_invocation_routing.model_mappings",
        return_value={
            (plan().logical_provider, ModelType.LLM, "gpt-4o"): record,
        },
    )
    provider = configuration()
    provider.provider.models = [schema]
    provider.provider.supported_model_types = [ModelType.LLM]
    manager = Mock()
    manager.get_configurations.return_value = [(plan().logical_provider, provider)]
    mocker.patch("core.plugin.impl.model_runtime_factory.create_plugin_provider_manager", return_value=manager)
    result = migration_inventory(plan().tenant_id, "fixture-v1")
    assert result["inventory_hash"] == canonical_hash(result["models"])
    assert "embedding_dimensions" not in result["models"][0]
    assert result["source_ownership"][plan().logical_provider]["quotas"]["paid"] == {"unmetered": False}


def test_migration_lookup_failure_is_sanitized_and_never_opens_legacy(mocker: MockerFixture) -> None:
    from core.model_invocation_routing import migration_routing_state

    mocker.patch(
        "core.model_invocation_routing.get_routing_state",
        side_effect=RuntimeError("SQL connection TEST_SECRET"),
    )
    with pytest.raises(ModelRouteUnavailable) as caught:
        migration_routing_state(plan().tenant_id)
    assert "TEST_SECRET" not in str(caught.value)


@pytest.mark.parametrize("ever_activated", [False, True])
def test_cancelled_route_requires_explicit_activation(mocker: MockerFixture, ever_activated: bool) -> None:
    from core.model_invocation_routing import migration_display_status
    from services.entities.model_billing_mapping import ModelMapping
    from tests.unit_tests.services.test_model_billing_mapping_service import mapping, schema

    state = {
        "phase": "cancelled",
        "persisted_model_billing_source": "tokener",
        "claimed_at": "2026-09-28T00:00:00Z",
        "ever_activated": ever_activated,
        "route_epoch": 3,
        "model_mapping_version": "fixture-v1",
        "preparation": credential_pin(),
    }
    mocker.patch("core.model_invocation_routing.migration_routing_state", return_value=state)
    assert has_compatibility_route(state)
    assert migration_display_status(plan().tenant_id) == ("active" if ever_activated else "processing")
    mocker.patch(
        "core.model_invocation_routing.model_mappings",
        return_value={
            (plan().logical_provider, ModelType.LLM, "gpt-4o"): ModelMapping.model_validate(
                mapping(schema(), revision="fixture-v1", target="fixture-target", pool_types=["paid"])
            ),
        },
    )
    session = Mock()
    session.scalar.return_value = SimpleNamespace(
        status="ready",
        provider_credential_id=plan().credential_id,
        plugin_unique_identifier=plan().plugin_unique_identifier,
    )
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(session))
    if ever_activated:
        credentials = routed_credentials(configuration(), ModelType.LLM, "gpt-4o")
        assert isinstance(credentials, RoutedModelCredentials)
        validate_invocation_admission(
            credentials, tenant_id=plan().tenant_id, provider="openai", model_type=ModelType.LLM, model="gpt-4o"
        )
    else:
        with pytest.raises(ModelMigrationProcessing):
            routed_credentials(configuration(), ModelType.LLM, "gpt-4o")
        with pytest.raises(ModelInvocationReprepare):
            validate_invocation_admission(
                RoutedModelCredentials(plan()),
                tenant_id=plan().tenant_id,
                provider="openai",
                model_type=ModelType.LLM,
                model="gpt-4o",
            )
        session.scalar.assert_not_called()


@pytest.mark.parametrize(
    "edited_config",
    [
        '{"api_key":"BYOK_CIPHERTEXT","endpoint_url":"https://fixture.invalid"}',
        '{"api_key":"encrypted","endpoint_url":"https://other-fixture.invalid"}',
    ],
)
def test_mutated_managed_row_fails_before_decrypt_and_plugin_dispatch(
    mocker: MockerFixture, edited_config: str
) -> None:
    session = Mock()
    session.scalar.return_value = SimpleNamespace(encrypted_config=edited_config)
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(session))
    decrypt = mocker.patch("core.helper.encrypter.decrypt_token")
    policy = mocker.patch("core.helper.credential_utils.runtime_check_credential_policy_compliance")
    client = PluginModelClient()
    send = mocker.patch.object(client, "_request_with_plugin_daemon_response_stream")
    with pytest.raises(ModelRouteUnavailable) as caught:
        list(
            client.invoke_llm(
                tenant_id=plan().tenant_id,
                user_id=None,
                plugin_id="langgenius/openai",
                provider="openai",
                model="gpt-4o",
                credentials=RoutedModelCredentials(plan()),
                prompt_messages=[],
                stream=True,
            )
        )
    assert caught.value.code == 503
    decrypt.assert_not_called()
    policy.assert_not_called()
    send.assert_not_called()


def test_fingerprint_plan_never_contains_key_or_ciphertext() -> None:
    from dataclasses import asdict

    data = asdict(plan())
    assert "encrypted_config" not in data
    assert "api_key" not in data
    assert "encrypted" not in json.dumps(data)
    assert data["expected_credential_fingerprint"] == canonical_hash({"encrypted_config": TEST_ENCRYPTED_CONFIG})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("tenant_id", "another-tenant"),
        ("provider_credential_id", "byok-id"),
        ("provider_name", "another/provider"),
        ("credential_fingerprint", ""),
    ],
)
def test_authoritative_credential_pin_must_match_complete_owner_chain(field: str, value: str) -> None:
    from core.model_invocation_routing import _pinned_credential_fingerprint

    pin = {**credential_pin(), field: value}
    with pytest.raises(ModelRouteUnavailable):
        _pinned_credential_fingerprint({"preparation": pin}, plan().tenant_id, plan().credential_id)


def test_missing_pin_never_retrusts_the_current_edited_row() -> None:
    from core.model_invocation_routing import _pinned_credential_fingerprint

    with pytest.raises(ModelRouteUnavailable):
        _pinned_credential_fingerprint({}, plan().tenant_id, plan().credential_id, allow_provisioned=True)


def _configure_gpt55_case(case: ProviderCase, *, daemon_profile: bool = False) -> tuple[str, str]:
    catalog, _ = gpt55_daemon_schemas() if daemon_profile else gpt55_schemas()
    case.provider.models = [catalog]
    case.provider.plugin_unique_identifier = (
        "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468"
    )
    case.integration.plugin_unique_identifier = (
        "langgenius/tokener:0.4.3-dev13@" if daemon_profile else "langgenius/tokener:0.4.3-dev12@"
    ) + "c" * 64
    revision = DAEMON_REVISION if daemon_profile else GPT55_REVISION
    raw = json.dumps(full_daemon_registry() if daemon_profile else full_gpt55_registry())
    digest = source_mapping_revision(raw, revision).digest
    case.state["model_mapping_version"] = revision
    case.state["source_variant_registry_digest"] = digest
    preparation = case.state["preparation"]
    assert isinstance(preparation, dict)
    preparation["source_variant_registry_digest"] = digest
    policy = json.dumps(
        [{"schema_version": 1, "mapping_revision": revision, "inventory_policy": "saved_system_dependencies_v2"}]
    )
    return raw, policy


@pytest.fixture
def gpt55_case(request: pytest.FixtureRequest) -> ProviderCase:
    return request.getfixturevalue("provider_case")


@pytest.mark.parametrize("selector", ["absent", "chat", "responses"])
@pytest.mark.parametrize("official", [False, True])
@pytest.mark.parametrize("daemon_profile", [False, True])
def test_exact_gpt55_source_routes_without_rewriting_original_settings_and_admits_fresh_facts(
    selector: str, official: bool, daemon_profile: bool, gpt55_case: ProviderCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = gpt55_case
    raw, policy = _configure_gpt55_case(case, daemon_profile=daemon_profile)
    hosting = case.hosting[case.provider.provider]
    original = {"api_key": "ORIGINAL_SYSTEM_NEVER_FORWARD"}
    if selector != "absent":
        original["api_protocol"] = selector
    if official:
        original["openai_api_base"] = "https://api.openai.com"
    hosting.credentials = original
    snapshot = deepcopy(original)
    state_snapshot = deepcopy(case.state)
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=raw, TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=policy
    ):
        configuration = case.manager.get_configurations(TENANT_ID).get(case.provider.provider)
        assert configuration is not None
        assert configuration.system_configuration.credentials is None
        routed = configuration.get_current_credentials(ModelType.LLM, "gpt-5.5")
        assert isinstance(routed, RoutedModelCredentials)
        assert dict(routed) == {}
        plan = routed.plan
        assert plan.logical_model == plan.target_model == "gpt-5.5"
        assert plan.source_variant_binding is not None
        assert plan.mapping_revision_digest == case.state["source_variant_registry_digest"]
        contract = plan.source_parameter_contract
        assert contract is not None
        assert contract.adapter_id == "openai_provider042_source_v1"
        protocol = "responses" if selector == "responses" else "chat"
        family = ("official-root-" if official else "") + ("daemon-runtime-v1" if daemon_profile else "runtime-v1")
        assert contract.profile_id == f"openai-042-{protocol}-{family}:gpt-5.5"
        assert contract.algorithm_revision == ("2" if daemon_profile else "1")

        def admit(credentials: RoutedModelCredentials = routed) -> None:
            validate_invocation_admission(
                credentials,
                tenant_id=TENANT_ID,
                provider=case.provider.provider,
                model_type=ModelType.LLM,
                model="gpt-5.5",
            )

        admit()
        for changed in (
            replace(plan, source_variant_binding=None),
            replace(plan, source_parameter_contract=None),
            replace(plan, mapping_revision_digest=None),
            replace(plan, source_parameter_contract=replace(contract, rules_digest="sha256:" + "f" * 64)),
        ):
            with pytest.raises(ModelInvocationReprepare):
                admit(RoutedModelCredentials(changed))
        # Existing private marker projection remains six fields, with no
        # original vendor credential or public source endpoint forwarded.
        monkeypatch.setattr(
            "core.model_invocation_routing.managed_credentials", lambda _: {"api_key": "MANAGED_TEST_KEY"}
        )
        payload = redirect_payload(plan, {"provider": "openai", "model": "gpt-5.5", "model_type": "llm"})
        serialized = json.dumps(payload)
        assert "ORIGINAL_SYSTEM_NEVER_FORWARD" not in serialized
        assert "https://api.openai.com" not in serialized
        assert contract.profile_id in serialized
        if official:
            original["openai_api_base"] = "https://api.openai.com/v1"
            with pytest.raises(ModelInvocationReprepare):
                admit()
            original["openai_api_base"] = snapshot["openai_api_base"]
        original["enable_request_metadata"] = "enabled"
        with pytest.raises(ModelInvocationReprepare):
            admit()
        original.pop("enable_request_metadata")
    assert original == snapshot
    assert case.state == state_snapshot


def test_gpt55_byok_preference_stays_original_not_managed_key(gpt55_case: ProviderCase) -> None:
    case = gpt55_case
    raw, policy = _configure_gpt55_case(case)
    cast(dict[str, TenantPreferredModelProvider], case.preferences)[case.provider.provider] = (
        TenantPreferredModelProvider(
            tenant_id=TENANT_ID, provider_name=case.provider.provider, preferred_provider_type=ProviderType.CUSTOM
        )
    )
    case.hosting[case.provider.provider].credentials = {"api_key": "ORIGINAL_SYSTEM_NEVER_FORWARD"}
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=raw, TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=policy
    ):
        configuration = case.manager.get_configurations(TENANT_ID).get(case.provider.provider)
        assert configuration is not None
        assert configuration.using_provider_type == ProviderType.CUSTOM
        assert configuration.get_current_credentials(ModelType.LLM, "gpt-5.5") == {"api_key": "USER_SECRET"}


@pytest.fixture
def embedding_case(request: pytest.FixtureRequest) -> ProviderCase:
    return request.getfixturevalue("provider_case")


def _configure_embedding_case(case: ProviderCase, model: str, version: str) -> tuple[str, str]:
    catalog, _ = embedding_schemas(model, version)
    profile = next(p for p in embedding_profiles() if (p["source_model"], p["source_version"]) == (model, version))
    case.provider.models = [catalog]
    case.provider.supported_model_types = [ModelType.TEXT_EMBEDDING]
    case.provider.plugin_unique_identifier = profile["source_plugin_uid"]
    case.integration.plugin_unique_identifier = "langgenius/tokener:0.4.3-dev12@" + "c" * 64
    raw = json.dumps(full_embedding_registry())
    digest = source_mapping_revision(raw, EMBEDDING_REVISION).digest
    case.state["model_mapping_version"] = EMBEDDING_REVISION
    case.state["source_variant_registry_digest"] = digest
    preparation = case.state["preparation"]
    assert isinstance(preparation, dict)
    preparation["source_variant_registry_digest"] = digest
    return raw, json.dumps(
        [
            {
                "schema_version": 1,
                "mapping_revision": EMBEDDING_REVISION,
                "inventory_policy": "saved_system_dependencies_v2",
            }
        ]
    )


@pytest.mark.parametrize(
    "model",
    [
        "gemini-2.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.1-pro-preview",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.7-flash",
        "gemini-3-flash-preview",
        "gemini-embedding-001",
        "gemini-embedding-2-preview",
    ],
)
@pytest.mark.parametrize("base", [None, "https://generativelanguage.googleapis.com"])
def test_gemini_v6_real_provider_configuration_current_admission_and_original_selector_are_preserved(
    model: str,
    base: str | None,
    provider_case: ProviderCase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.helpers.unit import model_billing_gemini_profiles as gemini

    case = provider_case
    rows = gemini.profiles()
    row = next(row for row in rows if row["source_model"] == model)
    kind = ModelType(row["model_type"])
    previous_provider = case.provider.provider
    case.provider.provider = gemini.SOURCE_PROVIDER
    case.provider.plugin_unique_identifier = gemini.SOURCE_UID
    case.provider.models = [gemini.schema(item) for item in rows]
    case.provider.supported_model_types = [ModelType.LLM, ModelType.TEXT_EMBEDDING]
    hosting = case.hosting.pop(previous_provider)
    case.hosting[gemini.SOURCE_PROVIDER] = hosting
    original = {"google_api_key": "ORIGINAL_GEMINI_SYSTEM_NEVER_FORWARD", "google_base_url": base}
    hosting.credentials = original
    case.integration.plugin_unique_identifier = gemini.TARGET_UID
    raw = gemini.registry()
    digest = source_mapping_revision(raw, gemini.REVISION).digest
    case.state["model_mapping_version"] = gemini.REVISION
    case.state["source_variant_registry_digest"] = digest
    preparation = case.state["preparation"]
    assert isinstance(preparation, dict)
    preparation["source_variant_registry_digest"] = digest
    policy = json.dumps(
        [{"schema_version": 1, "mapping_revision": gemini.REVISION, "inventory_policy": "saved_system_dependencies_v2"}]
    )
    before = deepcopy(case.state)
    source_before = deepcopy(original)
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=raw, TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=policy
    ):
        configuration = case.manager.get_configurations(TENANT_ID).get(gemini.SOURCE_PROVIDER)
        assert configuration is not None
        assert configuration.system_configuration.credentials is None
        fact = configuration.system_configuration._tokener_gemini_source_fact
        assert fact is not None
        assert fact.plugin_unique_identifier == gemini.SOURCE_UID
        exported = json.dumps(configuration.system_configuration.model_dump(mode="json"))
        assert "ORIGINAL_GEMINI_SYSTEM" not in exported
        assert "llm_source_base_policy" not in exported
        credentials = configuration.get_current_credentials(kind, model)
        assert isinstance(credentials, RoutedModelCredentials)
        assert not dict(credentials)
        plan = credentials.plan
        assert plan.logical_provider == gemini.SOURCE_PROVIDER
        assert plan.logical_model == plan.target_model == model
        assert plan.source_parameter_contract is not None
        assert plan.source_parameter_contract.profile_id == "gemini0912-native-v1:" + model

        def admit(value: RoutedModelCredentials = credentials) -> None:
            validate_invocation_admission(
                value, tenant_id=TENANT_ID, provider=gemini.SOURCE_PROVIDER, model_type=kind, model=model
            )

        admit()
        original["google_base_url"] = "https://generativelanguage.googleapis.com" if base is None else None
        admit()  # Exact source-wire-equivalent None/root policy, not URL normalization.
        original["google_base_url"] = base
        for key, value in (
            ("google_base_url", "https://generativelanguage.googleapis.com/v1beta"),
            ("enable_request_metadata", "enabled"),
            ("file_url", "https://files.invalid"),
        ):
            original[key] = value
            if kind is ModelType.LLM:
                with pytest.raises(ModelInvocationReprepare):
                    admit()
            else:
                admit()  # Exact source embedding ignores these settings.
            original.clear()
            original.update(source_before)
        for changed in (
            replace(plan, source_variant_binding=None),
            replace(plan, mapping_revision_digest=None),
            replace(plan, source_parameter_contract=None),
        ):
            with pytest.raises(ModelInvocationReprepare):
                admit(RoutedModelCredentials(changed))
        monkeypatch.setattr(
            "core.model_invocation_routing.managed_credentials", lambda _: {"api_key": "MANAGED_GEMINI_TEST_KEY"}
        )
        payload = redirect_payload(plan, {"provider": "google", "model": model, "model_type": kind.value})
        rendered = json.dumps(payload)
        assert "ORIGINAL_GEMINI_SYSTEM_NEVER_FORWARD" not in rendered
        assert "google_base_url" not in rendered
        assert "file_url" not in rendered
        assert plan.source_parameter_contract.profile_id in rendered
        # The same installed source and model remain BYOK when the original
        # provider selection is CUSTOM, even with an active migration receipt.
        from core.entities.provider_entities import CustomProviderConfiguration

        byok = {"google_api_key": "SYNTHETIC_GEMINI_BYOK_NEVER_MANAGED"}
        configuration.using_provider_type = ProviderType.CUSTOM
        configuration.custom_configuration = CustomConfiguration(provider=CustomProviderConfiguration(credentials=byok))
        assert routed_credentials(configuration, kind, model) is None
        selected_byok = configuration.get_current_credentials(kind, model)
        assert selected_byok == byok
        assert not isinstance(selected_byok, RoutedModelCredentials)
    assert case.state == before
    assert original == source_before


@pytest.mark.parametrize(
    "model",
    [
        "qwen-flash",
        "qwen-max",
        "qwen-plus",
        "qwen-plus-latest",
        "qwen3-vl-plus",
        "qwen3.5-flash",
        "qwen3.5-plus",
        "qwen3.6-flash",
        "qwen3.6-plus",
        "qwen3.7-max",
        "qwen3.7-plus",
        "text-embedding-v3",
        "text-embedding-v4",
        "qwen3-rerank",
    ],
)
@pytest.mark.parametrize("existing", [False, True])
@pytest.mark.parametrize("dynamic", [False, True])
def test_tongyi_v7_actual_provider_before_clear_current_admission_and_opaque_transport(
    model: str,
    existing: bool,
    dynamic: bool,
    provider_case: ProviderCase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core.plugin.impl import base as plugin_base
    from graphon.model_runtime.entities.message_entities import UserPromptMessage
    from tests.helpers.unit import model_billing_tongyi_profiles as tongyi

    case = provider_case
    rows = tongyi.profiles()
    row = next(item for item in rows if item["source_model"] == model)
    kind = ModelType(row["model_type"])
    previous = case.provider.provider
    case.provider.provider = tongyi.SOURCE_PROVIDER
    case.provider.plugin_unique_identifier = tongyi.SOURCE_UID
    case.provider.models = [] if dynamic else [tongyi.schema(item) for item in rows]
    case.provider.supported_model_types = [ModelType.LLM, ModelType.TEXT_EMBEDDING, ModelType.RERANK]
    hosting = case.hosting.pop(previous)
    case.hosting[tongyi.SOURCE_PROVIDER] = hosting
    original: dict[str, object] = {
        "dashscope_api_key": "ORIGINAL_TONGYI_SYSTEM_NEVER_FORWARD",
        "use_international_endpoint": "true",
    }
    hosting.credentials = original
    source_schema_calls = []
    if dynamic:
        from graphon.model_runtime.entities.provider_entities import ConfigurateMethod

        case.provider.configurate_methods.append(ConfigurateMethod.CUSTOMIZABLE_MODEL)

        def source_schema(
            *, provider: str, model_type: ModelType, model: str, credentials: dict[str, object]
        ) -> AIModelEntity:
            assert provider == tongyi.SOURCE_PROVIDER
            assert credentials == original
            source_schema_calls.append(model)
            selected = next(item for item in rows if item["source_model"] == model)
            result = tongyi.schema(selected)
            assert result.model_type is model_type
            return result

        monkeypatch.setattr(case.manager._model_runtime, "get_model_schema", source_schema)
    case.integration.plugin_unique_identifier = tongyi.TARGET_UID
    if existing:
        case.state["source_ownership"] = {
            tongyi.SOURCE_PROVIDER: {"current_quota_type": "paid", "quotas": {"paid": {"unmetered": False}}}
        }
    raw = tongyi.registry()
    digest = source_mapping_revision(raw, tongyi.REVISION).digest
    case.state["model_mapping_version"] = tongyi.REVISION
    case.state["source_variant_registry_digest"] = digest
    preparation = case.state["preparation"]
    assert isinstance(preparation, dict)
    preparation["source_variant_registry_digest"] = digest
    policy = json.dumps(
        [{"schema_version": 1, "mapping_revision": tongyi.REVISION, "inventory_policy": "saved_system_dependencies_v2"}]
    )
    before, source_before = deepcopy(case.state), deepcopy(original)
    key_lookups = []

    def target_key(plan: FrozenModelInvocation) -> dict[str, str]:
        assert plan.tenant_id == TENANT_ID
        key_lookups.append(plan.logical_model)
        return {"api_key": "MANAGED_TONGYI_SYNTHETIC_KEY"}

    monkeypatch.setattr("core.model_invocation_routing.managed_credentials", target_key)
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=raw, TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=policy
    ):
        configuration = case.manager.get_configurations(TENANT_ID).get(tongyi.SOURCE_PROVIDER)
        assert configuration is not None
        assert configuration.system_configuration.credentials is None
        fact = configuration.system_configuration._tokener_tongyi_source_fact
        assert fact is not None
        assert fact.endpoint_selector == "string_true"
        assert fact.plugin_unique_identifier == tongyi.SOURCE_UID
        assert len(fact.catalog_schema_digests) == 14
        assert len(source_schema_calls) == (14 if dynamic else 0)
        exported = json.dumps(configuration.system_configuration.model_dump(mode="json"))
        assert "ORIGINAL_TONGYI_SYSTEM" not in exported
        assert "endpoint_selector" not in exported
        credentials = configuration.get_current_credentials(kind, model)
        assert isinstance(credentials, RoutedModelCredentials)
        assert not dict(credentials)
        plan = credentials.plan
        assert plan.logical_provider == tongyi.SOURCE_PROVIDER
        assert plan.logical_model == plan.target_model == model
        assert plan.source_parameter_contract is not None
        assert plan.source_parameter_contract.profile_id == "tongyi0226-native-v1:" + model

        def admit(value: RoutedModelCredentials = credentials) -> None:
            validate_invocation_admission(
                value, tenant_id=TENANT_ID, provider=tongyi.SOURCE_PROVIDER, model_type=kind, model=model
            )

        admit()
        for name, value in (
            ("use_international_endpoint", "false"),
            ("use_international_endpoint", True),
            ("api_host", "https://custom.invalid"),
            ("enable_request_metadata", "enabled"),
        ):
            original[name] = value
            if name != "enable_request_metadata" or kind is ModelType.LLM:
                with pytest.raises(ModelInvocationReprepare):
                    admit()
            else:
                admit()  # Exact embedding/rerank codecs do not use metadata.
            original.clear()
            original.update(source_before)
        assert key_lookups == [], "current facts must fail before managed key lookup/reservation"

        class Captured(BaseException):
            pass

        sent = []

        class Terminal:
            def stream(self, **kwargs: object) -> Never:
                sent.append(kwargs)
                raise Captured()

        monkeypatch.setattr(plugin_base, "_httpx_client", Terminal())
        client = PluginModelClient()

        def dispatch() -> None:
            if kind is ModelType.LLM:
                list(
                    client.invoke_llm(
                        TENANT_ID,
                        None,
                        "langgenius/tongyi",
                        "tongyi",
                        model,
                        credentials,
                        [UserPromptMessage(content="original question")],
                        model_parameters={"temperature": 0.2},
                        stream=True,
                        plugin_unique_identifier=tongyi.SOURCE_UID,
                    )
                )
            elif kind is ModelType.TEXT_EMBEDDING:
                client.invoke_text_embedding(
                    TENANT_ID,
                    None,
                    "langgenius/tongyi",
                    "tongyi",
                    model,
                    credentials,
                    ["original document"],
                    "query",
                    plugin_unique_identifier=tongyi.SOURCE_UID,
                )
            else:
                client.invoke_rerank(
                    TENANT_ID,
                    None,
                    "langgenius/tongyi",
                    "tongyi",
                    model,
                    credentials,
                    "original query",
                    ["first", "second"],
                    top_n=1,
                    plugin_unique_identifier=tongyi.SOURCE_UID,
                )

        with pytest.raises(Captured):
            dispatch()
        assert len(sent) == 1
        assert key_lookups == [model]
        content = sent[0]["content"]
        assert isinstance(content, str | bytes)
        payload = json.loads(content)
        assert payload["data"]["credentials"] == {}
        assert payload["data"]["model"] == model
        assert payload["redirect"]["target"]["expected_unique_identifier"] == tongyi.TARGET_UID
        marker = payload["redirect"]["target"]["credentials"]["_dify_source_contract"]
        assert marker["profile_id"] == "tongyi0226-native-v1:" + model
        assert len(marker) == 6
        assert "ORIGINAL_TONGYI_SYSTEM" not in json.dumps(payload)
        if kind is ModelType.LLM:
            assert payload["data"]["model_parameters"] == {"temperature": 0.2}
        elif kind is ModelType.TEXT_EMBEDDING:
            assert payload["data"]["texts"] == ["original document"]
            assert payload["data"]["input_type"] == "query"
        else:
            assert payload["data"]["query"] == "original query"
            assert payload["data"]["docs"] == ["first", "second"]
            assert payload["data"]["top_n"] == 1
        from core.entities.provider_entities import CustomProviderConfiguration

        byok = {"dashscope_api_key": "SYNTHETIC_TONGYI_BYOK_NEVER_MANAGED"}
        configuration.using_provider_type = ProviderType.CUSTOM
        configuration.custom_configuration = CustomConfiguration(provider=CustomProviderConfiguration(credentials=byok))
        assert routed_credentials(configuration, kind, model) is None
        assert configuration.get_current_credentials(kind, model) == byok
        assert key_lookups == [model]
        configuration.using_provider_type = ProviderType.SYSTEM
        configuration.system_configuration = SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.FREE,
            quota_configurations=[
                QuotaConfiguration(
                    quota_type=ProviderQuotaType.FREE,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                    quota_used=0,
                    is_valid=True,
                )
            ],
            credentials=source_before.copy(),
        )
        assert routed_credentials(configuration, kind, model) is None
        assert configuration.get_current_credentials(kind, model) == source_before
        assert key_lookups == [model]
    assert case.state == before
    assert original == source_before
    case.init_records.assert_not_called()
    case.get_pool.assert_not_called()


def test_tongyi_before_migration_real_provider_owner_keeps_original_shared_credit_credentials(
    provider_case: ProviderCase,
) -> None:
    from enums import DeploymentEdition
    from models.enums import ProviderQuotaType as StoredQuotaType
    from models.provider import Provider
    from tests.helpers.unit import model_billing_tongyi_profiles as tongyi

    case = provider_case
    previous = case.provider.provider
    case.provider.provider = tongyi.SOURCE_PROVIDER
    case.provider.plugin_unique_identifier = tongyi.SOURCE_UID
    rows = tongyi.profiles()
    case.provider.models = [tongyi.schema(row) for row in rows]
    case.provider.supported_model_types = [ModelType.LLM, ModelType.TEXT_EMBEDDING, ModelType.RERANK]
    hosting = case.hosting.pop(previous)
    case.hosting[tongyi.SOURCE_PROVIDER] = hosting
    original = {"dashscope_api_key": "ORIGINAL_TONGYI_LEGACY_ONLY", "use_international_endpoint": "true"}
    hosting.credentials = original
    case.state["phase"] = "preparing"
    record = Provider(
        tenant_id=TENANT_ID,
        provider_name=tongyi.SOURCE_PROVIDER,
        provider_type=ProviderType.SYSTEM,
        quota_type=StoredQuotaType.PAID,
        quota_limit=200,
        quota_used=0,
        is_valid=True,
    )
    # The non-cloud branch keeps the existing provider-row owner; this local
    # test does not instantiate a DB session or fabricate a shared-pool row.
    with config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY):
        system = case.manager._to_system_configuration(TENANT_ID, case.provider, [record])
        assert system.enabled
        assert system.credentials == original
        configuration = ProviderConfiguration(
            tenant_id=TENANT_ID,
            provider=case.provider,
            preferred_provider_type=ProviderType.SYSTEM,
            using_provider_type=ProviderType.SYSTEM,
            system_configuration=system,
            custom_configuration=CustomConfiguration(provider=None),
            model_settings=[],
        )
        for row in rows:
            kind = ModelType(row["model_type"])
            assert routed_credentials(configuration, kind, row["source_model"]) is None
            credentials = configuration.get_current_credentials(kind, row["source_model"])
            assert credentials is not None
            assert credentials["dashscope_api_key"] == original["dashscope_api_key"]
            assert not isinstance(credentials, RoutedModelCredentials)
    case.get_pool.assert_not_called()


@pytest.mark.parametrize("model", EMBEDDING_MODELS)
@pytest.mark.parametrize("version", ["042", "110"])
@pytest.mark.parametrize("endpoint", ["unset", "official_root"])
def test_embedding_actual_source_fact_routes_the_exact_codec_and_keeps_ignored_flags_original(
    model: str, version: str, endpoint: str, embedding_case: ProviderCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = embedding_case
    raw, policy = _configure_embedding_case(case, model, version)
    original: dict[str, object] = {
        "api_key": "ORIGINAL_EMBEDDING_SOURCE_NEVER_FORWARD",
        "api_protocol": {"unknown_ignored_by_exact_embedding_source": True},
        "enable_request_metadata": "enabled",
        "openai_api_base": "https://api.openai.com" if endpoint == "official_root" else None,
    }
    snapshot = deepcopy(original)
    case.hosting[SOURCE_PROVIDER].credentials = original
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=raw, TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=policy
    ):
        configuration = case.manager.get_configurations(TENANT_ID).get(SOURCE_PROVIDER)
        assert configuration is not None
        assert configuration.system_configuration.credentials is None
        # LLM flags are not embedding authority. Its independently derived
        # private fact remains positive even when the LLM fact is unavailable.
        assert configuration.system_configuration._tokener_source_variant_fact is None
        assert configuration.system_configuration._tokener_embedding_source_fact is not None
        credentials = configuration.get_current_credentials(ModelType.TEXT_EMBEDDING, model)
        assert isinstance(credentials, RoutedModelCredentials)
        assert not dict(credentials)
        plan = credentials.plan
        contract = plan.source_parameter_contract
        assert contract is not None
        assert contract.profile_id == f"openai-{version}-embedding-runtime-v1:{model}"
        assert contract.source_plugin_unique_identifier == case.provider.plugin_unique_identifier
        assert plan.source_variant_binding is not None
        assert plan.mapping_revision_digest == plan.source_variant_binding.registry_digest

        def admit(value: RoutedModelCredentials = credentials) -> None:
            validate_invocation_admission(
                value, tenant_id=TENANT_ID, provider=SOURCE_PROVIDER, model_type=ModelType.TEXT_EMBEDDING, model=model
            )

        admit()
        ignored_flags: tuple[object, ...] = (None, "unknown", True, 0, list[object](), dict[str, object]())
        for flag in ignored_flags:
            original["api_protocol"] = flag
            original["enable_request_metadata"] = flag
            admit()  # The source implementations demonstrably ignore both.
        original["api_protocol"] = snapshot["api_protocol"]
        original["enable_request_metadata"] = snapshot["enable_request_metadata"]
        for changed in (
            replace(plan, source_variant_binding=None),
            replace(plan, source_parameter_contract=None),
            replace(plan, mapping_revision_digest=None),
            replace(plan, source_parameter_contract=replace(contract, rules_digest="sha256:" + "f" * 64)),
        ):
            with pytest.raises(ModelInvocationReprepare):
                admit(RoutedModelCredentials(changed))
        monkeypatch.setattr(
            "core.model_invocation_routing.managed_credentials", lambda _: {"api_key": "MANAGED_TEST_KEY"}
        )
        payload = redirect_payload(plan, {"provider": "openai", "model": model, "model_type": "text-embedding"})
        serialized = json.dumps(payload)
        assert "ORIGINAL_EMBEDDING_SOURCE_NEVER_FORWARD" not in serialized
        assert "https://api.openai.com" not in serialized
        assert "enable_request_metadata" not in serialized
        assert contract.profile_id in serialized
        for custom in ("https://api.openai.com/v1", "https://custom.invalid?secret=DO_NOT_LOG"):
            original["openai_api_base"] = custom
            with pytest.raises(ModelInvocationReprepare) as denied:
                admit()
            assert "DO_NOT_LOG" not in str(denied.value)
        original["openai_api_base"] = snapshot["openai_api_base"]
        case.hosting[SOURCE_PROVIDER].credentials = None
        with pytest.raises(ModelInvocationReprepare):
            admit()
        case.hosting[SOURCE_PROVIDER].credentials = original
        admit()
    assert original == snapshot


def test_embedding_fresh_official_class_changes_variant_pin_without_changing_codec(
    embedding_case: ProviderCase,
) -> None:
    case = embedding_case
    model = EMBEDDING_MODELS[0]
    raw, policy = _configure_embedding_case(case, model, "042")
    original = {"api_key": "ORIGINAL_SYSTEM_NEVER_FORWARD"}
    case.hosting[SOURCE_PROVIDER].credentials = original
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=raw, TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=policy
    ):
        config = case.manager.get_configurations(TENANT_ID).get(SOURCE_PROVIDER)
        assert config is not None
        first = config.get_current_credentials(ModelType.TEXT_EMBEDDING, model)
        assert isinstance(first, RoutedModelCredentials)
        original["openai_api_base"] = "https://api.openai.com"
        with pytest.raises(ModelInvocationReprepare):
            validate_invocation_admission(
                first, tenant_id=TENANT_ID, provider=SOURCE_PROVIDER, model_type=ModelType.TEXT_EMBEDDING, model=model
            )
        case.manager.clear_configurations_cache(TENANT_ID)
        config = case.manager.get_configurations(TENANT_ID).get(SOURCE_PROVIDER)
        assert config is not None
        second = config.get_current_credentials(ModelType.TEXT_EMBEDDING, model)
        assert isinstance(second, RoutedModelCredentials)
        assert first.plan.source_parameter_contract == second.plan.source_parameter_contract
        assert first.plan.source_variant_binding != second.plan.source_variant_binding
        assert first.plan.cache_identity != second.plan.cache_identity
        validate_invocation_admission(
            second, tenant_id=TENANT_ID, provider=SOURCE_PROVIDER, model_type=ModelType.TEXT_EMBEDDING, model=model
        )


def test_new_embedding_requires_dev12_not_native_dev11(embedding_case: ProviderCase) -> None:
    case = embedding_case
    raw, policy = _configure_embedding_case(case, EMBEDDING_MODELS[0], "042")
    case.integration.plugin_unique_identifier = "langgenius/tokener:0.4.3-dev11@" + "c" * 64
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=raw, TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=policy
    ):
        config = case.manager.get_configurations(TENANT_ID).get(SOURCE_PROVIDER)
        assert config is not None
        with pytest.raises(ModelRouteUnavailable):
            config.get_current_credentials(ModelType.TEXT_EMBEDDING, EMBEDDING_MODELS[0])


def test_embedding_byok_stays_original_even_when_shared_source_settings_are_unavailable(
    embedding_case: ProviderCase,
) -> None:
    case = embedding_case
    raw, policy = _configure_embedding_case(case, EMBEDDING_MODELS[0], "110")
    case.hosting[SOURCE_PROVIDER].credentials = None
    cast(dict[str, TenantPreferredModelProvider], case.preferences)[SOURCE_PROVIDER] = TenantPreferredModelProvider(
        tenant_id=TENANT_ID, provider_name=SOURCE_PROVIDER, preferred_provider_type=ProviderType.CUSTOM
    )
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=raw, TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=policy
    ):
        config = case.manager.get_configurations(TENANT_ID).get(SOURCE_PROVIDER)
        assert config is not None
        assert config.using_provider_type == ProviderType.CUSTOM
        assert config.get_current_credentials(ModelType.TEXT_EMBEDDING, EMBEDDING_MODELS[0]) == {
            "api_key": "USER_SECRET"
        }


@pytest.mark.parametrize(
    ("version", "model"),
    [
        ("042", "gpt-4o"),
        ("042", "gpt-5-2025-08-07"),
        ("042", "gpt-5-mini-2025-08-07"),
        ("110", "gpt-6-luna"),
    ],
)
@pytest.mark.parametrize("official", [False, True])
def test_credit_llm_family_routes_and_freezes_only_reviewed_aliases(
    version: str, model: str, official: bool, provider_case: ProviderCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.unit_tests.services.test_model_billing_source_variants import (
        _CREDIT_LLM_PROFILES,
        _CREDIT_LLM_REVISION,
        _credit_llm_catalog,
        _credit_llm_credentials,
        _credit_llm_records,
    )

    index = next(
        i
        for i, profile in enumerate(_CREDIT_LLM_PROFILES)
        if profile["source_version"] == version
        and profile["source_model"] == model
        and profile["protocol"] == ("chat" if version == "042" else "responses")
        and profile["source_endpoint_class"] == ("official_root" if official else "unset")
    )
    profile = _CREDIT_LLM_PROFILES[index]
    case = provider_case
    case.provider.models = [_credit_llm_catalog(index)]
    case.provider.plugin_unique_identifier = profile["source_plugin_uid"]
    case.integration.plugin_unique_identifier = "langgenius/tokener:9.9.9@" + "c" * 64
    original = _credit_llm_credentials(index, "absent")
    snapshot = deepcopy(original)
    case.hosting[SOURCE_PROVIDER].credentials = original
    raw = json.dumps(_credit_llm_records())
    digest = source_mapping_revision(raw, _CREDIT_LLM_REVISION).digest
    case.state["model_mapping_version"] = _CREDIT_LLM_REVISION
    case.state["source_variant_registry_digest"] = digest
    preparation = case.state["preparation"]
    assert isinstance(preparation, dict)
    preparation["source_variant_registry_digest"] = digest
    state_before = deepcopy(case.state)
    policy = json.dumps(
        [
            {
                "schema_version": 1,
                "mapping_revision": _CREDIT_LLM_REVISION,
                "inventory_policy": "saved_system_dependencies_v2",
            }
        ]
    )
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=raw, TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=policy
    ):
        config = case.manager.get_configurations(TENANT_ID).get(SOURCE_PROVIDER)
        assert config is not None
        assert config.system_configuration.credentials is None
        routed = config.get_current_credentials(ModelType.LLM, model)
        assert isinstance(routed, RoutedModelCredentials)
        assert dict(routed) == {}
        plan = routed.plan
        assert plan.logical_model == model
        assert plan.target_model == profile["target_model"]
        contract = plan.source_parameter_contract
        assert contract is not None
        assert contract.adapter_id == "openai_credit_llm_source_v1"
        assert contract.source_model == model
        assert contract.profile_id == profile["profile_id"]
        assert plan.source_variant_binding is not None
        assert plan.mapping_revision_digest == digest

        def admit(value: RoutedModelCredentials = routed) -> None:
            validate_invocation_admission(
                value, tenant_id=TENANT_ID, provider=SOURCE_PROVIDER, model_type=ModelType.LLM, model=model
            )

        admit()
        for changed in (
            replace(plan, target_model="unreviewed-target"),
            replace(plan, source_variant_binding=None),
            replace(
                plan, source_parameter_contract=replace(contract, source_runtime_schema_digest="sha256:" + "f" * 64)
            ),
        ):
            assert changed.cache_identity != plan.cache_identity
            with pytest.raises(ModelInvocationReprepare):
                admit(RoutedModelCredentials(changed))
        wrong_kind = replace(plan, model_type=ModelType.TEXT_EMBEDDING)
        assert wrong_kind.cache_identity != plan.cache_identity
        with pytest.raises(ModelRouteUnavailable):
            admit(RoutedModelCredentials(wrong_kind))
        monkeypatch.setattr(
            "core.model_invocation_routing.managed_credentials", lambda _: {"api_key": "MANAGED_TEST_KEY"}
        )
        payload = redirect_payload(plan, {"provider": "openai", "model": model, "model_type": "llm"})
        assert payload["target"]["model"] == profile["target_model"]
        assert payload["target"]["credentials"]["_dify_source_contract"]["source_model"] == model
        assert isinstance(original["api_key"], str)
        assert original["api_key"] not in json.dumps(payload)
        assert "https://api.openai.com" not in json.dumps(payload)
        original["enable_request_metadata"] = "enabled"
        with pytest.raises(ModelInvocationReprepare):
            admit()
        original.pop("enable_request_metadata")
    assert original == snapshot
    assert case.state == state_before
