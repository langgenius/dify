"""
Unit tests for Service API App controllers
"""

import uuid
from unittest.mock import Mock, patch

import pytest
from flask import Flask

from controllers.service_api.app.app import AppInfoApi, AppMetaApi, AppParameterApi
from controllers.service_api.app.error import AppUnavailableError
from models.model import App, AppMode
from tests.unit_tests.conftest import setup_mock_tenant_account_query


class TestAppParameterApi:
    """Test suite for AppParameterApi"""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_app_model(self):
        """Create a mock App model."""
        app = Mock(spec=App)
        app.id = str(uuid.uuid4())
        app.tenant_id = str(uuid.uuid4())
        app.mode = AppMode.CHAT
        app.status = "normal"
        app.enable_api = True
        return app

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    def test_get_parameters_for_chat_app(
        self, mock_db, mock_validate_token, mock_current_app, mock_user_logged_in, app, mock_app_model
    ):
        """Test retrieving parameters for a chat app."""
        # Arrange
        mock_current_app.login_manager = Mock()

        mock_config = Mock()
        mock_config.id = str(uuid.uuid4())
        mock_config.to_dict.return_value = {
            "user_input_form": [{"type": "text", "label": "Name", "variable": "name", "required": True}],
            "suggested_questions": [],
        }
        mock_app_model.app_model_config = mock_config
        mock_app_model.workflow = None

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app_model.id
        mock_api_token.tenant_id = mock_app_model.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = "normal"

        # Mock DB queries for app and tenant
        mock_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app_model,
            mock_tenant,
        ]

        # Mock tenant owner info for login
        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_db, mock_tenant, mock_account)

        # Act
        with app.test_request_context("/parameters", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppParameterApi()
            response = api.get()

        # Assert
        assert "opening_statement" in response
        assert "suggested_questions" in response
        assert "user_input_form" in response

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    def test_get_parameters_for_workflow_app(
        self, mock_db, mock_validate_token, mock_current_app, mock_user_logged_in, app, mock_app_model
    ):
        """Test retrieving parameters for a workflow app."""
        # Arrange
        mock_current_app.login_manager = Mock()

        mock_app_model.mode = AppMode.WORKFLOW
        mock_workflow = Mock()
        mock_workflow.features_dict = {"suggested_questions": []}
        mock_workflow.user_input_form.return_value = [{"type": "text", "label": "Input", "variable": "input"}]
        mock_app_model.workflow = mock_workflow
        mock_app_model.app_model_config = None

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app_model.id
        mock_api_token.tenant_id = mock_app_model.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = "normal"

        mock_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app_model,
            mock_tenant,
        ]

        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_db, mock_tenant, mock_account)

        # Act
        with app.test_request_context("/parameters", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppParameterApi()
            response = api.get()

        # Assert
        assert "user_input_form" in response
        assert "opening_statement" in response

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    def test_get_parameters_raises_error_when_chat_config_missing(
        self, mock_db, mock_validate_token, mock_current_app, mock_user_logged_in, app, mock_app_model
    ):
        """Test that AppUnavailableError is raised when chat app has no config."""
        # Arrange
        mock_current_app.login_manager = Mock()

        mock_app_model.app_model_config = None
        mock_app_model.workflow = None

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app_model.id
        mock_api_token.tenant_id = mock_app_model.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = "normal"

        mock_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app_model,
            mock_tenant,
        ]

        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_db, mock_tenant, mock_account)

        # Act & Assert
        with app.test_request_context("/parameters", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppParameterApi()
            with pytest.raises(AppUnavailableError):
                api.get()

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    def test_get_parameters_raises_error_when_workflow_missing(
        self, mock_db, mock_validate_token, mock_current_app, mock_user_logged_in, app, mock_app_model
    ):
        """Test that AppUnavailableError is raised when workflow app has no workflow."""
        # Arrange
        mock_current_app.login_manager = Mock()

        mock_app_model.mode = AppMode.WORKFLOW
        mock_app_model.workflow = None
        mock_app_model.app_model_config = None

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app_model.id
        mock_api_token.tenant_id = mock_app_model.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = "normal"

        mock_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app_model,
            mock_tenant,
        ]

        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_db, mock_tenant, mock_account)

        # Act & Assert
        with app.test_request_context("/parameters", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppParameterApi()
            with pytest.raises(AppUnavailableError):
                api.get()


class TestAppMetaApi:
    """Test suite for AppMetaApi"""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_app_model(self):
        """Create a mock App model."""
        app = Mock(spec=App)
        app.id = str(uuid.uuid4())
        app.status = "normal"
        app.enable_api = True
        return app

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    @patch("controllers.service_api.app.app.AppService")
    def test_get_app_meta(
        self, mock_app_service, mock_db, mock_validate_token, mock_current_app, mock_user_logged_in, app, mock_app_model
    ):
        """Test retrieving app metadata via AppService."""
        # Arrange
        mock_current_app.login_manager = Mock()

        mock_service_instance = Mock()
        mock_service_instance.get_app_meta.return_value = {
            "tool_icons": {},
            "AgentIcons": {},
        }
        mock_app_service.return_value = mock_service_instance

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app_model.id
        mock_api_token.tenant_id = mock_app_model.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = "normal"

        mock_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app_model,
            mock_tenant,
        ]

        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_db, mock_tenant, mock_account)

        # Act
        with app.test_request_context("/meta", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppMetaApi()
            response = api.get()

        # Assert
        mock_service_instance.get_app_meta.assert_called_once_with(mock_app_model)
        assert response == {"tool_icons": {}, "AgentIcons": {}}


class TestAppInfoApi:
    """Test suite for AppInfoApi"""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_app_model(self):
        """Create a mock App model with all required attributes."""
        app = Mock(spec=App)
        app.id = str(uuid.uuid4())
        app.tenant_id = str(uuid.uuid4())
        app.name = "Test App"
        app.description = "A test application"
        app.mode = AppMode.CHAT
        app.author_name = "Test Author"
        app.status = "normal"
        app.enable_api = True

        # Mock tags relationship
        mock_tag = Mock()
        mock_tag.name = "test-tag"
        app.tags = [mock_tag]

        return app

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    def test_get_app_info(
        self, mock_db, mock_validate_token, mock_current_app, mock_user_logged_in, app, mock_app_model
    ):
        """Test retrieving basic app information."""
        mock_current_app.login_manager = Mock()

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app_model.id
        mock_api_token.tenant_id = mock_app_model.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = "normal"

        mock_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app_model,
            mock_tenant,
        ]

        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_db, mock_tenant, mock_account)

        # Act
        with app.test_request_context("/info", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppInfoApi()
            response = api.get()

        # Assert
        assert response["name"] == "Test App"
        assert response["description"] == "A test application"
        assert response["tags"] == ["test-tag"]
        assert response["mode"] == AppMode.CHAT
        assert response["author_name"] == "Test Author"

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    def test_get_app_info_with_multiple_tags(
        self, mock_db, mock_validate_token, mock_current_app, mock_user_logged_in, app
    ):
        """Test retrieving app info with multiple tags."""
        # Arrange
        mock_current_app.login_manager = Mock()

        mock_app = Mock(spec=App)
        mock_app.id = str(uuid.uuid4())
        mock_app.tenant_id = str(uuid.uuid4())
        mock_app.name = "Multi Tag App"
        mock_app.description = "App with multiple tags"
        mock_app.mode = AppMode.WORKFLOW
        mock_app.author_name = "Author"
        mock_app.status = "normal"
        mock_app.enable_api = True

        tag1, tag2, tag3 = Mock(), Mock(), Mock()
        tag1.name = "tag-one"
        tag2.name = "tag-two"
        tag3.name = "tag-three"
        mock_app.tags = [tag1, tag2, tag3]

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app.id
        mock_api_token.tenant_id = mock_app.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = "normal"

        mock_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app,
            mock_tenant,
        ]

        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_db, mock_tenant, mock_account)

        # Act
        with app.test_request_context("/info", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppInfoApi()
            response = api.get()

        # Assert
        assert response["tags"] == ["tag-one", "tag-two", "tag-three"]

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    def test_get_app_info_with_no_tags(self, mock_db, mock_validate_token, mock_current_app, mock_user_logged_in, app):
        """Test retrieving app info when app has no tags."""
        # Arrange
        mock_current_app.login_manager = Mock()

        mock_app = Mock(spec=App)
        mock_app.id = str(uuid.uuid4())
        mock_app.tenant_id = str(uuid.uuid4())
        mock_app.name = "No Tags App"
        mock_app.description = "App without tags"
        mock_app.mode = AppMode.COMPLETION
        mock_app.author_name = "Author"
        mock_app.tags = []
        mock_app.status = "normal"
        mock_app.enable_api = True

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app.id
        mock_api_token.tenant_id = mock_app.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = "normal"

        mock_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app,
            mock_tenant,
        ]

        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_db, mock_tenant, mock_account)

        # Act
        with app.test_request_context("/info", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppInfoApi()
            response = api.get()

        # Assert
        assert response["tags"] == []

    @pytest.mark.parametrize(
        "app_mode",
        [AppMode.CHAT, AppMode.COMPLETION, AppMode.WORKFLOW, AppMode.ADVANCED_CHAT],
    )
    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.current_app")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.db")
    def test_get_app_info_returns_correct_mode(
        self, mock_db, mock_validate_token, mock_current_app, mock_user_logged_in, app, app_mode
    ):
        """Test that all app modes are correctly returned."""
        # Arrange
        mock_current_app.login_manager = Mock()

        mock_app = Mock(spec=App)
        mock_app.id = str(uuid.uuid4())
        mock_app.tenant_id = str(uuid.uuid4())
        mock_app.name = "Test"
        mock_app.description = "Test"
        mock_app.mode = app_mode
        mock_app.author_name = "Test"
        mock_app.tags = []
        mock_app.status = "normal"
        mock_app.enable_api = True

        # Mock authentication
        mock_api_token = Mock()
        mock_api_token.app_id = mock_app.id
        mock_api_token.tenant_id = mock_app.tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_tenant = Mock()
        mock_tenant.status = "normal"

        mock_db.session.query.return_value.where.return_value.first.side_effect = [
            mock_app,
            mock_tenant,
        ]

        mock_account = Mock()
        mock_account.current_tenant = mock_tenant
        setup_mock_tenant_account_query(mock_db, mock_tenant, mock_account)

        # Act
        with app.test_request_context("/info", method="GET", headers={"Authorization": "Bearer test_token"}):
            api = AppInfoApi()
            response = api.get()

        # Assert
        assert response["mode"] == app_mode
