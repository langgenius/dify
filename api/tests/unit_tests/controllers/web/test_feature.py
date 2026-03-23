"""Unit tests for controllers.web.feature endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from flask import Flask

from controllers.web.feature import SystemFeatureApi


class TestSystemFeatureApi:
    @patch("controllers.web.feature.FeatureService.get_system_features")
    def test_returns_system_features(self, mock_features: MagicMock, app: Flask) -> None:
        mock_model = MagicMock()
        mock_model.model_dump.return_value = {"sso_enforced_for_signin": False, "webapp_auth": {"enabled": False}}
        mock_features.return_value = mock_model

        with app.test_request_context("/system-features"):
            result = SystemFeatureApi().get()

        assert result == {"sso_enforced_for_signin": False, "webapp_auth": {"enabled": False}}
        mock_features.assert_called_once()

    @patch("controllers.web.feature.FeatureService.get_system_features")
    def test_unauthenticated_access(self, mock_features: MagicMock, app: Flask) -> None:
        """SystemFeatureApi is unauthenticated by design — no WebApiResource decorator."""
        mock_model = MagicMock()
        mock_model.model_dump.return_value = {}
        mock_features.return_value = mock_model

        # Verify it's a bare Resource, not WebApiResource
        from flask_restx import Resource

        from controllers.web.wraps import WebApiResource

        assert issubclass(SystemFeatureApi, Resource)
        assert not issubclass(SystemFeatureApi, WebApiResource)
