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
        return app

    def test_get_parameters_for_chat_app(self, app, mock_app_model):
        """Test retrieving parameters for a chat app."""
        # Arrange
        mock_config = Mock()
        mock_config.id = str(uuid.uuid4())
        mock_config.to_dict.return_value = {
            "user_input_form": [{"type": "text", "label": "Name", "variable": "name", "required": True}],
            "suggested_questions": [],
        }
        mock_app_model.app_model_config = mock_config
        mock_app_model.workflow = None

        # Act
        with app.test_request_context("/parameters", method="GET"):
            api = AppParameterApi()
            response = api.get(mock_app_model)

        # Assert
        assert "opening_statement" in response
        assert "suggested_questions" in response
        assert "user_input_form" in response

    def test_get_parameters_for_workflow_app(self, app, mock_app_model):
        """Test retrieving parameters for a workflow app."""
        # Arrange
        mock_app_model.mode = AppMode.WORKFLOW
        mock_workflow = Mock()
        mock_workflow.features_dict = {"suggested_questions": []}
        mock_workflow.user_input_form.return_value = [{"type": "text", "label": "Input", "variable": "input"}]
        mock_app_model.workflow = mock_workflow
        mock_app_model.app_model_config = None

        # Act
        with app.test_request_context("/parameters", method="GET"):
            api = AppParameterApi()
            response = api.get(mock_app_model)

        # Assert
        assert "user_input_form" in response
        assert "opening_statement" in response

    def test_get_parameters_raises_error_when_chat_config_missing(self, app, mock_app_model):
        """Test that AppUnavailableError is raised when chat app has no config."""
        # Arrange
        mock_app_model.app_model_config = None
        mock_app_model.workflow = None

        # Act & Assert
        with app.test_request_context("/parameters", method="GET"):
            api = AppParameterApi()
            with pytest.raises(AppUnavailableError):
                api.get(mock_app_model)

    def test_get_parameters_raises_error_when_workflow_missing(self, app, mock_app_model):
        """Test that AppUnavailableError is raised when workflow app has no workflow."""
        # Arrange
        mock_app_model.mode = AppMode.WORKFLOW
        mock_app_model.workflow = None
        mock_app_model.app_model_config = None

        # Act & Assert
        with app.test_request_context("/parameters", method="GET"):
            api = AppParameterApi()
            with pytest.raises(AppUnavailableError):
                api.get(mock_app_model)


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
        return app

    @patch("controllers.service_api.app.app.AppService")
    def test_get_app_meta(self, mock_app_service, app, mock_app_model):
        """Test retrieving app metadata via AppService."""
        # Arrange
        mock_service_instance = Mock()
        mock_service_instance.get_app_meta.return_value = {
            "tool_icons": {},
            "AgentIcons": {},
        }
        mock_app_service.return_value = mock_service_instance

        # Act
        with app.test_request_context("/meta", method="GET"):
            api = AppMetaApi()
            response = api.get(mock_app_model)

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
        app.name = "Test App"
        app.description = "A test application"
        app.mode = AppMode.CHAT
        app.author_name = "Test Author"

        # Mock tags relationship
        mock_tag = Mock()
        mock_tag.name = "test-tag"
        app.tags = [mock_tag]

        return app

    def test_get_app_info(self, app, mock_app_model):
        """Test retrieving basic app information."""
        # Act
        with app.test_request_context("/info", method="GET"):
            api = AppInfoApi()
            response = api.get(mock_app_model)

        # Assert
        assert response["name"] == "Test App"
        assert response["description"] == "A test application"
        assert response["tags"] == ["test-tag"]
        assert response["mode"] == AppMode.CHAT
        assert response["author_name"] == "Test Author"

    def test_get_app_info_with_multiple_tags(self, app):
        """Test retrieving app info with multiple tags."""
        # Arrange
        mock_app = Mock(spec=App)
        mock_app.name = "Multi Tag App"
        mock_app.description = "App with multiple tags"
        mock_app.mode = AppMode.WORKFLOW
        mock_app.author_name = "Author"

        tag1, tag2, tag3 = Mock(), Mock(), Mock()
        tag1.name = "tag-one"
        tag2.name = "tag-two"
        tag3.name = "tag-three"
        mock_app.tags = [tag1, tag2, tag3]

        # Act
        with app.test_request_context("/info", method="GET"):
            api = AppInfoApi()
            response = api.get(mock_app)

        # Assert
        assert response["tags"] == ["tag-one", "tag-two", "tag-three"]

    def test_get_app_info_with_no_tags(self, app):
        """Test retrieving app info when app has no tags."""
        # Arrange
        mock_app = Mock(spec=App)
        mock_app.name = "No Tags App"
        mock_app.description = "App without tags"
        mock_app.mode = AppMode.COMPLETION
        mock_app.author_name = "Author"
        mock_app.tags = []

        # Act
        with app.test_request_context("/info", method="GET"):
            api = AppInfoApi()
            response = api.get(mock_app)

        # Assert
        assert response["tags"] == []

    @pytest.mark.parametrize(
        "app_mode",
        [AppMode.CHAT, AppMode.COMPLETION, AppMode.WORKFLOW, AppMode.ADVANCED_CHAT],
    )
    def test_get_app_info_returns_correct_mode(self, app, app_mode):
        """Test that all app modes are correctly returned."""
        # Arrange
        mock_app = Mock(spec=App)
        mock_app.name = "Test"
        mock_app.description = "Test"
        mock_app.mode = app_mode
        mock_app.author_name = "Test"
        mock_app.tags = []

        # Act
        with app.test_request_context("/info", method="GET"):
            api = AppInfoApi()
            response = api.get(mock_app)

        # Assert
        assert response["mode"] == app_mode
