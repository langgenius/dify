from collections.abc import Callable
from unittest.mock import Mock

import pytest

from enums import CloudPlan, DeploymentEdition
from services.feature_service import FeatureService


@pytest.mark.parametrize(
    ("edition", "plan", "expected"),
    [
        (DeploymentEdition.COMMUNITY, CloudPlan.SANDBOX, True),
        (DeploymentEdition.ENTERPRISE, CloudPlan.SANDBOX, True),
        (DeploymentEdition.CLOUD, CloudPlan.SANDBOX, False),
        (DeploymentEdition.CLOUD, CloudPlan.PROFESSIONAL, True),
    ],
)
def test_site_import_entitlement(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    plan: CloudPlan,
    expected: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition)
    get_plan = Mock(return_value=plan)
    monkeypatch.setattr(FeatureService, "get_workspace_plan", get_plan)

    assert FeatureService.can_import_premium_site_settings("tenant-1") is expected
    assert get_plan.call_count == (1 if edition == DeploymentEdition.CLOUD else 0)
