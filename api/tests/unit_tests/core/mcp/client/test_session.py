import queue
import threading
from typing import Any

from core.mcp import types
from core.mcp.entities import RequestContext
from core.mcp.session.base_session import RequestResponder
from core.mcp.session.client_session import DEFAULT_CLIENT_INFO, ClientSession
from core.mcp.types import (
    LATEST_PROTOCOL_VERSION,
    ClientNotification,
    ClientRequest,
    Implementation,
    InitializedNotification,
    InitializeRequest,
    InitializeResult,
    JSONRPCMessage,
    JSONRPCNotification,
    JSONRPCRequest,
    JSONRPCResponse,
    ServerCapabilities,
    ServerResult,
    SessionMessage,
)


def test_client_session_initialize():
    # Create synchronous queues to replace async streams
    client_to_server: queue.Queue[SessionMessage] = queue.Queue()
    server_to_client: queue.Queue[SessionMessage] = queue.Queue()

    initialized_notification = None

    def mock_server():
        nonlocal initialized_notification

        # Receive initialization request
        session_message = client_to_server.get(timeout=5.0)
        jsonrpc_request = session_message.message
        assert isinstance(jsonrpc_request.root, JSONRPCRequest)
        request = ClientRequest.model_validate(
            jsonrpc_request.root.model_dump(by_alias=True, mode="json", exclude_none=True)
        )
        assert isinstance(request.root, InitializeRequest)

        # Create response
        result = ServerResult(
            InitializeResult(
                protocolVersion=LATEST_PROTOCOL_VERSION,
                capabilities=ServerCapabilities(
                    logging=None,
                    resources=None,
                    tools=None,
                    experimental=None,
                    prompts=None,
                ),
                serverInfo=Implementation(name="mock-server", version="0.1.0"),
                instructions="The server instructions.",
            )
        )

        # Send response
        server_to_client.put(
            SessionMessage(
                message=JSONRPCMessage(
                    JSONRPCResponse(
                        jsonrpc="2.0",
                        id=jsonrpc_request.root.id,
                        result=result.model_dump(by_alias=True, mode="json", exclude_none=True),
                    )
                )
            )
        )

        # Receive initialized notification
        session_notification = client_to_server.get(timeout=5.0)
        jsonrpc_notification = session_notification.message
        assert isinstance(jsonrpc_notification.root, JSONRPCNotification)
        initialized_notification = ClientNotification.model_validate(
            jsonrpc_notification.root.model_dump(by_alias=True, mode="json", exclude_none=True)
        )

    # Create message handler
    def message_handler(
        message: RequestResponder[types.ServerRequest, types.ClientResult] | types.ServerNotification | Exception,
    ) -> None:
        if isinstance(message, Exception):
            raise message

    # Start mock server thread
    server_thread = threading.Thread(target=mock_server, daemon=True)
    server_thread.start()

    # Create and use client session
    with ClientSession(
        server_to_client,
        client_to_server,
        message_handler=message_handler,
    ) as session:
        result = session.initialize()

    # Wait for server thread to complete
    server_thread.join(timeout=10.0)

    # Assert results
    assert isinstance(result, InitializeResult)
    assert result.protocolVersion == LATEST_PROTOCOL_VERSION
    assert isinstance(result.capabilities, ServerCapabilities)
    assert result.serverInfo == Implementation(name="mock-server", version="0.1.0")
    assert result.instructions == "The server instructions."

    # Check that client sent initialized notification
    assert initialized_notification
    assert isinstance(initialized_notification.root, InitializedNotification)


def test_client_session_custom_client_info():
    # Create synchronous queues to replace async streams
    client_to_server: queue.Queue[SessionMessage] = queue.Queue()
    server_to_client: queue.Queue[SessionMessage] = queue.Queue()

    custom_client_info = Implementation(name="test-client", version="1.2.3")
    received_client_info = None

    def mock_server():
        nonlocal received_client_info

        session_message = client_to_server.get(timeout=5.0)
        jsonrpc_request = session_message.message
        assert isinstance(jsonrpc_request.root, JSONRPCRequest)
        request = ClientRequest.model_validate(
            jsonrpc_request.root.model_dump(by_alias=True, mode="json", exclude_none=True)
        )
        assert isinstance(request.root, InitializeRequest)
        received_client_info = request.root.params.clientInfo

        result = ServerResult(
            InitializeResult(
                protocolVersion=LATEST_PROTOCOL_VERSION,
                capabilities=ServerCapabilities(),
                serverInfo=Implementation(name="mock-server", version="0.1.0"),
            )
        )

        server_to_client.put(
            SessionMessage(
                message=JSONRPCMessage(
                    JSONRPCResponse(
                        jsonrpc="2.0",
                        id=jsonrpc_request.root.id,
                        result=result.model_dump(by_alias=True, mode="json", exclude_none=True),
                    )
                )
            )
        )
        # Receive initialized notification
        client_to_server.get(timeout=5.0)

    # Start mock server thread
    server_thread = threading.Thread(target=mock_server, daemon=True)
    server_thread.start()

    with ClientSession(
        server_to_client,
        client_to_server,
        client_info=custom_client_info,
    ) as session:
        session.initialize()

    # Wait for server thread to complete
    server_thread.join(timeout=10.0)

    # Assert that custom client info was sent
    assert received_client_info == custom_client_info


def test_client_session_default_client_info():
    # Create synchronous queues to replace async streams
    client_to_server: queue.Queue[SessionMessage] = queue.Queue()
    server_to_client: queue.Queue[SessionMessage] = queue.Queue()

    received_client_info = None

    def mock_server():
        nonlocal received_client_info

        session_message = client_to_server.get(timeout=5.0)
        jsonrpc_request = session_message.message
        assert isinstance(jsonrpc_request.root, JSONRPCRequest)
        request = ClientRequest.model_validate(
            jsonrpc_request.root.model_dump(by_alias=True, mode="json", exclude_none=True)
        )
        assert isinstance(request.root, InitializeRequest)
        received_client_info = request.root.params.clientInfo

        result = ServerResult(
            InitializeResult(
                protocolVersion=LATEST_PROTOCOL_VERSION,
                capabilities=ServerCapabilities(),
                serverInfo=Implementation(name="mock-server", version="0.1.0"),
            )
        )

        server_to_client.put(
            SessionMessage(
                message=JSONRPCMessage(
                    JSONRPCResponse(
                        jsonrpc="2.0",
                        id=jsonrpc_request.root.id,
                        result=result.model_dump(by_alias=True, mode="json", exclude_none=True),
                    )
                )
            )
        )
        # Receive initialized notification
        client_to_server.get(timeout=5.0)

    # Start mock server thread
    server_thread = threading.Thread(target=mock_server, daemon=True)
    server_thread.start()

    with ClientSession(
        server_to_client,
        client_to_server,
    ) as session:
        session.initialize()

    # Wait for server thread to complete
    server_thread.join(timeout=10.0)

    # Assert that default client info was used
    assert received_client_info == DEFAULT_CLIENT_INFO


def test_client_session_version_negotiation_success():
    # Create synchronous queues to replace async streams
    client_to_server: queue.Queue[SessionMessage] = queue.Queue()
    server_to_client: queue.Queue[SessionMessage] = queue.Queue()

    def mock_server():
        session_message = client_to_server.get(timeout=5.0)
        jsonrpc_request = session_message.message
        assert isinstance(jsonrpc_request.root, JSONRPCRequest)
        request = ClientRequest.model_validate(
            jsonrpc_request.root.model_dump(by_alias=True, mode="json", exclude_none=True)
        )
        assert isinstance(request.root, InitializeRequest)

        # Send supported protocol version
        result = ServerResult(
            InitializeResult(
                protocolVersion=LATEST_PROTOCOL_VERSION,
                capabilities=ServerCapabilities(),
                serverInfo=Implementation(name="mock-server", version="0.1.0"),
            )
        )

        server_to_client.put(
            SessionMessage(
                message=JSONRPCMessage(
                    JSONRPCResponse(
                        jsonrpc="2.0",
                        id=jsonrpc_request.root.id,
                        result=result.model_dump(by_alias=True, mode="json", exclude_none=True),
                    )
                )
            )
        )
        # Receive initialized notification
        client_to_server.get(timeout=5.0)

    # Start mock server thread
    server_thread = threading.Thread(target=mock_server, daemon=True)
    server_thread.start()

    with ClientSession(
        server_to_client,
        client_to_server,
    ) as session:
        result = session.initialize()

    # Wait for server thread to complete
    server_thread.join(timeout=10.0)

    # Should successfully initialize
    assert isinstance(result, InitializeResult)
    assert result.protocolVersion == LATEST_PROTOCOL_VERSION


def test_client_session_version_negotiation_failure():
    # Create synchronous queues to replace async streams
    client_to_server: queue.Queue[SessionMessage] = queue.Queue()
    server_to_client: queue.Queue[SessionMessage] = queue.Queue()

    def mock_server():
        session_message = client_to_server.get(timeout=5.0)
        jsonrpc_request = session_message.message
        assert isinstance(jsonrpc_request.root, JSONRPCRequest)
        request = ClientRequest.model_validate(
            jsonrpc_request.root.model_dump(by_alias=True, mode="json", exclude_none=True)
        )
        assert isinstance(request.root, InitializeRequest)

        # Send unsupported protocol version
        result = ServerResult(
            InitializeResult(
                protocolVersion="99.99.99",  # Unsupported version
                capabilities=ServerCapabilities(),
                serverInfo=Implementation(name="mock-server", version="0.1.0"),
            )
        )

        server_to_client.put(
            SessionMessage(
                message=JSONRPCMessage(
                    JSONRPCResponse(
                        jsonrpc="2.0",
                        id=jsonrpc_request.root.id,
                        result=result.model_dump(by_alias=True, mode="json", exclude_none=True),
                    )
                )
            )
        )

    # Start mock server thread
    server_thread = threading.Thread(target=mock_server, daemon=True)
    server_thread.start()

    with ClientSession(
        server_to_client,
        client_to_server,
    ) as session:
        import pytest

        with pytest.raises(RuntimeError, match="Unsupported protocol version"):
            session.initialize()

    # Wait for server thread to complete
    server_thread.join(timeout=10.0)


def test_client_capabilities_default():
    # Create synchronous queues to replace async streams
    client_to_server: queue.Queue[SessionMessage] = queue.Queue()
    server_to_client: queue.Queue[SessionMessage] = queue.Queue()

    received_capabilities = None

    def mock_server():
        nonlocal received_capabilities

        session_message = client_to_server.get(timeout=5.0)
        jsonrpc_request = session_message.message
        assert isinstance(jsonrpc_request.root, JSONRPCRequest)
        request = ClientRequest.model_validate(
            jsonrpc_request.root.model_dump(by_alias=True, mode="json", exclude_none=True)
        )
        assert isinstance(request.root, InitializeRequest)
        received_capabilities = request.root.params.capabilities

        result = ServerResult(
            InitializeResult(
                protocolVersion=LATEST_PROTOCOL_VERSION,
                capabilities=ServerCapabilities(),
                serverInfo=Implementation(name="mock-server", version="0.1.0"),
            )
        )

        server_to_client.put(
            SessionMessage(
                message=JSONRPCMessage(
                    JSONRPCResponse(
                        jsonrpc="2.0",
                        id=jsonrpc_request.root.id,
                        result=result.model_dump(by_alias=True, mode="json", exclude_none=True),
                    )
                )
            )
        )
        # Receive initialized notification
        client_to_server.get(timeout=5.0)

    # Start mock server thread
    server_thread = threading.Thread(target=mock_server, daemon=True)
    server_thread.start()

    with ClientSession(
        server_to_client,
        client_to_server,
    ) as session:
        session.initialize()

    # Wait for server thread to complete
    server_thread.join(timeout=10.0)

    # Assert default capabilities
    assert received_capabilities is not None
    assert received_capabilities.sampling is not None
    assert received_capabilities.roots is not None
    assert received_capabilities.roots.listChanged is True


def test_client_capabilities_with_custom_callbacks():
    # Create synchronous queues to replace async streams
    client_to_server: queue.Queue[SessionMessage] = queue.Queue()
    server_to_client: queue.Queue[SessionMessage] = queue.Queue()

    def custom_sampling_callback(
        context: RequestContext["ClientSession", Any],
        params: types.CreateMessageRequestParams,
    ) -> types.CreateMessageResult | types.ErrorData:
        return types.CreateMessageResult(
            model="test-model",
            role="assistant",
            content=types.TextContent(type="text", text="Custom response"),
        )

    def custom_list_roots_callback(
        context: RequestContext["ClientSession", Any],
    ) -> types.ListRootsResult | types.ErrorData:
        return types.ListRootsResult(roots=[])

    def mock_server():
        session_message = client_to_server.get(timeout=5.0)
        jsonrpc_request = session_message.message
        assert isinstance(jsonrpc_request.root, JSONRPCRequest)
        request = ClientRequest.model_validate(
            jsonrpc_request.root.model_dump(by_alias=True, mode="json", exclude_none=True)
        )
        assert isinstance(request.root, InitializeRequest)

        result = ServerResult(
            InitializeResult(
                protocolVersion=LATEST_PROTOCOL_VERSION,
                capabilities=ServerCapabilities(),
                serverInfo=Implementation(name="mock-server", version="0.1.0"),
            )
        )

        server_to_client.put(
            SessionMessage(
                message=JSONRPCMessage(
                    JSONRPCResponse(
                        jsonrpc="2.0",
                        id=jsonrpc_request.root.id,
                        result=result.model_dump(by_alias=True, mode="json", exclude_none=True),
                    )
                )
            )
        )
        # Receive initialized notification
        client_to_server.get(timeout=5.0)

    # Start mock server thread
    server_thread = threading.Thread(target=mock_server, daemon=True)
    server_thread.start()

    with ClientSession(
        server_to_client,
        client_to_server,
        sampling_callback=custom_sampling_callback,
        list_roots_callback=custom_list_roots_callback,
    ) as session:
        result = session.initialize()

    # Wait for server thread to complete
    server_thread.join(timeout=10.0)

    # Verify initialization succeeded
    assert isinstance(result, InitializeResult)
    assert result.protocolVersion == LATEST_PROTOCOL_VERSION
