"""Tokener migration fences and workspace credit display regressions."""

from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from core.model_billing_profile import ModelBillingSource, TenantModelBillingResolution
from enums import CloudPlan, DeploymentEdition
from models.tokener import TenantTokenerIntegrationStatus
from services.credit_pool_service import CreditPoolBalance
from services.errors.billing import BillingUpstreamUnavailableError, LegacyCreditPoolManagedByTokenerError
from services.workspace.contracts import EffectiveCreditPool
from services.workspace.gateways import DeploymentWorkspaceFeatureGateway


@pytest.fixture(autouse=True)
def _legacy_model_billing_profile() -> Iterator[None]:
    with (
        patch(
            "services.workspace.gateways.ModelBillingProfileService.resolve",
            return_value=TenantModelBillingResolution(ModelBillingSource.LEGACY_MESSAGE_CREDITS),
        ),
        patch("core.model_invocation_routing.migration_display_status", return_value="none"),
    ):
        yield


def _tokener_metering() -> dict[str, object]:
    return {
        "tenant_id": "tenant-1",
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


def test_migration_processing_is_not_displayed_as_zero_or_old_credit_balance(mocker):
    mocker.patch("core.model_invocation_routing.migration_display_status", return_value="processing")
    get_pool = mocker.patch.object(DeploymentWorkspaceFeatureGateway, "get_effective_credit_pool")
    get_metering = mocker.patch("services.workspace.gateways.BillingService.get_tokener_metering")
    result = DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant-1")
    assert result.model_billing_migration_status == "processing"
    assert result.remaining_credits is None
    assert result.is_exhausted is False
    assert result.tokener_metering is None
    get_pool.assert_not_called()
    get_metering.assert_not_called()


def test_get_model_provider_credits_enriches_ready_tokener_without_changing_legacy_fields() -> None:
    credit_pool = EffectiveCreditPool(
        model_billing_source=ModelBillingSource.TOKENER,
        tokener_bootstrap_status=TenantTokenerIntegrationStatus.READY.value,
        plan=CloudPlan.SANDBOX,
    )
    metering = _tokener_metering()
    with (
        patch(
            "services.workspace.gateways.dify_config",
            SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        ),
        patch.object(DeploymentWorkspaceFeatureGateway, "get_effective_credit_pool", return_value=credit_pool),
        patch("services.workspace.gateways.BillingService.get_tokener_metering", return_value=metering) as get_metering,
    ):
        result = DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant-1")

    assert result.tokener_metering == metering
    assert result.remaining_credits is None
    assert result.is_exhausted is False
    get_metering.assert_called_once_with("tenant-1")


@pytest.mark.parametrize(
    "credit_pool",
    [
        EffectiveCreditPool(model_billing_source=ModelBillingSource.LEGACY_MESSAGE_CREDITS),
        EffectiveCreditPool(
            model_billing_source=ModelBillingSource.TOKENER,
            tokener_bootstrap_status=TenantTokenerIntegrationStatus.PENDING.value,
        ),
    ],
)
def test_get_model_provider_credits_does_not_query_metering_for_legacy_or_pending(
    credit_pool: EffectiveCreditPool,
) -> None:
    with (
        patch(
            "services.workspace.gateways.dify_config",
            SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        ),
        patch.object(DeploymentWorkspaceFeatureGateway, "get_effective_credit_pool", return_value=credit_pool),
        patch("services.workspace.gateways.BillingService.get_tokener_metering") as get_metering,
    ):
        result = DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant-1")

    assert result is credit_pool
    assert result.tokener_metering is None
    get_metering.assert_not_called()


def test_get_model_provider_credits_keeps_ready_balance_shape_when_metering_is_unavailable() -> None:
    credit_pool = EffectiveCreditPool(
        model_billing_source=ModelBillingSource.TOKENER,
        tokener_bootstrap_status=TenantTokenerIntegrationStatus.READY.value,
    )
    with (
        patch(
            "services.workspace.gateways.dify_config",
            SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        ),
        patch.object(DeploymentWorkspaceFeatureGateway, "get_effective_credit_pool", return_value=credit_pool),
        patch(
            "services.workspace.gateways.BillingService.get_tokener_metering",
            side_effect=BillingUpstreamUnavailableError,
        ),
    ):
        result = DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant-1")

    assert result is credit_pool
    assert result.tokener_metering is None


def test_preparation_still_displays_legacy_balance(mocker):
    mocker.patch("core.model_invocation_routing.migration_display_status", return_value="preparing")
    mocker.patch("services.workspace.gateways.dify_config", DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    mocker.patch(
        "services.workspace.gateways.BillingService.get_info", return_value={"subscription": {"plan": "professional"}}
    )
    get_pool = mocker.patch(
        "services.credit_pool_service.CreditPoolService.get_pool",
        return_value=CreditPoolBalance(tenant_id="tenant-1", pool_type="paid", quota_limit=100, quota_used=20),
    )

    result = DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant-1")

    assert result.remaining_credits == 80
    assert result.model_billing_migration_status == "preparing"
    assert get_pool.call_args.kwargs["pool_type"] == "paid"


@pytest.mark.parametrize("latest_status", ["processing", "active"])
def test_balance_read_claim_race_uses_refreshed_authority_without_trial_fallback(mocker, latest_status):
    # Provider display reads first, effective summary reads second, and only the
    # exact Billing denial triggers a third authoritative read after claim wins.
    status = mocker.patch(
        "core.model_invocation_routing.migration_display_status", side_effect=["preparing", "preparing", latest_status]
    )
    mocker.patch("services.workspace.gateways.dify_config", DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    mocker.patch(
        "services.workspace.gateways.BillingService.get_info", return_value={"subscription": {"plan": "professional"}}
    )
    get_pool = mocker.patch(
        "services.credit_pool_service.CreditPoolService.get_pool", side_effect=LegacyCreditPoolManagedByTokenerError
    )
    get_metering = mocker.patch("services.workspace.gateways.BillingService.get_tokener_metering")

    result = DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant-1")

    assert result.model_billing_migration_status == latest_status
    assert result.model_billing_source == (
        ModelBillingSource.TOKENER if latest_status == "active" else ModelBillingSource.LEGACY_MESSAGE_CREDITS
    )
    assert result.plan == CloudPlan.PROFESSIONAL
    assert result.remaining_credits is None
    assert not result.is_exhausted
    assert status.call_count == 3
    get_pool.assert_called_once()
    get_metering.assert_not_called()


@pytest.mark.parametrize("latest_status", ["none", "preparing"])
def test_unconfirmed_billing_fence_is_not_masked(mocker, latest_status):
    mocker.patch("core.model_invocation_routing.migration_display_status", return_value=latest_status)
    mocker.patch("services.workspace.gateways.dify_config", DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    mocker.patch(
        "services.workspace.gateways.BillingService.get_info", return_value={"subscription": {"plan": "professional"}}
    )
    get_pool = mocker.patch(
        "services.credit_pool_service.CreditPoolService.get_pool", side_effect=LegacyCreditPoolManagedByTokenerError
    )

    with pytest.raises(LegacyCreditPoolManagedByTokenerError):
        DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant-1")
    get_pool.assert_called_once()


def test_unrelated_billing_outage_is_not_masked(mocker):
    status = mocker.patch("core.model_invocation_routing.migration_display_status", return_value="preparing")
    mocker.patch("services.workspace.gateways.dify_config", DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    mocker.patch(
        "services.workspace.gateways.BillingService.get_info", return_value={"subscription": {"plan": "professional"}}
    )
    mocker.patch("services.credit_pool_service.CreditPoolService.get_pool", side_effect=BillingUpstreamUnavailableError)

    with pytest.raises(BillingUpstreamUnavailableError):
        DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant-1")
    status.assert_called_once()
