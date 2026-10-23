import logging
from io import BytesIO
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy import Engine as _webhook_service_relationships_Engine
from sqlalchemy import Table, select
from sqlalchemy.engine import Engine as _webhook_service_Engine
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import RequestEntityTooLarge

from core.trigger.constants import TRIGGER_WEBHOOK_NODE_TYPE
from core.workflow.nodes.trigger_webhook.entities import (
    ContentType,
    WebhookBodyParameter,
    WebhookData,
    WebhookParameter,
)
from graphon.variables.types import SegmentType
from models.base import TypeBase
from models.enums import AppTriggerStatus, AppTriggerType, EndUserType
from models.model import App, AppMode, EndUser
from models.tools import ToolFile
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from models.workflow import Workflow
from services.errors.app import QuotaExceededError
from services.trigger import webhook_service
from services.trigger import webhook_service as service_module
from services.trigger import webhook_service as webhook_service_module
from services.trigger.webhook_service import WebhookService
from tests.helpers.unit.model_factories import make_app, make_end_user, make_workflow


class _EndUserServiceStub:
    def __init__(self, result: EndUser | Exception) -> None:
        self._result = result
        self.calls: list[tuple[EndUserType, str, str, str | None]] = []

    def get_or_create_end_user_by_type(
        self,
        type: EndUserType,
        tenant_id: str,
        app_id: str,
        user_id: str | None = None,
    ) -> EndUser:
        self.calls.append((type, tenant_id, app_id, user_id))
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


def _webhook_trigger(
    *,
    webhook_id: str = "webhook-123",
    tenant_id: str = "tenant-123",
    app_id: str = "app-123",
    node_id: str = "node-123",
    created_by: str = "account-123",
) -> WorkflowWebhookTrigger:
    return WorkflowWebhookTrigger(
        webhook_id=webhook_id,
        tenant_id=tenant_id,
        app_id=app_id,
        node_id=node_id,
        created_by=created_by,
    )


def _tool_file() -> ToolFile:
    tool_file = ToolFile(
        user_id="user-123",
        tenant_id="test_tenant",
        conversation_id=None,
        file_key="webhook/test.txt",
        mimetype="text/plain",
        name="test.txt",
        size=7,
    )
    tool_file.id = "test_file_id"
    return tool_file


def _workflow(
    *,
    workflow_id: str = "workflow-123",
    tenant_id: str = "tenant-123",
    app_id: str = "app-123",
    version: str = Workflow.VERSION_DRAFT,
) -> Workflow:
    return make_workflow(
        workflow_id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        version=version,
        created_by="account-123",
    )


def _app(*, tenant_id: str = "tenant-123", app_id: str = "app-123") -> App:
    return make_app(
        app_id=app_id,
        tenant_id=tenant_id,
        name="Webhook App",
        mode=AppMode.WORKFLOW,
        icon_type=None,
        max_active_requests=0,
    )


def _app_trigger(*, status: AppTriggerStatus = AppTriggerStatus.ENABLED) -> AppTrigger:
    return AppTrigger(
        tenant_id="tenant-123",
        app_id="app-123",
        node_id="node-123",
        trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
        title="Webhook",
        status=status,
    )


def _end_user() -> EndUser:
    return make_end_user(
        end_user_id="end-user-123",
        tenant_id="tenant-123",
        app_id="app-123",
        end_user_type=EndUserType.TRIGGER,
        session_id="webhook-session",
    )


class TestWebhookServiceCases:
    class TestWebhookServiceLookup:
        def test_debug_lookup_scopes_draft_workflow_to_trigger_owner(
            self,
            sqlite_session: Session,
            sqlite_engine: _webhook_service_Engine,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            target_workflow = _workflow()
            tenant_decoy = _workflow(
                workflow_id="workflow-decoy",
                tenant_id="tenant-other",
                app_id="app-123",
            )
            sqlite_session.add_all([_webhook_trigger(), target_workflow, tenant_decoy])
            sqlite_session.commit()
            monkeypatch.setattr(webhook_service_module, "db", SimpleNamespace(engine=sqlite_engine))
            node_config = {"id": "node-123", "data": {}}

            with patch.object(Workflow, "get_node_config_by_id", autospec=True, return_value=node_config) as get_node:
                webhook_trigger, workflow, result_node_config = WebhookService.get_webhook_trigger_and_workflow(
                    "webhook-123", is_debug=True
                )

            assert webhook_trigger.tenant_id == "tenant-123"
            assert workflow.id == target_workflow.id
            assert result_node_config is node_config
            get_node.assert_called_once_with(workflow, "node-123")

        def test_published_lookup_uses_persisted_owner_chain(
            self,
            sqlite_session: Session,
            sqlite_engine: _webhook_service_Engine,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            sqlite_session.add_all([_webhook_trigger(), _app_trigger(), _app()])
            sqlite_session.commit()
            monkeypatch.setattr(webhook_service_module, "db", SimpleNamespace(engine=sqlite_engine))
            published_workflow = _workflow(version="published")
            node_config = {"id": "node-123", "data": {}}

            with (
                patch.object(webhook_service_module, "WorkflowService") as workflow_service_class,
                patch.object(Workflow, "get_node_config_by_id", autospec=True, return_value=node_config),
            ):
                get_published_workflow = workflow_service_class.return_value.get_published_workflow
                get_published_workflow.return_value = published_workflow
                webhook_trigger, workflow, result_node_config = WebhookService.get_webhook_trigger_and_workflow(
                    "webhook-123"
                )

            assert webhook_trigger.app_id == "app-123"
            assert workflow is published_workflow
            assert result_node_config is node_config
            persisted_app = get_published_workflow.call_args.args[0]
            assert isinstance(persisted_app, App)
            assert persisted_app.id == "app-123"
            assert persisted_app.tenant_id == "tenant-123"

        def test_published_lookup_rejects_cross_tenant_app_decoy(
            self,
            sqlite_session: Session,
            sqlite_engine: _webhook_service_Engine,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            sqlite_session.add_all(
                [
                    _webhook_trigger(),
                    _app_trigger(),
                    _app(tenant_id="tenant-other"),
                ]
            )
            sqlite_session.commit()
            monkeypatch.setattr(webhook_service_module, "db", SimpleNamespace(engine=sqlite_engine))

            with pytest.raises(ValueError, match="App not found"):
                WebhookService.get_webhook_trigger_and_workflow("webhook-123")

        @pytest.mark.parametrize(
            "status",
            [AppTriggerStatus.DISABLED, AppTriggerStatus.UNAUTHORIZED],
        )
        def test_published_lookup_rejects_inactive_trigger(
            self,
            status: AppTriggerStatus,
            sqlite_session: Session,
            sqlite_engine: _webhook_service_Engine,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            sqlite_session.add_all([_webhook_trigger(), _app_trigger(status=status)])
            sqlite_session.commit()
            monkeypatch.setattr(webhook_service_module, "db", SimpleNamespace(engine=sqlite_engine))

            with pytest.raises(ValueError, match="disabled"):
                WebhookService.get_webhook_trigger_and_workflow("webhook-123")

        def test_published_lookup_reports_rate_limited_trigger(
            self,
            sqlite_session: Session,
            sqlite_engine: _webhook_service_Engine,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            sqlite_session.add_all([_webhook_trigger(), _app_trigger(status=AppTriggerStatus.RATE_LIMITED)])
            sqlite_session.commit()
            monkeypatch.setattr(webhook_service_module, "db", SimpleNamespace(engine=sqlite_engine))

            with pytest.raises(QuotaExceededError):
                WebhookService.get_webhook_trigger_and_workflow("webhook-123")

    class TestWebhookServiceUnit:
        """Webhook business-logic tests with isolated sessions where the service owns their lifecycle."""

        def test_trigger_workflow_execution_propagates_quota_error_without_error_log(
            self,
            caplog: pytest.LogCaptureFixture,
            monkeypatch: pytest.MonkeyPatch,
            sqlite_engine: _webhook_service_Engine,
        ) -> None:
            """Quota failures refund the charge and close the real service-owned session."""
            monkeypatch.setattr(webhook_service_module, "db", SimpleNamespace(engine=sqlite_engine))
            webhook_trigger = _webhook_trigger()
            workflow = _workflow()
            quota_charge = MagicMock()
            quota_error = QuotaExceededError(feature="workflow", tenant_id="tenant-123", required=1)

            caplog.set_level(logging.INFO)
            with (
                patch("services.trigger.webhook_service.QuotaService.reserve", return_value=quota_charge),
                patch(
                    "services.trigger.webhook_service.AsyncWorkflowService.trigger_workflow_async",
                    side_effect=quota_error,
                ) as mock_trigger_workflow_async,
            ):
                with pytest.raises(QuotaExceededError) as exc_info:
                    WebhookService.trigger_workflow_execution(
                        webhook_trigger,
                        {"body": {}, "headers": {}, "query_params": {}, "files": {}, "method": "POST"},
                        workflow,
                        end_users=_EndUserServiceStub(_end_user()),
                    )

            assert exc_info.value is quota_error
            quota_charge.refund.assert_called_once_with()
            session = mock_trigger_workflow_async.call_args.kwargs["session"]
            assert isinstance(session, Session)
            assert session.in_transaction() is False
            assert len(caplog.records) == 1
            assert caplog.records[0].levelno == logging.INFO
            assert caplog.records[0].message == (
                "Tenant tenant-123 quota exceeded for feature workflow, skipping webhook trigger webhook-123"
            )

        def test_trigger_workflow_execution_success(
            self,
            monkeypatch: pytest.MonkeyPatch,
            sqlite_engine: _webhook_service_Engine,
        ) -> None:
            monkeypatch.setattr(webhook_service_module, "db", SimpleNamespace(engine=sqlite_engine))
            webhook_trigger = _webhook_trigger()
            workflow = _workflow()
            end_user = _end_user()
            quota_charge = MagicMock()
            webhook_data = {
                "method": "POST",
                "headers": {"Authorization": "Bearer token"},
                "query_params": {"version": "1"},
                "body": {"message": "hello"},
                "files": {},
            }

            with (
                patch.object(webhook_service_module.QuotaService, "reserve", return_value=quota_charge),
                patch.object(
                    webhook_service_module.AsyncWorkflowService,
                    "trigger_workflow_async",
                ) as mock_trigger,
            ):
                WebhookService.trigger_workflow_execution(
                    webhook_trigger,
                    webhook_data,
                    workflow,
                    end_users=_EndUserServiceStub(end_user),
                )

            call_session = mock_trigger.call_args.kwargs["session"]
            assert call_session.get_bind() is sqlite_engine
            quota_charge.commit.assert_called_once_with()
            quota_charge.refund.assert_not_called()

        def test_trigger_workflow_execution_end_user_service_failure(self) -> None:
            webhook_trigger = _webhook_trigger()
            workflow = _workflow()
            webhook_data = {"method": "POST", "headers": {}, "query_params": {}, "body": {}, "files": {}}

            with pytest.raises(ValueError, match="Failed to create end user"):
                WebhookService.trigger_workflow_execution(
                    webhook_trigger,
                    webhook_data,
                    workflow,
                    end_users=_EndUserServiceStub(ValueError("Failed to create end user")),
                )

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
                webhook_trigger = _webhook_trigger()
                webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

                assert webhook_data["method"] == "POST"
                assert webhook_data["headers"]["Authorization"] == "Bearer token"
                # Query params are now extracted as raw strings
                assert webhook_data["query_params"]["version"] == "1"
                assert webhook_data["query_params"]["format"] == "json"
                assert webhook_data["body"]["message"] == "hello"
                assert webhook_data["body"]["count"] == 42
                assert webhook_data["files"] == {}

        def test_extract_webhook_data_query_params_remain_strings(self):
            """Query parameters should be extracted as raw strings without automatic conversion."""
            app = Flask(__name__)

            with app.test_request_context(
                "/webhook",
                method="GET",
                headers={"Content-Type": "application/json"},
                query_string="count=42&threshold=3.14&enabled=true&note=text",
            ):
                webhook_trigger = _webhook_trigger()
                webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

                # After refactoring, raw extraction keeps query params as strings
                assert webhook_data["query_params"]["count"] == "42"
                assert webhook_data["query_params"]["threshold"] == "3.14"
                assert webhook_data["query_params"]["enabled"] == "true"
                assert webhook_data["query_params"]["note"] == "text"

        def test_extract_webhook_data_form_urlencoded(self):
            """Test webhook data extraction from form URL encoded request."""
            app = Flask(__name__)

            with app.test_request_context(
                "/webhook",
                method="POST",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={"username": "test", "password": "secret"},
            ):
                webhook_trigger = _webhook_trigger()
                webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

                assert webhook_data["method"] == "POST"
                assert webhook_data["body"]["username"] == "test"
                assert webhook_data["body"]["password"] == "secret"

        def test_extract_webhook_data_multipart_with_files(self):
            """Test webhook data extraction from multipart form with files."""
            app = Flask(__name__)

            # Create a mock file
            file_content = b"test file content"
            file_storage = FileStorage(stream=BytesIO(file_content), filename="test.txt", content_type="text/plain")

            with app.test_request_context(
                "/webhook",
                method="POST",
                headers={"Content-Type": "multipart/form-data"},
                data={"message": "test", "file": file_storage},
            ):
                webhook_trigger = _webhook_trigger()
                webhook_trigger.tenant_id = "test_tenant"

                with patch.object(WebhookService, "_process_file_uploads", autospec=True) as mock_process_files:
                    mock_process_files.return_value = {"file": "mocked_file_obj"}

                    webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

                    assert webhook_data["method"] == "POST"
                    assert webhook_data["body"]["message"] == "test"
                    assert webhook_data["files"]["file"] == "mocked_file_obj"
                    mock_process_files.assert_called_once()

        def test_extract_webhook_data_raw_text(self):
            """Test webhook data extraction from raw text request."""
            app = Flask(__name__)

            with app.test_request_context(
                "/webhook", method="POST", headers={"Content-Type": "text/plain"}, data="raw text content"
            ):
                webhook_trigger = _webhook_trigger()
                webhook_data = WebhookService.extract_webhook_data(webhook_trigger)

                assert webhook_data["method"] == "POST"
                assert webhook_data["body"]["raw"] == "raw text content"

        def test_extract_octet_stream_body_uses_detected_mime(self):
            """Octet-stream uploads should rely on detected MIME type."""
            app = Flask(__name__)
            binary_content = b"plain text data"

            with app.test_request_context(
                "/webhook", method="POST", headers={"Content-Type": "application/octet-stream"}, data=binary_content
            ):
                webhook_trigger = _webhook_trigger()
                mock_file = MagicMock()
                mock_file.to_dict.return_value = {"file": "data"}

                with (
                    patch.object(
                        WebhookService, "_detect_binary_mimetype", return_value="text/plain", autospec=True
                    ) as mock_detect,
                    patch.object(WebhookService, "_create_file_from_binary", autospec=True) as mock_create,
                ):
                    mock_create.return_value = mock_file
                    body, files = WebhookService._extract_octet_stream_body(webhook_trigger)

                assert body["raw"] == {"file": "data"}
                assert files == {}
                mock_detect.assert_called_once_with(binary_content)
                mock_create.assert_called_once()
                args = mock_create.call_args[0]
                assert args[0] == binary_content
                assert args[1] == "text/plain"
                assert args[2] is webhook_trigger

        def test_detect_binary_mimetype_uses_magic(self, monkeypatch: pytest.MonkeyPatch):
            """python-magic output should be used when available."""
            fake_magic = MagicMock()
            fake_magic.from_buffer.return_value = "image/png"
            monkeypatch.setattr("services.trigger.webhook_service.magic", fake_magic)

            result = WebhookService._detect_binary_mimetype(b"binary data")

            assert result == "image/png"
            fake_magic.from_buffer.assert_called_once()

        def test_detect_binary_mimetype_fallback_without_magic(self, monkeypatch: pytest.MonkeyPatch):
            """Fallback MIME type should be used when python-magic is unavailable."""
            monkeypatch.setattr("services.trigger.webhook_service.magic", None)

            result = WebhookService._detect_binary_mimetype(b"binary data")

            assert result == "application/octet-stream"

        def test_detect_binary_mimetype_handles_magic_exception(
            self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
        ):
            """Fallback MIME type should be used when python-magic raises an exception."""
            try:
                import magic as real_magic
            except ImportError:
                pytest.skip("python-magic is not installed")

            fake_magic = MagicMock()
            fake_magic.from_buffer.side_effect = real_magic.MagicException("magic error")
            monkeypatch.setattr("services.trigger.webhook_service.magic", fake_magic)
            caplog.set_level(logging.DEBUG, logger="services.trigger.webhook_service")

            result = WebhookService._detect_binary_mimetype(b"binary data")

            assert result == "application/octet-stream"
            assert "python-magic detection failed for octet-stream payload" in caplog.messages

        def test_extract_webhook_data_invalid_json(self):
            """Test webhook data extraction with invalid JSON."""
            app = Flask(__name__)

            with app.test_request_context(
                "/webhook", method="POST", headers={"Content-Type": "application/json"}, data="invalid json"
            ):
                webhook_trigger = _webhook_trigger()
                with pytest.raises(ValueError, match="Invalid JSON body"):
                    WebhookService.extract_webhook_data(webhook_trigger)

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

        def test_generate_webhook_response_empty_response_body(self):
            """Test webhook response generation with empty response body."""
            node_config = {"data": {"status_code": 204, "response_body": ""}}

            response_data, status_code = WebhookService.generate_webhook_response(node_config)

            assert status_code == 204
            assert response_data["status"] == "success"
            assert "Webhook processed successfully" in response_data["message"]

        def test_generate_webhook_response_array_json(self):
            """Test webhook response generation with JSON array response."""
            node_config = {"data": {"status_code": 200, "response_body": '[{"id": 1}, {"id": 2}]'}}

            response_data, status_code = WebhookService.generate_webhook_response(node_config)

            assert status_code == 200
            assert isinstance(response_data, list)
            assert len(response_data) == 2
            assert response_data[0]["id"] == 1
            assert response_data[1]["id"] == 2

        @patch("services.trigger.webhook_service.ToolFileManager", autospec=True)
        @patch("services.trigger.webhook_service.file_factory", autospec=True)
        def test_process_file_uploads_success(self, mock_file_factory, mock_tool_file_manager):
            """Test successful file upload processing."""
            # Mock ToolFileManager
            mock_tool_file_instance = mock_tool_file_manager.return_value  # Mock file creation
            mock_tool_file_instance.create_file_by_raw.return_value = _tool_file()

            # Mock file factory
            mock_file_obj = MagicMock()
            mock_file_factory.build_from_mapping.return_value = mock_file_obj

            # Create mock files
            files = {
                "file1": MagicMock(filename="test1.txt", content_type="text/plain"),
                "file2": MagicMock(filename="test2.jpg", content_type="image/jpeg"),
            }

            # Mock file reads
            files["file1"].stream.read.return_value = b"content1"
            files["file2"].stream.read.return_value = b"content2"

            webhook_trigger = _webhook_trigger()
            webhook_trigger.tenant_id = "test_tenant"

            result = WebhookService._process_file_uploads(files, webhook_trigger)

            assert len(result) == 2
            assert "file1" in result
            assert "file2" in result

            # Verify file processing was called for each file
            assert mock_tool_file_manager.call_count == 2
            assert mock_file_factory.build_from_mapping.call_count == 2

        @patch("services.trigger.webhook_service.ToolFileManager", autospec=True)
        @patch("services.trigger.webhook_service.file_factory", autospec=True)
        def test_process_file_uploads_with_errors(self, mock_file_factory, mock_tool_file_manager):
            """Test file upload processing with errors."""
            # Mock ToolFileManager
            mock_tool_file_instance = mock_tool_file_manager.return_value  # Mock file creation
            mock_tool_file_instance.create_file_by_raw.return_value = _tool_file()

            # Mock file factory
            mock_file_obj = MagicMock()
            mock_file_factory.build_from_mapping.return_value = mock_file_obj

            # Create mock files, one will fail
            files = {
                "good_file": MagicMock(filename="test.txt", content_type="text/plain"),
                "bad_file": MagicMock(filename="test.bad", content_type="text/plain"),
            }

            files["good_file"].stream.read.return_value = b"content"
            files["bad_file"].stream.read.side_effect = Exception("Read error")

            webhook_trigger = _webhook_trigger()
            webhook_trigger.tenant_id = "test_tenant"

            result = WebhookService._process_file_uploads(files, webhook_trigger)

            # Should process the good file and skip the bad one
            assert len(result) == 1
            assert "good_file" in result
            assert "bad_file" not in result

        def test_process_file_uploads_empty_filename(self):
            """Test file upload processing with empty filename."""
            files = {
                "no_filename": MagicMock(filename="", content_type="text/plain"),
                "none_filename": MagicMock(filename=None, content_type="text/plain"),
            }

            webhook_trigger = _webhook_trigger()
            webhook_trigger.tenant_id = "test_tenant"

            result = WebhookService._process_file_uploads(files, webhook_trigger)

            # Should skip files without filenames
            assert len(result) == 0

        def test_validate_json_value_string(self):
            """Test JSON value validation for string type."""
            # Valid string
            result = WebhookService._validate_json_value("name", "hello", "string")
            assert result == "hello"

            # Invalid string (number) - should raise ValueError
            with pytest.raises(ValueError, match="Expected string, got int"):
                WebhookService._validate_json_value("name", 123, "string")

        def test_validate_json_value_number(self):
            """Test JSON value validation for number type."""
            # Valid integer
            result = WebhookService._validate_json_value("count", 42, "number")
            assert result == 42

            # Valid float
            result = WebhookService._validate_json_value("price", 19.99, "number")
            assert result == 19.99

            # Invalid number (string) - should raise ValueError
            with pytest.raises(ValueError, match="Expected number, got str"):
                WebhookService._validate_json_value("count", "42", "number")

        def test_validate_json_value_bool(self):
            """Test JSON value validation for boolean type."""
            # Valid boolean
            result = WebhookService._validate_json_value("enabled", True, "boolean")
            assert result is True

            result = WebhookService._validate_json_value("enabled", False, "boolean")
            assert result is False

            # Invalid boolean (string) - should raise ValueError
            with pytest.raises(ValueError, match="Expected boolean, got str"):
                WebhookService._validate_json_value("enabled", "true", "boolean")

        def test_validate_json_value_object(self):
            """Test JSON value validation for object type."""
            # Valid object
            result = WebhookService._validate_json_value("user", {"name": "John", "age": 30}, "object")
            assert result == {"name": "John", "age": 30}

            # Invalid object (string) - should raise ValueError
            with pytest.raises(ValueError, match="Expected object, got str"):
                WebhookService._validate_json_value("user", "not_an_object", "object")

        def test_validate_json_value_array_string(self):
            """Test JSON value validation for array[string] type."""
            # Valid array of strings
            result = WebhookService._validate_json_value("tags", ["tag1", "tag2", "tag3"], "array[string]")
            assert result == ["tag1", "tag2", "tag3"]

            # Invalid - not an array
            with pytest.raises(ValueError, match="Expected array of strings, got str"):
                WebhookService._validate_json_value("tags", "not_an_array", "array[string]")

            # Invalid - array with non-strings
            with pytest.raises(ValueError, match="Expected array of strings, got list"):
                WebhookService._validate_json_value("tags", ["tag1", 123, "tag3"], "array[string]")

        def test_validate_json_value_array_number(self):
            """Test JSON value validation for array[number] type."""
            # Valid array of numbers
            result = WebhookService._validate_json_value("scores", [1, 2.5, 3, 4.7], "array[number]")
            assert result == [1, 2.5, 3, 4.7]

            # Invalid - array with non-numbers
            with pytest.raises(ValueError, match="Expected array of numbers, got list"):
                WebhookService._validate_json_value("scores", [1, "2", 3], "array[number]")

        def test_validate_json_value_array_bool(self):
            """Test JSON value validation for array[boolean] type."""
            # Valid array of booleans
            result = WebhookService._validate_json_value("flags", [True, False, True], "array[boolean]")
            assert result == [True, False, True]

            # Invalid - array with non-booleans
            with pytest.raises(ValueError, match="Expected array of booleans, got list"):
                WebhookService._validate_json_value("flags", [True, "false", True], "array[boolean]")

        def test_validate_json_value_array_object(self):
            """Test JSON value validation for array[object] type."""
            # Valid array of objects
            result = WebhookService._validate_json_value("users", [{"name": "John"}, {"name": "Jane"}], "array[object]")
            assert result == [{"name": "John"}, {"name": "Jane"}]

            # Invalid - array with non-objects
            with pytest.raises(ValueError, match="Expected array of objects, got list"):
                WebhookService._validate_json_value("users", [{"name": "John"}, "not_object"], "array[object]")

        def test_convert_form_value_string(self):
            """Test form value conversion for string type."""
            result = WebhookService._convert_form_value("test", "hello", "string")
            assert result == "hello"

        def test_convert_form_value_number(self):
            """Test form value conversion for number type."""
            # Integer
            result = WebhookService._convert_form_value("count", "42", "number")
            assert result == 42

            # Float
            result = WebhookService._convert_form_value("price", "19.99", "number")
            assert result == 19.99

            # Invalid number
            with pytest.raises(ValueError, match="Cannot convert 'not_a_number' to number"):
                WebhookService._convert_form_value("count", "not_a_number", "number")

        def test_convert_form_value_boolean(self):
            """Test form value conversion for boolean type."""
            # True values
            assert WebhookService._convert_form_value("flag", "true", "boolean") is True
            assert WebhookService._convert_form_value("flag", "1", "boolean") is True
            assert WebhookService._convert_form_value("flag", "yes", "boolean") is True

            # False values
            assert WebhookService._convert_form_value("flag", "false", "boolean") is False
            assert WebhookService._convert_form_value("flag", "0", "boolean") is False
            assert WebhookService._convert_form_value("flag", "no", "boolean") is False

            # Invalid boolean
            with pytest.raises(ValueError, match="Cannot convert 'maybe' to boolean"):
                WebhookService._convert_form_value("flag", "maybe", "boolean")

        def test_extract_and_validate_webhook_data_success(self):
            """Test successful unified data extraction and validation."""
            app = Flask(__name__)

            with app.test_request_context(
                "/webhook",
                method="POST",
                headers={"Content-Type": "application/json"},
                query_string="count=42&enabled=true",
                json={"message": "hello", "age": 25},
            ):
                webhook_trigger = _webhook_trigger()
                node_config = {
                    "data": {
                        "method": "post",
                        "content_type": "application/json",
                        "params": [
                            {"name": "count", "type": "number", "required": True},
                            {"name": "enabled", "type": "boolean", "required": True},
                        ],
                        "body": [
                            {"name": "message", "type": "string", "required": True},
                            {"name": "age", "type": "number", "required": True},
                        ],
                    }
                }

                result = WebhookService.extract_and_validate_webhook_data(webhook_trigger, node_config)

                # Check that types are correctly converted
                assert result["query_params"]["count"] == 42  # Converted to int
                assert result["query_params"]["enabled"] is True  # Converted to bool
                assert result["body"]["message"] == "hello"  # Already string
                assert result["body"]["age"] == 25  # Already number

        def test_extract_and_validate_webhook_data_invalid_json_error(self):
            """Invalid JSON should bubble up as a ValueError with details."""
            app = Flask(__name__)

            with app.test_request_context(
                "/webhook",
                method="POST",
                headers={"Content-Type": "application/json"},
                data='{"invalid": }',
            ):
                webhook_trigger = _webhook_trigger()
                node_config = {
                    "data": {
                        "method": "post",
                        "content_type": "application/json",
                    }
                }

                with pytest.raises(ValueError, match="Invalid JSON body"):
                    WebhookService.extract_and_validate_webhook_data(webhook_trigger, node_config)

        def test_extract_and_validate_webhook_data_validation_error(self):
            """Test unified data extraction with validation error."""
            app = Flask(__name__)

            with app.test_request_context(
                "/webhook",
                method="GET",  # Wrong method
                headers={"Content-Type": "application/json"},
            ):
                webhook_trigger = _webhook_trigger()
                node_config = {
                    "data": {
                        "method": "post",  # Expects POST
                        "content_type": "application/json",
                    }
                }

                with pytest.raises(ValueError, match="HTTP method mismatch"):
                    WebhookService.extract_and_validate_webhook_data(webhook_trigger, node_config)

        def test_extract_and_validate_webhook_request_missing_required_header(self) -> None:
            app = Flask(__name__)
            with app.test_request_context(
                "/webhook",
                method="POST",
                headers={"Content-Type": "application/json"},
            ):
                node_config = {
                    "data": {
                        "method": "post",
                        "content_type": "application/json",
                        "headers": [{"name": "Authorization", "required": True}],
                    }
                }

                with pytest.raises(ValueError, match="Required header missing: Authorization"):
                    WebhookService.extract_and_validate_webhook_data(_webhook_trigger(), node_config)

        def test_extract_and_validate_webhook_request_case_insensitive_headers(self) -> None:
            app = Flask(__name__)
            with app.test_request_context(
                "/webhook",
                method="POST",
                headers={"Content-Type": "application/json", "authorization": "Bearer token"},
                json={"message": "hello"},
            ):
                node_config = {
                    "data": {
                        "method": "post",
                        "content_type": "application/json",
                        "headers": [{"name": "Authorization", "required": True}],
                        "body": [{"name": "message", "type": "string", "required": True}],
                    }
                }

                result = WebhookService.extract_and_validate_webhook_data(_webhook_trigger(), node_config)

            assert result["headers"].get("Authorization") == "Bearer token"

        def test_extract_and_validate_webhook_request_missing_required_param(self) -> None:
            app = Flask(__name__)
            with app.test_request_context(
                "/webhook",
                method="POST",
                headers={"Content-Type": "application/json"},
                json={"message": "hello"},
            ):
                node_config = {
                    "data": {
                        "method": "post",
                        "content_type": "application/json",
                        "params": [{"name": "version", "required": True}],
                        "body": [{"name": "message", "type": "string", "required": True}],
                    }
                }

                with pytest.raises(ValueError, match="Required parameter missing: version"):
                    WebhookService.extract_and_validate_webhook_data(_webhook_trigger(), node_config)

        def test_extract_and_validate_webhook_request_missing_required_body_param(self) -> None:
            app = Flask(__name__)
            with app.test_request_context(
                "/webhook",
                method="POST",
                headers={"Content-Type": "application/json"},
                json={},
            ):
                node_config = {
                    "data": {
                        "method": "post",
                        "content_type": "application/json",
                        "body": [{"name": "message", "type": "string", "required": True}],
                    }
                }

                with pytest.raises(ValueError, match="Required body parameter missing: message"):
                    WebhookService.extract_and_validate_webhook_data(_webhook_trigger(), node_config)

        def test_extract_and_validate_webhook_request_missing_required_file(self) -> None:
            app = Flask(__name__)
            with app.test_request_context(
                "/webhook",
                method="POST",
                data={"note": "test"},
                content_type="multipart/form-data",
            ):
                node_config = {
                    "data": {
                        "method": "post",
                        "content_type": "multipart/form-data",
                        "body": [{"name": "file", "type": "file", "required": True}],
                    }
                }

                result = WebhookService.extract_and_validate_webhook_data(_webhook_trigger(), node_config)

            assert result["files"] == {}

        def test_debug_mode_parameter_handling(self):
            """Test that the debug mode parameter is properly handled in _prepare_webhook_execution."""
            from controllers.trigger.webhook import _prepare_webhook_execution

            # Mock the WebhookService methods
            with (
                patch.object(WebhookService, "get_webhook_trigger_and_workflow", autospec=True) as mock_get_trigger,
                patch.object(WebhookService, "extract_and_validate_webhook_data", autospec=True) as mock_extract,
            ):
                webhook_trigger = _webhook_trigger()
                workflow = _workflow()
                mock_config = {"data": {"test": "config"}}
                mock_data = {"test": "data"}

                mock_get_trigger.return_value = (webhook_trigger, workflow, mock_config)
                mock_extract.return_value = mock_data

                result = _prepare_webhook_execution("test_webhook", is_debug=False)
                assert result == (webhook_trigger, workflow, mock_config, mock_data, None)

                # Reset mock
                mock_get_trigger.reset_mock()

                result = _prepare_webhook_execution("test_webhook", is_debug=True)
                assert result == (webhook_trigger, workflow, mock_config, mock_data, None)


def _workflow_trigger(**kwargs: Any) -> WorkflowWebhookTrigger:
    values = {
        "webhook_id": "webhook-123",
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "node_id": "node-1",
        "created_by": "user-1",
    }
    values.update(kwargs)
    return WorkflowWebhookTrigger(**values)


class TestWebhookServiceAdditionalCases:
    @staticmethod
    @pytest.fixture
    def flask_app() -> Flask:
        return Flask(__name__)

    class TestWebhookServiceExtractionFallbacks:
        def test_extract_webhook_data_should_use_text_fallback_for_unknown_content_type(
            self,
            flask_app: Flask,
            monkeypatch: pytest.MonkeyPatch,
            caplog: pytest.LogCaptureFixture,
        ) -> None:
            webhook_trigger = _workflow_trigger()

            with caplog.at_level(logging.WARNING, logger="services.trigger.webhook_service"):
                with flask_app.test_request_context(
                    "/webhook",
                    method="POST",
                    headers={"Content-Type": "application/vnd.custom"},
                    data="plain content",
                ):
                    result = WebhookService.extract_webhook_data(webhook_trigger)

                assert result["body"] == {"raw": "plain content"}
                assert any(r.levelno >= logging.WARNING for r in caplog.records)

        def test_extract_webhook_data_should_raise_for_request_too_large(
            self,
            flask_app: Flask,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            from tests.helpers.unit.config_override import apply_config_overrides

            apply_config_overrides(monkeypatch, WEBHOOK_REQUEST_BODY_MAX_SIZE=1)

            with flask_app.test_request_context("/webhook", method="POST", data="ab"):
                with pytest.raises(RequestEntityTooLarge):
                    WebhookService.extract_webhook_data(_workflow_trigger())

        def test_extract_octet_stream_body_should_return_none_when_empty_payload(self, flask_app: Flask) -> None:
            webhook_trigger = _workflow_trigger()

            with flask_app.test_request_context("/webhook", method="POST", data=b""):
                body, files = WebhookService._extract_octet_stream_body(webhook_trigger)

            assert body == {"raw": None}
            assert files == {}

        def test_extract_octet_stream_body_should_return_none_when_processing_raises(
            self,
            flask_app: Flask,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            webhook_trigger = _workflow_trigger()
            monkeypatch.setattr(
                WebhookService, "_detect_binary_mimetype", MagicMock(return_value="application/octet-stream")
            )
            monkeypatch.setattr(WebhookService, "_create_file_from_binary", MagicMock(side_effect=RuntimeError("boom")))

            with flask_app.test_request_context("/webhook", method="POST", data=b"abc"):
                body, files = WebhookService._extract_octet_stream_body(webhook_trigger)

            assert body == {"raw": None}
            assert files == {}

        def test_extract_text_body_should_return_empty_string_when_request_read_fails(
            self,
            flask_app: Flask,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            monkeypatch.setattr("flask.wrappers.Request.get_data", MagicMock(side_effect=RuntimeError("read error")))

            with flask_app.test_request_context("/webhook", method="POST", data="abc"):
                body, files = WebhookService._extract_text_body()

            assert body == {"raw": ""}
            assert files == {}

        def test_detect_binary_mimetype_should_fallback_when_magic_raises(
            self,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            fake_magic = MagicMock()
            fake_magic.from_buffer.side_effect = RuntimeError("magic failed")
            monkeypatch.setattr(service_module, "magic", fake_magic)

            result = WebhookService._detect_binary_mimetype(b"binary")

            assert result == "application/octet-stream"

        def test_process_file_uploads_should_use_octet_stream_fallback_when_mimetype_unknown(
            self,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            webhook_trigger = _workflow_trigger(created_by="user-1", tenant_id="tenant-1")
            file_obj = MagicMock()
            file_obj.to_dict.return_value = {"id": "f-1"}
            monkeypatch.setattr(WebhookService, "_create_file_from_binary", MagicMock(return_value=file_obj))
            monkeypatch.setattr(service_module.mimetypes, "guess_type", MagicMock(return_value=(None, None)))

            uploaded = MagicMock()
            uploaded.filename = "file.unknown"
            uploaded.content_type = None
            uploaded.read.return_value = b"content"

            result = WebhookService._process_file_uploads({"f": uploaded}, webhook_trigger)

            assert result == {"f": {"id": "f-1"}}

        def test_create_file_from_binary_should_call_tool_file_manager_and_file_factory(
            self,
            monkeypatch: pytest.MonkeyPatch,
        ) -> None:
            webhook_trigger = _workflow_trigger(created_by="user-1", tenant_id="tenant-1")
            manager = MagicMock()
            manager.create_file_by_raw.return_value = SimpleNamespace(id="tool-file-1")
            monkeypatch.setattr(service_module, "ToolFileManager", MagicMock(return_value=manager))
            expected_file = MagicMock()
            monkeypatch.setattr(
                service_module.file_factory, "build_from_mapping", MagicMock(return_value=expected_file)
            )

            result = WebhookService._create_file_from_binary(b"abc", "text/plain", webhook_trigger)

            assert result is expected_file
            manager.create_file_by_raw.assert_called_once()

    class TestWebhookServiceValidationAndConversion:
        @pytest.mark.parametrize(
            ("raw_value", "param_type", "expected"),
            [
                ("42", SegmentType.NUMBER, 42),
                ("3.14", SegmentType.NUMBER, float("3.14")),
                ("yes", SegmentType.BOOLEAN, True),
                ("no", SegmentType.BOOLEAN, False),
            ],
        )
        def test_convert_form_value_should_convert_supported_types(
            self,
            raw_value: str,
            param_type: str,
            expected: Any,
        ) -> None:
            result = WebhookService._convert_form_value("param", raw_value, param_type)
            assert result == expected

        def test_convert_form_value_should_raise_for_unsupported_type(self) -> None:
            with pytest.raises(ValueError, match="Unsupported type"):
                WebhookService._convert_form_value("p", "x", SegmentType.FILE)

        def test_validate_json_value_should_return_original_for_unmapped_supported_segment_type(
            self,
            monkeypatch: pytest.MonkeyPatch,
            caplog: pytest.LogCaptureFixture,
        ) -> None:
            with caplog.at_level(logging.WARNING, logger="services.trigger.webhook_service"):
                result = WebhookService._validate_json_value("param", {"x": 1}, "unsupported-type")

                assert result == {"x": 1}
                assert any(r.levelno >= logging.WARNING for r in caplog.records)

        def test_validate_and_convert_value_should_wrap_conversion_errors(self) -> None:
            with pytest.raises(ValueError, match="validation failed"):
                WebhookService._validate_and_convert_value("param", "bad", SegmentType.NUMBER, is_form_data=True)

        def test_process_parameters_should_raise_when_required_parameter_missing(self) -> None:
            raw_params = {"optional": "x"}
            config = [WebhookParameter(name="required_param", type=SegmentType.STRING, required=True)]

            with pytest.raises(ValueError, match="Required parameter missing"):
                WebhookService._process_parameters(raw_params, config, is_form_data=True)

        def test_process_parameters_should_include_unconfigured_parameters(self) -> None:
            raw_params = {"known": "1", "unknown": "x"}
            config = [WebhookParameter(name="known", type=SegmentType.NUMBER, required=False)]

            result = WebhookService._process_parameters(raw_params, config, is_form_data=True)

            assert result == {"known": 1, "unknown": "x"}

        def test_process_body_parameters_should_raise_when_required_text_raw_is_missing(self) -> None:
            with pytest.raises(ValueError, match="Required body content missing"):
                WebhookService._process_body_parameters(
                    raw_body={"raw": ""},
                    body_configs=[WebhookBodyParameter(name="raw", required=True)],
                    content_type=ContentType.TEXT,
                )

        def test_process_body_parameters_should_skip_file_config_for_multipart_form_data(self) -> None:
            raw_body = {"message": "hello", "extra": "x"}
            body_configs = [
                WebhookBodyParameter(name="upload", type=SegmentType.FILE, required=True),
                WebhookBodyParameter(name="message", type=SegmentType.STRING, required=True),
            ]

            result = WebhookService._process_body_parameters(raw_body, body_configs, ContentType.FORM_DATA)

            assert result == {"message": "hello", "extra": "x"}

        def test_validate_required_headers_should_accept_sanitized_header_names(self) -> None:
            headers = {"x_api_key": "123"}
            configs = [WebhookParameter(name="x-api-key", required=True)]

            WebhookService._validate_required_headers(headers, configs)

        def test_validate_required_headers_should_raise_when_required_header_missing(self) -> None:
            headers = {"x-other": "123"}
            configs = [WebhookParameter(name="x-api-key", required=True)]

            with pytest.raises(ValueError, match="Required header missing"):
                WebhookService._validate_required_headers(headers, configs)

        def test_validate_http_metadata_should_return_content_type_mismatch_error(self) -> None:
            webhook_data = {"method": "POST", "headers": {"Content-Type": "application/json"}}
            node_data = WebhookData(method="post", content_type=ContentType.TEXT)

            result = WebhookService._validate_http_metadata(webhook_data, node_data)

            assert result["valid"] is False
            assert "Content-type mismatch" in result["error"]

        def test_extract_content_type_should_fallback_to_lowercase_header_key(self) -> None:
            headers = {"content-type": "application/json; charset=utf-8"}
            assert WebhookService._extract_content_type(headers) == "application/json"

        def test_build_workflow_inputs_should_include_expected_keys(self) -> None:
            webhook_data = {"headers": {"h": "v"}, "query_params": {"q": 1}, "body": {"b": 2}}

            result = WebhookService.build_workflow_inputs(webhook_data)

            assert result["webhook_data"] == webhook_data
            assert result["webhook_headers"] == {"h": "v"}
            assert result["webhook_query_params"] == {"q": 1}
            assert result["webhook_body"] == {"b": 2}

    class TestWebhookServiceUtilities:
        def test_generate_webhook_response_should_fallback_when_response_body_is_not_json(self) -> None:
            node_config = {"data": {"status_code": 200, "response_body": "{bad-json"}}

            body, status = WebhookService.generate_webhook_response(node_config)

            assert status == 200
            assert "message" in body

        def test_generate_webhook_id_should_return_24_character_identifier(self) -> None:
            webhook_id = WebhookService.generate_webhook_id()

            assert isinstance(webhook_id, str)
            assert len(webhook_id) == 24

        def test_sanitize_key_should_return_original_value_for_non_string_input(self) -> None:
            result = WebhookService._sanitize_key(123)  # type: ignore[arg-type]
            assert result == 123


class TestWebhookServiceRelationshipsCases:
    @staticmethod
    def test_draft_sync_preserves_webhook_id_when_deleted_node_is_restored(
        monkeypatch: pytest.MonkeyPatch, sqlite_engine: _webhook_service_relationships_Engine
    ) -> None:
        webhook_trigger_table = cast(Table, WorkflowWebhookTrigger.__table__)
        TypeBase.metadata.create_all(sqlite_engine, tables=[webhook_trigger_table])
        session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
        app = cast(
            App,
            SimpleNamespace(id="00000000-0000-0000-0000-000000000001", tenant_id="tenant-1", created_by="user-1"),
        )
        webhook_trigger = WorkflowWebhookTrigger(
            app_id=app.id,
            tenant_id=app.tenant_id,
            node_id="webhook-node",
            webhook_id="stable-webhook-id",
            created_by=app.created_by,
        )
        with session_maker.begin() as session:
            session.add(webhook_trigger)
        original_record_id = webhook_trigger.id

        redis = MagicMock()
        redis.get.return_value = None
        redis.lock.return_value.acquire.return_value = True
        monkeypatch.setattr(webhook_service, "db", SimpleNamespace(engine=sqlite_engine))
        monkeypatch.setattr(webhook_service, "redis_client", redis)

        deleted_draft = cast(Workflow, SimpleNamespace(walk_nodes=lambda _node_type: iter(())))
        WebhookService.sync_webhook_relationships(app, deleted_draft, remove_stale=False)

        restored_draft = cast(
            Workflow,
            SimpleNamespace(
                walk_nodes=lambda _node_type: iter([("webhook-node", {"type": TRIGGER_WEBHOOK_NODE_TYPE})])
            ),
        )
        WebhookService.sync_webhook_relationships(app, restored_draft, remove_stale=False)

        with Session(sqlite_engine) as session:
            records = session.scalars(select(WorkflowWebhookTrigger)).all()

        assert len(records) == 1
        assert records[0].id == original_record_id
        assert records[0].webhook_id == "stable-webhook-id"

    @staticmethod
    def test_published_sync_removes_stale_webhook_relationships(
        monkeypatch: pytest.MonkeyPatch, sqlite_engine: _webhook_service_relationships_Engine
    ) -> None:
        webhook_trigger_table = cast(Table, WorkflowWebhookTrigger.__table__)
        TypeBase.metadata.create_all(sqlite_engine, tables=[webhook_trigger_table])
        session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
        app = cast(
            App,
            SimpleNamespace(id="00000000-0000-0000-0000-000000000001", tenant_id="tenant-1", created_by="user-1"),
        )
        webhook_trigger = WorkflowWebhookTrigger(
            app_id=app.id,
            tenant_id=app.tenant_id,
            node_id="deleted-webhook-node",
            webhook_id="deleted-webhook-id",
            created_by=app.created_by,
        )
        with session_maker.begin() as session:
            session.add(webhook_trigger)

        redis = MagicMock()
        redis.get.return_value = None
        redis.lock.return_value.acquire.return_value = True
        monkeypatch.setattr(webhook_service, "db", SimpleNamespace(engine=sqlite_engine))
        monkeypatch.setattr(webhook_service, "redis_client", redis)

        published_workflow = cast(Workflow, SimpleNamespace(walk_nodes=lambda _node_type: iter(())))
        WebhookService.sync_webhook_relationships(app, published_workflow, remove_stale=True)

        with session_maker() as session:
            records = session.scalars(select(WorkflowWebhookTrigger)).all()
        assert records == []
        redis.delete.assert_called_once_with(
            f"{WebhookService.__WEBHOOK_NODE_CACHE_KEY__}:{app.id}:deleted-webhook-node"
        )
