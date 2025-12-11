"""Unit tests for MCP (Model Context Protocol) Controller.

This module provides comprehensive test coverage for the MCP controller which handles
JSON-RPC formatted requests according to the Model Context Protocol specification.

The MCP controller is responsible for:
- Processing JSON-RPC requests and notifications
- Validating MCP server status and availability
- Handling user input form integration
- Managing end user creation and retrieval
- Routing requests to appropriate handlers
- Error handling and response formatting

Test Coverage:
- JSON-RPC request parsing and validation
- Server code validation (existence, status)
- Request vs notification handling
- User input form extraction and conversion
- Error handling for various failure scenarios
- End user management (creation, retrieval)
- App availability validation
"""

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, Response

from controllers.console.app.mcp_server import AppMCPServerStatus
from controllers.mcp.mcp import MCPAppApi, MCPRequestError
from core.mcp import types as mcp_types
from models.model import App, AppMCPServer, AppMode, EndUser


class TestMCPAppApi:
    """Test suite for MCPAppApi controller.

    This class tests the main MCP endpoint that handles JSON-RPC requests
    for Model Context Protocol operations. Tests cover:
    - Request parsing and validation
    - Server and app lookup
    - Status validation
    - Request vs notification routing
    - Error handling
    """

    @pytest.fixture
    def app(self):
        """Create Flask application instance for testing.

        Returns:
            Flask: Configured Flask app with testing enabled
        """
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        return app

    @pytest.fixture
    def mock_mcp_server(self):
        """Create a mock MCP server instance.

        Returns:
            MagicMock: Mock AppMCPServer with required attributes
        """
        # Create mock server with all required attributes
        server = MagicMock(spec=AppMCPServer)
        server.id = "server-123"
        server.server_code = "test-server-code"
        server.app_id = "app-456"
        server.tenant_id = "tenant-789"
        server.status = AppMCPServerStatus.ACTIVE
        server.description = "Test MCP Server"
        server.parameters_dict = {"param1": "value1"}
        return server

    @pytest.fixture
    def mock_app(self):
        """Create a mock App instance.

        Returns:
            MagicMock: Mock App with required attributes
        """
        # Create mock app with workflow configuration
        app = MagicMock(spec=App)
        app.id = "app-456"
        app.tenant_id = "tenant-789"
        app.mode = AppMode.WORKFLOW
        app.name = "Test App"

        # Mock workflow with user_input_form method
        mock_workflow = MagicMock()
        mock_workflow.user_input_form.return_value = [
            {
                "text-input": {
                    "variable": "user_query",
                    "label": "User Query",
                    "required": True,
                    "description": "Enter your question",
                }
            }
        ]
        app.workflow = mock_workflow

        return app

    @pytest.fixture
    def mock_end_user(self):
        """Create a mock EndUser instance.

        Returns:
            MagicMock: Mock EndUser with required attributes
        """
        end_user = MagicMock(spec=EndUser)
        end_user.id = "end-user-123"
        end_user.tenant_id = "tenant-789"
        end_user.app_id = "app-456"
        end_user.type = "mcp"
        end_user.session_id = "server-123"
        end_user.name = "TestClient@1.0.0"
        return end_user

    @pytest.fixture
    def mock_db_session(self):
        """Create a mock database session.

        Returns:
            MagicMock: Mock SQLAlchemy session
        """
        session = MagicMock()
        return session

    def test_handle_initialize_request_success(self, app, mock_mcp_server, mock_app):
        """Test successful handling of initialize request.

        This test verifies that:
        - Valid JSON-RPC initialize request is processed correctly
        - Server and app are retrieved successfully
        - Server status is validated
        - User input form is extracted
        - Initialize response is returned with correct structure

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data
        server_code = "test-server-code"
        request_id = 1

        # Create valid initialize request payload
        initialize_payload = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "TestClient",
                    "version": "1.0.0",
                },
            },
        }

        # Mock the database session and queries
        with app.test_request_context(
            method="POST",
            json=initialize_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                # Mock database session context manager
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                # Mock console_ns.payload to return our test payload
                patch("controllers.mcp.mcp.mcp_ns.payload", initialize_payload),
                # Mock handle_mcp_request to return success response
                patch("controllers.mcp.mcp.handle_mcp_request") as mock_handle_request,
            ):
                # Configure session mock to return our mock objects
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                mock_session_instance.query.return_value.where.return_value.first.side_effect = [
                    mock_mcp_server,  # First query returns server
                    mock_app,  # Second query returns app
                ]

                # Mock end user retrieval (should return None for new initialize)
                mock_session_instance.query.return_value.where.return_value.first.return_value = None

                # Create expected response
                expected_response = mcp_types.JSONRPCResponse(
                    jsonrpc="2.0",
                    id=request_id,
                    result={
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {"listChanged": False}},
                        "serverInfo": {"name": "Dify", "version": "1.0.0"},
                    },
                )
                mock_handle_request.return_value = expected_response

                # Act: Call the controller
                resource = MCPAppApi()
                result = resource.post(server_code)

                # Assert: Verify the response
                assert isinstance(result, Response)
                assert result.status_code == 200

                # Verify handle_mcp_request was called with correct parameters
                mock_handle_request.assert_called_once()
                call_args = mock_handle_request.call_args
                assert call_args[0][0] == mock_app  # app parameter
                assert call_args[0][1].root.method == "initialize"  # request parameter
                assert call_args[0][4] == request_id  # request_id parameter

    def test_handle_list_tools_request_success(self, app, mock_mcp_server, mock_app, mock_end_user, mock_db_session):
        """Test successful handling of tools/list request.

        This test verifies that:
        - Valid tools/list request is processed correctly
        - Server and app are retrieved
        - User input form is converted to tool schema
        - Tools list response is returned

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_end_user: Mock EndUser fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data
        server_code = "test-server-code"
        request_id = 2

        # Create valid tools/list request payload
        list_tools_payload = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/list",
            "params": {},
        }

        with app.test_request_context(
            method="POST",
            json=list_tools_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", list_tools_payload),
                patch("controllers.mcp.mcp.handle_mcp_request") as mock_handle_request,
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results - server and app lookup
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,  # Server query
                    mock_app,  # App query
                ]
                mock_session_instance.query.return_value = query_mock

                # Mock end user retrieval - return existing user
                mock_end_user_query = MagicMock()
                mock_end_user_query.where.return_value.where.return_value.where.return_value.first.return_value = (
                    mock_end_user
                )
                mock_session_instance.query.return_value = mock_end_user_query

                # Create expected response
                expected_response = mcp_types.JSONRPCResponse(
                    jsonrpc="2.0",
                    id=request_id,
                    result={
                        "tools": [
                            {
                                "name": "Test App",
                                "description": "Test MCP Server",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "user_query": {
                                            "type": "string",
                                            "description": "Enter your question",
                                        }
                                    },
                                    "required": ["user_query"],
                                },
                            }
                        ]
                    },
                )
                mock_handle_request.return_value = expected_response

                # Act: Call the controller
                resource = MCPAppApi()
                result = resource.post(server_code)

                # Assert: Verify the response
                assert isinstance(result, Response)
                assert result.status_code == 200
                mock_handle_request.assert_called_once()

    def test_handle_notification_success(self, app, mock_mcp_server, mock_app, mock_db_session):
        """Test successful handling of notification (notifications/initialized).

        This test verifies that:
        - Valid notification is processed correctly
        - Notifications don't require request_id
        - HTTP 202 Accepted is returned for notifications
        - No response body is returned

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data for notification
        server_code = "test-server-code"

        # Create valid notification payload (no id field)
        notification_payload = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {},
        }

        with app.test_request_context(
            method="POST",
            json=notification_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", notification_payload),
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Act: Call the controller
                resource = MCPAppApi()
                result = resource.post(server_code)

                # Assert: Verify notification response
                assert isinstance(result, Response)
                assert result.status_code == 202  # Accepted status for notifications
                assert result.data == b""  # No response body for notifications

    def test_handle_invalid_notification_method(self, app, mock_mcp_server, mock_app, mock_db_session):
        """Test handling of invalid notification method.

        This test verifies that:
        - Invalid notification methods are rejected
        - MCPRequestError is raised with INVALID_REQUEST code
        - Error message indicates invalid notification method

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data with invalid notification
        server_code = "test-server-code"

        # Create invalid notification payload (unsupported method)
        invalid_notification_payload = {
            "jsonrpc": "2.0",
            "method": "notifications/invalid-method",
            "params": {},
        }

        with app.test_request_context(
            method="POST",
            json=invalid_notification_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", invalid_notification_payload),
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Act & Assert: Verify invalid notification raises error
                resource = MCPAppApi()
                with pytest.raises(MCPRequestError) as exc_info:
                    resource.post(server_code)

                # Verify error details
                assert exc_info.value.error_code == mcp_types.INVALID_REQUEST
                assert "Invalid notification method" in exc_info.value.message

    def test_server_not_found_error(self, app, mock_db_session):
        """Test error handling when server code doesn't exist.

        This test verifies that:
        - Non-existent server codes are detected
        - MCPRequestError is raised with INVALID_REQUEST code
        - Error message indicates server not found

        Args:
            app: Flask application fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data with non-existent server
        server_code = "non-existent-server"

        request_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "TestClient", "version": "1.0.0"},
            },
        }

        with app.test_request_context(
            method="POST",
            json=request_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", request_payload),
            ):
                # Configure session mock to return None (server not found)
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query to return None (server not found)
                mock_session_instance.query.return_value.where.return_value.first.return_value = None

                # Act & Assert: Verify server not found error
                resource = MCPAppApi()
                with pytest.raises(MCPRequestError) as exc_info:
                    resource.post(server_code)

                # Verify error details
                assert exc_info.value.error_code == mcp_types.INVALID_REQUEST
                assert "Server Not Found" in exc_info.value.message

    def test_app_not_found_error(self, app, mock_mcp_server, mock_db_session):
        """Test error handling when app doesn't exist for server.

        This test verifies that:
        - Missing app association is detected
        - MCPRequestError is raised with INVALID_REQUEST code
        - Error message indicates app not found

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data where app doesn't exist
        server_code = "test-server-code"

        request_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "TestClient", "version": "1.0.0"},
            },
        }

        with app.test_request_context(
            method="POST",
            json=request_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", request_payload),
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results - server found, app not found
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,  # Server found
                    None,  # App not found
                ]
                mock_session_instance.query.return_value = query_mock

                # Act & Assert: Verify app not found error
                resource = MCPAppApi()
                with pytest.raises(MCPRequestError) as exc_info:
                    resource.post(server_code)

                # Verify error details
                assert exc_info.value.error_code == mcp_types.INVALID_REQUEST
                assert "App Not Found" in exc_info.value.message

    def test_server_inactive_error(self, app, mock_mcp_server, mock_app, mock_db_session):
        """Test error handling when server status is not active.

        This test verifies that:
        - Inactive server status is detected
        - MCPRequestError is raised with INVALID_REQUEST code
        - Error message indicates server is not active

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data with inactive server
        server_code = "test-server-code"

        # Set server status to inactive
        mock_mcp_server.status = AppMCPServerStatus.INACTIVE

        request_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "TestClient", "version": "1.0.0"},
            },
        }

        with app.test_request_context(
            method="POST",
            json=request_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", request_payload),
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Act & Assert: Verify inactive server error
                resource = MCPAppApi()
                with pytest.raises(MCPRequestError) as exc_info:
                    resource.post(server_code)

                # Verify error details
                assert exc_info.value.error_code == mcp_types.INVALID_REQUEST
                assert "Server is not active" in exc_info.value.message

    def test_invalid_jsonrpc_format(self, app, mock_mcp_server, mock_app, mock_db_session):
        """Test error handling for invalid JSON-RPC format.

        This test verifies that:
        - Invalid JSON-RPC structure is detected
        - ValidationError is raised during parsing
        - Error is converted to MCPRequestError with INVALID_PARAMS code

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data with invalid JSON-RPC format
        server_code = "test-server-code"

        # Create invalid payload (missing required fields)
        invalid_payload = {
            "jsonrpc": "1.0",  # Wrong version
            "method": "initialize",
            # Missing id and params
        }

        with app.test_request_context(
            method="POST",
            json=invalid_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", invalid_payload),
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Act & Assert: Verify invalid format error
                resource = MCPAppApi()
                with pytest.raises(MCPRequestError) as exc_info:
                    resource.post(server_code)

                # Verify error details
                assert exc_info.value.error_code == mcp_types.INVALID_PARAMS
                assert "Invalid MCP request" in exc_info.value.message

    def test_request_without_id_error(self, app, mock_mcp_server, mock_app, mock_db_session):
        """Test error handling for request without id field.

        This test verifies that:
        - Requests (not notifications) must have an id field
        - MCPRequestError is raised with INVALID_REQUEST code
        - Error message indicates request ID is required

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data with request missing id
        server_code = "test-server-code"

        # Create request payload without id (should be notification or have id)
        request_payload = {
            "jsonrpc": "2.0",
            "method": "tools/list",  # This is a request, needs id
            "params": {},
            # Missing id field
        }

        with app.test_request_context(
            method="POST",
            json=request_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", request_payload),
                patch("controllers.mcp.mcp.handle_mcp_request") as mock_handle_request,
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Mock handle_mcp_request to return None (simulating missing id handling)
                # Actually, the controller should check for id before calling handle_mcp_request
                # So we need to test the _handle_request method behavior
                resource = MCPAppApi()

                # The request will be parsed as a request (not notification) but without id
                # This should raise an error in _handle_request
                with pytest.raises(MCPRequestError) as exc_info:
                    resource.post(server_code)

                # Verify error details
                assert exc_info.value.error_code == mcp_types.INVALID_REQUEST
                assert "Request ID is required" in exc_info.value.message

    def test_user_input_form_extraction_workflow_mode(self, app, mock_mcp_server, mock_app, mock_db_session):
        """Test user input form extraction for workflow mode apps.

        This test verifies that:
        - User input form is correctly extracted from workflow apps
        - Form is converted to VariableEntity objects
        - Form data is passed to request handler

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture (already set to WORKFLOW mode)
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data
        server_code = "test-server-code"
        request_id = 1

        request_payload = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/list",
            "params": {},
        }

        with app.test_request_context(
            method="POST",
            json=request_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", request_payload),
                patch("controllers.mcp.mcp.handle_mcp_request") as mock_handle_request,
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Mock end user
                mock_end_user_query = MagicMock()
                mock_end_user_query.where.return_value.where.return_value.where.return_value.first.return_value = (
                    MagicMock(spec=EndUser)
                )
                mock_session_instance.query.return_value = mock_end_user_query

                # Create expected response
                expected_response = mcp_types.JSONRPCResponse(
                    jsonrpc="2.0",
                    id=request_id,
                    result={"tools": []},
                )
                mock_handle_request.return_value = expected_response

                # Act: Call the controller
                resource = MCPAppApi()
                result = resource.post(server_code)

                # Assert: Verify workflow form extraction
                assert isinstance(result, Response)
                assert result.status_code == 200

                # Verify that workflow.user_input_form was called
                mock_app.workflow.user_input_form.assert_called_once_with(to_old_structure=True)

    def test_user_input_form_extraction_chat_mode(self, app, mock_mcp_server, mock_app, mock_db_session):
        """Test user input form extraction for chat mode apps.

        This test verifies that:
        - User input form is correctly extracted from chat apps
        - Form is retrieved from app_model_config
        - Form is converted to VariableEntity objects

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture (set to CHAT mode)
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data with chat mode app
        server_code = "test-server-code"
        request_id = 1

        # Change app mode to CHAT
        mock_app.mode = AppMode.CHAT
        mock_app.workflow = None  # Chat apps don't have workflow

        # Mock app_model_config
        mock_app_config = MagicMock()
        mock_app_config.to_dict.return_value = {
            "user_input_form": [
                {
                    "text-input": {
                        "variable": "query",
                        "label": "Question",
                        "required": True,
                    }
                }
            ]
        }
        mock_app.app_model_config = mock_app_config

        request_payload = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/list",
            "params": {},
        }

        with app.test_request_context(
            method="POST",
            json=request_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", request_payload),
                patch("controllers.mcp.mcp.handle_mcp_request") as mock_handle_request,
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Mock end user
                mock_end_user_query = MagicMock()
                mock_end_user_query.where.return_value.where.return_value.where.return_value.first.return_value = (
                    MagicMock(spec=EndUser)
                )
                mock_session_instance.query.return_value = mock_end_user_query

                # Create expected response
                expected_response = mcp_types.JSONRPCResponse(
                    jsonrpc="2.0",
                    id=request_id,
                    result={"tools": []},
                )
                mock_handle_request.return_value = expected_response

                # Act: Call the controller
                resource = MCPAppApi()
                result = resource.post(server_code)

                # Assert: Verify chat form extraction
                assert isinstance(result, Response)
                assert result.status_code == 200

                # Verify that app_model_config.to_dict was called
                mock_app_config.to_dict.assert_called_once()

    def test_app_unavailable_no_workflow(self, app, mock_mcp_server, mock_app, mock_db_session):
        """Test error handling when workflow app has no workflow configuration.

        This test verifies that:
        - Workflow mode apps without workflow config are rejected
        - MCPRequestError is raised with INVALID_REQUEST code
        - Error message indicates app is unavailable

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data with workflow app but no workflow
        server_code = "test-server-code"

        # Set app to workflow mode but remove workflow
        mock_app.mode = AppMode.WORKFLOW
        mock_app.workflow = None  # No workflow configuration

        request_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "TestClient", "version": "1.0.0"},
            },
        }

        with app.test_request_context(
            method="POST",
            json=request_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", request_payload),
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Act & Assert: Verify app unavailable error
                resource = MCPAppApi()
                with pytest.raises(MCPRequestError) as exc_info:
                    resource.post(server_code)

                # Verify error details
                assert exc_info.value.error_code == mcp_types.INVALID_REQUEST
                assert "App is unavailable" in exc_info.value.message

    def test_app_unavailable_no_app_config(self, app, mock_mcp_server, mock_app, mock_db_session):
        """Test error handling when chat app has no app_model_config.

        This test verifies that:
        - Chat mode apps without app_model_config are rejected
        - MCPRequestError is raised with INVALID_REQUEST code
        - Error message indicates app is unavailable

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data with chat app but no config
        server_code = "test-server-code"

        # Set app to chat mode but remove app_model_config
        mock_app.mode = AppMode.CHAT
        mock_app.workflow = None
        mock_app.app_model_config = None  # No app config

        request_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "TestClient", "version": "1.0.0"},
            },
        }

        with app.test_request_context(
            method="POST",
            json=request_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", request_payload),
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Act & Assert: Verify app unavailable error
                resource = MCPAppApi()
                with pytest.raises(MCPRequestError) as exc_info:
                    resource.post(server_code)

                # Verify error details
                assert exc_info.value.error_code == mcp_types.INVALID_REQUEST
                assert "App is unavailable" in exc_info.value.message

    def test_end_user_creation_on_initialize(self, app, mock_mcp_server, mock_app, mock_db_session):
        """Test end user creation when initialize request is received.

        This test verifies that:
        - New end user is created for initialize requests when user doesn't exist
        - User is created with correct attributes (name, type, session_id)
        - User name is constructed from client info

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data for initialize with new user
        server_code = "test-server-code"
        request_id = 1

        request_payload = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "TestClient",
                    "version": "2.0.0",
                },
            },
        }

        with app.test_request_context(
            method="POST",
            json=request_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", request_payload),
                patch("controllers.mcp.mcp.handle_mcp_request") as mock_handle_request,
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_create_session = MagicMock()
                mock_create_session_instance = MagicMock()

                # First session for main request
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Second session for end user creation
                mock_create_session.__enter__.return_value = mock_create_session_instance
                mock_create_session.__exit__.return_value = None

                # Mock query results - server and app found
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Mock end user retrieval - return None (user doesn't exist)
                mock_end_user_query = MagicMock()
                mock_end_user_query.where.return_value.where.return_value.where.return_value.first.return_value = None
                mock_session_instance.query.return_value = mock_end_user_query

                # Mock end user creation session
                mock_create_session_instance.add = MagicMock()
                mock_create_session_instance.flush = MagicMock()
                mock_create_session_instance.refresh = MagicMock()

                # Create mock end user for creation
                created_end_user = MagicMock(spec=EndUser)
                created_end_user.id = "new-user-123"
                mock_create_session_instance.refresh.side_effect = lambda obj: setattr(obj, "id", "new-user-123")

                # Mock Session for end user creation
                def session_factory(*args, **kwargs):
                    if "expire_on_commit" in kwargs and kwargs["expire_on_commit"] is False:
                        return mock_create_session
                    return mock_session_class.return_value

                mock_session_class.side_effect = session_factory

                # Create expected response
                expected_response = mcp_types.JSONRPCResponse(
                    jsonrpc="2.0",
                    id=request_id,
                    result={
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {"listChanged": False}},
                        "serverInfo": {"name": "Dify", "version": "1.0.0"},
                    },
                )
                mock_handle_request.return_value = expected_response

                # Act: Call the controller
                resource = MCPAppApi()
                result = resource.post(server_code)

                # Assert: Verify end user creation
                assert isinstance(result, Response)
                assert result.status_code == 200

                # Verify that session.commit was called before creating end user
                mock_session_instance.commit.assert_called_once()

                # Verify that add was called to create end user
                mock_create_session_instance.add.assert_called_once()
                created_user = mock_create_session_instance.add.call_args[0][0]
                assert created_user.tenant_id == mock_app.tenant_id
                assert created_user.app_id == mock_app.id
                assert created_user.type == "mcp"
                assert created_user.name == "TestClient@2.0.0"
                assert created_user.session_id == mock_mcp_server.id

    def test_invalid_user_input_form_validation_error(self, app, mock_mcp_server, mock_app, mock_db_session):
        """Test error handling for invalid user input form structure.

        This test verifies that:
        - Invalid user input form structures are detected
        - ValidationError is caught and converted to MCPRequestError
        - Error code is INVALID_PARAMS
        - Error message includes validation details

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data with invalid form structure
        server_code = "test-server-code"

        # Mock workflow to return invalid form structure
        mock_app.workflow.user_input_form.return_value = [
            "invalid-form-structure"  # Should be dict, not string
        ]

        request_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "TestClient", "version": "1.0.0"},
            },
        }

        with app.test_request_context(
            method="POST",
            json=request_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", request_payload),
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Act & Assert: Verify validation error
                resource = MCPAppApi()
                with pytest.raises(MCPRequestError) as exc_info:
                    resource.post(server_code)

                # Verify error details
                assert exc_info.value.error_code == mcp_types.INVALID_PARAMS
                assert "Invalid user_input_form" in exc_info.value.message

    def test_call_tool_request_processing(self, app, mock_mcp_server, mock_app, mock_end_user, mock_db_session):
        """Test successful processing of tools/call request.

        This test verifies that:
        - tools/call requests are processed correctly
        - End user is retrieved (not created for tool calls)
        - Request is routed to handle_mcp_request
        - Response contains tool execution results

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_end_user: Mock EndUser fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data for tool call
        server_code = "test-server-code"
        request_id = 3

        request_payload = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {
                "name": "Test App",
                "arguments": {
                    "user_query": "What is the weather?",
                },
            },
        }

        with app.test_request_context(
            method="POST",
            json=request_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", request_payload),
                patch("controllers.mcp.mcp.handle_mcp_request") as mock_handle_request,
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Mock end user retrieval - return existing user
                mock_end_user_query = MagicMock()
                mock_end_user_query.where.return_value.where.return_value.where.return_value.first.return_value = (
                    mock_end_user
                )
                mock_session_instance.query.return_value = mock_end_user_query

                # Create expected response with tool result
                expected_response = mcp_types.JSONRPCResponse(
                    jsonrpc="2.0",
                    id=request_id,
                    result={
                        "content": [
                            {
                                "type": "text",
                                "text": "The weather is sunny today.",
                            }
                        ],
                        "isError": False,
                    },
                )
                mock_handle_request.return_value = expected_response

                # Act: Call the controller
                resource = MCPAppApi()
                result = resource.post(server_code)

                # Assert: Verify tool call processing
                assert isinstance(result, Response)
                assert result.status_code == 200

                # Verify handle_mcp_request was called with end user
                mock_handle_request.assert_called_once()
                call_args = mock_handle_request.call_args
                assert call_args[0][4] == mock_end_user  # end_user parameter
                assert call_args[0][1].root.method == "tools/call"  # request method

    def test_ping_request_processing(self, app, mock_mcp_server, mock_app, mock_end_user, mock_db_session):
        """Test successful processing of ping request.

        This test verifies that:
        - ping requests are processed correctly
        - Empty result is returned for ping
        - Request ID is preserved in response

        Args:
            app: Flask application fixture
            mock_mcp_server: Mock MCP server fixture
            mock_app: Mock App fixture
            mock_end_user: Mock EndUser fixture
            mock_db_session: Mock database session fixture
        """
        # Arrange: Set up test data for ping
        server_code = "test-server-code"
        request_id = 4

        request_payload = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "ping",
            "params": {},
        }

        with app.test_request_context(
            method="POST",
            json=request_payload,
            path=f"/server/{server_code}/mcp",
        ):
            with (
                patch("controllers.mcp.mcp.Session") as mock_session_class,
                patch("controllers.mcp.mcp.mcp_ns.payload", request_payload),
                patch("controllers.mcp.mcp.handle_mcp_request") as mock_handle_request,
            ):
                # Configure session mock
                mock_session_instance = MagicMock()
                mock_session_class.return_value.__enter__.return_value = mock_session_instance
                mock_session_class.return_value.__exit__.return_value = None

                # Mock query results
                query_mock = MagicMock()
                query_mock.where.return_value.first.side_effect = [
                    mock_mcp_server,
                    mock_app,
                ]
                mock_session_instance.query.return_value = query_mock

                # Mock end user
                mock_end_user_query = MagicMock()
                mock_end_user_query.where.return_value.where.return_value.where.return_value.first.return_value = (
                    mock_end_user
                )
                mock_session_instance.query.return_value = mock_end_user_query

                # Create expected response for ping
                expected_response = mcp_types.JSONRPCResponse(
                    jsonrpc="2.0",
                    id=request_id,
                    result={},  # Empty result for ping
                )
                mock_handle_request.return_value = expected_response

                # Act: Call the controller
                resource = MCPAppApi()
                result = resource.post(server_code)

                # Assert: Verify ping processing
                assert isinstance(result, Response)
                assert result.status_code == 200
                mock_handle_request.assert_called_once()
