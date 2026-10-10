"""Tokener migration fences and workspace credit display regressions."""

from collections.abc import Callable, Iterator
from datetime import datetime
from types import SimpleNamespace
from typing import Literal
from unittest.mock import create_autospec, patch

import pytest
from pytest_mock import MockerFixture

from core.model_billing_profile import ModelBillingSource, TenantModelBillingResolution
from enums import CloudPlan, DeploymentEdition
from machinery.context import RequestContext
from models.tokener import TenantTokenerIntegrationStatus
from services.credit_pool_service import CreditPoolBalance
from services.entities.feature_entities import FeatureModel
from services.errors.billing import BillingUpstreamUnavailableError, LegacyCreditPoolManagedByTokenerError
from services.workspace.contracts import EffectiveCreditPool, WorkspaceSnapshot
from services.workspace.gateways import DeploymentWorkspaceFeatureGateway
from services.workspace.service import WorkspaceLogoGateway, WorkspaceService, WorkspaceStore


@pytest.mark.parametrize("migration_status", ["none", "preparing", "processing", "active"])
@pytest.mark.parametrize("tokener_enabled", [False, True], ids=["legacy", "tokener"])
def test_workspace_reads_preserve_migration_status_without_fenced_legacy_balances(
    config_overrides: Callable[..., None],
    migration_status: Literal["none", "preparing", "processing", "active"],
    tokener_enabled: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    source = ModelBillingSource.TOKENER if tokener_enabled else ModelBillingSource.LEGACY_MESSAGE_CREDITS
    profile = TenantModelBillingResolution(source, TenantTokenerIntegrationStatus.READY if tokener_enabled else None)
    feature = FeatureModel(model_billing_migration_status=migration_status)
    feature.billing.subscription.plan = CloudPlan.PROFESSIONAL
    feature.next_credit_reset_date = 1775001600
    context = RequestContext("request", None, "account", "workspace")
    snapshot = WorkspaceSnapshot("workspace", "Test", "normal", datetime(2026, 1, 1), "owner")
    store = create_autospec(WorkspaceStore, instance=True)
    store.get_for_account.return_value = snapshot
    store.switch.return_value = snapshot
    service = WorkspaceService(
        workspaces=store,
        features=DeploymentWorkspaceFeatureGateway(),
        logos=create_autospec(WorkspaceLogoGateway, instance=True),
    )
    with (
        patch("core.model_invocation_routing.migration_display_status", return_value=migration_status),
        patch("services.workspace.gateways.ModelBillingProfileService.resolve", return_value=profile),
        patch("services.workspace.gateways.FeatureService.get_features", return_value=feature),
        patch(
            "services.workspace.gateways.BillingService.get_info",
            return_value={"subscription": {"plan": "professional"}},
        ),
        patch(
            "services.workspace.gateways.CreditPoolService.get_pool",
            return_value=CreditPoolBalance("workspace", "paid", 100, 20),
        ) as get_pool,
    ):
        summary = service.current_summary(context)
        info = service.switch(context, "workspace")

    expected_source = "tokener" if tokener_enabled or migration_status == "active" else "legacy_message_credits"
    for response in (summary, info):
        assert response["plan"] == CloudPlan.PROFESSIONAL
        assert response["model_billing_source"] == expected_source
        assert response["model_billing_migration_status"] == migration_status
        assert response["tokener_bootstrap_status"] == ("ready" if tokener_enabled else None)
    if tokener_enabled or migration_status in {"processing", "active"}:
        assert summary["credits"] is None
        assert "trial_credits" not in info
        assert "trial_credits_used" not in info
        assert "next_credit_reset_date" not in info
        get_pool.assert_not_called()
    else:
        assert summary["credits"] == 80
        assert info["trial_credits"] == 100
        assert info["trial_credits_used"] == 20
        assert info["next_credit_reset_date"] == 1775001600
        assert get_pool.call_count == 2


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


def test_migration_processing_is_not_displayed_as_zero_or_old_credit_balance(mocker: MockerFixture) -> None:
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


def test_preparation_still_displays_legacy_balance(mocker: MockerFixture) -> None:
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
def test_balance_read_claim_race_uses_refreshed_authority_without_trial_fallback(
    mocker: MockerFixture, latest_status: str
) -> None:
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
def test_unconfirmed_billing_fence_is_not_masked(mocker: MockerFixture, latest_status: str) -> None:
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


def test_unrelated_billing_outage_is_not_masked(mocker: MockerFixture) -> None:
    status = mocker.patch("core.model_invocation_routing.migration_display_status", return_value="preparing")
    mocker.patch("services.workspace.gateways.dify_config", DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    mocker.patch(
        "services.workspace.gateways.BillingService.get_info", return_value={"subscription": {"plan": "professional"}}
    )
    mocker.patch("services.credit_pool_service.CreditPoolService.get_pool", side_effect=BillingUpstreamUnavailableError)

    with pytest.raises(BillingUpstreamUnavailableError):
        DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant-1")
    status.assert_called_once()
