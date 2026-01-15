import json
from unittest.mock import Mock, patch

import jsonschema
import pytest

from core.app.app_config.entities import VariableEntity, VariableEntityType
from core.app.features.rate_limiting.rate_limit import RateLimitGenerator
from core.mcp import types
from core.mcp.server.streamable_http import (
    build_parameter_schema,
    convert_input_form_to_parameters,
    extract_answer_from_response,
    handle_call_tool,
    handle_initialize,
    handle_list_tools,
    handle_mcp_request,
    handle_ping,
    prepare_tool_arguments,
    process_mapping_response,
)
from models.model import App, AppMCPServer, AppMode, EndUser


class TestHandleMCPRequest:
    """Test handle_mcp_request function"""

    def setup_method(self):
        """Setup test fixtures"""
        self.app = Mock(spec=App)
        self.app.name = "test_app"
        self.app.mode = AppMode.CHAT

        self.mcp_server = Mock(spec=AppMCPServer)
        self.mcp_server.description = "Test server"
        self.mcp_server.parameters_dict = {}

        self.end_user = Mock(spec=EndUser)
        self.user_input_form = []

        # Create mock request
        self.mock_request = Mock()
        self.mock_request.root = Mock()
        self.mock_request.root.id = 123

    def test_handle_ping_request(self):
        """Test handling ping request"""
        # Setup ping request
        self.mock_request.root = Mock(spec=types.PingRequest)
        self.mock_request.root.id = 123
        request_type = Mock(return_value=types.PingRequest)

        with patch("core.mcp.server.streamable_http.type", request_type):
            result = handle_mcp_request(
                self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123
            )

        assert isinstance(result, types.JSONRPCResponse)
        assert result.jsonrpc == "2.0"
        assert result.id == 123

    def test_handle_initialize_request(self):
        """Test handling initialize request"""
        # Setup initialize request
        self.mock_request.root = Mock(spec=types.InitializeRequest)
        self.mock_request.root.id = 123
        request_type = Mock(return_value=types.InitializeRequest)

        with patch("core.mcp.server.streamable_http.type", request_type):
            result = handle_mcp_request(
                self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123
            )

        assert isinstance(result, types.JSONRPCResponse)
        assert result.jsonrpc == "2.0"
        assert result.id == 123

    def test_handle_list_tools_request(self):
        """Test handling list tools request"""
        # Setup list tools request
        self.mock_request.root = Mock(spec=types.ListToolsRequest)
        self.mock_request.root.id = 123
        request_type = Mock(return_value=types.ListToolsRequest)

        with patch("core.mcp.server.streamable_http.type", request_type):
            result = handle_mcp_request(
                self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123
            )

        assert isinstance(result, types.JSONRPCResponse)
        assert result.jsonrpc == "2.0"
        assert result.id == 123

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_handle_call_tool_request(self, mock_app_generate):
        """Test handling call tool request"""
        # Setup call tool request
        mock_call_request = Mock(spec=types.CallToolRequest)
        mock_call_request.params = Mock()
        mock_call_request.params.arguments = {"query": "test question"}
        mock_call_request.id = 123

        self.mock_request.root = mock_call_request
        request_type = Mock(return_value=types.CallToolRequest)

        # Mock app generate service response
        mock_response = {"answer": "test answer"}
        mock_app_generate.generate.return_value = mock_response

        with patch("core.mcp.server.streamable_http.type", request_type):
            result = handle_mcp_request(
                self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123
            )

        assert isinstance(result, types.JSONRPCResponse)
        assert result.jsonrpc == "2.0"
        assert result.id == 123

        # Verify AppGenerateService was called
        mock_app_generate.generate.assert_called_once()

    def test_handle_unknown_request_type(self):
        """Test handling unknown request type"""

        # Setup unknown request
        class UnknownRequest:
            pass

        self.mock_request.root = Mock(spec=UnknownRequest)
        self.mock_request.root.id = 123
        request_type = Mock(return_value=UnknownRequest)

        with patch("core.mcp.server.streamable_http.type", request_type):
            result = handle_mcp_request(
                self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123
            )

        assert isinstance(result, types.JSONRPCError)
        assert result.jsonrpc == "2.0"
        assert result.id == 123
        assert result.error.code == types.METHOD_NOT_FOUND

    def test_handle_value_error(self):
        """Test handling ValueError"""
        # Setup request that will cause ValueError
        self.mock_request.root = Mock(spec=types.CallToolRequest)
        self.mock_request.root.params = Mock()
        self.mock_request.root.params.arguments = {}

        request_type = Mock(return_value=types.CallToolRequest)

        # Don't provide end_user to cause ValueError
        with patch("core.mcp.server.streamable_http.type", request_type):
            result = handle_mcp_request(self.app, self.mock_request, self.user_input_form, self.mcp_server, None, 123)

        assert isinstance(result, types.JSONRPCError)
        assert result.error.code == types.INVALID_PARAMS

    def test_handle_generic_exception(self):
        """Test handling generic exception"""
        # Setup request that will cause generic exception
        self.mock_request.root = Mock(spec=types.PingRequest)
        self.mock_request.root.id = 123

        # Patch handle_ping to raise exception instead of type
        with patch("core.mcp.server.streamable_http.handle_ping", side_effect=Exception("Test error")):
            with patch("core.mcp.server.streamable_http.type", return_value=types.PingRequest):
                result = handle_mcp_request(
                    self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123
                )

        assert isinstance(result, types.JSONRPCError)
        assert result.error.code == types.INTERNAL_ERROR


class TestIndividualHandlers:
    """Test individual handler functions"""

    def test_handle_ping(self):
        """Test ping handler"""
        result = handle_ping()
        assert isinstance(result, types.EmptyResult)

    def test_handle_initialize(self):
        """Test initialize handler"""
        description = "Test server"

        with patch("core.mcp.server.streamable_http.dify_config") as mock_config:
            mock_config.project.version = "1.0.0"
            result = handle_initialize(description)

        assert isinstance(result, types.InitializeResult)
        assert result.protocolVersion == types.SERVER_LATEST_PROTOCOL_VERSION
        assert result.instructions == "Test server"

    def test_handle_list_tools(self):
        """Test list tools handler"""
        app_name = "test_app"
        app_mode = AppMode.CHAT
        description = "Test server"
        parameters_dict: dict[str, str] = {}
        user_input_form: list[VariableEntity] = []

        result = handle_list_tools(app_name, app_mode, user_input_form, description, parameters_dict)

        assert isinstance(result, types.ListToolsResult)
        assert len(result.tools) == 1
        assert result.tools[0].name == "test_app"
        assert result.tools[0].description == "Test server"

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_handle_call_tool(self, mock_app_generate):
        """Test call tool handler"""
        app = Mock(spec=App)
        app.mode = AppMode.CHAT

        # Create mock request
        mock_request = Mock()
        mock_call_request = Mock(spec=types.CallToolRequest)
        mock_call_request.params = Mock()
        mock_call_request.params.arguments = {"query": "test question"}
        mock_request.root = mock_call_request

        user_input_form: list[VariableEntity] = []
        end_user = Mock(spec=EndUser)

        # Mock app generate service response
        mock_response = {"answer": "test answer"}
        mock_app_generate.generate.return_value = mock_response

        result = handle_call_tool(app, mock_request, user_input_form, end_user)

        assert isinstance(result, types.CallToolResult)
        assert len(result.content) == 1
        # Type assertion needed due to union type
        text_content = result.content[0]
        assert hasattr(text_content, "text")
        assert text_content.text == "test answer"

    def test_handle_call_tool_no_end_user(self):
        """Test call tool handler without end user"""
        app = Mock(spec=App)
        mock_request = Mock()
        user_input_form: list[VariableEntity] = []

        with pytest.raises(ValueError, match="End user not found"):
            handle_call_tool(app, mock_request, user_input_form, None)


class TestUtilityFunctions:
    """Test utility functions"""

    def test_build_parameter_schema_chat_mode(self):
        """Test building parameter schema for chat mode"""
        app_mode = AppMode.CHAT
        parameters_dict: dict[str, str] = {"name": "Enter your name"}

        user_input_form = [
            VariableEntity(
                type=VariableEntityType.TEXT_INPUT,
                variable="name",
                description="User name",
                label="Name",
                required=True,
            )
        ]

        schema = build_parameter_schema(app_mode, user_input_form, parameters_dict)

        assert schema["type"] == "object"
        assert "query" in schema["properties"]
        assert "name" in schema["properties"]
        assert "query" in schema["required"]
        assert "name" in schema["required"]

    def test_build_parameter_schema_workflow_mode(self):
        """Test building parameter schema for workflow mode"""
        app_mode = AppMode.WORKFLOW
        parameters_dict: dict[str, str] = {"input_text": "Enter text"}

        user_input_form = [
            VariableEntity(
                type=VariableEntityType.TEXT_INPUT,
                variable="input_text",
                description="Input text",
                label="Input",
                required=True,
            )
        ]

        schema = build_parameter_schema(app_mode, user_input_form, parameters_dict)

        assert schema["type"] == "object"
        assert "query" not in schema["properties"]
        assert "input_text" in schema["properties"]
        assert "input_text" in schema["required"]

    def test_prepare_tool_arguments_chat_mode(self):
        """Test preparing tool arguments for chat mode"""
        app = Mock(spec=App)
        app.mode = AppMode.CHAT

        arguments = {"query": "test question", "name": "John"}

        result = prepare_tool_arguments(app, arguments)

        assert result["query"] == "test question"
        assert result["inputs"]["name"] == "John"
        # Original arguments should not be modified
        assert arguments["query"] == "test question"

    def test_prepare_tool_arguments_workflow_mode(self):
        """Test preparing tool arguments for workflow mode"""
        app = Mock(spec=App)
        app.mode = AppMode.WORKFLOW

        arguments = {"input_text": "test input"}

        result = prepare_tool_arguments(app, arguments)

        assert "inputs" in result
        assert result["inputs"]["input_text"] == "test input"

    def test_prepare_tool_arguments_completion_mode(self):
        """Test preparing tool arguments for completion mode"""
        app = Mock(spec=App)
        app.mode = AppMode.COMPLETION

        arguments = {"name": "John"}

        result = prepare_tool_arguments(app, arguments)

        assert result["query"] == ""
        assert result["inputs"]["name"] == "John"

    def test_extract_answer_from_mapping_response_chat(self):
        """Test extracting answer from mapping response for chat mode"""
        app = Mock(spec=App)
        app.mode = AppMode.CHAT

        response = {"answer": "test answer", "other": "data"}

        result = extract_answer_from_response(app, response)

        assert result == "test answer"

    def test_extract_answer_from_mapping_response_workflow(self):
        """Test extracting answer from mapping response for workflow mode"""
        app = Mock(spec=App)
        app.mode = AppMode.WORKFLOW

        response = {"data": {"outputs": {"result": "test result"}}}

        result = extract_answer_from_response(app, response)

        expected = json.dumps({"result": "test result"}, ensure_ascii=False)
        assert result == expected

    def test_extract_answer_from_streaming_response(self):
        """Test extracting answer from streaming response"""
        app = Mock(spec=App)

        # Mock RateLimitGenerator
        mock_generator = Mock(spec=RateLimitGenerator)
        mock_generator.generator = [
            'data: {"event": "agent_thought", "thought": "thinking..."}',
            'data: {"event": "agent_thought", "thought": "more thinking"}',
            'data: {"event": "other", "content": "ignore this"}',
            "not data format",
        ]

        result = extract_answer_from_response(app, mock_generator)

        assert result == "thinking...more thinking"

    def test_process_mapping_response_invalid_mode(self):
        """Test processing mapping response with invalid app mode"""
        app = Mock(spec=App)
        app.mode = "invalid_mode"

        response = {"answer": "test"}

        with pytest.raises(ValueError, match="Invalid app mode"):
            process_mapping_response(app, response)

    def test_convert_input_form_to_parameters(self):
        """Test converting input form to parameters"""
        user_input_form = [
            VariableEntity(
                type=VariableEntityType.TEXT_INPUT,
                variable="name",
                description="User name",
                label="Name",
                required=True,
            ),
            VariableEntity(
                type=VariableEntityType.SELECT,
                variable="category",
                description="Category",
                label="Category",
                required=False,
                options=["A", "B", "C"],
            ),
            VariableEntity(
                type=VariableEntityType.NUMBER,
                variable="count",
                description="Count",
                label="Count",
                required=True,
            ),
            VariableEntity(
                type=VariableEntityType.FILE,
                variable="upload",
                description="File upload",
                label="Upload",
                required=False,
            ),
        ]

        parameters_dict: dict[str, str] = {
            "name": "Enter your name",
            "category": "Select category",
            "count": "Enter count",
        }

        parameters, required = convert_input_form_to_parameters(user_input_form, parameters_dict)

        # Check parameters
        assert "name" in parameters
        assert parameters["name"]["type"] == "string"
        assert parameters["name"]["description"] == "Enter your name"

        assert "category" in parameters
        assert parameters["category"]["type"] == "string"
        assert parameters["category"]["enum"] == ["A", "B", "C"]

        assert "count" in parameters
        assert parameters["count"]["type"] == "number"

        # FILE type should be skipped - it creates empty dict but gets filtered later
        # Check that it doesn't have any meaningful content
        if "upload" in parameters:
            assert parameters["upload"] == {}

        # Check required fields
        assert "name" in required
        assert "count" in required
        assert "category" not in required

    # Note: _get_request_id function has been removed as request_id is now passed as parameter

    def test_convert_input_form_to_parameters_jsonschema_validation_ok(self):
        """Current schema uses 'number' for numeric fields; it should be a valid JSON Schema."""
        user_input_form = [
            VariableEntity(
                type=VariableEntityType.NUMBER,
                variable="count",
                description="Count",
                label="Count",
                required=True,
            ),
            VariableEntity(
                type=VariableEntityType.TEXT_INPUT,
                variable="name",
                description="User name",
                label="Name",
                required=False,
            ),
        ]

        parameters_dict = {
            "count": "Enter count",
            "name": "Enter your name",
        }

        parameters, required = convert_input_form_to_parameters(user_input_form, parameters_dict)

        # Build a complete JSON Schema
        schema = {
            "type": "object",
            "properties": parameters,
            "required": required,
        }

        # 1) The schema itself must be valid
        jsonschema.Draft202012Validator.check_schema(schema)

        # 2) Both float and integer instances should pass validation
        jsonschema.validate(instance={"count": 3.14, "name": "alice"}, schema=schema)
        jsonschema.validate(instance={"count": 2, "name": "bob"}, schema=schema)

    def test_legacy_float_type_schema_is_invalid(self):
        """Legacy/buggy behavior: using 'float' should produce an invalid JSON Schema."""
        # Manually construct a legacy/incorrect schema (simulating old behavior)
        bad_schema = {
            "type": "object",
            "properties": {
                "count": {
                    "type": "float",  # Invalid type: JSON Schema does not support 'float'
                    "description": "Enter count",
                }
            },
            "required": ["count"],
        }

        # The schema itself should raise a SchemaError
        with pytest.raises(jsonschema.exceptions.SchemaError):
            jsonschema.Draft202012Validator.check_schema(bad_schema)

        # Or validation should also raise SchemaError
        with pytest.raises(jsonschema.exceptions.SchemaError):
            jsonschema.validate(instance={"count": 1.23}, schema=bad_schema)
