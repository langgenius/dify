"""Unit tests for controllers.web.feature endpoints."""

from __future__ import annotations

from unittest.mock import MagicMock, create_autospec

import pytest
from flask import Flask
from pytest_mock import MockerFixture

from controllers.web.feature import SystemFeatureApi
from enums import DeploymentEdition
from services.entities.feature_entities import SystemFeatureModel
from services.feature_query_service import FeatureQueryService


def _install_feature_queries(mocker: MockerFixture) -> MagicMock:
    feature_queries = create_autospec(FeatureQueryService, instance=True, spec_set=True)
    application_services = mocker.patch("controllers.web.feature.application_services")
    application_services.return_value.feature_queries = feature_queries
    return feature_queries


class TestSystemFeatureApi:
    @pytest.mark.parametrize("deployment_edition", list(DeploymentEdition))
    def test_returns_system_features(
        self,
        deployment_edition: DeploymentEdition,
        app: Flask,
        mocker: MockerFixture,
    ) -> None:
        system_features = SystemFeatureModel(deployment_edition=deployment_edition)
        feature_queries = _install_feature_queries(mocker)
        feature_queries.get_system_features.return_value = system_features

        with app.test_request_context("/system-features"):
            result = SystemFeatureApi().get()

        assert result == system_features.model_dump(mode="json")
        assert result["deployment_edition"] == deployment_edition.value
        assert result["sso_enforced_for_signin_protocol"] is None
        assert result["webapp_auth"]["sso_config"]["protocol"] is None
        feature_queries.get_system_features.assert_called_once_with()

    def test_unauthenticated_access(self) -> None:
        """SystemFeatureApi is unauthenticated by design — no WebApiResource decorator."""
        # Verify it's a bare Resource, not WebApiResource
        from flask_restx import Resource

        from controllers.web.wraps import WebApiResource

        assert issubclass(SystemFeatureApi, Resource)
        assert not issubclass(SystemFeatureApi, WebApiResource)
