from unittest.mock import Mock

import pytest

from enums.cloud_plan import CloudPlan
from services import feature_service as feature_service_module
from services.feature_service import FeatureService


@pytest.mark.parametrize(
    ("billing_enabled", "tenant_id", "billing_feature_enabled", "plan", "expected"),
    [
        (False, "tenant-1", True, CloudPlan.PROFESSIONAL, 15),
        (True, None, True, CloudPlan.PROFESSIONAL, 15),
        (True, "tenant-1", False, CloudPlan.PROFESSIONAL, 15),
        (True, "tenant-1", True, CloudPlan.SANDBOX, 15),
        (True, "tenant-1", True, CloudPlan.PROFESSIONAL, 50),
        (True, "tenant-1", True, CloudPlan.TEAM, 50),
    ],
)
def test_get_knowledge_file_size_limit(
    monkeypatch: pytest.MonkeyPatch,
    billing_enabled: bool,
    tenant_id: str | None,
    billing_feature_enabled: bool,
    plan: CloudPlan,
    expected: int,
) -> None:
    monkeypatch.setattr(feature_service_module.dify_config, "BILLING_ENABLED", billing_enabled)
    monkeypatch.setattr(feature_service_module.dify_config, "UPLOAD_FILE_SIZE_LIMIT", 15)
    monkeypatch.setattr(
        feature_service_module.dify_config,
        "KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN",
        50,
    )
    get_info = Mock(
        return_value={
            "enabled": billing_feature_enabled,
            "subscription": {"plan": plan},
        }
    )
    monkeypatch.setattr(feature_service_module.BillingService, "get_info", get_info)

    assert FeatureService.get_knowledge_file_size_limit(tenant_id) == expected

    if billing_enabled and tenant_id:
        get_info.assert_called_once_with(tenant_id, exclude_vector_space=True)
    else:
        get_info.assert_not_called()


def test_paid_knowledge_file_size_limit_never_reduces_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(feature_service_module.dify_config, "BILLING_ENABLED", True)
    monkeypatch.setattr(feature_service_module.dify_config, "UPLOAD_FILE_SIZE_LIMIT", 100)
    monkeypatch.setattr(
        feature_service_module.dify_config,
        "KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN",
        50,
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
