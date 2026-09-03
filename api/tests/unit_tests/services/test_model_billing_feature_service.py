from collections.abc import Callable
from unittest.mock import MagicMock

import pytest

from enums import DeploymentEdition
from models.tokener import TenantTokenerIntegrationStatus
from services import feature_service as feature_service_module
from services.feature_service import FeatureService
from services.model_billing_profile_service import (
    ModelBillingProfileResolutionError,
    ModelBillingSource,
    TenantModelBillingResolution,
)


@pytest.mark.parametrize(
    "status",
    [
        TenantTokenerIntegrationStatus.PENDING,
        TenantTokenerIntegrationStatus.READY,
        TenantTokenerIntegrationStatus.FAILED,
    ],
)
def test_feature_api_exposes_normalized_tokener_status(
    status: TenantTokenerIntegrationStatus,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    monkeypatch.setattr(
        feature_service_module.ModelBillingProfileService,
        "resolve",
        MagicMock(return_value=TenantModelBillingResolution(ModelBillingSource.TOKENER, status)),
    )

    features = FeatureService.get_features("tenant-1")

    assert features.model_billing_source == "tokener"
    assert features.tokener_bootstrap_status == status.value


def test_feature_api_propagates_profile_unavailable_as_503(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    monkeypatch.setattr(
        feature_service_module.ModelBillingProfileService,
        "resolve",
        MagicMock(side_effect=ModelBillingProfileResolutionError()),
    )

    with pytest.raises(ModelBillingProfileResolutionError) as exc_info:
        FeatureService.get_features("tenant-1")

    assert exc_info.value.code == 503
