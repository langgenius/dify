from unittest.mock import create_autospec

import pytest

from enums import DeploymentEdition
from machinery.context import RequestContext
from services.entities.feature_entities import (
    FeatureModel,
    LicenseModel,
    SystemFeatureModel,
    VectorSpaceLimitationModel,
)
from services.feature_query_service import FeatureQueryGateway, FeatureQueryService


def _request_context(*, active_workspace_id: str | None = "workspace_123") -> RequestContext:
    return RequestContext(
        request_id="request_123",
        trace_id=None,
        account_id="account_123",
        active_workspace_id=active_workspace_id,
    )


def test_workspace_queries_use_workspace_from_request_context() -> None:
    gateway = create_autospec(FeatureQueryGateway, instance=True, spec_set=True)
    features = FeatureModel()
    vector_space = VectorSpaceLimitationModel(size=1, limit=5)
    gateway.get_workspace_features.return_value = features
    gateway.get_vector_space.return_value = vector_space
    service = FeatureQueryService(features=gateway, trial_models=(), app_dsl_version="0.7.0")
    context = _request_context()

    assert service.get_features(context) is features
    assert service.get_vector_space(context) is vector_space
    gateway.get_workspace_features.assert_called_once_with("workspace_123")
    gateway.get_vector_space.assert_called_once_with("workspace_123")


def test_deployment_queries_delegate_without_request_context() -> None:
    gateway = create_autospec(FeatureQueryGateway, instance=True, spec_set=True)
    system_features = SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY)
    license_model = LicenseModel()
    gateway.get_public_system_features.return_value = system_features
    gateway.get_license.return_value = license_model
    service = FeatureQueryService(
        features=gateway,
        trial_models=["langgenius/openai/openai"],
        app_dsl_version="0.6.0",
    )

    assert service.get_trial_models() == ["langgenius/openai/openai"]
    assert service.get_app_dsl_version() == "0.6.0"
    assert service.get_system_features() is system_features
    assert service.get_license() is license_model


def test_workspace_queries_require_active_workspace() -> None:
    gateway = create_autospec(FeatureQueryGateway, instance=True, spec_set=True)
    service = FeatureQueryService(features=gateway, trial_models=(), app_dsl_version="0.7.0")

    with pytest.raises(RuntimeError, match="did not resolve an active workspace"):
        service.get_features(_request_context(active_workspace_id=None))

    gateway.get_workspace_features.assert_not_called()
