"""
Unit tests for Service API RAG Pipeline Workflow controllers.

Tests coverage for:
- DatasourceNodeRunPayload Pydantic model
- PipelineRunApiEntity / DatasourceNodeRunApiEntity model validation
- RAG pipeline service interfaces
- File upload validation for pipelines
- Endpoint tests for DatasourcePluginsApi, DatasourceNodeRunApi,
  PipelineRunApi, and KnowledgebasePipelineFileUploadApi

Strategy:
- Endpoint methods on these resources have no billing decorators on the method
  itself.  ``method_decorators = [validate_dataset_token]`` is only invoked by
  Flask-RESTx dispatch, not by direct calls, so we call methods directly.
- Only ``KnowledgebasePipelineFileUploadApi.post`` touches ``db`` inline
  (via ``FileService(db.engine)``); the other endpoints delegate to services.
"""

import io
import uuid
from datetime import UTC, datetime
from unittest.mock import Mock, patch

import pytest
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.errors import FilenameNotExistsError, NoFileUploadedError, TooManyFilesError
from controllers.service_api.dataset.error import PipelineRunError
from controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow import (
    DatasourceNodeRunApi,
    DatasourceNodeRunPayload,
    DatasourcePluginsApi,
    KnowledgebasePipelineFileUploadApi,
    PipelineRunApi,
)
from core.app.entities.app_invoke_entities import InvokeFrom
from models.account import Account
from services.errors.file import FileTooLargeError, UnsupportedFileTypeError
from services.rag_pipeline.entity.pipeline_service_api_entities import (
    DatasourceNodeRunApiEntity,
    PipelineRunApiEntity,
)
from services.rag_pipeline.rag_pipeline import RagPipelineService


class TestDatasourceNodeRunPayload:
    """Test suite for DatasourceNodeRunPayload Pydantic model."""

    def test_payload_with_required_fields(self):
        """Test payload with required fields."""
        payload = DatasourceNodeRunPayload(
            inputs={"key": "value"}, datasource_type="online_document", is_published=True
        )
        assert payload.inputs == {"key": "value"}
        assert payload.datasource_type == "online_document"
        assert payload.is_published is True
        assert payload.credential_id is None

    def test_payload_with_credential_id(self):
        """Test payload with optional credential_id."""
        payload = DatasourceNodeRunPayload(
            inputs={"url": "https://example.com"},
            datasource_type="online_document",
            credential_id="cred_123",
            is_published=False,
        )
        assert payload.credential_id == "cred_123"
        assert payload.is_published is False

    def test_payload_with_complex_inputs(self):
        """Test payload with complex nested inputs."""
        complex_inputs = {
            "config": {"url": "https://api.example.com", "headers": {"Authorization": "Bearer token"}},
            "parameters": {"limit": 100, "offset": 0},
            "options": ["opt1", "opt2"],
        }
        payload = DatasourceNodeRunPayload(inputs=complex_inputs, datasource_type="api", is_published=True)
        assert payload.inputs == complex_inputs

    def test_payload_with_empty_inputs(self):
        """Test payload with empty inputs dict."""
        payload = DatasourceNodeRunPayload(inputs={}, datasource_type="local_file", is_published=True)
        assert payload.inputs == {}

    @pytest.mark.parametrize("datasource_type", ["online_document", "local_file", "api", "database", "website"])
    def test_payload_common_datasource_types(self, datasource_type):
        """Test payload with common datasource types."""
        payload = DatasourceNodeRunPayload(inputs={}, datasource_type=datasource_type, is_published=True)
        assert payload.datasource_type == datasource_type


class TestPipelineErrors:
    """Test pipeline-related error types."""

    def test_pipeline_run_error_can_be_raised(self):
        """Test PipelineRunError can be raised."""
        error = PipelineRunError(description="Pipeline execution failed")
        assert error is not None

    def test_pipeline_run_error_with_description(self):
        """Test PipelineRunError captures description."""
        error = PipelineRunError(description="Timeout during node execution")
        # The error should have the description attribute
        assert hasattr(error, "description")


class TestFileUploadErrors:
    """Test file upload error types for pipelines."""

    def test_no_file_uploaded_error(self):
        """Test NoFileUploadedError can be raised."""
        error = NoFileUploadedError()
        assert error is not None

    def test_too_many_files_error(self):
        """Test TooManyFilesError can be raised."""
        error = TooManyFilesError()
        assert error is not None

    def test_filename_not_exists_error(self):
        """Test FilenameNotExistsError can be raised."""
        error = FilenameNotExistsError()
        assert error is not None

    def test_file_too_large_error(self):
        """Test FileTooLargeError can be raised."""
        error = FileTooLargeError("File exceeds size limit")
        assert error is not None

    def test_unsupported_file_type_error(self):
        """Test UnsupportedFileTypeError can be raised."""
        error = UnsupportedFileTypeError()
        assert error is not None


class TestRagPipelineService:
    """Test RagPipelineService interface."""

    def test_get_datasource_plugins_method_exists(self):
        """Test RagPipelineService.get_datasource_plugins exists."""
        assert hasattr(RagPipelineService, "get_datasource_plugins")

    def test_get_pipeline_method_exists(self):
        """Test RagPipelineService.get_pipeline exists."""
        assert hasattr(RagPipelineService, "get_pipeline")

    def test_run_datasource_workflow_node_method_exists(self):
        """Test RagPipelineService.run_datasource_workflow_node exists."""
        assert hasattr(RagPipelineService, "run_datasource_workflow_node")

    def test_get_pipeline_templates_method_exists(self):
        """Test RagPipelineService.get_pipeline_templates exists."""
        assert hasattr(RagPipelineService, "get_pipeline_templates")

    def test_get_pipeline_template_detail_method_exists(self):
        """Test RagPipelineService.get_pipeline_template_detail exists."""
        assert hasattr(RagPipelineService, "get_pipeline_template_detail")


class TestInvokeFrom:
    """Test InvokeFrom enum for pipeline invocation."""

    def test_published_pipeline_invoke_from(self):
        """Test PUBLISHED_PIPELINE InvokeFrom value exists."""
        assert hasattr(InvokeFrom, "PUBLISHED_PIPELINE")

    def test_debugger_invoke_from(self):
        """Test DEBUGGER InvokeFrom value exists."""
        assert hasattr(InvokeFrom, "DEBUGGER")


class TestPipelineResponseModes:
    """Test pipeline response mode patterns."""

    def test_streaming_mode(self):
        """Test streaming response mode."""
        mode = "streaming"
        valid_modes = ["streaming", "blocking"]
        assert mode in valid_modes

    def test_blocking_mode(self):
        """Test blocking response mode."""
        mode = "blocking"
        valid_modes = ["streaming", "blocking"]
        assert mode in valid_modes


class TestDatasourceTypes:
    """Test common datasource types for pipelines."""

    @pytest.mark.parametrize("ds_type", ["online_document", "local_file", "website", "api", "database"])
    def test_datasource_type_valid(self, ds_type):
        """Test common datasource types are strings."""
        assert isinstance(ds_type, str)
        assert len(ds_type) > 0


class TestPipelineFileUploadResponse:
    """Test file upload response structure for pipelines."""

    def test_upload_response_fields(self):
        """Test expected fields in upload response."""
        expected_fields = ["id", "name", "size", "extension", "mime_type", "created_by", "created_at"]

        # Create mock response
        mock_response = {
            "id": str(uuid.uuid4()),
            "name": "document.pdf",
            "size": 1024,
            "extension": "pdf",
            "mime_type": "application/pdf",
            "created_by": str(uuid.uuid4()),
            "created_at": "2024-01-01T00:00:00Z",
        }

        for field in expected_fields:
            assert field in mock_response


class TestPipelineNodeExecution:
    """Test pipeline node execution patterns."""

    def test_node_id_is_string(self):
        """Test node_id is a string identifier."""
        node_id = "node_abc123"
        assert isinstance(node_id, str)
        assert len(node_id) > 0

    def test_pipeline_id_is_uuid(self):
        """Test pipeline_id is a valid UUID string."""
        pipeline_id = str(uuid.uuid4())
        assert len(pipeline_id) == 36
        assert "-" in pipeline_id


class TestCredentialHandling:
    """Test credential handling patterns."""

    def test_credential_id_is_optional(self):
        """Test credential_id can be None."""
        payload = DatasourceNodeRunPayload(
            inputs={}, datasource_type="local_file", is_published=True, credential_id=None
        )
        assert payload.credential_id is None

    def test_credential_id_can_be_provided(self):
        """Test credential_id can be set."""
        payload = DatasourceNodeRunPayload(
            inputs={}, datasource_type="api", is_published=True, credential_id="cred_oauth_123"
        )
        assert payload.credential_id == "cred_oauth_123"


class TestPublishedVsDraft:
    """Test published vs draft pipeline patterns."""

    def test_is_published_true(self):
        """Test is_published=True for published pipelines."""
        payload = DatasourceNodeRunPayload(inputs={}, datasource_type="online_document", is_published=True)
        assert payload.is_published is True

    def test_is_published_false_for_draft(self):
        """Test is_published=False for draft pipelines."""
        payload = DatasourceNodeRunPayload(inputs={}, datasource_type="online_document", is_published=False)
        assert payload.is_published is False


class TestPipelineInputVariables:
    """Test pipeline input variable patterns."""

    def test_inputs_as_dict(self):
        """Test inputs are passed as dictionary."""
        inputs = {"url": "https://example.com/doc.pdf", "timeout": 30, "retry": True}
        payload = DatasourceNodeRunPayload(inputs=inputs, datasource_type="online_document", is_published=True)
        assert payload.inputs["url"] == "https://example.com/doc.pdf"
        assert payload.inputs["timeout"] == 30
        assert payload.inputs["retry"] is True

    def test_inputs_with_list_values(self):
        """Test inputs with list values."""
        inputs = {"urls": ["https://example.com/1", "https://example.com/2"], "tags": ["tag1", "tag2", "tag3"]}
        payload = DatasourceNodeRunPayload(inputs=inputs, datasource_type="online_document", is_published=True)
        assert len(payload.inputs["urls"]) == 2
        assert len(payload.inputs["tags"]) == 3


# ---------------------------------------------------------------------------
# PipelineRunApiEntity / DatasourceNodeRunApiEntity Model Tests
# ---------------------------------------------------------------------------


class TestPipelineRunApiEntity:
    """Test PipelineRunApiEntity Pydantic model."""

    def test_entity_with_all_fields(self):
        """Test entity with all required fields."""
        entity = PipelineRunApiEntity(
            inputs={"key": "value"},
            datasource_type="online_document",
            datasource_info_list=[{"url": "https://example.com"}],
            start_node_id="node_1",
            is_published=True,
            response_mode="streaming",
        )
        assert entity.datasource_type == "online_document"
        assert entity.response_mode == "streaming"
        assert entity.is_published is True

    def test_entity_blocking_response_mode(self):
        """Test entity with blocking response mode."""
        entity = PipelineRunApiEntity(
            inputs={},
            datasource_type="local_file",
            datasource_info_list=[],
            start_node_id="node_start",
            is_published=False,
            response_mode="blocking",
        )
        assert entity.response_mode == "blocking"
        assert entity.is_published is False

    def test_entity_missing_required_field(self):
        """Test entity raises on missing required field."""
        with pytest.raises(ValueError):
            PipelineRunApiEntity(
                inputs={},
                datasource_type="online_document",
                # missing datasource_info_list, start_node_id, etc.
            )


class TestDatasourceNodeRunApiEntity:
    """Test DatasourceNodeRunApiEntity Pydantic model."""

    def test_entity_with_all_fields(self):
        """Test entity with all fields."""
        entity = DatasourceNodeRunApiEntity(
            pipeline_id=str(uuid.uuid4()),
            node_id="node_abc",
            inputs={"url": "https://example.com"},
            datasource_type="website",
            is_published=True,
        )
        assert entity.node_id == "node_abc"
        assert entity.credential_id is None

    def test_entity_with_credential(self):
        """Test entity with credential_id."""
        entity = DatasourceNodeRunApiEntity(
            pipeline_id=str(uuid.uuid4()),
            node_id="node_xyz",
            inputs={},
            datasource_type="api",
            credential_id="cred_123",
            is_published=False,
        )
        assert entity.credential_id == "cred_123"


# ---------------------------------------------------------------------------
# Endpoint Tests
# ---------------------------------------------------------------------------


class TestDatasourcePluginsApiGet:
    """Tests for DatasourcePluginsApi.get().

    The original source delegates directly to ``RagPipelineService`` without
    an inline dataset query, so no ``db`` patching is needed.
    """

    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.db")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.RagPipelineService")
    def test_get_plugins_success(self, mock_svc_cls, mock_db, app):
        """Test successful retrieval of datasource plugins."""
        tenant_id = str(uuid.uuid4())
        dataset_id = str(uuid.uuid4())

        mock_dataset = Mock()
        mock_db.session.scalar.return_value = mock_dataset

        mock_svc_instance = Mock()
        mock_svc_instance.get_datasource_plugins.return_value = [{"name": "plugin_a"}]
        mock_svc_cls.return_value = mock_svc_instance

        with app.test_request_context("/datasets/test/pipeline/datasource-plugins?is_published=true"):
            api = DatasourcePluginsApi()
            response, status = api.get(tenant_id=tenant_id, dataset_id=dataset_id)

        assert status == 200
        assert response == [{"name": "plugin_a"}]
        mock_svc_instance.get_datasource_plugins.assert_called_once_with(
            tenant_id=tenant_id, dataset_id=dataset_id, is_published=True
        )

    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.db")
    def test_get_plugins_not_found(self, mock_db, app):
        """Test NotFound when dataset check fails."""
        mock_db.session.scalar.return_value = None

        with app.test_request_context("/datasets/test/pipeline/datasource-plugins"):
            api = DatasourcePluginsApi()
            with pytest.raises(NotFound):
                api.get(tenant_id=str(uuid.uuid4()), dataset_id=str(uuid.uuid4()))

    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.db")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.RagPipelineService")
    def test_get_plugins_empty_list(self, mock_svc_cls, mock_db, app):
        """Test empty plugin list."""
        mock_db.session.scalar.return_value = Mock()
        mock_svc_instance = Mock()
        mock_svc_instance.get_datasource_plugins.return_value = []
        mock_svc_cls.return_value = mock_svc_instance

        with app.test_request_context("/datasets/test/pipeline/datasource-plugins"):
            api = DatasourcePluginsApi()
            response, status = api.get(tenant_id=str(uuid.uuid4()), dataset_id=str(uuid.uuid4()))

        assert status == 200
        assert response == []


class TestDatasourceNodeRunApiPost:
    """Tests for DatasourceNodeRunApi.post().

    The source asserts ``isinstance(current_user, Account)`` and delegates to
    ``RagPipelineService`` and ``PipelineGenerator``, so we patch those plus
    ``current_user`` and ``service_api_ns``.
    """

    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.helper")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.PipelineGenerator")
    @patch(
        "controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.current_user",
        new_callable=lambda: Mock(spec=Account),
    )
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.RagPipelineService")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.db")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.service_api_ns")
    def test_post_success(self, mock_ns, mock_db, mock_svc_cls, mock_current_user, mock_gen, mock_helper, app):
        """Test successful datasource node run."""
        tenant_id = str(uuid.uuid4())
        dataset_id = str(uuid.uuid4())
        node_id = "node_abc"

        mock_db.session.scalar.return_value = Mock()

        mock_ns.payload = {
            "inputs": {"url": "https://example.com"},
            "datasource_type": "online_document",
            "is_published": True,
        }

        mock_pipeline = Mock()
        mock_pipeline.id = str(uuid.uuid4())
        mock_svc_instance = Mock()
        mock_svc_instance.get_pipeline.return_value = mock_pipeline
        mock_svc_instance.run_datasource_workflow_node.return_value = iter(["event1"])
        mock_svc_cls.return_value = mock_svc_instance

        mock_gen.convert_to_event_stream.return_value = iter(["stream_event"])
        mock_helper.compact_generate_response.return_value = {"result": "ok"}

        with app.test_request_context("/datasets/test/pipeline/datasource/nodes/node_abc/run", method="POST"):
            api = DatasourceNodeRunApi()
            response = api.post(tenant_id=tenant_id, dataset_id=dataset_id, node_id=node_id)

        assert response == {"result": "ok"}
        mock_svc_instance.get_pipeline.assert_called_once_with(tenant_id=tenant_id, dataset_id=dataset_id)
        mock_svc_instance.get_pipeline.assert_called_once_with(tenant_id=tenant_id, dataset_id=dataset_id)
        mock_svc_instance.run_datasource_workflow_node.assert_called_once()

    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.db")
    def test_post_not_found(self, mock_db, app):
        """Test NotFound when dataset check fails."""
        mock_db.session.scalar.return_value = None

        with app.test_request_context("/datasets/test/pipeline/datasource/nodes/n1/run", method="POST"):
            api = DatasourceNodeRunApi()
            with pytest.raises(NotFound):
                api.post(tenant_id=str(uuid.uuid4()), dataset_id=str(uuid.uuid4()), node_id="n1")

    @patch(
        "controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.current_user",
        new="not_account",
    )
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.db")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.service_api_ns")
    def test_post_fails_when_current_user_not_account(self, mock_ns, mock_db, app):
        """Test AssertionError when current_user is not an Account instance."""
        mock_db.session.scalar.return_value = Mock()
        mock_ns.payload = {
            "inputs": {},
            "datasource_type": "local_file",
            "is_published": True,
        }

        with app.test_request_context("/datasets/test/pipeline/datasource/nodes/n1/run", method="POST"):
            api = DatasourceNodeRunApi()
            with pytest.raises(AssertionError):
                api.post(tenant_id=str(uuid.uuid4()), dataset_id=str(uuid.uuid4()), node_id="n1")


class TestPipelineRunApiPost:
    """Tests for PipelineRunApi.post()."""

    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.helper")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.PipelineGenerateService")
    @patch(
        "controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.current_user",
        new_callable=lambda: Mock(spec=Account),
    )
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.RagPipelineService")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.db")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.service_api_ns")
    def test_post_success_streaming(
        self, mock_ns, mock_db, mock_svc_cls, mock_current_user, mock_gen_svc, mock_helper, app
    ):
        """Test successful pipeline run with streaming response."""
        tenant_id = str(uuid.uuid4())
        dataset_id = str(uuid.uuid4())

        mock_db.session.scalar.return_value = Mock()

        mock_ns.payload = {
            "inputs": {"key": "val"},
            "datasource_type": "online_document",
            "datasource_info_list": [],
            "start_node_id": "node_1",
            "is_published": True,
            "response_mode": "streaming",
        }

        mock_pipeline = Mock()
        mock_svc_instance = Mock()
        mock_svc_instance.get_pipeline.return_value = mock_pipeline
        mock_svc_cls.return_value = mock_svc_instance

        mock_gen_svc.generate.return_value = {"result": "ok"}
        mock_helper.compact_generate_response.return_value = {"result": "ok"}

        with app.test_request_context("/datasets/test/pipeline/run", method="POST"):
            api = PipelineRunApi()
            response = api.post(tenant_id=tenant_id, dataset_id=dataset_id)

        assert response == {"result": "ok"}
        mock_gen_svc.generate.assert_called_once()

    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.db")
    def test_post_not_found(self, mock_db, app):
        """Test NotFound when dataset check fails."""
        mock_db.session.scalar.return_value = None

        with app.test_request_context("/datasets/test/pipeline/run", method="POST"):
            api = PipelineRunApi()
            with pytest.raises(NotFound):
                api.post(tenant_id=str(uuid.uuid4()), dataset_id=str(uuid.uuid4()))

    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.current_user", new="not_account")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.db")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.service_api_ns")
    def test_post_forbidden_non_account_user(self, mock_ns, mock_db, app):
        """Test Forbidden when current_user is not an Account."""
        mock_db.session.scalar.return_value = Mock()
        mock_ns.payload = {
            "inputs": {},
            "datasource_type": "online_document",
            "datasource_info_list": [],
            "start_node_id": "node_1",
            "is_published": True,
            "response_mode": "blocking",
        }

        with app.test_request_context("/datasets/test/pipeline/run", method="POST"):
            api = PipelineRunApi()
            with pytest.raises(Forbidden):
                api.post(tenant_id=str(uuid.uuid4()), dataset_id=str(uuid.uuid4()))


class TestFileUploadApiPost:
    """Tests for KnowledgebasePipelineFileUploadApi.post()."""

    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.FileService")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.current_user")
    @patch("controllers.service_api.dataset.rag_pipeline.rag_pipeline_workflow.db")
    def test_upload_success(self, mock_db, mock_current_user, mock_file_svc_cls, app):
        """Test successful file upload."""
        mock_current_user.__bool__ = Mock(return_value=True)

        mock_upload = Mock()
        mock_upload.id = str(uuid.uuid4())
        mock_upload.name = "doc.pdf"
        mock_upload.size = 1024
        mock_upload.extension = "pdf"
        mock_upload.mime_type = "application/pdf"
        mock_upload.created_by = str(uuid.uuid4())
        mock_upload.created_at = datetime(2024, 1, 1, tzinfo=UTC)

        mock_file_svc_instance = Mock()
        mock_file_svc_instance.upload_file.return_value = mock_upload
        mock_file_svc_cls.return_value = mock_file_svc_instance

        file_data = FileStorage(
            stream=io.BytesIO(b"fake pdf content"),
            filename="doc.pdf",
            content_type="application/pdf",
        )

        with app.test_request_context(
            "/datasets/pipeline/file-upload",
            method="POST",
            content_type="multipart/form-data",
            data={"file": file_data},
        ):
            api = KnowledgebasePipelineFileUploadApi()
            response, status = api.post(tenant_id=str(uuid.uuid4()))

        assert status == 201
        assert response["name"] == "doc.pdf"
        assert response["extension"] == "pdf"

    def test_upload_no_file(self, app):
        """Test error when no file is uploaded."""
        with app.test_request_context(
            "/datasets/pipeline/file-upload",
            method="POST",
            content_type="multipart/form-data",
        ):
            api = KnowledgebasePipelineFileUploadApi()
            with pytest.raises(NoFileUploadedError):
                api.post(tenant_id=str(uuid.uuid4()))
