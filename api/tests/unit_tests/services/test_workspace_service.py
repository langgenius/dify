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
from services.workspace_service import WorkspaceService


@pytest.fixture(autouse=True)
def _legacy_model_billing_profile():
    with patch(
        "services.workspace_service.ModelBillingProfileService.resolve",
        return_value=TenantModelBillingResolution(ModelBillingSource.LEGACY_MESSAGE_CREDITS),
    ):
        yield


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
