"""
Unit tests for Service API Site controller
"""

import uuid
from unittest.mock import Mock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.service_api.app.site import AppSiteApi
from models.account import TenantStatus
from models.model import App, Site


class TestAppSiteApi:
    """Test suite for AppSiteApi"""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_app_model(self):
        """Create a mock App model with tenant."""
        app = Mock(spec=App)
        app.id = str(uuid.uuid4())
        app.tenant_id = str(uuid.uuid4())

        mock_tenant = Mock()
        mock_tenant.id = app.tenant_id
        mock_tenant.status = TenantStatus.NORMAL
        app.tenant = mock_tenant

        return app

    @pytest.fixture
    def mock_site(self):
        """Create a mock Site model."""
        site = Mock(spec=Site)
        site.id = str(uuid.uuid4())
        site.app_id = str(uuid.uuid4())
        site.title = "Test Site"
        site.icon = "icon-url"
        site.icon_background = "#ffffff"
        site.description = "Site description"
        site.copyright = "Copyright 2024"
        site.privacy_policy = "Privacy policy text"
        site.custom_disclaimer = "Custom disclaimer"
        site.default_language = "en-US"
        site.prompt_public = True
        site.show_workflow_steps = True
        site.use_icon_as_answer_icon = False
        site.created_at = "2024-01-01T00:00:00"
        site.updated_at = "2024-01-01T00:00:00"
        return site

    @patch("controllers.service_api.app.site.db")
    def test_get_site_success(self, mock_db, app, mock_app_model, mock_site):
        """Test successful retrieval of site configuration."""
        # Arrange
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_site

        # Act
        with app.test_request_context("/site", method="GET"):
            api = AppSiteApi()
            response = api.get(mock_app_model)

        # Assert
        assert response["title"] == "Test Site"
        assert response["icon"] == "icon-url"
        assert response["description"] == "Site description"
        mock_db.session.query.assert_called_once_with(Site)

    @patch("controllers.service_api.app.site.db")
    def test_get_site_not_found(self, mock_db, app, mock_app_model):
        """Test that Forbidden is raised when site is not found."""
        # Arrange
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        # Act & Assert
        with app.test_request_context("/site", method="GET"):
            api = AppSiteApi()
            with pytest.raises(Forbidden):
                api.get(mock_app_model)

    @patch("controllers.service_api.app.site.db")
    def test_get_site_tenant_archived(self, mock_db, app, mock_app_model, mock_site):
        """Test that Forbidden is raised when tenant is archived."""
        # Arrange
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_site
        mock_app_model.tenant.status = TenantStatus.ARCHIVE

        # Act & Assert
        with app.test_request_context("/site", method="GET"):
            api = AppSiteApi()
            with pytest.raises(Forbidden):
                api.get(mock_app_model)

    @patch("controllers.service_api.app.site.db")
    def test_get_site_queries_by_app_id(self, mock_db, app, mock_app_model):
        """Test that site is queried using the app model's id."""
        # Arrange
        mock_site = Mock(spec=Site)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_site

        # Act
        with app.test_request_context("/site", method="GET"):
            api = AppSiteApi()
            api.get(mock_app_model)

        # Assert
        call_args = mock_db.session.query.return_value.where.call_args
        where_clause = call_args[1][0] if call_args[1] else call_args[0][0]
        assert mock_app_model.id in str(where_clause)
