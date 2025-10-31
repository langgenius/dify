"""Unit tests for MCP types module."""

import pytest
from pydantic import ValidationError

from core.mcp.types import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    INVALID_REQUEST,
    LATEST_PROTOCOL_VERSION,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    SERVER_LATEST_PROTOCOL_VERSION,
    Annotations,
    CallToolRequest,
    CallToolRequestParams,
    CallToolResult,
    ClientCapabilities,
    CompleteRequest,
    CompleteRequestParams,
    CompleteResult,
    Completion,
    CompletionArgument,
    CompletionContext,
    ErrorData,
    ImageContent,
    Implementation,
    InitializeRequest,
    InitializeRequestParams,
    InitializeResult,
    JSONRPCError,
    JSONRPCMessage,
    JSONRPCNotification,
    JSONRPCRequest,
    JSONRPCResponse,
    ListToolsRequest,
    ListToolsResult,
    OAuthClientInformation,
    OAuthClientMetadata,
    OAuthMetadata,
    OAuthTokens,
    PingRequest,
    ProgressNotification,
    ProgressNotificationParams,
    PromptReference,
    RequestParams,
    ResourceTemplateReference,
    Result,
    ServerCapabilities,
    TextContent,
    Tool,
    ToolAnnotations,
)


class TestConstants:
    """Test module constants."""

    def test_protocol_versions(self):
        """Test protocol version constants."""
        assert LATEST_PROTOCOL_VERSION == "2025-03-26"
        assert SERVER_LATEST_PROTOCOL_VERSION == "2024-11-05"

    def test_error_codes(self):
        """Test JSON-RPC error code constants."""
        assert PARSE_ERROR == -32700
        assert INVALID_REQUEST == -32600
        assert METHOD_NOT_FOUND == -32601
        assert INVALID_PARAMS == -32602
        assert INTERNAL_ERROR == -32603


class TestRequestParams:
    """Test RequestParams and related classes."""

    def test_request_params_basic(self):
        """Test basic RequestParams creation."""
        params = RequestParams()
        assert params.meta is None

    def test_request_params_with_meta(self):
        """Test RequestParams with meta."""
        meta = RequestParams.Meta(progressToken="test-token")
        params = RequestParams(_meta=meta)
        assert params.meta is not None
        assert params.meta.progressToken == "test-token"

    def test_request_params_meta_extra_fields(self):
        """Test RequestParams.Meta allows extra fields."""
        meta = RequestParams.Meta(progressToken="token", customField="value")
        assert meta.progressToken == "token"
        assert meta.customField == "value"  # type: ignore

    def test_request_params_serialization(self):
        """Test RequestParams serialization with _meta alias."""
        meta = RequestParams.Meta(progressToken="test")
        params = RequestParams(_meta=meta)

        # Model dump should use the alias
        dumped = params.model_dump(by_alias=True)
        assert "_meta" in dumped
        assert dumped["_meta"] is not None
        assert dumped["_meta"]["progressToken"] == "test"


class TestJSONRPCMessages:
    """Test JSON-RPC message types."""

    def test_jsonrpc_request(self):
        """Test JSONRPCRequest creation and validation."""
        request = JSONRPCRequest(jsonrpc="2.0", id="test-123", method="test_method", params={"key": "value"})

        assert request.jsonrpc == "2.0"
        assert request.id == "test-123"
        assert request.method == "test_method"
        assert request.params == {"key": "value"}

    def test_jsonrpc_request_numeric_id(self):
        """Test JSONRPCRequest with numeric ID."""
        request = JSONRPCRequest(jsonrpc="2.0", id=123, method="test", params=None)
        assert request.id == 123

    def test_jsonrpc_notification(self):
        """Test JSONRPCNotification creation."""
        notification = JSONRPCNotification(jsonrpc="2.0", method="notification_method", params={"data": "test"})

        assert notification.jsonrpc == "2.0"
        assert notification.method == "notification_method"
        assert not hasattr(notification, "id")  # Notifications don't have ID

    def test_jsonrpc_response(self):
        """Test JSONRPCResponse creation."""
        response = JSONRPCResponse(jsonrpc="2.0", id="req-123", result={"success": True})

        assert response.jsonrpc == "2.0"
        assert response.id == "req-123"
        assert response.result == {"success": True}

    def test_jsonrpc_error(self):
        """Test JSONRPCError creation."""
        error_data = ErrorData(code=INVALID_PARAMS, message="Invalid parameters", data={"field": "missing"})

        error = JSONRPCError(jsonrpc="2.0", id="req-123", error=error_data)

        assert error.jsonrpc == "2.0"
        assert error.id == "req-123"
        assert error.error.code == INVALID_PARAMS
        assert error.error.message == "Invalid parameters"
        assert error.error.data == {"field": "missing"}

    def test_jsonrpc_message_parsing(self):
        """Test JSONRPCMessage parsing different message types."""
        # Parse request
        request_json = '{"jsonrpc": "2.0", "id": 1, "method": "test", "params": null}'
        msg = JSONRPCMessage.model_validate_json(request_json)
        assert isinstance(msg.root, JSONRPCRequest)

        # Parse response
        response_json = '{"jsonrpc": "2.0", "id": 1, "result": {"data": "test"}}'
        msg = JSONRPCMessage.model_validate_json(response_json)
        assert isinstance(msg.root, JSONRPCResponse)

        # Parse error
        error_json = '{"jsonrpc": "2.0", "id": 1, "error": {"code": -32600, "message": "Invalid Request"}}'
        msg = JSONRPCMessage.model_validate_json(error_json)
        assert isinstance(msg.root, JSONRPCError)


class TestCapabilities:
    """Test capability classes."""

    def test_client_capabilities(self):
        """Test ClientCapabilities creation."""
        caps = ClientCapabilities(
            experimental={"feature": {"enabled": True}},
            sampling={"model_config": {"extra": "allow"}},
            roots={"listChanged": True},
        )

        assert caps.experimental == {"feature": {"enabled": True}}
        assert caps.sampling is not None
        assert caps.roots.listChanged is True  # type: ignore

    def test_server_capabilities(self):
        """Test ServerCapabilities creation."""
        caps = ServerCapabilities(
            tools={"listChanged": True},
            resources={"subscribe": True, "listChanged": False},
            prompts={"listChanged": True},
            logging={},
            completions={},
        )

        assert caps.tools.listChanged is True  # type: ignore
        assert caps.resources.subscribe is True  # type: ignore
        assert caps.resources.listChanged is False  # type: ignore


class TestInitialization:
    """Test initialization request/response types."""

    def test_initialize_request(self):
        """Test InitializeRequest creation."""
        client_info = Implementation(name="test-client", version="1.0.0")
        capabilities = ClientCapabilities()

        params = InitializeRequestParams(
            protocolVersion=LATEST_PROTOCOL_VERSION, capabilities=capabilities, clientInfo=client_info
        )

        request = InitializeRequest(params=params)

        assert request.method == "initialize"
        assert request.params.protocolVersion == LATEST_PROTOCOL_VERSION
        assert request.params.clientInfo.name == "test-client"

    def test_initialize_result(self):
        """Test InitializeResult creation."""
        server_info = Implementation(name="test-server", version="1.0.0")
        capabilities = ServerCapabilities()

        result = InitializeResult(
            protocolVersion=LATEST_PROTOCOL_VERSION,
            capabilities=capabilities,
            serverInfo=server_info,
            instructions="Welcome to test server",
        )

        assert result.protocolVersion == LATEST_PROTOCOL_VERSION
        assert result.serverInfo.name == "test-server"
        assert result.instructions == "Welcome to test server"


class TestTools:
    """Test tool-related types."""

    def test_tool_creation(self):
        """Test Tool creation with all fields."""
        tool = Tool(
            name="test_tool",
            title="Test Tool",
            description="A tool for testing",
            inputSchema={"type": "object", "properties": {"input": {"type": "string"}}, "required": ["input"]},
            outputSchema={"type": "object", "properties": {"result": {"type": "string"}}},
            annotations=ToolAnnotations(
                title="Test Tool", readOnlyHint=False, destructiveHint=False, idempotentHint=True
            ),
        )

        assert tool.name == "test_tool"
        assert tool.title == "Test Tool"
        assert tool.description == "A tool for testing"
        assert tool.inputSchema["properties"]["input"]["type"] == "string"
        assert tool.annotations.idempotentHint is True

    def test_call_tool_request(self):
        """Test CallToolRequest creation."""
        params = CallToolRequestParams(name="test_tool", arguments={"input": "test value"})

        request = CallToolRequest(params=params)

        assert request.method == "tools/call"
        assert request.params.name == "test_tool"
        assert request.params.arguments == {"input": "test value"}

    def test_call_tool_result(self):
        """Test CallToolResult creation."""
        result = CallToolResult(
            content=[TextContent(type="text", text="Tool executed successfully")],
            structuredContent={"status": "success", "data": "test"},
            isError=False,
        )

        assert len(result.content) == 1
        assert result.content[0].text == "Tool executed successfully"  # type: ignore
        assert result.structuredContent == {"status": "success", "data": "test"}
        assert result.isError is False

    def test_list_tools_request(self):
        """Test ListToolsRequest creation."""
        request = ListToolsRequest()
        assert request.method == "tools/list"

    def test_list_tools_result(self):
        """Test ListToolsResult creation."""
        tool1 = Tool(name="tool1", inputSchema={})
        tool2 = Tool(name="tool2", inputSchema={})

        result = ListToolsResult(tools=[tool1, tool2])

        assert len(result.tools) == 2
        assert result.tools[0].name == "tool1"
        assert result.tools[1].name == "tool2"


class TestContent:
    """Test content types."""

    def test_text_content(self):
        """Test TextContent creation."""
        annotations = Annotations(audience=["user"], priority=0.8)
        content = TextContent(type="text", text="Hello, world!", annotations=annotations)

        assert content.type == "text"
        assert content.text == "Hello, world!"
        assert content.annotations is not None
        assert content.annotations.priority == 0.8

    def test_image_content(self):
        """Test ImageContent creation."""
        content = ImageContent(type="image", data="base64encodeddata", mimeType="image/png")

        assert content.type == "image"
        assert content.data == "base64encodeddata"
        assert content.mimeType == "image/png"


class TestOAuth:
    """Test OAuth-related types."""

    def test_oauth_client_metadata(self):
        """Test OAuthClientMetadata creation."""
        metadata = OAuthClientMetadata(
            client_name="Test Client",
            redirect_uris=["https://example.com/callback"],
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            token_endpoint_auth_method="none",
            client_uri="https://example.com",
            scope="read write",
        )

        assert metadata.client_name == "Test Client"
        assert len(metadata.redirect_uris) == 1
        assert "authorization_code" in metadata.grant_types

    def test_oauth_client_information(self):
        """Test OAuthClientInformation creation."""
        info = OAuthClientInformation(client_id="test-client-id", client_secret="test-secret")

        assert info.client_id == "test-client-id"
        assert info.client_secret == "test-secret"

    def test_oauth_client_information_without_secret(self):
        """Test OAuthClientInformation without secret."""
        info = OAuthClientInformation(client_id="public-client")

        assert info.client_id == "public-client"
        assert info.client_secret is None

    def test_oauth_tokens(self):
        """Test OAuthTokens creation."""
        tokens = OAuthTokens(
            access_token="access-token-123",
            token_type="Bearer",
            expires_in=3600,
            refresh_token="refresh-token-456",
            scope="read write",
        )

        assert tokens.access_token == "access-token-123"
        assert tokens.token_type == "Bearer"
        assert tokens.expires_in == 3600
        assert tokens.refresh_token == "refresh-token-456"
        assert tokens.scope == "read write"

    def test_oauth_metadata(self):
        """Test OAuthMetadata creation."""
        metadata = OAuthMetadata(
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            registration_endpoint="https://auth.example.com/register",
            response_types_supported=["code", "token"],
            grant_types_supported=["authorization_code", "refresh_token"],
            code_challenge_methods_supported=["plain", "S256"],
        )

        assert metadata.authorization_endpoint == "https://auth.example.com/authorize"
        assert "code" in metadata.response_types_supported
        assert "S256" in metadata.code_challenge_methods_supported


class TestNotifications:
    """Test notification types."""

    def test_progress_notification(self):
        """Test ProgressNotification creation."""
        params = ProgressNotificationParams(
            progressToken="progress-123", progress=50.0, total=100.0, message="Processing... 50%"
        )

        notification = ProgressNotification(params=params)

        assert notification.method == "notifications/progress"
        assert notification.params.progressToken == "progress-123"
        assert notification.params.progress == 50.0
        assert notification.params.total == 100.0
        assert notification.params.message == "Processing... 50%"

    def test_ping_request(self):
        """Test PingRequest creation."""
        request = PingRequest()
        assert request.method == "ping"
        assert request.params is None


class TestCompletion:
    """Test completion-related types."""

    def test_completion_context(self):
        """Test CompletionContext creation."""
        context = CompletionContext(arguments={"template_var": "value"})
        assert context.arguments == {"template_var": "value"}

    def test_resource_template_reference(self):
        """Test ResourceTemplateReference creation."""
        ref = ResourceTemplateReference(type="ref/resource", uri="file:///path/to/{filename}")
        assert ref.type == "ref/resource"
        assert ref.uri == "file:///path/to/{filename}"

    def test_prompt_reference(self):
        """Test PromptReference creation."""
        ref = PromptReference(type="ref/prompt", name="test_prompt")
        assert ref.type == "ref/prompt"
        assert ref.name == "test_prompt"

    def test_complete_request(self):
        """Test CompleteRequest creation."""
        ref = PromptReference(type="ref/prompt", name="test_prompt")
        arg = CompletionArgument(name="arg1", value="val")

        params = CompleteRequestParams(ref=ref, argument=arg, context=CompletionContext(arguments={"key": "value"}))

        request = CompleteRequest(params=params)

        assert request.method == "completion/complete"
        assert request.params.ref.name == "test_prompt"  # type: ignore
        assert request.params.argument.name == "arg1"

    def test_complete_result(self):
        """Test CompleteResult creation."""
        completion = Completion(values=["option1", "option2", "option3"], total=10, hasMore=True)

        result = CompleteResult(completion=completion)

        assert len(result.completion.values) == 3
        assert result.completion.total == 10
        assert result.completion.hasMore is True


class TestValidation:
    """Test validation of various types."""

    def test_invalid_jsonrpc_version(self):
        """Test invalid JSON-RPC version validation."""
        with pytest.raises(ValidationError):
            JSONRPCRequest(
                jsonrpc="1.0",  # Invalid version
                id=1,
                method="test",
            )

    def test_tool_annotations_validation(self):
        """Test ToolAnnotations with invalid values."""
        # Valid annotations
        annotations = ToolAnnotations(
            title="Test", readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False
        )
        assert annotations.title == "Test"

    def test_extra_fields_allowed(self):
        """Test that extra fields are allowed in models."""
        # Most models should allow extra fields
        tool = Tool(
            name="test",
            inputSchema={},
            customField="allowed",  # type: ignore
        )
        assert tool.customField == "allowed"  # type: ignore

    def test_result_meta_alias(self):
        """Test Result model with _meta alias."""
        # Create with the field name (not alias)
        result = Result(_meta={"key": "value"})

        # Verify the field is set correctly
        assert result.meta == {"key": "value"}

        # Dump with alias
        dumped = result.model_dump(by_alias=True)
        assert "_meta" in dumped
        assert dumped["_meta"] == {"key": "value"}
