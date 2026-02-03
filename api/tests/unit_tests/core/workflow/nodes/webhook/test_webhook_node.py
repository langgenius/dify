from unittest.mock import patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.file import File, FileTransferMethod, FileType
from core.variables import FileVariable, StringVariable
from core.workflow.entities.graph_init_params import GraphInitParams
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.trigger_webhook.entities import (
    ContentType,
    Method,
    WebhookBodyParameter,
    WebhookData,
    WebhookParameter,
)
from core.workflow.nodes.trigger_webhook.node import TriggerWebhookNode
from core.workflow.runtime.graph_runtime_state import GraphRuntimeState
from core.workflow.runtime.variable_pool import VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom
from models.workflow import WorkflowType


def create_webhook_node(webhook_data: WebhookData, variable_pool: VariablePool) -> TriggerWebhookNode:
    """Helper function to create a webhook node with proper initialization."""
    node_config = {
        "id": "1",
        "data": webhook_data.model_dump(),
    }

    graph_init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_id="1",
        graph_config={},
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.SERVICE_API,
        call_depth=0,
    )
    runtime_state = GraphRuntimeState(
        variable_pool=variable_pool,
        start_at=0,
    )
    node = TriggerWebhookNode(
        id="1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )

    # Provide tenant_id for conversion path
    runtime_state.app_config = type("_AppCfg", (), {"tenant_id": "1"})()

    # Compatibility alias for some nodes referencing `self.node_id`
    node.node_id = node.id

    return node


def test_webhook_node_basic_initialization():
    """Test basic webhook node initialization and configuration."""
    data = WebhookData(
        title="Test Webhook",
        method=Method.POST,
        content_type=ContentType.JSON,
        headers=[WebhookParameter(name="X-API-Key", required=True)],
        params=[WebhookParameter(name="version", required=False)],
        body=[WebhookBodyParameter(name="message", type="string", required=True)],
        status_code=200,
        response_body="OK",
        timeout=30,
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={},
    )

    node = create_webhook_node(data, variable_pool)

    assert node.node_type.value == "trigger-webhook"
    assert node.version() == "1"
    assert node._get_title() == "Test Webhook"
    assert node._node_data.method == Method.POST
    assert node._node_data.content_type == ContentType.JSON
    assert len(node._node_data.headers) == 1
    assert len(node._node_data.params) == 1
    assert len(node._node_data.body) == 1


def test_webhook_node_default_config():
    """Test webhook node default configuration."""
    config = TriggerWebhookNode.get_default_config()

    assert config["type"] == "webhook"
    assert config["config"]["method"] == "get"
    assert config["config"]["content_type"] == "application/json"
    assert config["config"]["headers"] == []
    assert config["config"]["params"] == []
    assert config["config"]["body"] == []
    assert config["config"]["async_mode"] is True
    assert config["config"]["status_code"] == 200
    assert config["config"]["response_body"] == ""
    assert config["config"]["timeout"] == 30


def test_webhook_node_run_with_headers():
    """Test webhook node execution with header extraction."""
    data = WebhookData(
        title="Test Webhook",
        headers=[
            WebhookParameter(name="Authorization", required=True),
            WebhookParameter(name="Content-Type", required=False),
        ],
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
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
        },
    )

    node = create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["Authorization"] == "Bearer token123"
    assert result.outputs["Content_Type"] == "application/json"  # Case-insensitive match
    assert "_webhook_raw" in result.outputs


def test_webhook_node_run_with_query_params():
    """Test webhook node execution with query parameter extraction."""
    data = WebhookData(
        title="Test Webhook",
        params=[
            WebhookParameter(name="page", required=True),
            WebhookParameter(name="limit", required=False),
            WebhookParameter(name="missing", required=False),
        ],
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
            "webhook_data": {
                "headers": {},
                "query_params": {
                    "page": "1",
                    "limit": "10",
                },
                "body": {},
                "files": {},
            }
        },
    )

    node = create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["page"] == "1"
    assert result.outputs["limit"] == "10"
    assert result.outputs["missing"] is None  # Missing parameter should be None


def test_webhook_node_run_with_body_params():
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

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
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
        },
    )

    node = create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["message"] == "Hello World"
    assert result.outputs["count"] == 42
    assert result.outputs["active"] is True
    assert result.outputs["metadata"] == {"key": "value"}


def test_webhook_node_run_with_file_params():
    """Test webhook node execution with file parameter extraction."""
    # Create mock file objects
    file1 = File(
        tenant_id="1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="file1",
        filename="image.jpg",
        mime_type="image/jpeg",
        storage_key="",
    )

    file2 = File(
        tenant_id="1",
        type=FileType.DOCUMENT,
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

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {
                    "upload": file1.to_dict(),
                    "document": file2.to_dict(),
                },
            }
        },
    )

    node = create_webhook_node(data, variable_pool)
    # Mock the file factory to avoid DB-dependent validation on upload_file_id
    with patch("factories.file_factory.build_from_mapping") as mock_file_factory:

        def _to_file(mapping, tenant_id, config=None, strict_type_validation=False):
            return File.model_validate(mapping)

        mock_file_factory.side_effect = _to_file
        result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert isinstance(result.outputs["upload"], FileVariable)
    assert isinstance(result.outputs["document"], FileVariable)
    assert result.outputs["upload"].value.filename == "image.jpg"


def test_webhook_node_run_mixed_parameters():
    """Test webhook node execution with mixed parameter types."""
    file_obj = File(
        tenant_id="1",
        type=FileType.IMAGE,
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

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
            "webhook_data": {
                "headers": {"Authorization": "Bearer token"},
                "query_params": {"version": "v1"},
                "body": {"message": "Test message"},
                "files": {"upload": file_obj.to_dict()},
            }
        },
    )

    node = create_webhook_node(data, variable_pool)
    # Mock the file factory to avoid DB-dependent validation on upload_file_id
    with patch("factories.file_factory.build_from_mapping") as mock_file_factory:

        def _to_file(mapping, tenant_id, config=None, strict_type_validation=False):
            return File.model_validate(mapping)

        mock_file_factory.side_effect = _to_file
        result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["Authorization"] == "Bearer token"
    assert result.outputs["version"] == "v1"
    assert result.outputs["message"] == "Test message"
    assert isinstance(result.outputs["upload"], FileVariable)
    assert result.outputs["upload"].value.filename == "test.jpg"
    assert "_webhook_raw" in result.outputs


def test_webhook_node_run_empty_webhook_data():
    """Test webhook node execution with empty webhook data."""
    data = WebhookData(
        title="Test Webhook",
        headers=[WebhookParameter(name="Authorization", required=False)],
        params=[WebhookParameter(name="page", required=False)],
        body=[WebhookBodyParameter(name="message", type="string", required=False)],
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={},  # No webhook_data
    )

    node = create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["Authorization"] is None
    assert result.outputs["page"] is None
    assert result.outputs["message"] is None
    assert result.outputs["_webhook_raw"] == {}


def test_webhook_node_run_case_insensitive_headers():
    """Test webhook node header extraction is case-insensitive."""
    data = WebhookData(
        title="Test Webhook",
        headers=[
            WebhookParameter(name="Content-Type", required=True),
            WebhookParameter(name="X-API-KEY", required=True),
            WebhookParameter(name="authorization", required=True),
        ],
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
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
        },
    )

    node = create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["Content_Type"] == "application/json"
    assert result.outputs["X_API_KEY"] == "key123"
    assert result.outputs["authorization"] == "Bearer token"


def test_webhook_node_variable_pool_user_inputs():
    """Test that webhook node uses user_inputs from variable pool correctly."""
    data = WebhookData(title="Test Webhook")

    # Add some additional variables to the pool
    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
            "webhook_data": {"headers": {}, "query_params": {}, "body": {}, "files": {}},
            "other_var": "should_be_included",
        },
    )
    variable_pool.add(["node1", "extra"], StringVariable(name="extra", value="extra_value"))

    node = create_webhook_node(data, variable_pool)
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
def test_webhook_node_different_methods(method):
    """Test webhook node with different HTTP methods."""
    data = WebhookData(
        title="Test Webhook",
        method=method,
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={
            "webhook_data": {
                "headers": {},
                "query_params": {},
                "body": {},
                "files": {},
            }
        },
    )

    node = create_webhook_node(data, variable_pool)
    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert node._node_data.method == method


def test_webhook_data_content_type_field():
    """Test that content_type accepts both raw strings and enum values."""
    data1 = WebhookData(title="Test", content_type="application/json")
    assert data1.content_type == ContentType.JSON

    data2 = WebhookData(title="Test", content_type=ContentType.FORM_DATA)
    assert data2.content_type == ContentType.FORM_DATA


def test_webhook_parameter_models():
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


def test_webhook_data_field_defaults():
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
