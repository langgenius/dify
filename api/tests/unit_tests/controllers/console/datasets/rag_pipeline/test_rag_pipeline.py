"""Unit tests for RAG Pipeline Controller.

This module provides comprehensive test coverage for the RAG pipeline controller which handles
pipeline template management, creation, configuration, execution, and status management.

The RAG pipeline controller is responsible for:
- Listing pipeline templates (built-in and customized)
- Getting pipeline template details
- Managing customized pipeline templates (create, update, delete)
- Publishing customized pipeline templates
- Pipeline configuration and execution

Test Coverage:
- Pipeline template listing
- Template detail retrieval
- Customized template CRUD operations
- Template publishing
- Pipeline configuration validation
- Error handling for various failure scenarios
"""

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest

from controllers.console.datasets.rag_pipeline.rag_pipeline import (
    CustomizedPipelineTemplateApi,
    PipelineTemplateDetailApi,
    PipelineTemplateListApi,
    PublishCustomizedPipelineTemplateApi,
)
from models.dataset import PipelineCustomizedTemplate


class TestPipelineTemplateListApi:
    """Test suite for PipelineTemplateListApi.

    This class tests the endpoint that lists pipeline templates (built-in or customized).
    Tests cover:
    - Template listing with different types
    - Language parameter handling
    - Default parameter values
    - Response formatting
    """

    @pytest.fixture
    def app(self):
        """Create Flask application instance for testing.

        Returns:
            Flask: Configured Flask app with testing enabled
        """
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        return app

    @pytest.fixture
    def mock_decorators(self):
        """Mock decorators to avoid database access.

        Returns:
            dict: Dictionary with mocked decorators
        """
        with (
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline.setup_required", lambda f: f),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline.login_required", lambda f: f),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.account_initialization_required", lambda f: f
            ),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline.enterprise_license_required", lambda f: f),
        ):
            yield

    def test_get_built_in_templates_default_params(self, app, mock_decorators):
        """Test getting built-in templates with default parameters.

        This test verifies that:
        - Default type parameter is "built-in"
        - Default language parameter is "en-US"
        - Templates are retrieved successfully
        - Response status is 200

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data
        expected_templates = {
            "pipeline_templates": [
                {"id": "template-1", "name": "Basic RAG", "description": "Basic retrieval pipeline"},
                {"id": "template-2", "name": "Advanced RAG", "description": "Advanced retrieval pipeline"},
            ]
        }

        with app.test_request_context(method="GET", path="/rag/pipeline/templates"):
            with patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService.get_pipeline_templates"
            ) as mock_get_templates:
                # Configure service to return expected templates
                mock_get_templates.return_value = expected_templates

                # Act: Call the API
                resource = PipelineTemplateListApi()
                result, status_code = resource.get()

                # Assert: Verify response
                assert status_code == 200
                assert result == expected_templates
                # Verify service was called with default parameters
                mock_get_templates.assert_called_once_with("built-in", "en-US")

    def test_get_customized_templates(self, app, mock_decorators):
        """Test getting customized templates.

        This test verifies that:
        - Customized templates can be retrieved
        - Type parameter "customized" is passed correctly
        - Language parameter is respected
        - Response contains customized templates

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data
        expected_templates = {
            "pipeline_templates": [
                {"id": "custom-1", "name": "Custom Template 1", "description": "User created template"},
            ]
        }

        with app.test_request_context(
            method="GET", path="/rag/pipeline/templates", query_string={"type": "customized", "language": "en-US"}
        ):
            with patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService.get_pipeline_templates"
            ) as mock_get_templates:
                # Configure service to return customized templates
                mock_get_templates.return_value = expected_templates

                # Act: Call the API
                resource = PipelineTemplateListApi()
                result, status_code = resource.get()

                # Assert: Verify response
                assert status_code == 200
                assert result == expected_templates
                # Verify service was called with customized type
                mock_get_templates.assert_called_once_with("customized", "en-US")

    def test_get_templates_different_language(self, app, mock_decorators):
        """Test getting templates with different language parameter.

        This test verifies that:
        - Language parameter is passed to service
        - Different languages are supported
        - Response is returned correctly

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data
        expected_templates = {
            "pipeline_templates": [
                {"id": "template-1", "name": "基本RAG", "description": "基本检索管道"},
            ]
        }

        with app.test_request_context(
            method="GET", path="/rag/pipeline/templates", query_string={"type": "built-in", "language": "zh-CN"}
        ):
            with patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService.get_pipeline_templates"
            ) as mock_get_templates:
                # Configure service to return templates
                mock_get_templates.return_value = expected_templates

                # Act: Call the API
                resource = PipelineTemplateListApi()
                result, status_code = resource.get()

                # Assert: Verify response
                assert status_code == 200
                assert result == expected_templates
                # Verify service was called with correct language
                mock_get_templates.assert_called_once_with("built-in", "zh-CN")

    def test_get_templates_empty_result(self, app, mock_decorators):
        """Test getting templates when no templates are available.

        This test verifies that:
        - Empty template list is handled correctly
        - Response structure is maintained
        - Status code is still 200

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data with empty result
        expected_templates = {"pipeline_templates": []}

        with app.test_request_context(method="GET", path="/rag/pipeline/templates"):
            with patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService.get_pipeline_templates"
            ) as mock_get_templates:
                # Configure service to return empty templates
                mock_get_templates.return_value = expected_templates

                # Act: Call the API
                resource = PipelineTemplateListApi()
                result, status_code = resource.get()

                # Assert: Verify response
                assert status_code == 200
                assert result == expected_templates
                assert result["pipeline_templates"] == []


class TestPipelineTemplateDetailApi:
    """Test suite for PipelineTemplateDetailApi.

    This class tests the endpoint that retrieves pipeline template details.
    Tests cover:
    - Template detail retrieval
    - Built-in vs customized template types
    - Template ID validation
    - Error handling
    """

    @pytest.fixture
    def app(self):
        """Create Flask application instance for testing.

        Returns:
            Flask: Configured Flask app with testing enabled
        """
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        return app

    @pytest.fixture
    def mock_decorators(self):
        """Mock decorators to avoid database access.

        Returns:
            dict: Dictionary with mocked decorators
        """
        with (
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline.setup_required", lambda f: f),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline.login_required", lambda f: f),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.account_initialization_required", lambda f: f
            ),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline.enterprise_license_required", lambda f: f),
        ):
            yield

    def test_get_built_in_template_detail(self, app, mock_decorators):
        """Test getting built-in template detail.

        This test verifies that:
        - Built-in template details are retrieved successfully
        - Template ID is passed correctly
        - Type parameter defaults to "built-in"
        - Response contains template details

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data
        template_id = "template-123"
        expected_detail = {
            "id": template_id,
            "name": "Basic RAG",
            "description": "Basic retrieval pipeline",
            "yaml_content": "workflow:\n  nodes: []",
        }

        with app.test_request_context(
            method="GET", path=f"/rag/pipeline/templates/{template_id}", query_string={"type": "built-in"}
        ):
            with patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService"
            ) as mock_service_class:
                # Create service instance and configure method
                mock_service = MagicMock()
                mock_service.get_pipeline_template_detail.return_value = expected_detail
                mock_service_class.return_value = mock_service

                # Act: Call the API
                resource = PipelineTemplateDetailApi()
                result, status_code = resource.get(template_id)

                # Assert: Verify response
                assert status_code == 200
                assert result == expected_detail
                # Verify service method was called correctly
                mock_service.get_pipeline_template_detail.assert_called_once_with(template_id, "built-in")

    def test_get_customized_template_detail(self, app, mock_decorators):
        """Test getting customized template detail.

        This test verifies that:
        - Customized template details are retrieved successfully
        - Type parameter "customized" is passed correctly
        - Response contains template details

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data
        template_id = "custom-template-456"
        expected_detail = {
            "id": template_id,
            "name": "Custom Template",
            "description": "User created template",
            "yaml_content": "workflow:\n  nodes: []",
        }

        with app.test_request_context(
            method="GET", path=f"/rag/pipeline/templates/{template_id}", query_string={"type": "customized"}
        ):
            with patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService"
            ) as mock_service_class:
                # Create service instance and configure method
                mock_service = MagicMock()
                mock_service.get_pipeline_template_detail.return_value = expected_detail
                mock_service_class.return_value = mock_service

                # Act: Call the API
                resource = PipelineTemplateDetailApi()
                result, status_code = resource.get(template_id)

                # Assert: Verify response
                assert status_code == 200
                assert result == expected_detail
                # Verify service method was called with customized type
                mock_service.get_pipeline_template_detail.assert_called_once_with(template_id, "customized")

    def test_get_template_detail_not_found(self, app, mock_decorators):
        """Test getting template detail when template doesn't exist.

        This test verifies that:
        - None is returned when template not found
        - Status code is still 200 (service handles None)
        - Error handling works correctly

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data
        template_id = "non-existent-template"

        with app.test_request_context(
            method="GET", path=f"/rag/pipeline/templates/{template_id}", query_string={"type": "built-in"}
        ):
            with patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService"
            ) as mock_service_class:
                # Create service instance that returns None
                mock_service = MagicMock()
                mock_service.get_pipeline_template_detail.return_value = None
                mock_service_class.return_value = mock_service

                # Act: Call the API
                resource = PipelineTemplateDetailApi()
                result, status_code = resource.get(template_id)

                # Assert: Verify response
                assert status_code == 200
                assert result is None


class TestCustomizedPipelineTemplateApi:
    """Test suite for CustomizedPipelineTemplateApi.

    This class tests the CRUD operations for customized pipeline templates.
    Tests cover:
    - Template update (PATCH)
    - Template deletion (DELETE)
    - Template retrieval (POST)
    - Validation errors
    - Template not found errors
    """

    @pytest.fixture
    def app(self):
        """Create Flask application instance for testing.

        Returns:
            Flask: Configured Flask app with testing enabled
        """
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        return app

    @pytest.fixture
    def mock_decorators(self):
        """Mock decorators to avoid database access.

        Returns:
            dict: Dictionary with mocked decorators
        """
        with (
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline.setup_required", lambda f: f),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline.login_required", lambda f: f),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.account_initialization_required", lambda f: f
            ),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline.enterprise_license_required", lambda f: f),
        ):
            yield

    @pytest.fixture
    def mock_current_user(self):
        """Mock current user for tenant ID access.

        Returns:
            MagicMock: Mock user object
        """
        with patch("controllers.console.datasets.rag_pipeline.rag_pipeline.current_user") as mock_user:
            mock_user.current_tenant_id = "tenant-123"
            mock_user.id = "user-456"
            yield mock_user

    def test_update_customized_template_success(self, app, mock_decorators, mock_current_user):
        """Test successful update of customized template.

        This test verifies that:
        - Template update works correctly
        - Payload validation passes
        - Template info is updated
        - Status code is 200

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
            mock_current_user: Mock current user fixture
        """
        # Arrange: Set up test data
        template_id = "custom-template-789"
        update_payload = {
            "name": "Updated Template Name",
            "description": "Updated description",
            "icon_info": {"type": "emoji", "value": "🚀"},
        }

        with app.test_request_context(
            method="PATCH", path=f"/rag/pipeline/customized/templates/{template_id}", json=update_payload
        ):
            with (
                patch("controllers.console.datasets.rag_pipeline.rag_pipeline.console_ns.payload", update_payload),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService.update_customized_pipeline_template"
                ) as mock_update,
            ):
                # Configure service to return success
                mock_template = MagicMock()
                mock_template.id = template_id
                mock_update.return_value = mock_template

                # Act: Call the API
                resource = CustomizedPipelineTemplateApi()
                result = resource.patch(template_id)

                # Assert: Verify response
                assert result == 200
                # Verify service method was called
                mock_update.assert_called_once()

    def test_update_template_invalid_payload(self, app, mock_decorators, mock_current_user):
        """Test template update with invalid payload.

        This test verifies that:
        - Invalid payload raises validation error
        - Name length validation works
        - Description length validation works
        - BadRequest is raised for invalid data

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
            mock_current_user: Mock current user fixture
        """
        # Arrange: Set up test data with invalid payload (name too long)
        template_id = "custom-template-789"
        invalid_payload = {
            "name": "A" * 50,  # Exceeds max_length=40
            "description": "Valid description",
        }

        with app.test_request_context(
            method="PATCH", path=f"/rag/pipeline/customized/templates/{template_id}", json=invalid_payload
        ):
            with patch("controllers.console.datasets.rag_pipeline.rag_pipeline.console_ns.payload", invalid_payload):
                # Act & Assert: Verify validation error
                resource = CustomizedPipelineTemplateApi()
                with pytest.raises(BadRequest):
                    resource.patch(template_id)

    def test_delete_customized_template_success(self, app, mock_decorators, mock_current_user):
        """Test successful deletion of customized template.

        This test verifies that:
        - Template deletion works correctly
        - Template is removed from database
        - Status code is 200

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
            mock_current_user: Mock current user fixture
        """
        # Arrange: Set up test data
        template_id = "custom-template-789"

        with app.test_request_context(method="DELETE", path=f"/rag/pipeline/customized/templates/{template_id}"):
            with patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService.delete_customized_pipeline_template"
            ) as mock_delete:
                # Configure service to return success
                mock_delete.return_value = None

                # Act: Call the API
                resource = CustomizedPipelineTemplateApi()
                result = resource.delete(template_id)

                # Assert: Verify response
                assert result == 200
                # Verify service method was called
                mock_delete.assert_called_once_with(template_id)

    def test_delete_template_not_found(self, app, mock_decorators, mock_current_user):
        """Test template deletion when template doesn't exist.

        This test verifies that:
        - ValueError is raised when template not found
        - Error message is appropriate
        - Error handling works correctly

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
            mock_current_user: Mock current user fixture
        """
        # Arrange: Set up test data
        template_id = "non-existent-template"

        with app.test_request_context(method="DELETE", path=f"/rag/pipeline/customized/templates/{template_id}"):
            with patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService.delete_customized_pipeline_template"
            ) as mock_delete:
                # Configure service to raise ValueError
                mock_delete.side_effect = ValueError("Customized pipeline template not found.")

                # Act & Assert: Verify error is raised
                resource = CustomizedPipelineTemplateApi()
                with pytest.raises(ValueError, match="Customized pipeline template not found"):
                    resource.delete(template_id)

    def test_get_customized_template_yaml_success(self, app, mock_decorators):
        """Test successful retrieval of customized template YAML content.

        This test verifies that:
        - Template YAML content is retrieved successfully
        - Template exists in database
        - Response contains YAML data
        - Status code is 200

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data
        template_id = "custom-template-789"
        yaml_content = "workflow:\n  nodes:\n    - id: node-1\n      type: datasource"

        with app.test_request_context(method="POST", path=f"/rag/pipeline/customized/templates/{template_id}"):
            with (
                patch("controllers.console.datasets.rag_pipeline.rag_pipeline.db") as mock_db,
                patch("controllers.console.datasets.rag_pipeline.rag_pipeline.Session") as mock_session_class,
            ):
                # Configure database session
                mock_session = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session
                mock_session_class.return_value.__exit__.return_value = None

                # Configure template query
                mock_template = MagicMock(spec=PipelineCustomizedTemplate)
                mock_template.id = template_id
                mock_template.yaml_content = yaml_content
                mock_session.query.return_value.where.return_value.first.return_value = mock_template

                # Act: Call the API
                resource = CustomizedPipelineTemplateApi()
                result, status_code = resource.post(template_id)

                # Assert: Verify response
                assert status_code == 200
                assert result == {"data": yaml_content}

    def test_get_template_yaml_not_found(self, app, mock_decorators):
        """Test template YAML retrieval when template doesn't exist.

        This test verifies that:
        - ValueError is raised when template not found
        - Error message is appropriate
        - Error handling works correctly

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data
        template_id = "non-existent-template"

        with app.test_request_context(method="POST", path=f"/rag/pipeline/customized/templates/{template_id}"):
            with (
                patch("controllers.console.datasets.rag_pipeline.rag_pipeline.db") as mock_db,
                patch("controllers.console.datasets.rag_pipeline.rag_pipeline.Session") as mock_session_class,
            ):
                # Configure database session to return None
                mock_session = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session
                mock_session_class.return_value.__exit__.return_value = None

                # Configure template query to return None
                mock_session.query.return_value.where.return_value.first.return_value = None

                # Act & Assert: Verify error is raised
                resource = CustomizedPipelineTemplateApi()
                with pytest.raises(ValueError, match="Customized pipeline template not found"):
                    resource.post(template_id)


class TestPublishCustomizedPipelineTemplateApi:
    """Test suite for PublishCustomizedPipelineTemplateApi.

    This class tests the endpoint that publishes customized pipeline templates.
    Tests cover:
    - Template publishing
    - Payload validation
    - Publishing workflow
    - Error handling
    """

    @pytest.fixture
    def app(self):
        """Create Flask application instance for testing.

        Returns:
            Flask: Configured Flask app with testing enabled
        """
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        return app

    @pytest.fixture
    def mock_decorators(self):
        """Mock decorators to avoid database access.

        Returns:
            dict: Dictionary with mocked decorators
        """
        with (
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline.setup_required", lambda f: f),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline.login_required", lambda f: f),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.account_initialization_required", lambda f: f
            ),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline.enterprise_license_required", lambda f: f),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline.knowledge_pipeline_publish_enabled", lambda f: f
            ),
        ):
            yield

    def test_publish_customized_template_success(self, app, mock_decorators):
        """Test successful publishing of customized template.

        This test verifies that:
        - Template publishing works correctly
        - Payload validation passes
        - Template is published successfully
        - Response indicates success

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data
        pipeline_id = "pipeline-123"
        publish_payload = {
            "name": "Published Template",
            "description": "Template ready for use",
            "icon_info": {"type": "emoji", "value": "⭐"},
        }

        with app.test_request_context(
            method="POST",
            path=f"/rag/pipelines/{pipeline_id}/customized/publish",
            json=publish_payload,
        ):
            with (
                patch("controllers.console.datasets.rag_pipeline.rag_pipeline.console_ns.payload", publish_payload),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService"
                ) as mock_service_class,
            ):
                # Create service instance and configure method
                mock_service = MagicMock()
                mock_service.publish_customized_pipeline_template.return_value = None
                mock_service_class.return_value = mock_service

                # Act: Call the API
                resource = PublishCustomizedPipelineTemplateApi()
                result = resource.post(pipeline_id)

                # Assert: Verify response
                assert result == {"result": "success"}
                # Verify service method was called with correct parameters
                mock_service.publish_customized_pipeline_template.assert_called_once_with(pipeline_id, publish_payload)

    def test_publish_template_invalid_payload(self, app, mock_decorators):
        """Test template publishing with invalid payload.

        This test verifies that:
        - Invalid payload raises validation error
        - Name is required
        - Name length validation works
        - BadRequest is raised for invalid data

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data with invalid payload (missing name)
        pipeline_id = "pipeline-123"
        invalid_payload = {
            "description": "Template without name",
        }

        with app.test_request_context(
            method="POST",
            path=f"/rag/pipelines/{pipeline_id}/customized/publish",
            json=invalid_payload,
        ):
            with patch("controllers.console.datasets.rag_pipeline.rag_pipeline.console_ns.payload", invalid_payload):
                # Act & Assert: Verify validation error
                resource = PublishCustomizedPipelineTemplateApi()
                with pytest.raises(BadRequest):
                    resource.post(pipeline_id)

    def test_publish_template_empty_name(self, app, mock_decorators):
        """Test template publishing with empty name.

        This test verifies that:
        - Empty name is rejected
        - min_length validation works
        - BadRequest is raised

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data with empty name
        pipeline_id = "pipeline-123"
        invalid_payload = {
            "name": "",  # Empty name violates min_length=1
            "description": "Template with empty name",
        }

        with app.test_request_context(
            method="POST",
            path=f"/rag/pipelines/{pipeline_id}/customized/publish",
            json=invalid_payload,
        ):
            with patch("controllers.console.datasets.rag_pipeline.rag_pipeline.console_ns.payload", invalid_payload):
                # Act & Assert: Verify validation error
                resource = PublishCustomizedPipelineTemplateApi()
                with pytest.raises(BadRequest):
                    resource.post(pipeline_id)

    def test_publish_template_with_icon_info(self, app, mock_decorators):
        """Test template publishing with icon information.

        This test verifies that:
        - Icon info is accepted in payload
        - Icon info is passed to service
        - Publishing works with icon info

        Args:
            app: Flask application fixture
            mock_decorators: Mock decorators fixture
        """
        # Arrange: Set up test data with icon info
        pipeline_id = "pipeline-123"
        publish_payload = {
            "name": "Template with Icon",
            "description": "Template with icon information",
            "icon_info": {"type": "emoji", "value": "🎯", "color": "blue"},
        }

        with app.test_request_context(
            method="POST",
            path=f"/rag/pipelines/{pipeline_id}/customized/publish",
            json=publish_payload,
        ):
            with (
                patch("controllers.console.datasets.rag_pipeline.rag_pipeline.console_ns.payload", publish_payload),
                patch(
                    "controllers.console.datasets.rag_pipeline.rag_pipeline.RagPipelineService"
                ) as mock_service_class,
            ):
                # Create service instance
                mock_service = MagicMock()
                mock_service.publish_customized_pipeline_template.return_value = None
                mock_service_class.return_value = mock_service

                # Act: Call the API
                resource = PublishCustomizedPipelineTemplateApi()
                result = resource.post(pipeline_id)

                # Assert: Verify response
                assert result == {"result": "success"}
                # Verify icon_info was included in service call
                call_args = mock_service.publish_customized_pipeline_template.call_args[0]
                assert call_args[1]["icon_info"] == publish_payload["icon_info"]
