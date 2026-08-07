from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import pytest

from enums.cloud_plan import CloudPlan
from models.account import Tenant
from services.credit_pool_service import CreditPoolBalance
from services.workspace_service import WorkspaceService


@pytest.mark.parametrize(
    ("quota_limit", "quota_used", "remaining_credits", "is_unlimited"),
    [(500, 120, 380, False), (-1, 999, -1, True)],
)
def test_get_effective_credit_pool_prefers_available_paid_pool(
    quota_limit: int, quota_used: int, remaining_credits: int, is_unlimited: bool
) -> None:
    session = MagicMock()
    paid_pool = CreditPoolBalance(
        tenant_id="tenant-1",
        pool_type="paid",
        quota_limit=quota_limit,
        quota_used=quota_used,
    )
    billing_info = {
        "enabled": True,
        "subscription": {"plan": CloudPlan.TEAM},
        "next_credit_reset_date": 1775001600,
    }
    config = SimpleNamespace(BILLING_ENABLED=True)

    with (
        patch("services.workspace_service.dify_config", config),
        patch("services.workspace_service.BillingService.get_info", return_value=billing_info),
        patch("services.credit_pool_service.CreditPoolService.get_pool", return_value=paid_pool) as get_pool,
    ):
        result = WorkspaceService.get_effective_credit_pool("tenant-1", session=session)

    get_pool.assert_called_once_with(tenant_id="tenant-1", pool_type="paid", session=session)
    assert result.pool_type == "paid"
    assert result.quota_limit == quota_limit
    assert result.quota_used == quota_used
    assert result.remaining_credits == remaining_credits
    assert result.is_unlimited is is_unlimited
    assert result.is_exhausted is False
    assert result.next_credit_reset_date == 1775001600


def test_get_effective_credit_pool_exposes_exhausted_trial_pool() -> None:
    session = MagicMock()
    trial_pool = CreditPoolBalance(
        tenant_id="tenant-1",
        pool_type="trial",
        quota_limit=200,
        quota_used=200,
        exhausted_at=1772323200,
    )
    billing_info = {
        "enabled": True,
        "subscription": {"plan": CloudPlan.SANDBOX},
    }
    config = SimpleNamespace(BILLING_ENABLED=True)

    with (
        patch("services.workspace_service.dify_config", config),
        patch("services.workspace_service.BillingService.get_info", return_value=billing_info),
        patch("services.credit_pool_service.CreditPoolService.get_pool", return_value=trial_pool) as get_pool,
    ):
        result = WorkspaceService.get_effective_credit_pool("tenant-1", session=session)

    get_pool.assert_called_once_with(tenant_id="tenant-1", pool_type="trial", session=session)
    assert result.pool_type == "trial"
    assert result.remaining_credits == 0
    assert result.is_unlimited is False
    assert result.is_exhausted is True
    assert result.exhausted_at == 1772323200


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
    config = SimpleNamespace(BILLING_ENABLED=True)

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
    config = SimpleNamespace(BILLING_ENABLED=True)

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


def test_get_current_workspace_summary_billing_disabled_skips_billing_and_credits() -> None:
    tenant = Tenant(name="Workspace")
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(role="editor")
    config = SimpleNamespace(BILLING_ENABLED=False)

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
    }
    get_info.assert_not_called()
    get_pool.assert_not_called()
