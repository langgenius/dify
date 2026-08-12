"""Application service for feature queries exposed by API adapters."""

from collections.abc import Sequence
from typing import Protocol

from machinery.context import RequestContext
from services.entities.feature_entities import (
    FeatureModel,
    LicenseModel,
    SystemFeatureModel,
    VectorSpaceLimitationModel,
)


class FeatureQueryGateway(Protocol):
    """Read dynamic feature resources without exposing their current implementation."""

    def get_workspace_features(self, workspace_id: str) -> FeatureModel: ...

    def get_vector_space(self, workspace_id: str) -> VectorSpaceLimitationModel: ...

    def get_public_system_features(self) -> SystemFeatureModel: ...

    def get_license(self) -> LicenseModel: ...


class FeatureQueryService:
    def __init__(
        self,
        *,
        features: FeatureQueryGateway,
        trial_models: Sequence[str],
        app_dsl_version: str,
    ) -> None:
        self._features = features
        self._trial_models = tuple(trial_models)
        self._app_dsl_version = app_dsl_version

    def get_features(self, context: RequestContext) -> FeatureModel:
        return self._features.get_workspace_features(self._require_active_workspace(context))

    def get_vector_space(self, context: RequestContext) -> VectorSpaceLimitationModel:
        return self._features.get_vector_space(self._require_active_workspace(context))

    def get_trial_models(self) -> list[str]:
        return list(self._trial_models)

    def get_app_dsl_version(self) -> str:
        return self._app_dsl_version

    def get_system_features(self) -> SystemFeatureModel:
        return self._features.get_public_system_features()

    def get_license(self) -> LicenseModel:
        return self._features.get_license()

    @staticmethod
    def _require_active_workspace(context: RequestContext) -> str:
        workspace_id = context.active_workspace_id
        if workspace_id is None:
            raise RuntimeError("Console account admission did not resolve an active workspace")
        return workspace_id
