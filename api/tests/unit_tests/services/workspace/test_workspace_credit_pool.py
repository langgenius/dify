"""Deployment billing adapter and paid-to-trial fallback regressions."""

from collections.abc import Callable
from unittest.mock import Mock

import pytest

from enums import CloudPlan, DeploymentEdition
from services.credit_pool_service import CreditPoolBalance
from services.entities.feature_entities import FeatureModel
from services.workspace import gateways
from services.workspace.gateways import DeploymentWorkspaceFeatureGateway, DeploymentWorkspacePlanGateway


@pytest.mark.parametrize(
    ("plan", "paid_quota", "paid_used", "trial_quota", "expected_type", "remaining"),
    [
        (CloudPlan.TEAM, 500, 120, 100, "paid", 380),
        (CloudPlan.TEAM, -1, 999, 100, "paid", -1),
        (CloudPlan.TEAM, 500, 500, 100, "trial", 60),
        (CloudPlan.TEAM, None, 0, 100, "trial", 60),
        (CloudPlan.SANDBOX, 500, 0, 100, "trial", 60),
        (CloudPlan.SANDBOX, None, 0, None, None, None),
    ],
)
def test_effective_credit_pool(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    plan: CloudPlan | None,
    paid_quota: int | None,
    paid_used: int,
    trial_quota: int | None,
    expected_type: str | None,
    remaining: int | None,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr(
        gateways.BillingService,
        "get_info",
        lambda *_a, **_k: {"subscription": {"plan": plan}, "next_credit_reset_date": 1775001600},
    )
    paid = CreditPoolBalance("tenant", "paid", paid_quota, paid_used) if paid_quota is not None else None
    trial = CreditPoolBalance("tenant", "trial", trial_quota, 40) if trial_quota is not None else None
    calls = []

    def get_pool(*, tenant_id: str, pool_type: str) -> CreditPoolBalance | None:
        calls.append((tenant_id, pool_type))
        return paid if pool_type == "paid" else trial

    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", get_pool)
    result = DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
    assert result.pool_type == expected_type
    assert result.remaining_credits == remaining
    assert result.next_credit_reset_date == 1775001600
    if plan == CloudPlan.SANDBOX:
        assert calls == [("tenant", "trial")]
    elif expected_type == "paid":
        assert calls == [("tenant", "paid")]
    else:
        assert calls == [("tenant", "paid"), ("tenant", "trial")]


@pytest.mark.parametrize(
    ("quota", "used", "exhausted_at", "expected"),
    [(100, 100, 123, 123), (100, 10, 123, None), (-1, 100, 123, None), (100, 100, 0, None)],
)
def test_feature_info_uses_same_pool_rules(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    quota: int,
    used: int,
    exhausted_at: int | None,
    expected: int | None,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    features = FeatureModel(can_replace_logo=True)
    monkeypatch.setattr(gateways.FeatureService, "get_features", lambda *_a, **_k: features)
    monkeypatch.setattr(
        gateways.CreditPoolService,
        "get_pool",
        lambda **_k: CreditPoolBalance("tenant", "trial", quota, used, exhausted_at),
    )
    result = DeploymentWorkspaceFeatureGateway().get_features("tenant")
    assert result.can_replace_logo
    assert result.credits.exhausted_at == expected


@pytest.mark.parametrize("edition", [DeploymentEdition.COMMUNITY, DeploymentEdition.ENTERPRISE])
def test_non_cloud_summary_skips_external_io(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], edition: DeploymentEdition
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition)
    billing = Mock(side_effect=AssertionError("billing must not be queried"))
    monkeypatch.setattr(gateways.BillingService, "get_info", billing)
    result = DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
    assert result.plan is None
    assert result.remaining_credits is None
    billing.assert_not_called()


@pytest.mark.parametrize(
    ("edition", "bulk", "expected", "fallback_ids"),
    [
        (DeploymentEdition.CLOUD, {"w1": {"plan": "team"}}, {"w1": "team", "w2": "professional"}, ["w2"]),
        (DeploymentEdition.CLOUD, {}, {"w1": "professional", "w2": "professional"}, ["w1", "w2"]),
        (DeploymentEdition.COMMUNITY, {}, {"w1": "professional", "w2": "professional"}, ["w1", "w2"]),
        (DeploymentEdition.ENTERPRISE, {}, {"w1": "sandbox", "w2": "sandbox"}, []),
    ],
)
def test_plan_gateway_bulk_and_fallback(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    bulk: dict[str, dict[str, str]],
    expected: int | None,
    fallback_ids: list[str],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition)
    bulk_query = Mock(return_value=bulk)
    features = FeatureModel()
    features.billing.subscription.plan = CloudPlan.PROFESSIONAL
    feature_query = Mock(return_value=features)
    monkeypatch.setattr(gateways.BillingService, "get_plan_bulk", bulk_query)
    monkeypatch.setattr(gateways.FeatureService, "get_features", feature_query)
    assert DeploymentWorkspacePlanGateway().resolve_many(["w1", "w2"]) == expected
    assert [call.args[0] for call in feature_query.call_args_list] == fallback_ids
    assert bulk_query.call_count == int(edition == DeploymentEdition.CLOUD)
