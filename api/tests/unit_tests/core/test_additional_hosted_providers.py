"""Provider assembly and invocation boundaries for plugins installed after cutover."""

import json
from collections.abc import Iterator
from contextlib import nullcontext
from copy import deepcopy
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pytest_mock import MockerFixture

from core.entities.provider_entities import (
    CustomConfiguration,
    CustomProviderConfiguration,
    ProviderQuotaType,
    QuotaUnit,
)
from core.hosting_configuration import FreeHostingQuota, HostingProvider, PaidHostingQuota, TrialHostingQuota
from core.model_billing_profile import ModelBillingSource, TenantModelBillingResolution
from core.model_invocation_routing import ModelRouteUnavailable, ModelRouteUnmapped, RoutedModelCredentials
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from core.provider_manager import ProviderManager
from enums import DeploymentEdition
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod
from models.provider import ProviderType
from services.entities.model_billing_migration import canonical_hash
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.services.test_model_billing_mapping_service import mapping, schema

TENANT_ID = "11111111-1111-4111-8111-111111111111"
CREDENTIAL_ID = "33333333-3333-4333-8333-333333333333"
PLUGIN_UID = "langgenius/tokener:0.4.1-dev3@fixture"


@dataclass
class ProviderCase:
    manager: ProviderManager
    provider: PluginModelProviderDeclaration
    providers: list[PluginModelProviderDeclaration]
    hosting: dict[str, HostingProvider]
    preferences: dict[str, SimpleNamespace]
    state: dict[str, object]
    init_records: Mock
    get_pool: Mock
    integration: SimpleNamespace


@pytest.fixture
def provider_case(mocker: MockerFixture) -> Iterator[ProviderCase]:
    provider = PluginModelProviderDeclaration(
        provider="langgenius/openai/openai",
        plugin_unique_identifier="langgenius/openai:1.0.8@source",
        installation_source=PluginInstallationSource.Marketplace,
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[schema()],
    )
    providers = [provider]
    hosting = {
        provider.provider: HostingProvider(
            enabled=True,
            quota_unit=QuotaUnit.CREDITS,
            credentials={"api_key": "SOURCE_SECRET"},
            quotas=[PaidHostingQuota(), TrialHostingQuota()],
        )
    }
    preferences: dict[str, SimpleNamespace] = {}
    state: dict[str, object] = {
        "phase": "active",
        "model_mapping_version": "old",
        "route_epoch": 3,
        "source_ownership": {},
        "preparation": {
            "tenant_id": TENANT_ID,
            "provider_credential_id": CREDENTIAL_ID,
            "provider_name": "langgenius/tokener/tokener",
            "credential_fingerprint": canonical_hash({"encrypted_config": '{"api_key":"ENCRYPTED"}'}),
        },
    }
    manager = ProviderManager(model_runtime=Mock())
    mocker.patch(
        "core.provider_manager.ModelBillingProfileService.resolve",
        return_value=TenantModelBillingResolution(ModelBillingSource.TOKENER),
    )
    mocker.patch("core.model_invocation_routing.migration_routing_state", return_value=state)
    mocker.patch("core.plugin.plugin_service.PluginService.is_plugin_verified", return_value=True)
    mocker.patch("core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map", hosting)
    factory = Mock()
    factory.get_providers.return_value = providers
    mocker.patch("core.provider_manager.ModelProviderFactory", return_value=factory)
    mocker.patch.object(manager, "_get_all_providers", return_value={})
    init_records = mocker.patch.object(manager, "_init_trial_provider_records")
    for method in (
        "_get_all_provider_models",
        "_get_all_provider_model_settings",
        "_get_all_provider_load_balancing_configs",
        "_get_all_provider_model_credentials",
        "_get_all_provider_credentials",
    ):
        mocker.patch.object(manager, method, return_value={})
    mocker.patch.object(manager, "_get_all_preferred_model_providers", return_value=preferences)
    mocker.patch.object(manager, "_to_model_settings", return_value=[])
    mocker.patch.object(
        manager,
        "_to_custom_configuration",
        return_value=CustomConfiguration(
            provider=CustomProviderConfiguration(credentials={"api_key": "USER_SECRET"}),
        ),
    )
    get_pool = mocker.patch("services.credit_pool_service.CreditPoolService.get_pool")
    integration = SimpleNamespace(
        status="ready", provider_credential_id=CREDENTIAL_ID, plugin_unique_identifier=PLUGIN_UID
    )
    session = Mock()
    session.scalar.return_value = integration
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(session))
    with config_overrides_context(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps([mapping()])
    ):
        yield ProviderCase(
            manager, provider, providers, hosting, preferences, state, init_records, get_pool, integration
        )


def test_new_provider_without_rows_can_route_without_rewriting_financial_state(provider_case: ProviderCase) -> None:
    original_state = deepcopy(provider_case.state)
    configuration = provider_case.manager.get_configurations(TENANT_ID).get(provider_case.provider.provider)
    assert configuration is not None
    assert configuration.using_provider_type == ProviderType.SYSTEM
    assert configuration.system_configuration.enabled
    assert configuration.system_configuration.current_quota_type == ProviderQuotaType.PAID
    assert configuration.system_configuration.credentials is None
    assert all(
        (quota.quota_limit, quota.quota_used, quota.is_valid) == (0, 0, False)
        for quota in configuration.system_configuration.quota_configurations
    )
    credentials = configuration.get_current_credentials(ModelType.LLM, "gpt-4o")
    assert isinstance(credentials, RoutedModelCredentials)
    assert credentials.plan.logical_provider == provider_case.provider.provider
    assert credentials.plan.logical_model == "gpt-4o"
    assert credentials.plan.target_model == "old-target"
    assert credentials.plan.mapping_revision == "old"
    assert provider_case.state == original_state
    provider_case.init_records.assert_not_called()
    provider_case.get_pool.assert_not_called()


def test_unmapped_provider_is_local_and_explicit_byok_still_works(provider_case: ProviderCase) -> None:
    unmapped = provider_case.provider.model_copy(deep=True, update={"provider": "langgenius/anthropic/anthropic"})
    provider_case.providers.append(unmapped)
    provider_case.hosting[unmapped.provider] = provider_case.hosting[provider_case.provider.provider].model_copy(
        deep=True
    )
    provider_case.preferences[unmapped.provider] = SimpleNamespace(preferred_provider_type=ProviderType.CUSTOM)
    configurations = provider_case.manager.get_configurations(TENANT_ID)
    working = configurations.get(provider_case.provider.provider)
    byok = configurations.get(unmapped.provider)
    assert working is not None
    assert byok is not None
    assert isinstance(working.get_current_credentials(ModelType.LLM, "gpt-4o"), RoutedModelCredentials)
    assert not byok.system_configuration.enabled
    assert byok.using_provider_type == ProviderType.CUSTOM
    assert byok.get_current_credentials(ModelType.LLM, "gpt-4o") == {"api_key": "USER_SECRET"}


@pytest.mark.parametrize("raw_registry", ["[]", json.dumps([mapping(revision="newer")]), "invalid-json"])
def test_unmapped_explicit_system_never_falls_back_to_byok_or_source(
    provider_case: ProviderCase, raw_registry: str
) -> None:
    provider_case.preferences[provider_case.provider.provider] = SimpleNamespace(
        preferred_provider_type=ProviderType.SYSTEM
    )
    with config_overrides_context(TOKENER_LEGACY_MODEL_MAPPING_JSON=raw_registry):
        configuration = provider_case.manager.get_configurations(TENANT_ID).get(provider_case.provider.provider)
        assert configuration is not None
        assert not configuration.system_configuration.enabled
        assert configuration.using_provider_type == ProviderType.SYSTEM
        with pytest.raises(ModelRouteUnmapped):
            configuration.get_current_credentials(ModelType.LLM, "gpt-4o")


def test_unmapped_cloud_default_system_never_silently_uses_existing_byok(provider_case: ProviderCase) -> None:
    with config_overrides_context(TOKENER_LEGACY_MODEL_MAPPING_JSON="[]"):
        configuration = provider_case.manager.get_configurations(TENANT_ID).get(provider_case.provider.provider)
        assert configuration is not None
        assert configuration.preferred_provider_type == ProviderType.SYSTEM
        assert configuration.using_provider_type == ProviderType.SYSTEM
        with pytest.raises(ModelRouteUnmapped):
            configuration.get_current_credentials(ModelType.LLM, "gpt-4o")


@pytest.mark.parametrize("hosting_kind", ["free", "tokens", "unlimited", "unverified", "existing"])
def test_new_hosted_default_does_not_change_other_provider_selection(
    provider_case: ProviderCase, mocker: MockerFixture, hosting_kind: str
) -> None:
    hosting = provider_case.hosting[provider_case.provider.provider]
    if hosting_kind == "free":
        hosting.quotas = [FreeHostingQuota()]
    elif hosting_kind == "tokens":
        hosting.quota_unit = QuotaUnit.TOKENS
    elif hosting_kind == "unlimited":
        hosting.quotas = [TrialHostingQuota(quota_limit=-1)]
    elif hosting_kind == "unverified":
        mocker.patch("core.plugin.plugin_service.PluginService.is_plugin_verified", return_value=False)
    elif hosting_kind == "existing":
        provider_case.state["source_ownership"] = {provider_case.provider.provider: {"current_quota_type": "paid"}}
    with config_overrides_context(TOKENER_LEGACY_MODEL_MAPPING_JSON="[]"):
        configuration = provider_case.manager.get_configurations(TENANT_ID).get(provider_case.provider.provider)
        assert configuration is not None
        assert configuration.using_provider_type == ProviderType.CUSTOM
        assert configuration.get_current_credentials(ModelType.LLM, "gpt-4o") == {"api_key": "USER_SECRET"}


@pytest.mark.parametrize("malformed", [None, "invalid", {}])
def test_existing_malformed_provider_ownership_is_not_treated_as_new(
    provider_case: ProviderCase, mocker: MockerFixture, malformed: object
) -> None:
    provider_case.state["source_ownership"] = {provider_case.provider.provider: malformed}
    # Existing owned rows ensure the prior strict provenance path is evaluated.
    record = SimpleNamespace(
        provider_type=ProviderType.SYSTEM, quota_type=ProviderQuotaType.PAID, quota_used=0, quota_limit=100
    )
    mocker.patch.object(
        provider_case.manager, "_get_all_providers", return_value={provider_case.provider.provider: [record]}
    )
    with pytest.raises(ModelRouteUnavailable):
        provider_case.manager.get_configurations(TENANT_ID)


@pytest.mark.parametrize(
    ("verified", "source"), [(False, PluginInstallationSource.Marketplace), (True, PluginInstallationSource.Package)]
)
def test_new_provider_still_requires_trusted_marketplace_provenance(
    provider_case: ProviderCase, mocker: MockerFixture, verified: bool, source: PluginInstallationSource
) -> None:
    mocker.patch("core.plugin.plugin_service.PluginService.is_plugin_verified", return_value=verified)
    provider_case.provider.installation_source = source
    configuration = provider_case.manager.get_configurations(TENANT_ID).get(provider_case.provider.provider)
    assert configuration is not None
    assert not configuration.system_configuration.enabled


def test_new_provider_checks_pinned_target_minimum_version(provider_case: ProviderCase) -> None:
    provider_case.integration.plugin_unique_identifier = "langgenius/tokener:0.1.1@old"
    configuration = provider_case.manager.get_configurations(TENANT_ID).get(provider_case.provider.provider)
    assert configuration is not None
    with pytest.raises(ModelRouteUnavailable):
        configuration.get_current_credentials(ModelType.LLM, "gpt-4o")


def test_new_provider_cannot_bypass_hosted_model_intersection_via_direct_invocation(
    provider_case: ProviderCase,
) -> None:
    configuration = provider_case.manager.get_configurations(TENANT_ID).get(provider_case.provider.provider)
    assert configuration is not None
    configuration.system_configuration.quota_configurations[0].restrict_models = []
    with pytest.raises(ModelRouteUnmapped):
        configuration.get_current_credentials(ModelType.LLM, "gpt-4o")


def test_schema_change_after_assembly_requires_a_new_reviewed_contract(provider_case: ProviderCase) -> None:
    configuration = provider_case.manager.get_configurations(TENANT_ID).get(provider_case.provider.provider)
    assert configuration is not None
    configuration.provider.models[0].label.en_us = "changed schema"
    with pytest.raises(ModelRouteUnmapped):
        configuration.get_current_credentials(ModelType.LLM, "gpt-4o")
