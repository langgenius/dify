"""Deployment billing adapter and paid-to-trial fallback regressions."""

from collections.abc import Callable
from unittest.mock import Mock

import pytest

from core.model_billing_profile import ModelBillingSource, TenantModelBillingResolution
from enums import CloudPlan, DeploymentEdition
from models.tokener import TenantTokenerIntegrationStatus
from services.credit_pool_service import CreditPoolBalance
from services.errors.billing import BillingUpstreamUnavailableError, LegacyCreditPoolManagedByTokenerError
from services.workspace import gateways
from services.workspace.contracts import EffectiveCreditPool
from services.workspace.gateways import DeploymentWorkspaceFeatureGateway


@pytest.fixture(autouse=True)
def legacy_billing_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", Mock(return_value="none"))
    monkeypatch.setattr(
        gateways.ModelBillingProfileService,
        "resolve",
        Mock(return_value=TenantModelBillingResolution(ModelBillingSource.LEGACY_MESSAGE_CREDITS)),
    )


def test_migration_processing_does_not_display_old_balance(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", Mock(return_value="processing"))
    get_pool = Mock()
    monkeypatch.setattr(DeploymentWorkspaceFeatureGateway, "get_effective_credit_pool", get_pool)
    get_metering = Mock()
    monkeypatch.setattr(gateways.BillingService, "get_tokener_metering", get_metering)
    result = DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant")
    assert result.model_billing_migration_status == "processing"
    assert result.remaining_credits is None
    assert not result.is_exhausted
    assert result.tokener_metering is None
    get_pool.assert_not_called()
    get_metering.assert_not_called()


@pytest.mark.parametrize("status", list(TenantTokenerIntegrationStatus))
def test_tokener_never_reads_legacy_credit_pool(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], status: TenantTokenerIntegrationStatus
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr(
        gateways.ModelBillingProfileService,
        "resolve",
        Mock(return_value=TenantModelBillingResolution(ModelBillingSource.TOKENER, status)),
    )
    monkeypatch.setattr(
        gateways.BillingService, "get_info", Mock(return_value={"subscription": {"plan": CloudPlan.SANDBOX}})
    )
    get_pool = Mock()
    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", get_pool)
    result = DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
    assert result.plan == CloudPlan.SANDBOX
    assert result.remaining_credits is None
    assert not result.is_exhausted
    assert result.model_billing_source == ModelBillingSource.TOKENER
    assert result.tokener_bootstrap_status == status.value
    get_pool.assert_not_called()


def test_ready_tokener_enriches_metering_without_changing_legacy_fields(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    credits = EffectiveCreditPool(
        model_billing_source=ModelBillingSource.TOKENER,
        tokener_bootstrap_status=TenantTokenerIntegrationStatus.READY.value,
        plan=CloudPlan.SANDBOX,
    )
    metering = {
        "tenant_id": "tenant",
        "currency": "USD",
        "available_usd_micro": "12500000",
        "current_month": {
            "status": "available",
            "start_date": "2026-09-01",
            "end_date": "2026-09-03",
            "billed_usd_micro": "3750000",
            "request_count": "42",
        },
        "balance_generated_at": "2026-09-03T06:00:00Z",
        "usage_generated_at": "2026-09-03T05:59:30Z",
    }
    monkeypatch.setattr(DeploymentWorkspaceFeatureGateway, "get_effective_credit_pool", Mock(return_value=credits))
    get_metering = Mock(return_value=metering)
    monkeypatch.setattr(gateways.BillingService, "get_tokener_metering", get_metering)
    result = DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant")
    assert result.tokener_metering == metering
    assert result.remaining_credits is None
    assert not result.is_exhausted
    get_metering.assert_called_once_with("tenant")


@pytest.mark.parametrize(
    "credits",
    [
        EffectiveCreditPool(),
        EffectiveCreditPool(
            model_billing_source=ModelBillingSource.TOKENER,
            tokener_bootstrap_status=TenantTokenerIntegrationStatus.PENDING.value,
        ),
    ],
)
def test_legacy_or_pending_does_not_query_metering(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], credits: EffectiveCreditPool
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr(DeploymentWorkspaceFeatureGateway, "get_effective_credit_pool", Mock(return_value=credits))
    get_metering = Mock()
    monkeypatch.setattr(gateways.BillingService, "get_tokener_metering", get_metering)
    assert DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant") is credits
    get_metering.assert_not_called()


def test_metering_outage_keeps_ready_balance_shape(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    credits = EffectiveCreditPool(
        model_billing_source=ModelBillingSource.TOKENER,
        tokener_bootstrap_status=TenantTokenerIntegrationStatus.READY.value,
    )
    monkeypatch.setattr(DeploymentWorkspaceFeatureGateway, "get_effective_credit_pool", Mock(return_value=credits))
    monkeypatch.setattr(
        gateways.BillingService, "get_tokener_metering", Mock(side_effect=BillingUpstreamUnavailableError)
    )
    assert DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant") is credits


@pytest.mark.parametrize("migration_status", ["processing", "active"])
def test_workspace_credit_snapshot_never_reads_fenced_balance(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], migration_status: str
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", Mock(return_value=migration_status))
    monkeypatch.setattr(
        gateways.BillingService, "get_info", Mock(return_value={"subscription": {"plan": "professional"}})
    )
    get_pool = Mock()
    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", get_pool)
    result = DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
    assert result.plan == CloudPlan.PROFESSIONAL
    assert result.remaining_credits is None
    assert not result.is_exhausted
    assert result.model_billing_migration_status == migration_status
    assert result.model_billing_source == ("tokener" if migration_status == "active" else "legacy_message_credits")
    get_pool.assert_not_called()


def test_preparation_still_displays_legacy_balance(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", Mock(return_value="preparing"))
    monkeypatch.setattr(
        gateways.BillingService, "get_info", Mock(return_value={"subscription": {"plan": "professional"}})
    )
    get_pool = Mock(return_value=CreditPoolBalance("tenant", "paid", 100, 20))
    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", get_pool)
    result = DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
    assert result.remaining_credits == 80
    assert result.model_billing_migration_status == "preparing"
    get_pool.assert_called_once_with(tenant_id="tenant", pool_type="paid")


@pytest.mark.parametrize("latest_status", ["processing", "active"])
def test_claim_race_refreshes_authority_without_trial_fallback(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], latest_status: str
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    status = Mock(side_effect=["preparing", "preparing", latest_status])
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", status)
    monkeypatch.setattr(
        gateways.BillingService, "get_info", Mock(return_value={"subscription": {"plan": "professional"}})
    )
    get_pool = Mock(side_effect=LegacyCreditPoolManagedByTokenerError)
    get_metering = Mock()
    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", get_pool)
    monkeypatch.setattr(gateways.BillingService, "get_tokener_metering", get_metering)
    result = DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant")
    assert result.model_billing_migration_status == latest_status
    assert result.model_billing_source == ("tokener" if latest_status == "active" else "legacy_message_credits")
    assert result.plan == CloudPlan.PROFESSIONAL
    assert result.remaining_credits is None
    assert not result.is_exhausted
    assert status.call_count == 3
    get_pool.assert_called_once()
    get_metering.assert_not_called()


@pytest.mark.parametrize("latest_status", ["none", "preparing"])
def test_unconfirmed_billing_fence_is_not_masked(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], latest_status: str
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", Mock(return_value=latest_status))
    monkeypatch.setattr(
        gateways.BillingService, "get_info", Mock(return_value={"subscription": {"plan": "professional"}})
    )
    get_pool = Mock(side_effect=LegacyCreditPoolManagedByTokenerError)
    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", get_pool)
    with pytest.raises(LegacyCreditPoolManagedByTokenerError):
        DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
    get_pool.assert_called_once()


def test_unrelated_billing_outage_is_not_masked(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    status = Mock(return_value="preparing")
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", status)
    monkeypatch.setattr(
        gateways.BillingService, "get_info", Mock(return_value={"subscription": {"plan": "professional"}})
    )
    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", Mock(side_effect=BillingUpstreamUnavailableError))
    with pytest.raises(BillingUpstreamUnavailableError):
        DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
    status.assert_called_once()
