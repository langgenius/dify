from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from enums import CloudPlan, DeploymentEdition
from services.credit_pool_service import CreditPoolBalance
from services.workspace_service import WorkspaceService


@pytest.mark.parametrize(
    ("quota_limit", "quota_used", "remaining_credits", "is_unlimited"),
    [(500, 120, 380, False), (-1, 999, -1, True)],
)
def test_get_effective_credit_pool_prefers_available_paid_pool(
    quota_limit: int,
    quota_used: int,
    remaining_credits: int,
    is_unlimited: bool,
    unbound_session: Session,
) -> None:
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
    config = SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

    with (
        patch("services.workspace_service.dify_config", config),
        patch("services.workspace_service.BillingService.get_info", return_value=billing_info),
        patch("services.credit_pool_service.CreditPoolService.get_pool", return_value=paid_pool) as get_pool,
    ):
        result = WorkspaceService.get_effective_credit_pool("tenant-1", session=unbound_session)

    get_pool.assert_called_once_with(tenant_id="tenant-1", pool_type="paid", session=unbound_session)
    assert result.pool_type == "paid"
    assert result.quota_limit == quota_limit
    assert result.quota_used == quota_used
    assert result.remaining_credits == remaining_credits
    assert result.is_unlimited is is_unlimited
    assert result.is_exhausted is False
    assert result.next_credit_reset_date == 1775001600


def test_get_effective_credit_pool_exposes_exhausted_trial_pool(unbound_session: Session) -> None:
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
    config = SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

    with (
        patch("services.workspace_service.dify_config", config),
        patch("services.workspace_service.BillingService.get_info", return_value=billing_info),
        patch("services.credit_pool_service.CreditPoolService.get_pool", return_value=trial_pool) as get_pool,
    ):
        result = WorkspaceService.get_effective_credit_pool("tenant-1", session=unbound_session)

    get_pool.assert_called_once_with(tenant_id="tenant-1", pool_type="trial", session=unbound_session)
    assert result.pool_type == "trial"
    assert result.remaining_credits == 0
    assert result.is_unlimited is False
    assert result.is_exhausted is True
    assert result.exhausted_at == 1772323200
