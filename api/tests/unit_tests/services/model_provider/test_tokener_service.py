"""Tokener workspace restrictions at the existing provider service boundary."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.model_billing_profile import ModelBillingSource, TenantModelBillingResolution
from core.plugin.entities.plugin import PluginInstallationSource
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderType
from services.model_provider import service as service_module
from services.model_provider.service import ModelProviderService, _ProviderSummaryState
from tests.unit_tests.services.model_provider.test_service import _build_model_provider_binding


@pytest.fixture(autouse=True)
def tokener_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        service_module.ModelBillingProfileService,
        "resolve",
        MagicMock(return_value=TenantModelBillingResolution(ModelBillingSource.TOKENER)),
    )


def test_tokener_provider_summary_disables_system_but_keeps_custom_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    binding = _build_model_provider_binding(PluginInstallationSource.Marketplace)
    provider = SimpleNamespace(
        provider="langgenius/openai/openai",
        label=I18nObject(en_US="OpenAI"),
        description=None,
        icon_small=None,
        icon_small_dark=None,
        supported_model_types=[ModelType.LLM],
        configurate_methods=[],
    )
    monkeypatch.setattr(service_module.PluginService, "list_model_provider_bindings", MagicMock(return_value=[binding]))
    monkeypatch.setattr(
        service_module.PluginService, "fetch_plugin_model_providers", MagicMock(return_value=[provider])
    )
    monkeypatch.setattr(
        ModelProviderService,
        "_load_provider_summary_states",
        MagicMock(return_value={provider.provider: _ProviderSummaryState(has_custom_provider=True)}),
    )
    monkeypatch.setattr(
        service_module.ext_hosting_provider.hosting_configuration,
        "provider_map",
        {provider.provider: SimpleNamespace(enabled=True, quotas=[SimpleNamespace()])},
    )
    providers, _ = ModelProviderService().get_provider_summary_list("tenant-1")
    assert providers[0].system_configuration.enabled is False
    assert providers[0].preferred_provider_type == ProviderType.CUSTOM


def test_tokener_workspace_rejects_switch_to_system(monkeypatch: pytest.MonkeyPatch) -> None:
    service = ModelProviderService()
    get_configuration = MagicMock()
    monkeypatch.setattr(service, "_get_provider_configuration", get_configuration)
    with pytest.raises(ValueError, match="Hosted SYSTEM providers are disabled"):
        service.switch_preferred_provider(
            tenant_id="tenant-1",
            provider="openai",
            preferred_provider_type=ProviderType.SYSTEM.value,
        )
    get_configuration.assert_not_called()


def test_empty_feature_tenant_keeps_legacy_defaults_without_profile_query(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.feature_service import FeatureService

    resolve = MagicMock()
    monkeypatch.setattr(service_module.ModelBillingProfileService, "resolve", resolve)
    features = FeatureService.get_features("")
    assert features.model_billing_source == "legacy_message_credits"
    resolve.assert_not_called()
