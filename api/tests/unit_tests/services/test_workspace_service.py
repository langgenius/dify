from types import SimpleNamespace
from unittest.mock import call, patch

from sqlalchemy.orm import Session

from enums import CloudPlan, DeploymentEdition
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from services.credit_pool_service import CreditPoolBalance
from services.workspace_service import WorkspaceService


def _persist_membership(session: Session, *, role: TenantAccountRole) -> Tenant:
    tenant = Tenant(name="Workspace")
    session.add_all(
        [
            tenant,
            TenantAccountJoin(tenant_id=tenant.id, account_id="account-1", role=role),
            TenantAccountJoin(tenant_id=tenant.id, account_id="decoy-account", role=TenantAccountRole.NORMAL),
            TenantAccountJoin(tenant_id="decoy-tenant", account_id="account-1", role=TenantAccountRole.NORMAL),
        ]
    )
    session.commit()
    return tenant


def test_get_current_workspace_summary_sandbox_uses_trial_only(sqlite_session: Session) -> None:
    tenant = _persist_membership(sqlite_session, role=TenantAccountRole.OWNER)
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
        result = WorkspaceService.get_current_workspace_summary(tenant, "account-1", session=sqlite_session)

    assert result == {
        "id": tenant.id,
        "name": tenant.name,
        "role": "owner",
        "plan": CloudPlan.SANDBOX,
        "credits": 180,
    }
    get_info.assert_called_once_with(tenant.id, exclude_vector_space=True)
    get_pool.assert_called_once_with(tenant_id=tenant.id, pool_type="trial", session=sqlite_session)
    get_features.assert_not_called()


def test_get_current_workspace_summary_falls_back_from_exhausted_paid_pool(sqlite_session: Session) -> None:
    tenant = _persist_membership(sqlite_session, role=TenantAccountRole.ADMIN)
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
        result = WorkspaceService.get_current_workspace_summary(tenant, "account-1", session=sqlite_session)

    assert result["plan"] == CloudPlan.TEAM
    assert result["credits"] == 60
    assert get_pool.call_args_list == [
        call(tenant_id=tenant.id, pool_type="paid", session=sqlite_session),
        call(tenant_id=tenant.id, pool_type="trial", session=sqlite_session),
    ]


def test_get_current_workspace_summary_non_cloud_skips_billing_and_credits(sqlite_session: Session) -> None:
    tenant = _persist_membership(sqlite_session, role=TenantAccountRole.EDITOR)
    config = SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

    with (
        patch("services.workspace_service.dify_config", config),
        patch("services.workspace_service.BillingService.get_info") as get_info,
        patch("services.credit_pool_service.CreditPoolService.get_pool") as get_pool,
    ):
        result = WorkspaceService.get_current_workspace_summary(tenant, "account-1", session=sqlite_session)

    assert result == {
        "id": tenant.id,
        "name": tenant.name,
        "role": "editor",
        "plan": None,
        "credits": None,
    }
    get_info.assert_not_called()
    get_pool.assert_not_called()
