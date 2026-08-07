"""Feature-query gateway backed by the existing FeatureService."""

from typing import override

from services.entities.feature_entities import (
    FeatureModel,
    LicenseModel,
    SystemFeatureModel,
    VectorSpaceLimitationModel,
)
from services.feature_query_service import FeatureQueryGateway
from services.feature_service import FeatureService


class FeatureServiceGateway(FeatureQueryGateway):
    """Read dynamic feature resources through FeatureService."""

    @override
    def get_workspace_features(self, workspace_id: str) -> FeatureModel:
        return FeatureService.get_features(workspace_id, exclude_vector_space=True)

    @override
    def get_vector_space(self, workspace_id: str) -> VectorSpaceLimitationModel:
        return FeatureService.get_vector_space(workspace_id)

    @override
    def get_public_system_features(self) -> SystemFeatureModel:
        return FeatureService.get_system_features()

    @override
    def get_license(self) -> LicenseModel:
        return FeatureService.get_license()
