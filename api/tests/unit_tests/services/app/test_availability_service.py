"""Availability resolution caches only for the request and never executes dependencies."""

from dataclasses import replace
from unittest.mock import create_autospec, patch

import pytest

from core.entities.model_entities import ModelStatus, ModelWithProviderEntity
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderNotFoundError
from services.app.availability_service import AppAvailabilityService
from services.entities.app_entities import (
    AppAvailabilityPlan,
    AppModelDependency,
    AppPluginDependency,
    AppRecord,
    AppToolDependency,
)


def record(*dependencies: AppModelDependency | AppToolDependency | AppPluginDependency) -> AppRecord:
    return AppRecord(
        id="app",
        name="Example",
        mode_compatible_with_agent="workflow",
        availability_plan=AppAvailabilityPlan("published", (), dependencies),
    )


@pytest.mark.parametrize("status", list(ModelStatus))
def test_model_status_uses_runtime_provider_configuration(status: ModelStatus) -> None:
    configurations = create_autospec(ProviderConfigurations, instance=True)
    provider = create_autospec(ProviderConfiguration, instance=True)
    model = create_autospec(ModelWithProviderEntity, instance=True)
    model.status = status
    provider.get_provider_model.return_value = model
    configurations.get.return_value = provider
    source = record(AppModelDependency("provider", "model", "llm", "node"))
    with patch("services.app.availability_service.create_plugin_provider_manager", autospec=True) as factory:
        factory.return_value.get_configurations.return_value = configurations
        result = AppAvailabilityService.for_tenant("tenant").evaluate_many([source])[0]
    assert result.availability == ("available" if status == ModelStatus.ACTIVE else "unavailable")
    assert [r.reason for r in result.availability_reasons] == ([] if status == ModelStatus.ACTIVE else [status.value])
    assert result.availability_source == "published"
    assert result.availability_plan is None
    assert source.availability is None


def test_identical_models_are_resolved_once_per_request_not_across_repairs() -> None:
    configurations = create_autospec(ProviderConfigurations, instance=True)
    provider = create_autospec(ProviderConfiguration, instance=True)
    model = create_autospec(ModelWithProviderEntity, instance=True)
    model.status = ModelStatus.DISABLED
    provider.get_provider_model.return_value = model
    configurations.get.return_value = provider
    source = record(
        AppModelDependency("provider", "model", "llm", "first"),
        AppModelDependency("provider", "model", "llm", "second"),
    )
    with patch("services.app.availability_service.create_plugin_provider_manager", autospec=True) as factory:
        factory.return_value.get_configurations.return_value = configurations
        evaluation = AppAvailabilityService.for_tenant("tenant")
        first, second = evaluation.evaluate_many([source, replace(source, id="other")])
        assert len(first.availability_reasons) == len(second.availability_reasons) == 2
        provider.get_provider_model.assert_called_once()
        factory.assert_called_once_with(tenant_id="tenant")
        model.status = ModelStatus.ACTIVE
        repaired = AppAvailabilityService.for_tenant("tenant").evaluate_many([source])[0]
        assert repaired.availability == "available"
        assert provider.get_provider_model.call_count == 2


def test_failed_provider_lookup_is_not_reported_as_a_success_or_leaked_exception() -> None:
    source = record(AppModelDependency("provider", "model", "llm", "node"))
    with patch(
        "services.app.availability_service.create_plugin_provider_manager",
        autospec=True,
        side_effect=RuntimeError("private credential value"),
    ):
        result = AppAvailabilityService.for_tenant("tenant").evaluate_many([source])[0]
    assert result.availability == "unavailable"
    assert result.availability_reasons[0].reason == "evaluation-failed"
    assert "private credential value" not in repr(result)


def test_tool_credential_results_do_not_share_cache_entries() -> None:
    provider = create_autospec(BuiltinToolProviderController, instance=True)
    provider.need_credentials = True
    source = record(
        AppToolDependency("builtin", "provider", "lookup", True, "valid"),
        AppToolDependency("builtin", "provider", "lookup", False, "deleted-credential"),
    )
    with patch(
        "services.app.availability_service.ToolManager.get_builtin_provider",
        autospec=True,
        return_value=provider,
    ):
        result = AppAvailabilityService.for_tenant("tenant").evaluate_many([source])[0]
    assert [(r.resource_id, r.reason) for r in result.availability_reasons] == [
        ("deleted-credential", "no-configure"),
    ]


def test_missing_tool_is_a_repairable_reason() -> None:
    source = record(AppToolDependency("builtin", "provider", "lookup", False, "node"))
    with patch(
        "services.app.availability_service.ToolManager.get_builtin_provider",
        autospec=True,
        side_effect=ToolProviderNotFoundError("missing"),
    ):
        result = AppAvailabilityService.for_tenant("tenant").evaluate_many([source])[0]
    assert result.availability_reasons[0].reason == "missing"


def test_plugin_installation_is_checked_without_invoking_a_tool() -> None:
    source = record(AppPluginDependency("org/plugin", "node"))
    with patch("services.app.availability_service.PluginInstaller", autospec=True) as installer:
        installer.return_value.fetch_plugin_installation_by_ids.return_value = list[object]()
        result = AppAvailabilityService.for_tenant("tenant").evaluate_many([source])[0]
        installer.return_value.fetch_plugin_installation_by_ids.assert_called_once_with("tenant", ["org/plugin"])
    assert result.availability == "unavailable"
    assert result.availability_reasons[0].provider == "org/plugin"
