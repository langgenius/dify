from typing import Any
from unittest.mock import Mock, patch

import pytest

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, InvokeFrom, UserFrom
from core.workflow.nodes.trigger_webhook.entities import (
    ContentType,
    Method,
    WebhookBodyParameter,
    WebhookData,
    WebhookParameter,
)
from core.workflow.nodes.trigger_webhook.node import (
    TriggerWebhookNode,
    WebhookFileDict,
    WebhookFilePayload,
    _webhook_file_record_id,
    parse_webhook_file,
)
from core.workflow.system_variables import default_system_variables
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.runtime import InitParams, RuntimeState, VariablePool
from graphon.variables import FileVariable, StringVariable
from tests.workflow_test_utils import build_test_variable_pool

"""
Unit tests for webhook file conversion fix.

This test verifies that webhook trigger nodes properly convert file dictionaries
to FileVariable objects, fixing the "Invalid variable type: ObjectVariable" error
when passing files to downstream LLM nodes.
"""


def _webhook_file_conversion_create_webhook_node(
    webhook_data: WebhookData,
    variable_pool: VariablePool,
    tenant_id: str = "test-tenant",
) -> TriggerWebhookNode:
    """Helper function to create a webhook node with proper initialization."""
    graph_init_params = InitParams(
        workflow_id="test-workflow",
        graph_config={},
        run_context={
            DIFY_RUN_CONTEXT_KEY: {
                "tenant_id": tenant_id,
                "app_id": "test-app",
                "user_id": "test-user",
                "user_from": UserFrom.ACCOUNT,
                "invoke_from": InvokeFrom.SERVICE_API,
            }
        },
        call_depth=0,
    )

    runtime_state = RuntimeState(
        workflow_id="test-workflow",
        variable_pool=variable_pool,
        start_at=0,
    )

    node = TriggerWebhookNode(
        node_id="webhook-node-1",
        data=webhook_data,
        init_params=graph_init_params,
        runtime_state=runtime_state,
    )

    return node


def create_test_file_dict(
    filename: str = "test.jpg",
    file_type: str = "image",
    transfer_method: str = "local_file",
) -> WebhookFileDict:
    """Create a test file dictionary as it would come from webhook service."""
    return {
        "id": "file-123",
        "tenant_id": "test-tenant",
        "type": file_type,
        "filename": filename,
        "extension": ".jpg",
        "mime_type": "image/jpeg",
        "transfer_method": transfer_method,
        "related_id": "related-123",
        "storage_key": "storage-key-123",
        "size": 1024,
        "url": "https://example.com/test.jpg",
        "created_at": 1234567890,
        "used_at": None,
        "hash": "file-hash-123",
    }


def _webhook_file_conversion_build_webhook_variable_pool(inputs: dict[str, Any]) -> VariablePool:
    return build_test_variable_pool(
        variables=default_system_variables(),
        node_id="webhook-node-1",
        inputs=inputs,
    )


def expected_factory_mapping(file_dict: WebhookFileDict) -> WebhookFileDict:
    related_id = file_dict.get("related_id")
    return {**file_dict, "upload_file_id": related_id}


def test_webhook_node_file_conversion_to_file_variable() -> None:
    """Test that webhook node converts file dictionaries to FileVariable objects."""
    # Create test file dictionary (as it comes from webhook service)
    file_dict = create_test_file_dict("uploaded_image.jpg")

    data = WebhookData(
        title="Test Webhook with File",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        body=[
            WebhookBodyParameter(name="image_upload", type="file", required=True),
            WebhookBodyParameter(name="message", type="string", required=False),
        ],
    )

    variable_pool = _webhook_file_conversion_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {"message": "Test message"},
                "files": {
                    "image_upload": file_dict,
                },
            }
        }
    )

    node = _webhook_file_conversion_create_webhook_node(data, variable_pool)

    # Mock the file reference boundary and variable factory
    with (
        patch.object(node._file_reference_factory, "build_from_mapping") as mock_file_factory,
        patch("core.workflow.nodes.trigger_webhook.node.build_segment_with_type") as mock_segment_factory,
        patch("core.workflow.nodes.trigger_webhook.node.FileVariable") as mock_file_variable,
    ):
        # Setup mocks
        mock_file_obj = Mock()
        mock_file_obj.to_dict.return_value = file_dict
        mock_file_factory.return_value = mock_file_obj

        mock_segment = Mock()
        mock_segment.value = mock_file_obj
        mock_segment_factory.return_value = mock_segment

        mock_file_var_instance = Mock()
        mock_file_variable.return_value = mock_file_var_instance

        # Run the node
        result = node._run()

        # Verify successful execution
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

        # Verify file factory was called with correct parameters
        mock_file_factory.assert_called_once_with(
            mapping=expected_factory_mapping(file_dict),
        )

        # Verify segment factory was called to create FileSegment
        mock_segment_factory.assert_called_once()

        # Verify FileVariable was created with correct parameters
        mock_file_variable.assert_called_once()
        call_args = mock_file_variable.call_args[1]
        assert call_args["name"] == "image_upload"
        # value should be whatever build_segment_with_type.value returned
        assert call_args["value"] == mock_segment.value
        assert call_args["selector"] == ["webhook-node-1", "image_upload"]

        # Verify output contains the FileVariable, not the original dict
        assert result.outputs["image_upload"] == mock_file_var_instance
        assert result.outputs["message"] == "Test message"


def test_webhook_node_file_conversion_with_missing_files() -> None:
    """Test webhook node file conversion with missing file parameter."""
    data = WebhookData(
        title="Test Webhook with Missing File",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        body=[
            WebhookBodyParameter(name="missing_file", type="file", required=False),
        ],
    )

    variable_pool = _webhook_file_conversion_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {},  # No files
            }
        }
    )

    node = _webhook_file_conversion_create_webhook_node(data, variable_pool)

    # Run the node without patches (should handle None case gracefully)
    result = node._run()

    # Verify successful execution
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

    # Verify missing file parameter is None
    assert result.outputs["_webhook_raw"]["files"] == {}


def test_webhook_node_file_conversion_with_none_file() -> None:
    """Test webhook node file conversion with None file value."""
    data = WebhookData(
        title="Test Webhook with None File",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        body=[
            WebhookBodyParameter(name="none_file", type="file", required=False),
        ],
    )

    variable_pool = _webhook_file_conversion_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {
                    "file": None,
                },
            }
        }
    )

    node = _webhook_file_conversion_create_webhook_node(data, variable_pool)

    # Run the node without patches (should handle None case gracefully)
    result = node._run()

    # Verify successful execution
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

    # Verify None file parameter is None
    assert result.outputs["_webhook_raw"]["files"]["file"] is None


def test_webhook_node_file_conversion_with_non_dict_file() -> None:
    """Test webhook node file conversion with non-dict file value."""
    data = WebhookData(
        title="Test Webhook with Non-Dict File",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        body=[
            WebhookBodyParameter(name="wrong_type", type="file", required=True),
        ],
    )

    variable_pool = _webhook_file_conversion_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {
                    "file": "not_a_dict",  # Wrapped to match node expectation
                },
            }
        }
    )

    node = _webhook_file_conversion_create_webhook_node(data, variable_pool)

    # Run the node without patches (should handle non-dict case gracefully)
    result = node._run()

    # Verify successful execution
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

    # Verify fallback to original (wrapped) mapping
    assert result.outputs["_webhook_raw"]["files"]["file"] == "not_a_dict"


def test_webhook_node_file_conversion_mixed_parameters() -> None:
    """Test webhook node with mixed parameter types including files."""
    file_dict = create_test_file_dict("mixed_test.jpg")

    data = WebhookData(
        title="Test Webhook Mixed Parameters",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        headers=[],
        params=[],
        body=[
            WebhookBodyParameter(name="text_param", type="string", required=True),
            WebhookBodyParameter(name="number_param", type="number", required=False),
            WebhookBodyParameter(name="file_param", type="file", required=True),
            WebhookBodyParameter(name="bool_param", type="boolean", required=False),
        ],
    )

    variable_pool = _webhook_file_conversion_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {
                    "text_param": "Hello World",
                    "number_param": 42,
                    "bool_param": True,
                },
                "files": {
                    "file_param": file_dict,
                },
            }
        }
    )

    node = _webhook_file_conversion_create_webhook_node(data, variable_pool)

    with (
        patch.object(node._file_reference_factory, "build_from_mapping") as mock_file_factory,
        patch("core.workflow.nodes.trigger_webhook.node.build_segment_with_type") as mock_segment_factory,
        patch("core.workflow.nodes.trigger_webhook.node.FileVariable") as mock_file_variable,
    ):
        # Setup mocks for file
        mock_file_obj = Mock()
        mock_file_factory.return_value = mock_file_obj

        mock_segment = Mock()
        mock_segment.value = mock_file_obj
        mock_segment_factory.return_value = mock_segment

        mock_file_var = Mock()
        mock_file_variable.return_value = mock_file_var

        # Run the node
        result = node._run()

        # Verify successful execution
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

        # Verify all parameters are present
        assert result.outputs["text_param"] == "Hello World"
        assert result.outputs["number_param"] == 42
        assert result.outputs["bool_param"] is True
        assert result.outputs["file_param"] == mock_file_var

        # Verify file conversion was called
        mock_file_factory.assert_called_once_with(
            mapping=expected_factory_mapping(file_dict),
        )


def test_webhook_node_different_file_types() -> None:
    """Test webhook node file conversion with different file types."""
    image_dict = create_test_file_dict("image.jpg", "image")

    data = WebhookData(
        title="Test Webhook Different File Types",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        body=[
            WebhookBodyParameter(name="image", type="file", required=True),
            WebhookBodyParameter(name="document", type="file", required=True),
            WebhookBodyParameter(name="video", type="file", required=True),
        ],
    )

    variable_pool = _webhook_file_conversion_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {
                    "image": image_dict,
                    "document": create_test_file_dict("document.pdf", "document"),
                    "video": create_test_file_dict("video.mp4", "video"),
                },
            }
        }
    )

    node = _webhook_file_conversion_create_webhook_node(data, variable_pool)

    with (
        patch.object(node._file_reference_factory, "build_from_mapping") as mock_file_factory,
        patch("core.workflow.nodes.trigger_webhook.node.build_segment_with_type") as mock_segment_factory,
        patch("core.workflow.nodes.trigger_webhook.node.FileVariable") as mock_file_variable,
    ):
        # Setup mocks for all files
        mock_file_objs = [Mock() for _ in range(3)]
        mock_segments = [Mock() for _ in range(3)]
        mock_file_vars = [Mock() for _ in range(3)]

        # Map each segment.value to its corresponding mock file obj
        for seg, f in zip(mock_segments, mock_file_objs, strict=False):
            seg.value = f

        mock_file_factory.side_effect = mock_file_objs
        mock_segment_factory.side_effect = mock_segments
        mock_file_variable.side_effect = mock_file_vars

        # Run the node
        result = node._run()

        # Verify successful execution
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

        # Verify all file types were converted
        assert mock_file_factory.call_count == 3
        assert result.outputs["image"] == mock_file_vars[0]
        assert result.outputs["document"] == mock_file_vars[1]
        assert result.outputs["video"] == mock_file_vars[2]


def test_webhook_node_file_conversion_with_non_dict_wrapper() -> None:
    """Test webhook node file conversion when the file wrapper is not a dict."""
    data = WebhookData(
        title="Test Webhook with Non-dict File Wrapper",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        body=[
            WebhookBodyParameter(name="non_dict_wrapper", type="file", required=True),
        ],
    )

    variable_pool = _webhook_file_conversion_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {
                    "file": "just a string",
                },
            }
        }
    )

    node = _webhook_file_conversion_create_webhook_node(data, variable_pool)
    result = node._run()

    # Verify successful execution (should not crash)
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    # Verify fallback to original value
    assert result.outputs["_webhook_raw"]["files"]["file"] == "just a string"


def _webhook_node_create_webhook_node(webhook_data: WebhookData, variable_pool: VariablePool) -> TriggerWebhookNode:
    """Helper function to create a webhook node with proper initialization."""
    graph_init_params = InitParams(
        workflow_id="1",
        graph_config={},
        run_context={
            DIFY_RUN_CONTEXT_KEY: {
                "tenant_id": "1",
                "app_id": "1",
                "user_id": "1",
                "user_from": UserFrom.ACCOUNT,
                "invoke_from": InvokeFrom.SERVICE_API,
            }
        },
        call_depth=0,
    )
    runtime_state = RuntimeState(
        workflow_id="test-workflow",
        variable_pool=variable_pool,
        start_at=0,
    )
    node = TriggerWebhookNode(
        node_id="1",
        data=webhook_data,
        init_params=graph_init_params,
        runtime_state=runtime_state,
    )

    return node


def _webhook_node_build_webhook_variable_pool(inputs: dict[str, Any]) -> VariablePool:
    return build_test_variable_pool(
        variables=default_system_variables(),
        node_id="1",
        inputs=inputs,
    )


def test_webhook_node_default_config() -> None:
    """Test webhook node default configuration."""
    config = TriggerWebhookNode.get_default_config()
    defaults = config["config"]

    assert config["type"] == "webhook"
    assert defaults["method"] == "get"
    assert defaults["content_type"] == "application/json"
    assert defaults["headers"] == []
    assert defaults["params"] == []
    assert defaults["body"] == []
    assert defaults["async_mode"] is True
    assert defaults["status_code"] == 200
    assert defaults["response_body"] == ""
    assert defaults["timeout"] == 30


def test_webhook_node_run_with_headers() -> None:
    """Test webhook node execution with header extraction."""
    data = WebhookData(
        title="Test Webhook",
        headers=[
            WebhookParameter(name="Authorization", required=True),
            WebhookParameter(name="Content-Type", required=False),
        ],
    )

    variable_pool = _webhook_node_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {
                    "Authorization": "Bearer token123",
                    "content-type": "application/json",  # Different case
                    "X-Custom": "custom-value",
                },
                "query_params": {},
                "body": {},
                "files": {},
            }
        }
    )

    node = _webhook_node_create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["Authorization"] == "Bearer token123"
    assert result.outputs["Content_Type"] == "application/json"  # Case-insensitive match
    assert "_webhook_raw" in result.outputs


def test_webhook_node_run_with_query_params() -> None:
    """Test webhook node execution with query parameter extraction."""
    data = WebhookData(
        title="Test Webhook",
        params=[
            WebhookParameter(name="page", required=True),
            WebhookParameter(name="limit", required=False),
            WebhookParameter(name="missing", required=False),
        ],
    )

    variable_pool = _webhook_node_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {},
                "query_params": {
                    "page": "1",
                    "limit": "10",
                },
                "body": {},
                "files": {},
            }
        }
    )

    node = _webhook_node_create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["page"] == "1"
    assert result.outputs["limit"] == "10"
    assert result.outputs["missing"] is None  # Missing parameter should be None


def test_webhook_node_run_with_body_params() -> None:
    """Test webhook node execution with body parameter extraction."""
    data = WebhookData(
        title="Test Webhook",
        body=[
            WebhookBodyParameter(name="message", type="string", required=True),
            WebhookBodyParameter(name="count", type="number", required=False),
            WebhookBodyParameter(name="active", type="boolean", required=False),
            WebhookBodyParameter(name="metadata", type="object", required=False),
        ],
    )

    variable_pool = _webhook_node_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {
                    "message": "Hello World",
                    "count": 42,
                    "active": True,
                    "metadata": {"key": "value"},
                },
                "files": {},
            }
        }
    )

    node = _webhook_node_create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["message"] == "Hello World"
    assert result.outputs["count"] == 42
    assert result.outputs["active"] is True
    assert result.outputs["metadata"] == {"key": "value"}


def test_webhook_node_run_with_file_params() -> None:
    """Test webhook node execution with file parameter extraction."""
    # Create mock file objects
    file1 = File(
        file_type=FileType.IMAGE,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="file1",
        filename="image.jpg",
        mime_type="image/jpeg",
        storage_key="",
    )

    file2 = File(
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="file2",
        filename="document.pdf",
        mime_type="application/pdf",
        storage_key="",
    )

    data = WebhookData(
        title="Test Webhook",
        body=[
            WebhookBodyParameter(name="upload", type="file", required=True),
            WebhookBodyParameter(name="document", type="file", required=False),
            WebhookBodyParameter(name="missing_file", type="file", required=False),
        ],
    )

    variable_pool = _webhook_node_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {
                    "upload": file1.to_dict(),
                    "document": file2.to_dict(),
                },
            }
        }
    )

    node = _webhook_node_create_webhook_node(data, variable_pool)
    # Mock the node's file reference boundary to avoid DB-dependent validation on upload_file_id
    with patch.object(node._file_reference_factory, "build_from_mapping") as mock_file_factory:

        def _to_file(*, mapping: dict[str, Any]) -> File:
            return File(
                file_id=mapping.get("id"),
                file_type=FileType(mapping["type"]),
                transfer_method=FileTransferMethod(mapping["transfer_method"]),
                related_id=mapping.get("related_id"),
                filename=mapping.get("filename"),
                extension=mapping.get("extension"),
                mime_type=mapping.get("mime_type"),
                size=mapping.get("size", -1),
                storage_key=mapping.get("storage_key", ""),
                remote_url=mapping.get("url"),
            )

        mock_file_factory.side_effect = _to_file
        result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert isinstance(result.outputs["upload"], FileVariable)
    assert isinstance(result.outputs["document"], FileVariable)
    assert result.outputs["upload"].value.filename == "image.jpg"


def test_webhook_node_run_mixed_parameters() -> None:
    """Test webhook node execution with mixed parameter types."""
    file_obj = File(
        file_type=FileType.IMAGE,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="file1",
        filename="test.jpg",
        mime_type="image/jpeg",
        storage_key="",
    )

    data = WebhookData(
        title="Test Webhook",
        headers=[WebhookParameter(name="Authorization", required=True)],
        params=[WebhookParameter(name="version", required=False)],
        body=[
            WebhookBodyParameter(name="message", type="string", required=True),
            WebhookBodyParameter(name="upload", type="file", required=False),
        ],
    )

    variable_pool = _webhook_node_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {"Authorization": "Bearer token"},
                "query_params": {"version": "v1"},
                "body": {"message": "Test message"},
                "files": {"upload": file_obj.to_dict()},
            }
        }
    )

    node = _webhook_node_create_webhook_node(data, variable_pool)
    # Mock the node's file reference boundary to avoid DB-dependent validation on upload_file_id
    with patch.object(node._file_reference_factory, "build_from_mapping") as mock_file_factory:

        def _to_file(*, mapping: dict[str, Any]) -> File:
            return File(
                file_id=mapping.get("id"),
                file_type=FileType(mapping["type"]),
                transfer_method=FileTransferMethod(mapping["transfer_method"]),
                related_id=mapping.get("related_id"),
                filename=mapping.get("filename"),
                extension=mapping.get("extension"),
                mime_type=mapping.get("mime_type"),
                size=mapping.get("size", -1),
                storage_key=mapping.get("storage_key", ""),
                remote_url=mapping.get("url"),
            )

        mock_file_factory.side_effect = _to_file
        result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["Authorization"] == "Bearer token"
    assert result.outputs["version"] == "v1"
    assert result.outputs["message"] == "Test message"
    assert isinstance(result.outputs["upload"], FileVariable)
    assert result.outputs["upload"].value.filename == "test.jpg"
    assert "_webhook_raw" in result.outputs


def test_webhook_node_run_empty_webhook_data() -> None:
    """Test webhook node execution with empty webhook data."""
    data = WebhookData(
        title="Test Webhook",
        headers=[WebhookParameter(name="Authorization", required=False)],
        params=[WebhookParameter(name="page", required=False)],
        body=[WebhookBodyParameter(name="message", type="string", required=False)],
    )

    variable_pool = _webhook_node_build_webhook_variable_pool({})  # No webhook_data

    node = _webhook_node_create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["Authorization"] is None
    assert result.outputs["page"] is None
    assert result.outputs["message"] is None
    assert result.outputs["_webhook_raw"] == {}


def test_webhook_node_run_case_insensitive_headers() -> None:
    """Test webhook node header extraction is case-insensitive."""
    data = WebhookData(
        title="Test Webhook",
        headers=[
            WebhookParameter(name="Content-Type", required=True),
            WebhookParameter(name="X-API-KEY", required=True),
            WebhookParameter(name="authorization", required=True),
        ],
    )

    variable_pool = _webhook_node_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {
                    "content-type": "application/json",  # lowercase
                    "x-api-key": "key123",  # lowercase
                    "Authorization": "Bearer token",  # different case
                },
                "query_params": {},
                "body": {},
                "files": {},
            }
        }
    )

    node = _webhook_node_create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["Content_Type"] == "application/json"
    assert result.outputs["X_API_KEY"] == "key123"
    assert result.outputs["authorization"] == "Bearer token"


def test_webhook_node_variable_pool_user_inputs() -> None:
    """Test that webhook node uses user_inputs from variable pool correctly."""
    data = WebhookData(title="Test Webhook")

    # Add some additional variables to the pool
    variable_pool = _webhook_node_build_webhook_variable_pool(
        {
            "webhook_data": {"headers": {}, "query_params": {}, "body": {}, "files": {}},
            "other_var": "should_be_included",
        }
    )
    variable_pool.add(["node1", "extra"], StringVariable(name="extra", value="extra_value"))

    node = _webhook_node_create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    # Check that all user_inputs are included in the inputs (they get converted to dict)
    inputs_dict = dict(result.inputs)
    assert "webhook_data" in inputs_dict
    assert "other_var" in inputs_dict
    assert inputs_dict["other_var"] == "should_be_included"


@pytest.mark.parametrize(
    "method",
    [Method.GET, Method.POST, Method.PUT, Method.DELETE, Method.PATCH, Method.HEAD],
)
def test_webhook_node_different_methods(method: Method) -> None:
    """Test webhook node with different HTTP methods."""
    data = WebhookData(
        title="Test Webhook",
        method=method,
    )

    variable_pool = _webhook_node_build_webhook_variable_pool(
        {
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {},
            }
        }
    )

    node = _webhook_node_create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert node._node_data.method == method


def test_webhook_data_content_type_field() -> None:
    """Test that content_type accepts both raw strings and enum values."""
    data1 = WebhookData(title="Test", content_type="application/json")
    assert data1.content_type == ContentType.JSON

    data2 = WebhookData(title="Test", content_type=ContentType.FORM_DATA)
    assert data2.content_type == ContentType.FORM_DATA


def test_webhook_parameter_models() -> None:
    """Test webhook parameter model validation."""
    # Test WebhookParameter
    param = WebhookParameter(name="test_param", required=True)
    assert param.name == "test_param"
    assert param.required is True

    param_default = WebhookParameter(name="test_param")
    assert param_default.required is False

    # Test WebhookBodyParameter
    body_param = WebhookBodyParameter(name="test_body", type="string", required=True)
    assert body_param.name == "test_body"
    assert body_param.type == "string"
    assert body_param.required is True

    body_param_default = WebhookBodyParameter(name="test_body")
    assert body_param_default.type == "string"  # Default type
    assert body_param_default.required is False


def test_webhook_data_field_defaults() -> None:
    """Test webhook data model field defaults."""
    data = WebhookData(title="Minimal Webhook")

    assert data.method == Method.GET
    assert data.content_type == ContentType.JSON
    assert data.headers == []
    assert data.params == []
    assert data.body == []
    assert data.status_code == 200
    assert data.response_body == ""
    assert data.webhook_id is None
    assert data.timeout == 30


def test_parse_webhook_file_rejects_non_mapping_and_empty_values() -> None:
    assert parse_webhook_file(None) is None
    assert parse_webhook_file("file-123") is None
    assert parse_webhook_file(["file-123"]) is None
    assert parse_webhook_file({}) is None
    assert parse_webhook_file({"nested": {"id": "file-123"}}) is None
    assert parse_webhook_file({1: "file-123"}) is None


def test_parse_webhook_file_keeps_only_scalar_string_keyed_fields() -> None:
    raw: WebhookFilePayload = {
        "id": "file-123",
        "size": 1024,
        "used_at": None,
        "nested": {"id": "inner"},
        7: "non-string-key",
    }
    parsed = parse_webhook_file(raw)
    assert parsed == {"id": "file-123", "size": 1024, "used_at": None}
    assert raw["nested"] == {"id": "inner"}


def test_parse_webhook_file_keeps_only_values_matching_declared_field_types() -> None:
    parsed = parse_webhook_file({"reference": 42, "related_id": "rel-1", "transfer_method": 7})
    assert parsed == {"related_id": "rel-1"}
    assert _webhook_file_record_id(parsed) == "rel-1"


def test_webhook_file_record_id_prefers_reference_then_related_id() -> None:
    assert _webhook_file_record_id({"reference": "ref-1", "related_id": "rel-1"}) == "ref-1"
    assert _webhook_file_record_id({"reference": "", "related_id": "rel-1"}) == "rel-1"
    assert _webhook_file_record_id({"related_id": ""}) is None
    assert _webhook_file_record_id({}) is None


def test_generate_file_var_without_transfer_method_returns_none() -> None:
    data = WebhookData(
        title="Test Webhook",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        body=[WebhookBodyParameter(name="upload", type="file", required=True)],
    )
    variable_pool = _webhook_file_conversion_build_webhook_variable_pool({"webhook_data": {}})
    node = _webhook_file_conversion_create_webhook_node(data, variable_pool)

    assert node.generate_file_var("upload", {"id": "file-123"}) is None
    assert node.generate_file_var("upload", {"transfer_method": ""}) is None


def test_generate_file_var_returns_none_when_file_build_fails() -> None:
    data = WebhookData(
        title="Test Webhook",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        body=[WebhookBodyParameter(name="upload", type="file", required=True)],
    )
    variable_pool = _webhook_file_conversion_build_webhook_variable_pool({"webhook_data": {}})
    node = _webhook_file_conversion_create_webhook_node(data, variable_pool)

    # The real factory rejects a remote-url entry without any url before touching storage.
    file = create_test_file_dict(transfer_method="remote_url")
    del file["url"]
    assert node.generate_file_var("upload", file) is None


def test_webhook_node_binary_upload_without_parsable_file_keeps_raw() -> None:
    data = WebhookData(
        title="Test Webhook Binary",
        method=Method.POST,
        content_type=ContentType.BINARY,
        body=[WebhookBodyParameter(name="upload", type="file", required=True)],
    )
    variable_pool = _webhook_file_conversion_build_webhook_variable_pool(
        {"webhook_data": {"headers": {}, "query_params": {}, "body": {"raw": {"nested": {"id": "x"}}}}}
    )
    node = _webhook_file_conversion_create_webhook_node(data, variable_pool)

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["upload"] == {"nested": {"id": "x"}}
