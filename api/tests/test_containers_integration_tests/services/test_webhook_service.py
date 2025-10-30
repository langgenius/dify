import json
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker
from flask import Flask
from werkzeug.datastructures import FileStorage

from models.model import App
from models.trigger import WorkflowWebhookTrigger
from services.account_service import AccountService, TenantService
from services.trigger.webhook_service import WebhookService


class TestWebhookService:
    """Integration tests for WebhookService using testcontainers."""

    @pytest.fixture
    def mock_external_dependencies(self):
        """Mock external service dependencies."""
        with (
            patch("services.webhook_service.AsyncWorkflowService") as mock_async_service,
            patch("services.webhook_service.ToolFileManager") as mock_tool_file_manager,
            patch("services.webhook_service.file_factory") as mock_file_factory,
            patch("services.account_service.FeatureService") as mock_feature_service,
        ):
            # Mock ToolFileManager
            mock_tool_file_instance = MagicMock()
            mock_tool_file_manager.return_value = mock_tool_file_instance

            # Mock file creation
            mock_tool_file = MagicMock()
            mock_tool_file.id = "test_file_id"
            mock_tool_file_instance.create_file_by_raw.return_value = mock_tool_file

            # Mock file factory
            mock_file_obj = MagicMock()
            mock_file_factory.build_from_mapping.return_value = mock_file_obj

            # Mock feature service
            mock_feature_service.get_system_features.return_value.is_allow_register = True
            mock_feature_service.get_system_features.return_value.is_allow_create_workspace = True

            yield {
                "async_service": mock_async_service,
                "tool_file_manager": mock_tool_file_manager,
                "file_factory": mock_file_factory,
                "tool_file": mock_tool_file,
                "file_obj": mock_file_obj,
                "feature_service": mock_feature_service,
            }

    @pytest.fixture
    def test_data(self, db_session_with_containers, mock_external_dependencies):
        """Create test data for webhook service tests."""
        fake = Faker()

        # Create account and tenant
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app
        app = App(
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(),
            mode="workflow",
            icon="",
            icon_background="",
            enable_site=True,
            enable_api=True,
        )
        db_session_with_containers.add(app)
        db_session_with_containers.flush()

        # Create workflow
        workflow_data = {
            "nodes": [
                {
                    "id": "webhook_node",
                    "type": "webhook",
                    "data": {
                        "title": "Test Webhook",
                        "method": "post",
                        "content_type": "application/json",
                        "headers": [
                            {"name": "Authorization", "required": True},
                            {"name": "Content-Type", "required": False},
                        ],
                        "params": [{"name": "version", "required": True}, {"name": "format", "required": False}],
                        "body": [
                            {"name": "message", "type": "string", "required": True},
                            {"name": "count", "type": "number", "required": False},
                            {"name": "upload", "type": "file", "required": False},
                        ],
                        "status_code": 200,
                        "response_body": '{"status": "success"}',
                        "timeout": 30,
                    },
                }
            ],
            "edges": [],
        }

        workflow = Workflow(
            tenant_id=tenant.id,
            app_id=app.id,
            type="workflow",
            graph=json.dumps(workflow_data),
            features=json.dumps({}),
            created_by=account.id,
            environment_variables=[],
            conversation_variables=[],
            version="1.0",
        )
        db_session_with_containers.add(workflow)
        db_session_with_containers.flush()

        # Create webhook trigger
        webhook_id = fake.uuid4()[:16]
        webhook_trigger = WorkflowWebhookTrigger(
            app_id=app.id,
            node_id="webhook_node",
            tenant_id=tenant.id,
            webhook_id=webhook_id,
            created_by=account.id,
        )
        db_session_with_containers.add(webhook_trigger)
        db_session_with_containers.commit()

        return {
            "tenant": tenant,
            "account": account,
            "app": app,
            "workflow": workflow,
            "webhook_trigger": webhook_trigger,
            "webhook_id": webhook_id,
        }

    def test_get_webhook_trigger_and_workflow_success(self, test_data, flask_app_with_containers):
        """Test successful retrieval of webhook trigger and workflow."""
        webhook_id = test_data["webhook_id"]

        with flask_app_with_containers.app_context():
            webhook_trigger, workflow, node_config = WebhookService.get_webhook_trigger_and_workflow(webhook_id)

            assert webhook_trigger is not None
            assert webhook_trigger.webhook_id == webhook_id
            assert workflow is not None
            assert workflow.app_id == test_data["app"].id
            assert node_config is not None
            assert node_config["id"] == "webhook_node"
            assert node_config["data"]["title"] == "Test Webhook"

    def test_get_webhook_trigger_and_workflow_not_found(self, flask_app_with_containers):
        """Test webhook trigger not found scenario."""
        with flask_app_with_containers.app_context():
            with pytest.raises(ValueError, match="Webhook not found"):
                WebhookService.get_webhook_trigger_and_workflow("nonexistent_webhook")

    def test_extract_webhook_data_json(self):
        """Test webhook data extraction from JSON request."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": "Bearer token"},
            query_string="version=1&format=json",
            json={"message": "hello", "count": 42},
        ):
            webhook_trigger = MagicMock()
            webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

            assert webhook_data["method"] == "POST"
            assert webhook_data["headers"]["Authorization"] == "Bearer token"
            assert webhook_data["query_params"]["version"] == "1"
            assert webhook_data["query_params"]["format"] == "json"
            assert webhook_data["body"]["message"] == "hello"
            assert webhook_data["body"]["count"] == 42
            assert webhook_data["files"] == {}

    def test_extract_webhook_data_form_urlencoded(self):
        """Test webhook data extraction from form URL encoded request."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={"username": "test", "password": "secret"},
        ):
            webhook_trigger = MagicMock()
            webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

            assert webhook_data["method"] == "POST"
            assert webhook_data["body"]["username"] == "test"
            assert webhook_data["body"]["password"] == "secret"

    def test_extract_webhook_data_multipart_with_files(self, mock_external_dependencies):
        """Test webhook data extraction from multipart form with files."""
        app = Flask(__name__)

        # Create a mock file
        file_content = b"test file content"
        file_storage = FileStorage(stream=BytesIO(file_content), filename="test.txt", content_type="text/plain")

        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "multipart/form-data"},
            data={"message": "test", "upload": file_storage},
        ):
            webhook_trigger = MagicMock()
            webhook_trigger.tenant_id = "test_tenant"

            webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

            assert webhook_data["method"] == "POST"
            assert webhook_data["body"]["message"] == "test"
            assert "upload" in webhook_data["files"]

            # Verify file processing was called
            mock_external_dependencies["tool_file_manager"].assert_called_once()
            mock_external_dependencies["file_factory"].build_from_mapping.assert_called_once()

    def test_extract_webhook_data_raw_text(self):
        """Test webhook data extraction from raw text request."""
        app = Flask(__name__)

        with app.test_request_context(
            "/webhook", method="POST", headers={"Content-Type": "text/plain"}, data="raw text content"
        ):
            webhook_trigger = MagicMock()
            webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

            assert webhook_data["method"] == "POST"
            assert webhook_data["body"]["raw"] == "raw text content"

    def test_validate_webhook_request_success(self):
        """Test successful webhook request validation."""
        webhook_data = {
            "method": "POST",
            "headers": {"Authorization": "Bearer token", "Content-Type": "application/json"},
            "query_params": {"version": "1"},
            "body": {"message": "hello"},
            "files": {},
        }

        node_config = {
            "data": {
                "method": "post",
                "headers": [{"name": "Authorization", "required": True}, {"name": "Content-Type", "required": False}],
                "params": [{"name": "version", "required": True}],
                "body": [{"name": "message", "type": "string", "required": True}],
            }
        }

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is True

    def test_validate_webhook_request_method_mismatch(self):
        """Test webhook validation with HTTP method mismatch."""
        webhook_data = {"method": "GET", "headers": {}, "query_params": {}, "body": {}, "files": {}}

        node_config = {"data": {"method": "post"}}

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is False
        assert "HTTP method mismatch" in result["error"]

    def test_validate_webhook_request_missing_required_header(self):
        """Test webhook validation with missing required header."""
        webhook_data = {"method": "POST", "headers": {}, "query_params": {}, "body": {}, "files": {}}

        node_config = {"data": {"method": "post", "headers": [{"name": "Authorization", "required": True}]}}

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is False
        assert "Required header missing: Authorization" in result["error"]

    def test_validate_webhook_request_case_insensitive_headers(self):
        """Test webhook validation with case-insensitive header matching."""
        webhook_data = {
            "method": "POST",
            "headers": {"authorization": "Bearer token"},  # lowercase
            "query_params": {},
            "body": {},
            "files": {},
        }

        node_config = {
            "data": {
                "method": "post",
                "headers": [
                    {"name": "Authorization", "required": True}  # Pascal case
                ],
            }
        }

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is True

    def test_validate_webhook_request_missing_required_param(self):
        """Test webhook validation with missing required query parameter."""
        webhook_data = {"method": "POST", "headers": {}, "query_params": {}, "body": {}, "files": {}}

        node_config = {"data": {"method": "post", "params": [{"name": "version", "required": True}]}}

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is False
        assert "Required query parameter missing: version" in result["error"]

    def test_validate_webhook_request_missing_required_body_param(self):
        """Test webhook validation with missing required body parameter."""
        webhook_data = {"method": "POST", "headers": {}, "query_params": {}, "body": {}, "files": {}}

        node_config = {"data": {"method": "post", "body": [{"name": "message", "type": "string", "required": True}]}}

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is False
        assert "Required body parameter missing: message" in result["error"]

    def test_validate_webhook_request_missing_required_file(self):
        """Test webhook validation with missing required file parameter."""
        webhook_data = {"method": "POST", "headers": {}, "query_params": {}, "body": {}, "files": {}}

        node_config = {"data": {"method": "post", "body": [{"name": "upload", "type": "file", "required": True}]}}

        result = WebhookService.validate_webhook_request(webhook_data, node_config)

        assert result["valid"] is False
        assert "Required file parameter missing: upload" in result["error"]

    def test_trigger_workflow_execution_success(self, test_data, mock_external_dependencies, flask_app_with_containers):
        """Test successful workflow execution trigger."""
        webhook_data = {
            "method": "POST",
            "headers": {"Authorization": "Bearer token"},
            "query_params": {"version": "1"},
            "body": {"message": "hello"},
            "files": {},
        }

        with flask_app_with_containers.app_context():
            # Mock tenant owner lookup to return the test account
            with patch("services.webhook_service.select") as mock_select:
                mock_query = MagicMock()
                mock_select.return_value.join.return_value.where.return_value = mock_query

                # Mock the session to return our test account
                with patch("services.webhook_service.Session") as mock_session:
                    mock_session_instance = MagicMock()
                    mock_session.return_value.__enter__.return_value = mock_session_instance
                    mock_session_instance.scalar.return_value = test_data["account"]

                    # Should not raise any exceptions
                    WebhookService.trigger_workflow_execution(
                        test_data["webhook_trigger"], webhook_data, test_data["workflow"]
                    )

                    # Verify AsyncWorkflowService was called
                    mock_external_dependencies["async_service"].trigger_workflow_async.assert_called_once()

    def test_trigger_workflow_execution_no_tenant_owner(
        self, test_data, mock_external_dependencies, flask_app_with_containers
    ):
        """Test workflow execution trigger when tenant owner not found."""
        webhook_data = {"method": "POST", "headers": {}, "query_params": {}, "body": {}, "files": {}}

        with flask_app_with_containers.app_context():
            # Mock tenant owner lookup to return None
            with (
                patch("services.webhook_service.select") as mock_select,
                patch("services.webhook_service.Session") as mock_session,
            ):
                mock_session_instance = MagicMock()
                mock_session.return_value.__enter__.return_value = mock_session_instance
                mock_session_instance.scalar.return_value = None

                with pytest.raises(ValueError, match="Tenant owner not found"):
                    WebhookService.trigger_workflow_execution(
                        test_data["webhook_trigger"], webhook_data, test_data["workflow"]
                    )

    def test_generate_webhook_response_default(self):
        """Test webhook response generation with default values."""
        node_config = {"data": {}}

        response_data, status_code = WebhookService.generate_webhook_response(node_config)

        assert status_code == 200
        assert response_data["status"] == "success"
        assert "Webhook processed successfully" in response_data["message"]

    def test_generate_webhook_response_custom_json(self):
        """Test webhook response generation with custom JSON response."""
        node_config = {"data": {"status_code": 201, "response_body": '{"result": "created", "id": 123}'}}

        response_data, status_code = WebhookService.generate_webhook_response(node_config)

        assert status_code == 201
        assert response_data["result"] == "created"
        assert response_data["id"] == 123

    def test_generate_webhook_response_custom_text(self):
        """Test webhook response generation with custom text response."""
        node_config = {"data": {"status_code": 202, "response_body": "Request accepted for processing"}}

        response_data, status_code = WebhookService.generate_webhook_response(node_config)

        assert status_code == 202
        assert response_data["message"] == "Request accepted for processing"

    def test_generate_webhook_response_invalid_json(self):
        """Test webhook response generation with invalid JSON response."""
        node_config = {"data": {"status_code": 400, "response_body": '{"invalid": json}'}}

        response_data, status_code = WebhookService.generate_webhook_response(node_config)

        assert status_code == 400
        assert response_data["message"] == '{"invalid": json}'

    def test_process_file_uploads_success(self, mock_external_dependencies):
        """Test successful file upload processing."""
        # Create mock files
        files = {
            "file1": MagicMock(filename="test1.txt", content_type="text/plain"),
            "file2": MagicMock(filename="test2.jpg", content_type="image/jpeg"),
        }

        # Mock file reads
        files["file1"].read.return_value = b"content1"
        files["file2"].read.return_value = b"content2"

        webhook_trigger = MagicMock()
        webhook_trigger.tenant_id = "test_tenant"

        result = WebhookService._process_file_uploads(files, webhook_trigger)

        assert len(result) == 2
        assert "file1" in result
        assert "file2" in result

        # Verify file processing was called for each file
        assert mock_external_dependencies["tool_file_manager"].call_count == 2
        assert mock_external_dependencies["file_factory"].build_from_mapping.call_count == 2

    def test_process_file_uploads_with_errors(self, mock_external_dependencies):
        """Test file upload processing with errors."""
        # Create mock files, one will fail
        files = {
            "good_file": MagicMock(filename="test.txt", content_type="text/plain"),
            "bad_file": MagicMock(filename="test.bad", content_type="text/plain"),
        }

        files["good_file"].read.return_value = b"content"
        files["bad_file"].read.side_effect = Exception("Read error")

        webhook_trigger = MagicMock()
        webhook_trigger.tenant_id = "test_tenant"

        result = WebhookService._process_file_uploads(files, webhook_trigger)

        # Should process the good file and skip the bad one
        assert len(result) == 1
        assert "good_file" in result
        assert "bad_file" not in result

    def test_process_file_uploads_empty_filename(self, mock_external_dependencies):
        """Test file upload processing with empty filename."""
        files = {
            "no_filename": MagicMock(filename="", content_type="text/plain"),
            "none_filename": MagicMock(filename=None, content_type="text/plain"),
        }

        webhook_trigger = MagicMock()
        webhook_trigger.tenant_id = "test_tenant"

        result = WebhookService._process_file_uploads(files, webhook_trigger)

        # Should skip files without filenames
        assert len(result) == 0
        mock_external_dependencies["tool_file_manager"].assert_not_called()
