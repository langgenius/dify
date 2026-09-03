from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import pytest

from core.model_billing_profile import (
    ModelBillingSource,
    TenantModelBillingResolution,
)
from enums import CloudPlan, DeploymentEdition
from models.account import Tenant
from models.tokener import TenantTokenerIntegrationStatus
from services.credit_pool_service import CreditPoolBalance
from services.errors.billing import BillingUpstreamUnavailableError
from services.workspace_service import EffectiveCreditPool, WorkspaceService


@pytest.fixture(autouse=True)
def _legacy_model_billing_profile():
    with patch(
        "services.workspace_service.ModelBillingProfileService.resolve",
        return_value=TenantModelBillingResolution(ModelBillingSource.LEGACY_MESSAGE_CREDITS),
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


def test_get_current_workspace_summary_sandbox_uses_trial_only() -> None:
    tenant = Tenant(name="Workspace")
    membership = SimpleNamespace(role="owner")
    session = MagicMock()
    session.scalar.return_value = membership
    trial_pool = CreditPoolBalance(
        tenant_id=tenant.id,
        pool_type="trial",
        quota_limit=200,
        quota_used=20,
    )
    billing_info = {
        "enabled": True,
        "subscription": {"plan": CloudPlan.SANDBOX},
    }
    config = SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

    with (
        patch("services.workspace_service.dify_config", config),
        patch("services.workspace_service.BillingService.get_info", return_value=billing_info) as get_info,
        patch("services.credit_pool_service.CreditPoolService.get_pool", return_value=trial_pool) as get_pool,
        patch("services.workspace_service.FeatureService.get_features") as get_features,
    ):
        result = WorkspaceService.get_current_workspace_summary(tenant, "account-1", session=session)

    assert result == {
        "id": tenant.id,
        "name": tenant.name,
        "role": "owner",
        "plan": CloudPlan.SANDBOX,
        "credits": 180,
        "model_billing_source": "legacy_message_credits",
        "tokener_bootstrap_status": None,
    }
    get_info.assert_called_once_with(tenant.id, exclude_vector_space=True)
    get_pool.assert_called_once_with(tenant_id=tenant.id, pool_type="trial", session=session)
    get_features.assert_not_called()


def test_get_current_workspace_summary_falls_back_from_exhausted_paid_pool() -> None:
    tenant = Tenant(name="Workspace")
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(role="admin")
    paid_pool = CreditPoolBalance(
        tenant_id=tenant.id,
        pool_type="paid",
        quota_limit=500,
        quota_used=500,
    )
    trial_pool = CreditPoolBalance(
        tenant_id=tenant.id,
        pool_type="trial",
        quota_limit=100,
        quota_used=40,
    )
    billing_info = {
        "enabled": True,
        "subscription": {"plan": CloudPlan.TEAM},
    }
    config = SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

    with (
        patch("services.workspace_service.dify_config", config),
        patch("services.workspace_service.BillingService.get_info", return_value=billing_info),
        patch(
            "services.credit_pool_service.CreditPoolService.get_pool",
            side_effect=[paid_pool, trial_pool],
        ) as get_pool,
    ):
        result = WorkspaceService.get_current_workspace_summary(tenant, "account-1", session=session)

    assert result["plan"] == CloudPlan.TEAM
    assert result["credits"] == 60
    assert get_pool.call_args_list == [
        call(tenant_id=tenant.id, pool_type="paid", session=session),
        call(tenant_id=tenant.id, pool_type="trial", session=session),
    ]


def test_get_current_workspace_summary_non_cloud_skips_billing_and_credits() -> None:
    tenant = Tenant(name="Workspace")
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(role="editor")
    config = SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

    with (
        patch("services.workspace_service.dify_config", config),
        patch("services.workspace_service.BillingService.get_info") as get_info,
        patch("services.credit_pool_service.CreditPoolService.get_pool") as get_pool,
    ):
        result = WorkspaceService.get_current_workspace_summary(tenant, "account-1", session=session)

    assert result == {
        "id": tenant.id,
        "name": tenant.name,
        "role": "editor",
        "plan": None,
        "credits": None,
        "model_billing_source": "legacy_message_credits",
        "tokener_bootstrap_status": None,
    }
    get_info.assert_not_called()
    get_pool.assert_not_called()


@pytest.mark.parametrize(
    "status",
    [
        TenantTokenerIntegrationStatus.PENDING,
        TenantTokenerIntegrationStatus.READY,
        TenantTokenerIntegrationStatus.FAILED,
    ],
)
def test_tokener_workspace_summary_never_reads_legacy_credit_pool(
    status: TenantTokenerIntegrationStatus,
) -> None:
    tenant = Tenant(name="Tokener workspace")
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(role="owner")
    billing_info = {
        "enabled": True,
        "subscription": {"plan": CloudPlan.SANDBOX},
    }
    config = SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    resolution = TenantModelBillingResolution(ModelBillingSource.TOKENER, status)

    with (
        patch("services.workspace_service.dify_config", config),
        patch("services.workspace_service.ModelBillingProfileService.resolve", return_value=resolution),
        patch("services.workspace_service.BillingService.get_info", return_value=billing_info),
        patch("services.credit_pool_service.CreditPoolService.get_pool") as get_pool,
    ):
        result = WorkspaceService.get_current_workspace_summary(tenant, "account-1", session=session)

    assert result["credits"] is None
    assert result["model_billing_source"] == "tokener"
    assert result["tokener_bootstrap_status"] == status.value
    get_pool.assert_not_called()


def test_get_model_provider_credits_enriches_ready_tokener_without_changing_legacy_fields() -> None:
    session = MagicMock()
    credit_pool = EffectiveCreditPool(
        model_billing_source=ModelBillingSource.TOKENER,
        tokener_bootstrap_status=TenantTokenerIntegrationStatus.READY.value,
        plan=CloudPlan.SANDBOX,
    )
    metering = _tokener_metering()
    with (
        patch(
            "services.workspace_service.dify_config",
            SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        ),
        patch.object(WorkspaceService, "get_effective_credit_pool", return_value=credit_pool),
        patch("services.workspace_service.BillingService.get_tokener_metering", return_value=metering) as get_metering,
    ):
        result = WorkspaceService.get_model_provider_credits("tenant-1", session=session)

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
    session = MagicMock()
    with (
        patch(
            "services.workspace_service.dify_config",
            SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        ),
        patch.object(WorkspaceService, "get_effective_credit_pool", return_value=credit_pool),
        patch("services.workspace_service.BillingService.get_tokener_metering") as get_metering,
    ):
        result = WorkspaceService.get_model_provider_credits("tenant-1", session=session)

    assert result is credit_pool
    assert result.tokener_metering is None
    get_metering.assert_not_called()


def test_get_model_provider_credits_keeps_ready_balance_shape_when_metering_is_unavailable() -> None:
    session = MagicMock()
    credit_pool = EffectiveCreditPool(
        model_billing_source=ModelBillingSource.TOKENER,
        tokener_bootstrap_status=TenantTokenerIntegrationStatus.READY.value,
    )
    with (
        patch(
            "services.workspace_service.dify_config",
            SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        ),
        patch.object(WorkspaceService, "get_effective_credit_pool", return_value=credit_pool),
        patch(
            "services.workspace_service.BillingService.get_tokener_metering",
            side_effect=BillingUpstreamUnavailableError,
        ),
    ):
        result = WorkspaceService.get_model_provider_credits("tenant-1", session=session)

    assert result is credit_pool
    assert result.tokener_metering is None


def test_get_tenant_info_uses_authoritative_legacy_profile_for_cloud_credits() -> None:
    tenant = Tenant(name="Legacy workspace")
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(role="owner")
    feature = SimpleNamespace(
        billing=SimpleNamespace(
            enabled=True,
            subscription=SimpleNamespace(plan=CloudPlan.PROFESSIONAL),
        ),
        can_replace_logo=False,
        next_credit_reset_date=1775001600,
    )
    resolution = TenantModelBillingResolution(ModelBillingSource.LEGACY_MESSAGE_CREDITS)
    paid_pool = CreditPoolBalance(
        tenant_id=tenant.id,
        pool_type="paid",
        quota_limit=100,
        quota_used=20,
    )

    with (
        patch("services.workspace_service.current_user", SimpleNamespace(id="account-1")),
        patch(
            "services.workspace_service.dify_config",
            SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        ),
        patch("services.workspace_service.FeatureService.get_features", return_value=feature),
        patch(
            "services.workspace_service.ModelBillingProfileService.resolve",
            return_value=resolution,
        ) as resolve,
        patch("services.credit_pool_service.CreditPoolService.get_pool", return_value=paid_pool) as get_pool,
    ):
        result = WorkspaceService.get_tenant_info(tenant, session)

    assert result is not None
    assert result["model_billing_source"] == "legacy_message_credits"
    assert result["tokener_bootstrap_status"] is None
    assert result["next_credit_reset_date"] == 1775001600
    assert result["trial_credits"] == 100
    assert result["trial_credits_used"] == 20
    resolve.assert_called_once_with(tenant.id, session=session)
    get_pool.assert_called_once_with(tenant_id=tenant.id, pool_type="paid", session=session)


def test_get_tenant_info_tokener_profile_skips_legacy_credit_pool() -> None:
    tenant = Tenant(name="Tokener workspace")
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(role="owner")
    feature = SimpleNamespace(
        billing=SimpleNamespace(
            enabled=True,
            subscription=SimpleNamespace(plan=CloudPlan.PROFESSIONAL),
        ),
        can_replace_logo=False,
        next_credit_reset_date=1775001600,
    )
    resolution = TenantModelBillingResolution(
        ModelBillingSource.TOKENER,
        TenantTokenerIntegrationStatus.PENDING,
    )

    with (
        patch("services.workspace_service.current_user", SimpleNamespace(id="account-1")),
        patch(
            "services.workspace_service.dify_config",
            SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        ),
        patch("services.workspace_service.FeatureService.get_features", return_value=feature),
        patch(
            "services.workspace_service.ModelBillingProfileService.resolve",
            return_value=resolution,
        ) as resolve,
        patch("services.credit_pool_service.CreditPoolService.get_pool") as get_pool,
    ):
        result = WorkspaceService.get_tenant_info(tenant, session)

    assert result is not None
    assert result["model_billing_source"] == "tokener"
    assert result["tokener_bootstrap_status"] == "pending"
    assert "next_credit_reset_date" not in result
    assert "trial_credits" not in result
    assert "trial_credits_used" not in result
    resolve.assert_called_once_with(tenant.id, session=session)
    get_pool.assert_not_called()
