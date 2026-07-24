"""Unit tests for controllers.web.feature endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from flask import Flask

from controllers.web.feature import SystemFeatureApi
from enums.deployment_edition import DeploymentEdition
from services.feature_service import SystemFeatureModel


class TestSystemFeatureApi:
    @patch("controllers.web.feature.FeatureService.get_system_features")
    def test_returns_system_features(self, mock_features: MagicMock, app: Flask) -> None:
        system_features = SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY)
        mock_features.return_value = system_features

        with app.test_request_context("/system-features"):
            result = SystemFeatureApi().get()

        assert result == system_features.model_dump()
        mock_features.assert_called_once()

    @patch("controllers.web.feature.FeatureService.get_system_features")
    def test_unauthenticated_access(self, mock_features: MagicMock, app: Flask) -> None:
        """SystemFeatureApi is unauthenticated by design — no WebApiResource decorator."""
        mock_features.return_value = SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY)

        # Verify it's a bare Resource, not WebApiResource
        from flask_restx import Resource

        from controllers.web.wraps import WebApiResource

        assert issubclass(SystemFeatureApi, Resource)
        assert not issubclass(SystemFeatureApi, WebApiResource)
