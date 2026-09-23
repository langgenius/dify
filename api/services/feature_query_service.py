"""Application service for feature queries exposed by API adapters."""

from typing import Protocol

from machinery.context import RequestContext
from services.entities.feature_entities import (
    FeatureModel,
    LicenseModel,
    LicenseStatus,
    SystemFeatureModel,
    VectorSpaceLimitationModel,
)

_VALID_ENTERPRISE_LICENSE_STATUSES = frozenset({LicenseStatus.ACTIVE, LicenseStatus.EXPIRING})


class FeatureQueryGateway(Protocol):
    """Read dynamic feature resources without exposing their current implementation."""

    def get_workspace_features(self, workspace_id: str) -> FeatureModel: ...

    def get_trial_models(self, workspace_id: str) -> list[str]: ...

    def get_vector_space(self, workspace_id: str) -> VectorSpaceLimitationModel: ...

    def get_public_system_features(self) -> SystemFeatureModel: ...

    def get_license(self) -> LicenseModel: ...


class FeatureQueryService:
    def __init__(
        self,
        *,
        features: FeatureQueryGateway,
        app_dsl_version: str,
    ) -> None:
        self._features = features
        self._app_dsl_version = app_dsl_version

    def get_features(self, context: RequestContext) -> FeatureModel:
        return self.get_workspace_features(context.active_workspace_id)

    def get_workspace_features(self, workspace_id: str) -> FeatureModel:
        return self._features.get_workspace_features(workspace_id)

    def get_vector_space(self, context: RequestContext) -> VectorSpaceLimitationModel:
        return self.get_workspace_vector_space(context.active_workspace_id)

    def get_workspace_vector_space(self, workspace_id: str) -> VectorSpaceLimitationModel:
        return self._features.get_vector_space(workspace_id)

    def get_trial_models(self, context: RequestContext) -> list[str]:
        return self._features.get_trial_models(context.active_workspace_id)

    def get_app_dsl_version(self) -> str:
        return self._app_dsl_version

    def get_public_system_features(self) -> SystemFeatureModel:
        return self._features.get_public_system_features()

    def get_license(self) -> LicenseModel:
        return self._features.get_license()

    def has_valid_enterprise_license(self) -> bool:
        status = self._features.get_public_system_features().license.status
        return status in _VALID_ENTERPRISE_LICENSE_STATUSES
