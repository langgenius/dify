"""
Unit tests for webhook file conversion fix.

This test verifies that webhook trigger nodes properly convert file dictionaries
to FileVariable objects, fixing the "Invalid variable type: ObjectVariable" error
when passing files to downstream LLM nodes.
"""

from unittest.mock import Mock, patch

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.graph_init_params import GraphInitParams
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.trigger_webhook.entities import (
    ContentType,
    Method,
    WebhookBodyParameter,
    WebhookData,
)
from core.workflow.nodes.trigger_webhook.node import TriggerWebhookNode
from core.workflow.runtime.graph_runtime_state import GraphRuntimeState
from core.workflow.runtime.variable_pool import VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom
from models.workflow import WorkflowType


def create_webhook_node(
    webhook_data: WebhookData,
    variable_pool: VariablePool,
    tenant_id: str = "test-tenant",
) -> TriggerWebhookNode:
    """Helper function to create a webhook node with proper initialization."""
    node_config = {
        "id": "webhook-node-1",
        "data": webhook_data.model_dump(),
    }

    graph_init_params = GraphInitParams(
        tenant_id=tenant_id,
        app_id="test-app",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_id="test-workflow",
        graph_config={},
        user_id="test-user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.SERVICE_API,
        call_depth=0,
    )

    runtime_state = GraphRuntimeState(
        variable_pool=variable_pool,
        start_at=0,
    )

    node = TriggerWebhookNode(
        id="webhook-node-1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )

    # Attach a lightweight app_config onto runtime state for tenant lookups
    runtime_state.app_config = Mock()
    runtime_state.app_config.tenant_id = tenant_id

    # Provide compatibility alias expected by node implementation
    # Some nodes reference `self.node_id`; expose it as an alias to `self.id` for tests
    node.node_id = node.id

    return node


def create_test_file_dict(
    filename: str = "test.jpg",
    file_type: str = "image",
    transfer_method: str = "local_file",
) -> dict:
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


def test_webhook_node_file_conversion_to_file_variable():
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

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {"message": "Test message"},
                "files": {
                    "image_upload": file_dict,
                },
            }
        },
    )

    node = create_webhook_node(data, variable_pool)

    # Mock the file factory and variable factory
    with (
        patch("factories.file_factory.build_from_mapping") as mock_file_factory,
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
            mapping=file_dict,
            tenant_id="test-tenant",
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


def test_webhook_node_file_conversion_with_missing_files():
    """Test webhook node file conversion with missing file parameter."""
    data = WebhookData(
        title="Test Webhook with Missing File",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        body=[
            WebhookBodyParameter(name="missing_file", type="file", required=False),
        ],
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {},  # No files
            }
        },
    )

    node = create_webhook_node(data, variable_pool)

    # Run the node without patches (should handle None case gracefully)
    result = node._run()

    # Verify successful execution
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

    # Verify missing file parameter is None
    assert result.outputs["_webhook_raw"]["files"] == {}


def test_webhook_node_file_conversion_with_none_file():
    """Test webhook node file conversion with None file value."""
    data = WebhookData(
        title="Test Webhook with None File",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        body=[
            WebhookBodyParameter(name="none_file", type="file", required=False),
        ],
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {
                    "file": None,
                },
            }
        },
    )

    node = create_webhook_node(data, variable_pool)

    # Run the node without patches (should handle None case gracefully)
    result = node._run()

    # Verify successful execution
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

    # Verify None file parameter is None
    assert result.outputs["_webhook_raw"]["files"]["file"] is None


def test_webhook_node_file_conversion_with_non_dict_file():
    """Test webhook node file conversion with non-dict file value."""
    data = WebhookData(
        title="Test Webhook with Non-Dict File",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        body=[
            WebhookBodyParameter(name="wrong_type", type="file", required=True),
        ],
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {
                    "file": "not_a_dict",  # Wrapped to match node expectation
                },
            }
        },
    )

    node = create_webhook_node(data, variable_pool)

    # Run the node without patches (should handle non-dict case gracefully)
    result = node._run()

    # Verify successful execution
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

    # Verify fallback to original (wrapped) mapping
    assert result.outputs["_webhook_raw"]["files"]["file"] == "not_a_dict"


def test_webhook_node_file_conversion_mixed_parameters():
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

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
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
        },
    )

    node = create_webhook_node(data, variable_pool)

    with (
        patch("factories.file_factory.build_from_mapping") as mock_file_factory,
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
            mapping=file_dict,
            tenant_id="test-tenant",
        )


def test_webhook_node_different_file_types():
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

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
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
        },
    )

    node = create_webhook_node(data, variable_pool)

    with (
        patch("factories.file_factory.build_from_mapping") as mock_file_factory,
        patch("core.workflow.nodes.trigger_webhook.node.build_segment_with_type") as mock_segment_factory,
        patch("core.workflow.nodes.trigger_webhook.node.FileVariable") as mock_file_variable,
    ):
        # Setup mocks for all files
        mock_file_objs = [Mock() for _ in range(3)]
        mock_segments = [Mock() for _ in range(3)]
        mock_file_vars = [Mock() for _ in range(3)]

        # Map each segment.value to its corresponding mock file obj
        for seg, f in zip(mock_segments, mock_file_objs):
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


def test_webhook_node_file_conversion_with_non_dict_wrapper():
    """Test webhook node file conversion when the file wrapper is not a dict."""
    data = WebhookData(
        title="Test Webhook with Non-dict File Wrapper",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        body=[
            WebhookBodyParameter(name="non_dict_wrapper", type="file", required=True),
        ],
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {
                    "file": "just a string",
                },
            }
        },
    )

    node = create_webhook_node(data, variable_pool)
    result = node._run()

    # Verify successful execution (should not crash)
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    # Verify fallback to original value
    assert result.outputs["_webhook_raw"]["files"]["file"] == "just a string"
