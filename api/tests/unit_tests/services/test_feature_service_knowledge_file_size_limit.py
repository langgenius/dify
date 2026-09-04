from collections.abc import Callable
from unittest.mock import Mock

import pytest

from enums import CloudPlan, DeploymentEdition
from services import feature_service as feature_service_module
from services.feature_service import FeatureService


@pytest.mark.parametrize(
    ("deployment_edition", "tenant_id", "billing_feature_enabled", "plan", "expected"),
    [
        (DeploymentEdition.COMMUNITY, "tenant-1", True, CloudPlan.PROFESSIONAL, 15),
        (DeploymentEdition.ENTERPRISE, "tenant-1", True, CloudPlan.PROFESSIONAL, 15),
        (DeploymentEdition.CLOUD, None, True, CloudPlan.PROFESSIONAL, 15),
        (DeploymentEdition.CLOUD, "tenant-1", False, CloudPlan.PROFESSIONAL, 15),
        (DeploymentEdition.CLOUD, "tenant-1", True, CloudPlan.SANDBOX, 15),
        (DeploymentEdition.CLOUD, "tenant-1", True, CloudPlan.PROFESSIONAL, 50),
        (DeploymentEdition.CLOUD, "tenant-1", True, CloudPlan.TEAM, 50),
    ],
)
def test_get_knowledge_file_size_limit(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    deployment_edition: DeploymentEdition,
    tenant_id: str | None,
    billing_feature_enabled: bool,
    plan: CloudPlan,
    expected: int,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=deployment_edition,
        UPLOAD_FILE_SIZE_LIMIT=15,
        KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN=50,
    )
    get_info = Mock(
        return_value={
            "enabled": billing_feature_enabled,
            "subscription": {"plan": plan},
        }
    )
    monkeypatch.setattr(feature_service_module.BillingService, "get_info", get_info)

    assert FeatureService.get_knowledge_file_size_limit(tenant_id) == expected

    if deployment_edition == DeploymentEdition.CLOUD and tenant_id:
        get_info.assert_called_once_with(tenant_id, exclude_vector_space=True)
    else:
        get_info.assert_not_called()


def test_paid_knowledge_file_size_limit_never_reduces_default(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        UPLOAD_FILE_SIZE_LIMIT=100,
        KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN=50,
    )
    monkeypatch.setattr(
        feature_service_module.BillingService,
        "get_info",
        lambda *_args, **_kwargs: {
            "enabled": True,
            "subscription": {"plan": CloudPlan.PROFESSIONAL},
        },
    )

    assert FeatureService.get_knowledge_file_size_limit("tenant-1") == 100
