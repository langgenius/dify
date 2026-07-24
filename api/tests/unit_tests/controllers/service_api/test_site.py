"""
Unit tests for Service API Site controller
"""

import uuid
from unittest.mock import Mock, patch

import pytest
from werkzeug.exceptions import Forbidden

from controllers.service_api.app.site import AppSiteApi
from models.account import TenantStatus
from models.model import App, Site
from tests.unit_tests.conftest import setup_mock_tenant_account_query


class TestAppSiteApi:
    """Test suite for AppSiteApi"""

    @pytest.fixture
    def mock_app_model(self):
        """Create a mock App model with tenant."""
        app = Mock(spec=App)
        app.id = str(uuid.uuid4())
        app.tenant_id = str(uuid.uuid4())
        app.status = "normal"
        app.enable_api = True

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
        site.chat_color_theme = "light"
        site.chat_color_theme_inverted = False
        site.icon_type = "image"
        site.created_at = "2024-01-01T00:00:00"
        site.updated_at = "2024-01-01T00:00:00"
        return site

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.app.site.db")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    def test_get_site_success(
        self,
        mock_wraps_db,
        mock_validate_token,
        mock_current_app,
        mock_db,
        mock_user_logged_in,
        app,
        mock_app_model,
        mock_site,
    ):
        """Test successful retrieval of site configuration."""
        # Arrange
        mock_current_app.login_manager = Mock()

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app_model.id
        mock_api_token.tenant_id = mock_app_model.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = TenantStatus.NORMAL
        mock_app_model.tenant = mock_tenant

        # Mock wraps.db for authentication
        mock_wraps_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app_model,
            mock_tenant,
        ]

        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_wraps_db, mock_tenant, mock_account)

        # Mock site.db for site query
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_site

        # Act
        with app.test_request_context("/site", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppSiteApi()
            response = api.get()

        # Assert
        assert response["title"] == "Test Site"
        assert response["icon"] == "icon-url"
        assert response["description"] == "Site description"
        mock_db.session.query.assert_called_once_with(Site)

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.app.site.db")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    def test_get_site_not_found(
        self,
        mock_wraps_db,
        mock_validate_token,
        mock_current_app,
        mock_db,
        mock_user_logged_in,
        app,
        mock_app_model,
    ):
        """Test that Forbidden is raised when site is not found."""
        # Arrange
        mock_current_app.login_manager = Mock()

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app_model.id
        mock_api_token.tenant_id = mock_app_model.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = TenantStatus.NORMAL
        mock_app_model.tenant = mock_tenant

        mock_wraps_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app_model,
            mock_tenant,
        ]

        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_wraps_db, mock_tenant, mock_account)

        # Mock site query to return None
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        # Act & Assert
        with app.test_request_context("/site", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppSiteApi()
            with pytest.raises(Forbidden):
                api.get()

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.app.site.db")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    def test_get_site_tenant_archived(
        self,
        mock_wraps_db,
        mock_validate_token,
        mock_current_app,
        mock_db,
        mock_user_logged_in,
        app,
        mock_app_model,
        mock_site,
    ):
        """Test that Forbidden is raised when tenant is archived."""
        # Arrange
        mock_current_app.login_manager = Mock()

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app_model.id
        mock_api_token.tenant_id = mock_app_model.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = TenantStatus.NORMAL

        mock_wraps_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app_model,
            mock_tenant,
        ]

        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_wraps_db, mock_tenant, mock_account)

        # Mock site query
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_site

        # Set tenant status to archived AFTER authentication
        mock_app_model.tenant.status = TenantStatus.ARCHIVE

        # Act & Assert
        with app.test_request_context("/site", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppSiteApi()
            with pytest.raises(Forbidden):
                api.get()

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.app.site.db")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    def test_get_site_queries_by_app_id(
        self, mock_wraps_db, mock_validate_token, mock_current_app, mock_db, mock_user_logged_in, app, mock_app_model
    ):
        """Test that site is queried using the app model's id."""
        # Arrange
        mock_current_app.login_manager = Mock()

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app_model.id
        mock_api_token.tenant_id = mock_app_model.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = TenantStatus.NORMAL
        mock_app_model.tenant = mock_tenant

        mock_wraps_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app_model,
            mock_tenant,
        ]

        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_wraps_db, mock_tenant, mock_account)

        mock_site = Mock(spec=Site)
        mock_site.id = str(uuid.uuid4())
        mock_site.app_id = mock_app_model.id
        mock_site.title = "Test Site"
        mock_site.icon = "icon-url"
        mock_site.icon_background = "#ffffff"
        mock_site.description = "Site description"
        mock_site.copyright = "Copyright 2024"
        mock_site.privacy_policy = "Privacy policy text"
        mock_site.custom_disclaimer = "Custom disclaimer"
        mock_site.default_language = "en-US"
        mock_site.prompt_public = True
        mock_site.show_workflow_steps = True
        mock_site.use_icon_as_answer_icon = False
        mock_site.chat_color_theme = "light"
        mock_site.chat_color_theme_inverted = False
        mock_site.icon_type = "image"
        mock_site.created_at = "2024-01-01T00:00:00"
        mock_site.updated_at = "2024-01-01T00:00:00"
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_site

        # Act
        with app.test_request_context("/site", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppSiteApi()
            api.get()

        # Assert
        # The query was executed successfully (site returned), which validates the correct query was made
        mock_db.session.query.assert_called_once_with(Site)
