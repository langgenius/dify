import json
from unittest.mock import Mock, patch

import jsonschema
import pytest

from core.app.features.rate_limiting.rate_limit import RateLimitGenerator
from core.mcp import types
from core.mcp.server.streamable_http import (
    AppStreamError,
    build_parameter_schema,
    convert_input_form_to_parameters,
    extract_answer_from_response,
    extract_structured_output,
    handle_call_tool,
    handle_initialize,
    handle_list_tools,
    handle_mcp_request,
    handle_ping,
    negotiate_protocol_version,
    prepare_tool_arguments,
    process_mapping_response,
)
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from models.model import App, AppMCPServer, AppMode, EndUser
from services.errors.app import TriggerWorkflowServiceModeUnavailableError


class TestHandleMCPRequest:
    """Test handle_mcp_request function"""

    def setup_method(self):
        """Setup test fixtures"""
        self.app = App()
        self.app.name = "test_app"
        self.app.mode = AppMode.CHAT

        self.mcp_server = AppMCPServer(
            tenant_id="tenant-id",
            app_id="app-id",
            name="Test Server",
            description="",
            server_code="test-server",
            status="active",
            parameters="{}",
        )
        self.mcp_server.description = "Test server"

        self.end_user = EndUser()
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
                Mock(), self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123
            )

        assert isinstance(result, types.JSONRPCResponse)
        assert result.jsonrpc == "2.0"
        assert result.id == 123

    def test_handle_initialize_request(self):
        """Test handling initialize request"""
        # Setup initialize request
        self.mock_request.root = Mock(spec=types.InitializeRequest)
        self.mock_request.root.id = 123
        self.mock_request.root.params = Mock()
        self.mock_request.root.params.protocolVersion = "2025-06-18"
        request_type = Mock(return_value=types.InitializeRequest)

        with patch("core.mcp.server.streamable_http.type", request_type):
            result = handle_mcp_request(
                Mock(), self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123
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
                Mock(), self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123
            )

        assert isinstance(result, types.JSONRPCResponse)
        assert result.jsonrpc == "2.0"
        assert result.id == 123

    def test_handle_list_tools_request_threads_protocol_version(self):
        """The negotiated version reaches handle_list_tools through the dispatcher."""
        self.mock_request.root = Mock(spec=types.ListToolsRequest)
        self.mock_request.root.id = 123

        result = handle_mcp_request(
            Mock(), self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123, "2025-06-18"
        )

        assert isinstance(result, types.JSONRPCResponse)
        tool = result.result["tools"][0]
        assert tool["outputSchema"] == {"type": "object"}
        assert tool["title"] == "test_app"

    def test_handle_list_tools_request_legacy_serialization_unchanged(self):
        """A 2024-11-05 tools/list response serializes without any 2025-06-18 fields."""
        self.mock_request.root = Mock(spec=types.ListToolsRequest)
        self.mock_request.root.id = 123

        result = handle_mcp_request(
            Mock(), self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123, "2024-11-05"
        )

        assert isinstance(result, types.JSONRPCResponse)
        tool = result.result["tools"][0]
        assert set(tool) == {"name", "description", "inputSchema"}

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
                Mock(), self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123
            )

        assert isinstance(result, types.JSONRPCResponse)
        assert result.jsonrpc == "2.0"
        assert result.id == 123

        # Verify AppGenerateService was called
        mock_app_generate.generate.assert_called_once()

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_handle_call_tool_returns_trigger_workflow_business_error(self, mock_app_generate):
        mock_call_request = Mock(spec=types.CallToolRequest)
        mock_call_request.params = Mock()
        mock_call_request.params.arguments = {"query": "test question"}
        mock_call_request.id = 123
        self.mock_request.root = mock_call_request
        mock_app_generate.generate.side_effect = TriggerWorkflowServiceModeUnavailableError()

        result = handle_mcp_request(
            Mock(),
            self.app,
            self.mock_request,
            self.user_input_form,
            self.mcp_server,
            self.end_user,
            123,
        )

        assert isinstance(result, types.JSONRPCError)
        assert result.error.code == types.INVALID_REQUEST
        assert result.error.data == {"code": "trigger_workflow_service_mode_unavailable"}

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_handle_call_tool_request_threads_protocol_version(self, mock_app_generate):
        """The negotiated version reaches handle_call_tool through the dispatcher."""
        mock_call_request = Mock(spec=types.CallToolRequest)
        mock_call_request.params = Mock()
        mock_call_request.params.arguments = {"query": "test question"}
        mock_call_request.id = 123
        self.mock_request.root = mock_call_request

        mock_app_generate.generate.return_value = {"answer": "test answer"}

        result = handle_mcp_request(
            Mock(), self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123, "2025-06-18"
        )

        assert isinstance(result, types.JSONRPCResponse)
        assert result.result["structuredContent"] == {"answer": "test answer"}

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_handle_call_tool_request_legacy_serialization_unchanged(self, mock_app_generate):
        """A 2024-11-05 tools/call response serializes without structuredContent."""
        mock_call_request = Mock(spec=types.CallToolRequest)
        mock_call_request.params = Mock()
        mock_call_request.params.arguments = {"query": "test question"}
        mock_call_request.id = 123
        self.mock_request.root = mock_call_request

        mock_app_generate.generate.return_value = {"answer": "test answer"}

        result = handle_mcp_request(
            Mock(), self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123, "2024-11-05"
        )

        assert isinstance(result, types.JSONRPCResponse)
        assert "structuredContent" not in result.result
        assert result.result["content"][0]["text"] == "test answer"

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
                Mock(), self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123
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
            result = handle_mcp_request(
                Mock(), self.app, self.mock_request, self.user_input_form, self.mcp_server, None, 123
            )

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
                    Mock(), self.app, self.mock_request, self.user_input_form, self.mcp_server, self.end_user, 123
                )

        assert isinstance(result, types.JSONRPCError)
        assert result.error.code == types.INTERNAL_ERROR


class TestIndividualHandlers:
    """Test individual handler functions"""

    def test_handle_ping(self):
        """Test ping handler"""
        result = handle_ping()
        assert isinstance(result, types.EmptyResult)

    def test_handle_initialize_echoes_supported_version(self):
        """A supported requested version is echoed back unchanged."""
        result = handle_initialize("Test server", "2024-11-05")

        assert isinstance(result, types.InitializeResult)
        assert result.protocolVersion == "2024-11-05"
        assert result.instructions == "Test server"

    def test_handle_initialize_echoes_intermediate_version(self):
        """The intermediate supported version (2025-03-26) is echoed back."""
        result = handle_initialize("Test server", "2025-03-26")

        assert result.protocolVersion == "2025-03-26"

    def test_handle_initialize_negotiates_latest_for_modern_client(self):
        """A 2025-06-18 client gets 2025-06-18 back."""
        result = handle_initialize("Test server", "2025-06-18")

        assert result.protocolVersion == "2025-06-18"

    def test_handle_initialize_falls_back_for_unknown_version(self):
        """An unsupported requested version falls back to the server latest."""
        result = handle_initialize("Test server", "1999-01-01")

        assert result.protocolVersion == types.SERVER_LATEST_PROTOCOL_VERSION
        assert result.protocolVersion == "2025-06-18"

    def test_handle_initialize_non_string_version_falls_back(self):
        """A malformed (non-string) requested version falls back to the server latest."""
        result = handle_initialize("Test server", 20250618)

        assert result.protocolVersion == types.SERVER_LATEST_PROTOCOL_VERSION

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

    def test_handle_list_tools_adds_structured_output_for_modern_client(self):
        """Tool advertises outputSchema and title when negotiated >= 2025-06-18."""
        result = handle_list_tools("test_app", AppMode.CHAT, [], "Test server", {}, "2025-06-18")

        tool = result.tools[0]
        assert tool.outputSchema == {"type": "object"}
        assert tool.title == "test_app"

    def test_handle_list_tools_omits_structured_output_for_legacy_client(self):
        """Tool stays unchanged (no outputSchema/title) for 2024-11-05 clients."""
        result = handle_list_tools("test_app", AppMode.CHAT, [], "Test server", {}, "2024-11-05")

        tool = result.tools[0]
        assert tool.outputSchema is None
        assert tool.title is None

    def test_handle_list_tools_omits_structured_output_for_intermediate_client(self):
        """The 2025-03-26 negotiated version is below the structured-output threshold."""
        result = handle_list_tools("test_app", AppMode.CHAT, [], "Test server", {}, "2025-03-26")

        tool = result.tools[0]
        assert tool.outputSchema is None
        assert tool.title is None

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_handle_call_tool(self, mock_app_generate):
        """Test call tool handler"""
        app = App(
            mode=AppMode.CHAT,
        )

        # Create mock request
        mock_request = Mock()
        mock_call_request = Mock(spec=types.CallToolRequest)
        mock_call_request.params = Mock()
        mock_call_request.params.arguments = {"query": "test question"}
        mock_request.root = mock_call_request

        user_input_form: list[VariableEntity] = []
        end_user = EndUser()

        # Mock app generate service response
        mock_response = {"answer": "test answer"}
        mock_app_generate.generate.return_value = mock_response

        result = handle_call_tool(Mock(), app, mock_request, user_input_form, end_user)

        assert isinstance(result, types.CallToolResult)
        assert len(result.content) == 1
        # Type assertion needed due to union type
        text_content = result.content[0]
        assert hasattr(text_content, "text")
        assert text_content.text == "test answer"

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_handle_call_tool_structured_output_modern_client(self, mock_app_generate):
        """structuredContent is attached alongside TextContent for >= 2025-06-18."""
        app = App(
            mode=AppMode.CHAT,
        )

        mock_request = Mock()
        mock_call_request = Mock(spec=types.CallToolRequest)
        mock_call_request.params = Mock()
        mock_call_request.params.arguments = {"query": "test question"}
        mock_request.root = mock_call_request

        mock_app_generate.generate.return_value = {"answer": "test answer"}

        result = handle_call_tool(Mock(), app, mock_request, [], EndUser(), "2025-06-18")

        assert result.structuredContent == {"answer": "test answer"}
        assert result.content[0].text == "test answer"

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_handle_call_tool_no_structured_output_legacy_client(self, mock_app_generate):
        """structuredContent is omitted for 2024-11-05 clients."""
        app = App(
            mode=AppMode.CHAT,
        )

        mock_request = Mock()
        mock_call_request = Mock(spec=types.CallToolRequest)
        mock_call_request.params = Mock()
        mock_call_request.params.arguments = {"query": "test question"}
        mock_request.root = mock_call_request

        mock_app_generate.generate.return_value = {"answer": "test answer"}

        result = handle_call_tool(Mock(), app, mock_request, [], EndUser(), "2024-11-05")

        assert result.structuredContent is None
        assert result.content[0].text == "test answer"

    def test_handle_call_tool_no_end_user(self):
        """Test call tool handler without end user"""
        app = App()
        mock_request = Mock()
        user_input_form: list[VariableEntity] = []

        with pytest.raises(ValueError, match="End user not found"):
            handle_call_tool(Mock(), app, mock_request, user_input_form, None)


def _sse(event: dict[str, object]) -> str:
    """Render one JSON payload as the SSE line the app generator emits."""
    return f"data: {json.dumps(event)}"


def _stream_response(*lines: str) -> RateLimitGenerator:
    """Wrap raw SSE lines in the rate-limited stream the MCP layer consumes."""
    return RateLimitGenerator(
        rate_limit=Mock(),
        generator=(line for line in lines),
        request_id="request-id",
    )


class TestAgentAppCallTool:
    """Agent Apps (AppMode.AGENT) registered as MCP servers must work through tools/call.

    Agent Apps only run in streaming mode, and their answer rides the chat `message`
    channel — the same chunks the pipeline persists as ``Message.answer``. Their
    `agent_thought` rows hold reasoning and their `agent_message` events hold
    in-progress stream text that may differ from the terminal answer.
    """

    @staticmethod
    def _agent_app() -> App:
        return App(mode=AppMode.AGENT)

    @staticmethod
    def _call_request() -> Mock:
        mock_request = Mock()
        mock_call_request = Mock(spec=types.CallToolRequest)
        mock_call_request.params = Mock()
        mock_call_request.params.arguments = {"query": "test question"}
        mock_request.root = mock_call_request
        return mock_request

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_agent_app_generates_in_streaming_mode(self, mock_app_generate):
        """Agent Apps reject blocking generation, so tools/call must request streaming."""
        mock_app_generate.generate.return_value = _stream_response(_sse({"event": "message", "answer": "answer"}))

        handle_call_tool(Mock(), self._agent_app(), self._call_request(), [], EndUser())

        assert mock_app_generate.generate.call_args.kwargs["streaming"] is True

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_agent_app_answer_accumulates_message_events(self, mock_app_generate):
        """The answer comes from the `message` channel — never silently ""."""
        mock_app_generate.generate.return_value = _stream_response(
            _sse({"event": "message", "answer": "Hello, "}),
            _sse({"event": "message", "answer": "world"}),
            _sse({"event": "message_end", "metadata": {}}),
        )

        result = handle_call_tool(Mock(), self._agent_app(), self._call_request(), [], EndUser())

        assert isinstance(result, types.CallToolResult)
        assert result.content[0].text == "Hello, world"

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_agent_app_answer_excludes_reasoning_and_stream_text(self, mock_app_generate):
        """Reasoning thoughts and in-progress `agent_message` text must not leak in.

        AgentAppRunner streams `agent_message` deltas that can differ from the
        terminal answer, and records reasoning as `agent_thought` rows; only the
        terminal `message` chunk is the answer.
        """
        mock_app_generate.generate.return_value = _stream_response(
            _sse({"event": "agent_thought", "thought": "let me think about this"}),
            _sse({"event": "agent_message", "answer": "hello "}),
            _sse({"event": "agent_message", "answer": "agent"}),
            _sse({"event": "message", "answer": "hello agent"}),
            _sse({"event": "message_end", "metadata": {}}),
            "not data format",
        )

        result = handle_call_tool(Mock(), self._agent_app(), self._call_request(), [], EndUser())

        assert result.content[0].text == "hello agent"

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_legacy_agent_chat_answer_is_not_duplicated(self, mock_app_generate):
        """Agent chat streams the same text as both `agent_thought` and `agent_message`."""
        mock_app_generate.generate.return_value = _stream_response(
            _sse({"event": "agent_thought", "thought": "Hello"}),
            _sse({"event": "agent_message", "answer": "Hello"}),
        )

        result = handle_call_tool(Mock(), App(mode=AppMode.AGENT_CHAT), self._call_request(), [], EndUser())

        assert result.content[0].text == "Hello"

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_agent_app_message_replace_overrides_streamed_answer(self, mock_app_generate):
        """Output moderation replaces the answer the pipeline persists."""
        mock_app_generate.generate.return_value = _stream_response(
            _sse({"event": "message", "answer": "unmoderated text"}),
            _sse({"event": "message_replace", "answer": "[content blocked]"}),
            _sse({"event": "message_end", "metadata": {}}),
        )

        result = handle_call_tool(Mock(), self._agent_app(), self._call_request(), [], EndUser())

        assert result.content[0].text == "[content blocked]"

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_agent_app_failed_run_returns_error_result(self, mock_app_generate):
        """A failed run ends the stream normally, so the error event must surface."""
        mock_app_generate.generate.return_value = _stream_response(
            _sse({"event": "message", "answer": "partial"}),
            _sse({"event": "error", "code": "completion_request_error", "message": "agent backend is down"}),
        )

        result = handle_call_tool(Mock(), self._agent_app(), self._call_request(), [], EndUser())

        assert result.isError is True
        assert result.content[0].text == "agent backend is down"
        assert result.structuredContent is None

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_agent_app_mapping_response_extracts_answer(self, mock_app_generate):
        """Defensive: a blocking-style Mapping response must not raise Invalid app mode.

        Agent Apps always generate through a stream, so this path is not reachable
        today; the arm exists so the answer modes stay consistent across the module.
        """
        mock_app_generate.generate.return_value = {"answer": "test answer"}

        result = handle_call_tool(Mock(), self._agent_app(), self._call_request(), [], EndUser())

        assert result.content[0].text == "test answer"

    @patch("core.mcp.server.streamable_http.AppGenerateService")
    def test_agent_app_structured_output_modern_client(self, mock_app_generate):
        """>= 2025-06-18 clients get structuredContent for Agent Apps too."""
        mock_app_generate.generate.return_value = _stream_response(_sse({"event": "message", "answer": "final answer"}))

        result = handle_call_tool(Mock(), self._agent_app(), self._call_request(), [], EndUser(), "2025-06-18")

        assert result.structuredContent == {"answer": "final answer"}
        assert result.content[0].text == "final answer"


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
        app = App(
            mode=AppMode.CHAT,
        )

        arguments = {"query": "test question", "name": "John"}

        result = prepare_tool_arguments(app, arguments)

        assert result["query"] == "test question"
        assert result["inputs"]["name"] == "John"
        # Original arguments should not be modified
        assert arguments["query"] == "test question"

    def test_prepare_tool_arguments_workflow_mode(self):
        """Test preparing tool arguments for workflow mode"""
        app = App(
            mode=AppMode.WORKFLOW,
        )

        arguments = {"input_text": "test input"}

        result = prepare_tool_arguments(app, arguments)

        assert "inputs" in result
        assert result["inputs"]["input_text"] == "test input"

    def test_prepare_tool_arguments_completion_mode(self):
        """Test preparing tool arguments for completion mode"""
        app = App(
            mode=AppMode.COMPLETION,
        )

        arguments = {"name": "John"}

        result = prepare_tool_arguments(app, arguments)

        assert result["query"] == ""
        assert result["inputs"]["name"] == "John"

    def test_extract_answer_from_mapping_response_chat(self):
        """Test extracting answer from mapping response for chat mode"""
        app = App(
            mode=AppMode.CHAT,
        )

        response = {"answer": "test answer", "other": "data"}

        result = extract_answer_from_response(app, response)

        assert result == "test answer"

    def test_extract_answer_from_mapping_response_workflow(self):
        """Test extracting answer from mapping response for workflow mode"""
        app = App(
            mode=AppMode.WORKFLOW,
        )

        response = {"data": {"outputs": {"result": "test result"}}}

        result = extract_answer_from_response(app, response)

        expected = json.dumps({"result": "test result"}, ensure_ascii=False)
        assert result == expected

    def test_extract_answer_from_streaming_response(self):
        """Test extracting answer from streaming response"""
        app = App()

        response = _stream_response(
            'data: {"event": "agent_thought", "thought": "thinking..."}',
            'data: {"event": "agent_thought", "thought": "more thinking"}',
            'data: {"event": "other", "content": "ignore this"}',
            "not data format",
        )

        assert extract_answer_from_response(app, response) == "thinking...more thinking"

    def test_extract_answer_from_streaming_response_releases_rate_limit(self):
        """Exhausting the stream must release the app-level rate-limit permit."""
        rate_limit = Mock()
        response = RateLimitGenerator(
            rate_limit=rate_limit,
            generator=(line for line in [_sse({"event": "message", "answer": "hi"})]),
            request_id="request-id",
        )

        assert extract_answer_from_response(App(mode=AppMode.AGENT), response) == "hi"

        rate_limit.exit.assert_called_once_with("request-id")

    @pytest.mark.parametrize("mode", [AppMode.AGENT, AppMode.AGENT_CHAT])
    def test_extract_answer_from_streaming_response_error_event(self, mode):
        """An error event ends the stream without raising, so extraction raises."""
        rate_limit = Mock()
        response = RateLimitGenerator(
            rate_limit=rate_limit,
            generator=(
                line
                for line in [
                    _sse({"event": "message", "answer": "partial"}),
                    _sse({"event": "error", "code": "completion_request_error", "message": "backend is down"}),
                ]
            ),
            request_id="request-id",
        )

        with pytest.raises(AppStreamError, match="backend is down"):
            extract_answer_from_response(App(mode=mode), response)

        rate_limit.exit.assert_called_once_with("request-id")

    def test_extract_answer_from_streaming_response_message_events(self):
        """Agent App answers ride the `message` channel, not `agent_message`."""
        app = App(mode=AppMode.AGENT)

        response = _stream_response(
            _sse({"event": "agent_message", "answer": "in-progress"}),
            _sse({"event": "message", "answer": "Hello, "}),
            _sse({"event": "message", "answer": "world"}),
            _sse({"event": "message_end", "metadata": {}}),
        )

        assert extract_answer_from_response(app, response) == "Hello, world"

    def test_extract_structured_output_workflow(self):
        """Workflow mode exposes the raw outputs mapping as structured content."""
        app = App(
            mode=AppMode.WORKFLOW,
        )

        response = {"data": {"outputs": {"result": "test result"}}}

        assert extract_structured_output(app, response, "ignored") == {"result": "test result"}

    def test_extract_structured_output_chat(self):
        """Chat mode wraps the answer string under an 'answer' key."""
        app = App(
            mode=AppMode.CHAT,
        )

        assert extract_structured_output(app, {"answer": "hi"}, "hi") == {"answer": "hi"}

    def test_extract_structured_output_workflow_missing_outputs(self):
        """Missing or malformed outputs fall back to None."""
        app = App(
            mode=AppMode.WORKFLOW,
        )

        assert extract_structured_output(app, {"data": {}}, "ignored") is None

    def test_extract_structured_output_workflow_non_mapping_response(self):
        """A non-mapping workflow response yields no structured output."""
        app = App(
            mode=AppMode.WORKFLOW,
        )

        assert extract_structured_output(app, None, "ignored") is None

    def test_extract_structured_output_workflow_non_mapping_data(self):
        """A non-mapping 'data' entry yields no structured output."""
        app = App(
            mode=AppMode.WORKFLOW,
        )

        assert extract_structured_output(app, {"data": "not a mapping"}, "ignored") is None

    def test_extract_structured_output_workflow_non_mapping_outputs(self):
        """A non-mapping 'outputs' entry yields no structured output."""
        app = App(
            mode=AppMode.WORKFLOW,
        )

        assert extract_structured_output(app, {"data": {"outputs": ["not", "a", "mapping"]}}, "ignored") is None

    @pytest.mark.parametrize("mode", [AppMode.ADVANCED_CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION, AppMode.AGENT])
    def test_extract_structured_output_other_answer_modes(self, mode):
        """Every chat-style mode wraps the answer string under an 'answer' key."""
        app = App(
            mode=mode,
        )

        assert extract_structured_output(app, {"answer": "hi"}, "hi") == {"answer": "hi"}

    def test_extract_structured_output_unknown_mode(self):
        """Modes outside the MCP surface produce no structured output."""
        app = App(
            mode=AppMode.CHANNEL,
        )

        assert extract_structured_output(app, {"answer": "hi"}, "hi") is None

    def test_process_mapping_response_agent_mode(self):
        """Agent App mapping responses read the answer like other chat modes."""
        app = App(mode=AppMode.AGENT)

        assert process_mapping_response(app, {"answer": "test answer"}) == "test answer"

    def test_process_mapping_response_invalid_mode(self):
        """Test processing mapping response with invalid app mode"""
        app = App(
            mode="invalid_mode",
        )

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
            VariableEntity(
                type=VariableEntityType.CHECKBOX,
                variable="enabled",
                description="Enable flag",
                label="Enabled",
                required=False,
            ),
            VariableEntity(
                type=VariableEntityType.JSON_OBJECT,
                variable="config",
                description="Config object",
                label="Config",
                required=True,
            ),
            VariableEntity(
                type=VariableEntityType.JSON_OBJECT,
                variable="schema_config",
                description="Config with schema",
                label="Schema Config",
                required=False,
                json_schema={
                    "properties": {
                        "host": {"type": "string"},
                        "port": {"type": "number"},
                    },
                    "required": ["host"],
                    "additionalProperties": False,
                },
            ),
        ]

        parameters_dict: dict[str, str] = {
            "name": "Enter your name",
            "category": "Select category",
            "count": "Enter count",
            "enabled": "Enable flag",
            "config": "Config object",
            "schema_config": "Config with schema",
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

        # FILE type is skipped entirely via `continue` — key should not exist
        assert "upload" not in parameters

        # CHECKBOX maps to boolean
        assert parameters["enabled"]["type"] == "boolean"

        # JSON_OBJECT without json_schema maps to object
        assert parameters["config"]["type"] == "object"
        assert "properties" not in parameters["config"]

        # JSON_OBJECT with json_schema forwards schema keys
        assert parameters["schema_config"]["type"] == "object"
        assert parameters["schema_config"]["properties"] == {
            "host": {"type": "string"},
            "port": {"type": "number"},
        }
        assert parameters["schema_config"]["required"] == ["host"]
        assert parameters["schema_config"]["additionalProperties"] is False

        # Check required fields
        assert "name" in required
        assert "count" in required
        assert "config" in required
        assert "category" not in required

    # Note: _get_request_id function has been removed as request_id is now passed as parameter

    def test_convert_input_form_to_parameters_jsonschema_validation_ok(self):
        """Generated schema with all supported types should be valid JSON Schema."""
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
            VariableEntity(
                type=VariableEntityType.CHECKBOX,
                variable="enabled",
                description="Toggle",
                label="Enabled",
                required=False,
            ),
            VariableEntity(
                type=VariableEntityType.JSON_OBJECT,
                variable="metadata",
                description="Metadata",
                label="Metadata",
                required=False,
            ),
        ]

        parameters_dict = {
            "count": "Enter count",
            "name": "Enter your name",
            "enabled": "Toggle flag",
            "metadata": "Metadata object",
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

        # 2) Validate instances with all types
        jsonschema.validate(instance={"count": 3.14, "name": "alice"}, schema=schema)
        jsonschema.validate(
            instance={"count": 2, "enabled": True, "metadata": {"key": "val"}},
            schema=schema,
        )

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


class TestNegotiateProtocolVersion:
    """Test the MCP-Protocol-Version header resolver."""

    def test_initialize_ignores_header(self):
        """Initialize negotiates via the request body, so its header is ignored."""
        assert negotiate_protocol_version("anything", True) == types.DEFAULT_NEGOTIATED_VERSION

    def test_absent_header_defaults(self):
        """An absent header defaults to 2025-03-26 per the spec back-compat rule."""
        assert negotiate_protocol_version(None, False) == types.DEFAULT_NEGOTIATED_VERSION

    def test_empty_header_treated_as_absent(self):
        """An empty header value is treated as absent and defaults to 2025-03-26."""
        assert negotiate_protocol_version("", False) == types.DEFAULT_NEGOTIATED_VERSION

    def test_supported_header_passes_through(self):
        """All supported header values are used as the negotiated version."""
        assert negotiate_protocol_version("2025-06-18", False) == "2025-06-18"
        assert negotiate_protocol_version("2025-03-26", False) == "2025-03-26"
        assert negotiate_protocol_version("2024-11-05", False) == "2024-11-05"

    def test_unsupported_header_returns_none(self):
        """An explicit but unsupported header signals an error (None)."""
        assert negotiate_protocol_version("1999-01-01", False) is None
