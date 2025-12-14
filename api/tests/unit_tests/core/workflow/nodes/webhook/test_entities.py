import pytest
from pydantic import ValidationError

from core.workflow.nodes.trigger_webhook.entities import (
    ContentType,
    Method,
    WebhookBodyParameter,
    WebhookData,
    WebhookParameter,
)


def test_method_enum():
    """Test Method enum values."""
    assert Method.GET == "get"
    assert Method.POST == "post"
    assert Method.HEAD == "head"
    assert Method.PATCH == "patch"
    assert Method.PUT == "put"
    assert Method.DELETE == "delete"

    # Test all enum values are strings
    for method in Method:
        assert isinstance(method.value, str)


def test_content_type_enum():
    """Test ContentType enum values."""
    assert ContentType.JSON == "application/json"
    assert ContentType.FORM_DATA == "multipart/form-data"
    assert ContentType.FORM_URLENCODED == "application/x-www-form-urlencoded"
    assert ContentType.TEXT == "text/plain"
    assert ContentType.BINARY == "application/octet-stream"

    # Test all enum values are strings
    for content_type in ContentType:
        assert isinstance(content_type.value, str)


def test_webhook_parameter_creation():
    """Test WebhookParameter model creation and validation."""
    # Test with all fields
    param = WebhookParameter(name="api_key", required=True)
    assert param.name == "api_key"
    assert param.required is True

    # Test with defaults
    param_default = WebhookParameter(name="optional_param")
    assert param_default.name == "optional_param"
    assert param_default.required is False

    # Test validation - name is required
    with pytest.raises(ValidationError):
        WebhookParameter()


def test_webhook_body_parameter_creation():
    """Test WebhookBodyParameter model creation and validation."""
    # Test with all fields
    body_param = WebhookBodyParameter(
        name="user_data",
        type="object",
        required=True,
    )
    assert body_param.name == "user_data"
    assert body_param.type == "object"
    assert body_param.required is True

    # Test with defaults
    body_param_default = WebhookBodyParameter(name="message")
    assert body_param_default.name == "message"
    assert body_param_default.type == "string"  # Default type
    assert body_param_default.required is False

    # Test validation - name is required
    with pytest.raises(ValidationError):
        WebhookBodyParameter()


def test_webhook_body_parameter_types():
    """Test WebhookBodyParameter type validation."""
    valid_types = [
        "string",
        "number",
        "boolean",
        "object",
        "array[string]",
        "array[number]",
        "array[boolean]",
        "array[object]",
        "file",
    ]

    for param_type in valid_types:
        param = WebhookBodyParameter(name="test", type=param_type)
        assert param.type == param_type

    # Test invalid type
    with pytest.raises(ValidationError):
        WebhookBodyParameter(name="test", type="invalid_type")


def test_webhook_data_creation_minimal():
    """Test WebhookData creation with minimal required fields."""
    data = WebhookData(title="Test Webhook")

    assert data.title == "Test Webhook"
    assert data.method == Method.GET  # Default
    assert data.content_type == ContentType.JSON  # Default
    assert data.headers == []  # Default
    assert data.params == []  # Default
    assert data.body == []  # Default
    assert data.status_code == 200  # Default
    assert data.response_body == ""  # Default
    assert data.webhook_id is None  # Default
    assert data.timeout == 30  # Default


def test_webhook_data_creation_full():
    """Test WebhookData creation with all fields."""
    headers = [
        WebhookParameter(name="Authorization", required=True),
        WebhookParameter(name="Content-Type", required=False),
    ]
    params = [
        WebhookParameter(name="version", required=True),
        WebhookParameter(name="format", required=False),
    ]
    body = [
        WebhookBodyParameter(name="message", type="string", required=True),
        WebhookBodyParameter(name="count", type="number", required=False),
        WebhookBodyParameter(name="upload", type="file", required=True),
    ]

    # Use the alias for content_type to test it properly
    data = WebhookData(
        title="Full Webhook Test",
        desc="A comprehensive webhook test",
        method=Method.POST,
        content_type=ContentType.FORM_DATA,
        headers=headers,
        params=params,
        body=body,
        status_code=201,
        response_body='{"success": true}',
        webhook_id="webhook_123",
        timeout=60,
    )

    assert data.title == "Full Webhook Test"
    assert data.desc == "A comprehensive webhook test"
    assert data.method == Method.POST
    assert data.content_type == ContentType.FORM_DATA
    assert len(data.headers) == 2
    assert len(data.params) == 2
    assert len(data.body) == 3
    assert data.status_code == 201
    assert data.response_body == '{"success": true}'
    assert data.webhook_id == "webhook_123"
    assert data.timeout == 60


def test_webhook_data_content_type_alias():
    """Test WebhookData content_type accepts both strings and enum values."""
    data1 = WebhookData(title="Test", content_type="application/json")
    assert data1.content_type == ContentType.JSON

    data2 = WebhookData(title="Test", content_type=ContentType.FORM_DATA)
    assert data2.content_type == ContentType.FORM_DATA


def test_webhook_data_model_dump():
    """Test WebhookData model serialization."""
    data = WebhookData(
        title="Test Webhook",
        method=Method.POST,
        content_type=ContentType.JSON,
        headers=[WebhookParameter(name="Authorization", required=True)],
        params=[WebhookParameter(name="version", required=False)],
        body=[WebhookBodyParameter(name="message", type="string", required=True)],
        status_code=200,
        response_body="OK",
        timeout=30,
    )

    dumped = data.model_dump()

    assert dumped["title"] == "Test Webhook"
    assert dumped["method"] == "post"
    assert dumped["content_type"] == "application/json"
    assert len(dumped["headers"]) == 1
    assert dumped["headers"][0]["name"] == "Authorization"
    assert dumped["headers"][0]["required"] is True
    assert len(dumped["params"]) == 1
    assert len(dumped["body"]) == 1
    assert dumped["body"][0]["type"] == "string"


def test_webhook_data_model_dump_with_alias():
    """Test WebhookData model serialization includes alias."""
    data = WebhookData(
        title="Test Webhook",
        content_type=ContentType.FORM_DATA,
    )

    dumped = data.model_dump(by_alias=True)
    assert "content_type" in dumped
    assert dumped["content_type"] == "multipart/form-data"


def test_webhook_data_validation_errors():
    """Test WebhookData validation errors."""
    # Title is required (inherited from BaseNodeData)
    with pytest.raises(ValidationError):
        WebhookData()

    # Invalid method
    with pytest.raises(ValidationError):
        WebhookData(title="Test", method="invalid_method")

    # Invalid content_type
    with pytest.raises(ValidationError):
        WebhookData(title="Test", content_type="invalid/type")

    # Invalid status_code (should be int) - use non-numeric string
    with pytest.raises(ValidationError):
        WebhookData(title="Test", status_code="invalid")

    # Invalid timeout (should be int) - use non-numeric string
    with pytest.raises(ValidationError):
        WebhookData(title="Test", timeout="invalid")

    # Valid cases that should NOT raise errors
    # These should work fine (pydantic converts string numbers to int)
    valid_data = WebhookData(title="Test", status_code="200", timeout="30")
    assert valid_data.status_code == 200
    assert valid_data.timeout == 30


def test_webhook_data_sequence_fields():
    """Test WebhookData sequence field behavior."""
    # Test empty sequences
    data = WebhookData(title="Test")
    assert data.headers == []
    assert data.params == []
    assert data.body == []

    # Test immutable sequences
    headers = [WebhookParameter(name="test")]
    data = WebhookData(title="Test", headers=headers)

    # Original list shouldn't affect the model
    headers.append(WebhookParameter(name="test2"))
    assert len(data.headers) == 1  # Should still be 1


def test_webhook_data_sync_mode():
    """Test WebhookData SyncMode nested enum."""
    # Test that SyncMode enum exists and has expected value
    assert hasattr(WebhookData, "SyncMode")
    assert WebhookData.SyncMode.SYNC == "async"  # Note: confusingly named but correct


def test_webhook_parameter_edge_cases():
    """Test WebhookParameter edge cases."""
    # Test with special characters in name
    param = WebhookParameter(name="X-Custom-Header-123", required=True)
    assert param.name == "X-Custom-Header-123"

    # Test with empty string name (should be valid if pydantic allows it)
    param_empty = WebhookParameter(name="", required=False)
    assert param_empty.name == ""


def test_webhook_body_parameter_edge_cases():
    """Test WebhookBodyParameter edge cases."""
    # Test file type parameter
    file_param = WebhookBodyParameter(name="upload", type="file", required=True)
    assert file_param.type == "file"
    assert file_param.required is True

    # Test all valid types
    for param_type in [
        "string",
        "number",
        "boolean",
        "object",
        "array[string]",
        "array[number]",
        "array[boolean]",
        "array[object]",
        "file",
    ]:
        param = WebhookBodyParameter(name=f"test_{param_type}", type=param_type)
        assert param.type == param_type


def test_webhook_data_inheritance():
    """Test WebhookData inherits from BaseNodeData correctly."""
    from core.workflow.nodes.base import BaseNodeData

    # Test that WebhookData is a subclass of BaseNodeData
    assert issubclass(WebhookData, BaseNodeData)

    # Test that instances have BaseNodeData properties
    data = WebhookData(title="Test")
    assert hasattr(data, "title")
    assert hasattr(data, "desc")  # Inherited from BaseNodeData
