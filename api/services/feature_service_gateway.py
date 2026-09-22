"""Feature-query gateway combining workspace and deployment feature providers."""

from typing import override

from services.entities.feature_entities import (
    FeatureModel,
    LicenseModel,
    SystemFeatureModel,
    VectorSpaceLimitationModel,
)
from services.feature_query_service import FeatureQueryGateway
from services.feature_service import FeatureService
from services.system_feature_service import SystemFeatureService


class FeatureServiceGateway(FeatureQueryGateway):
    """Read workspace features from FeatureService and deployment features from SystemFeatureService."""

    @override
    def get_workspace_features(self, workspace_id: str) -> FeatureModel:
        return FeatureService.get_features(workspace_id, exclude_vector_space=True)

    @override
    def get_trial_models(self, workspace_id: str) -> list[str]:
        return FeatureService.get_trial_models(workspace_id)

    @override
    def get_vector_space(self, workspace_id: str) -> VectorSpaceLimitationModel:
        return FeatureService.get_vector_space(workspace_id)

    @override
    def get_public_system_features(self) -> SystemFeatureModel:
        return SystemFeatureService.get_public_system_features()

    @override
    def get_license(self) -> LicenseModel:
        return SystemFeatureService.get_license()
