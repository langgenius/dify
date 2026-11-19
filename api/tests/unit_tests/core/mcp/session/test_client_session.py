import queue
import threading
from typing import Any
from unittest.mock import MagicMock

import pytest
from pydantic import AnyUrl

from core.mcp import types
from core.mcp.entities import RequestContext
from core.mcp.session.base_session import RequestResponder
from core.mcp.session.base_session import SessionMessage as _client_session_SessionMessage
from core.mcp.session.client_session import (
    DEFAULT_CLIENT_INFO,
    ClientSession,
    _default_list_roots_callback,
    _default_logging_callback,
    _default_message_handler,
    _default_sampling_callback,
)
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
)
from core.mcp.types import (
    SessionMessage as _session_SessionMessage,
)


class TestSessionCases:
    @staticmethod
    def test_client_session_initialize() -> None:
        # Create synchronous queues to replace async streams
        client_to_server: queue.Queue[_session_SessionMessage] = queue.Queue()
        server_to_client: queue.Queue[_session_SessionMessage] = queue.Queue()

        initialized_notification = None

        def mock_server() -> None:
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
                _session_SessionMessage(
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

    @staticmethod
    def test_client_session_custom_client_info() -> None:
        # Create synchronous queues to replace async streams
        client_to_server: queue.Queue[_session_SessionMessage] = queue.Queue()
        server_to_client: queue.Queue[_session_SessionMessage] = queue.Queue()

        custom_client_info = Implementation(name="test-client", version="1.2.3")
        received_client_info = None

        def mock_server() -> None:
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
                _session_SessionMessage(
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

    @staticmethod
    def test_client_session_default_client_info() -> None:
        # Create synchronous queues to replace async streams
        client_to_server: queue.Queue[_session_SessionMessage] = queue.Queue()
        server_to_client: queue.Queue[_session_SessionMessage] = queue.Queue()

        received_client_info = None

        def mock_server() -> None:
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
                _session_SessionMessage(
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

    @staticmethod
    def test_client_session_version_negotiation_success() -> None:
        # Create synchronous queues to replace async streams
        client_to_server: queue.Queue[_session_SessionMessage] = queue.Queue()
        server_to_client: queue.Queue[_session_SessionMessage] = queue.Queue()

        def mock_server() -> None:
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
                _session_SessionMessage(
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

    @staticmethod
    def test_client_session_version_negotiation_failure() -> None:
        # Create synchronous queues to replace async streams
        client_to_server: queue.Queue[_session_SessionMessage] = queue.Queue()
        server_to_client: queue.Queue[_session_SessionMessage] = queue.Queue()

        def mock_server() -> None:
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
                _session_SessionMessage(
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

    @staticmethod
    def test_client_capabilities_default() -> None:
        # Create synchronous queues to replace async streams
        client_to_server: queue.Queue[_session_SessionMessage] = queue.Queue()
        server_to_client: queue.Queue[_session_SessionMessage] = queue.Queue()

        received_capabilities = None

        def mock_server() -> None:
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
                _session_SessionMessage(
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

    @staticmethod
    def test_client_capabilities_with_custom_callbacks() -> None:
        # Create synchronous queues to replace async streams
        client_to_server: queue.Queue[_session_SessionMessage] = queue.Queue()
        server_to_client: queue.Queue[_session_SessionMessage] = queue.Queue()

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

        def mock_server() -> None:
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
                _session_SessionMessage(
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

    # Should just pass (case _:)


class TestClientSessionCases:
    @staticmethod
    @pytest.fixture
    def streams():
        return queue.Queue(), queue.Queue()

    @staticmethod
    def test_client_session_init(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        assert session._client_info.name == "Dify"
        assert session._sampling_callback == _default_sampling_callback
        assert session._list_roots_callback == _default_list_roots_callback
        assert session._logging_callback == _default_logging_callback
        assert session._message_handler == _default_message_handler

    @staticmethod
    def test_client_session_init_custom(streams):
        read_stream, write_stream = streams
        sampling_cb = MagicMock()
        list_roots_cb = MagicMock()
        logging_cb = MagicMock()
        msg_handler = MagicMock()
        client_info = types.Implementation(name="Custom", version="1.0")

        session = ClientSession(
            read_stream,
            write_stream,
            sampling_callback=sampling_cb,
            list_roots_callback=list_roots_cb,
            logging_callback=logging_cb,
            message_handler=msg_handler,
            client_info=client_info,
        )

        assert session._client_info == client_info
        assert session._sampling_callback == sampling_cb
        assert session._list_roots_callback == list_roots_cb
        assert session._logging_callback == logging_cb
        assert session._message_handler == msg_handler

    @staticmethod
    def test_initialize_success(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        expected_result = types.InitializeResult(
            protocolVersion=types.LATEST_PROTOCOL_VERSION,
            capabilities=types.ServerCapabilities(),
            serverInfo=types.Implementation(name="test-server", version="1.0"),
        )

        def mock_server():
            # Handle initialize request
            msg = write_stream.get(timeout=2)
            req_id = msg.message.root.id

            resp = types.JSONRPCResponse(jsonrpc="2.0", id=req_id, result=expected_result.model_dump())
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

            # Expect initialized notification
            notif = write_stream.get(timeout=2)
            assert notif.message.root.method == "notifications/initialized"

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            result = session.initialize()
            assert result.protocolVersion == types.LATEST_PROTOCOL_VERSION
            assert result.serverInfo.name == "test-server"

        t.join(timeout=1)

    @staticmethod
    def test_initialize_custom_capabilities(streams):
        read_stream, write_stream = streams
        session = ClientSession(
            read_stream, write_stream, sampling_callback=lambda c, p: None, list_roots_callback=lambda c: None
        )

        def mock_server():
            msg = write_stream.get(timeout=2)
            params = msg.message.root.params
            # Check that capabilities are set because we provided custom callbacks
            assert params["capabilities"]["sampling"] is not None
            assert params["capabilities"]["roots"]["listChanged"] is True

            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(
                jsonrpc="2.0",
                id=req_id,
                result={
                    "protocolVersion": types.LATEST_PROTOCOL_VERSION,
                    "capabilities": {},
                    "serverInfo": {"name": "test", "version": "1.0"},
                },
            )
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))
            write_stream.get(timeout=2)  # initialized notif

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            session.initialize()
        t.join(timeout=1)

    @staticmethod
    def test_initialize_unsupported_version(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        def mock_server():
            msg = write_stream.get(timeout=2)
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(
                jsonrpc="2.0",
                id=req_id,
                result={
                    "protocolVersion": "0.0.1",  # Unsupported
                    "capabilities": {},
                    "serverInfo": {"name": "test", "version": "1.0"},
                },
            )
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            with pytest.raises(RuntimeError, match="Unsupported protocol version"):
                session.initialize()
        t.join(timeout=1)

    @staticmethod
    def test_send_ping(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        def mock_server():
            msg = write_stream.get(timeout=2)
            assert msg.message.root.method == "ping"
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(jsonrpc="2.0", id=req_id, result={})
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            session.send_ping()
        t.join(timeout=1)

    @staticmethod
    def test_send_progress_notification(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        session.send_progress_notification(progress_token="token", progress=50.0, total=100.0)

        msg = write_stream.get_nowait()
        assert msg.message.root.method == "notifications/progress"
        assert msg.message.root.params["progressToken"] == "token"
        assert msg.message.root.params["progress"] == 50.0
        assert msg.message.root.params["total"] == 100.0

    @staticmethod
    def test_set_logging_level(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        def mock_server():
            msg = write_stream.get(timeout=2)
            assert msg.message.root.method == "logging/setLevel"
            assert msg.message.root.params["level"] == "debug"
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(jsonrpc="2.0", id=req_id, result={})
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            session.set_logging_level("debug")
        t.join(timeout=1)

    @staticmethod
    def test_list_resources(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        def mock_server():
            msg = write_stream.get(timeout=2)
            assert msg.message.root.method == "resources/list"
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(jsonrpc="2.0", id=req_id, result={"resources": []})
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            result = session.list_resources()
            assert result.resources == []
        t.join(timeout=1)

    @staticmethod
    def test_list_resource_templates(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        def mock_server():
            msg = write_stream.get(timeout=2)
            assert msg.message.root.method == "resources/templates/list"
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(jsonrpc="2.0", id=req_id, result={"resourceTemplates": []})
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            result = session.list_resource_templates()
            assert result.resourceTemplates == []
        t.join(timeout=1)

    @staticmethod
    def test_read_resource(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)
        uri = AnyUrl("file:///test")

        def mock_server():
            msg = write_stream.get(timeout=2)
            assert msg.message.root.method == "resources/read"
            assert msg.message.root.params["uri"] == str(uri)
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(jsonrpc="2.0", id=req_id, result={"contents": []})
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            result = session.read_resource(uri)
            assert result.contents == []
        t.join(timeout=1)

    @staticmethod
    def test_subscribe_resource(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)
        uri = AnyUrl("file:///test")

        def mock_server():
            msg = write_stream.get(timeout=2)
            assert msg.message.root.method == "resources/subscribe"
            assert msg.message.root.params["uri"] == str(uri)
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(jsonrpc="2.0", id=req_id, result={})
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            session.subscribe_resource(uri)
        t.join(timeout=1)

    @staticmethod
    def test_unsubscribe_resource(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)
        uri = AnyUrl("file:///test")

        def mock_server():
            msg = write_stream.get(timeout=2)
            assert msg.message.root.method == "resources/unsubscribe"
            assert msg.message.root.params["uri"] == str(uri)
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(jsonrpc="2.0", id=req_id, result={})
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            session.unsubscribe_resource(uri)
        t.join(timeout=1)

    @staticmethod
    def test_call_tool(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        def mock_server():
            msg = write_stream.get(timeout=2)
            assert msg.message.root.method == "tools/call"
            assert msg.message.root.params["name"] == "test-tool"
            assert msg.message.root.params["arguments"] == {"arg": 1}
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(jsonrpc="2.0", id=req_id, result={"content": [], "isError": False})
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            result = session.call_tool("test-tool", arguments={"arg": 1})
            assert result.isError is False
        t.join(timeout=1)

    @staticmethod
    def test_list_prompts(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        def mock_server():
            msg = write_stream.get(timeout=2)
            assert msg.message.root.method == "prompts/list"
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(jsonrpc="2.0", id=req_id, result={"prompts": []})
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            result = session.list_prompts()
            assert result.prompts == []
        t.join(timeout=1)

    @staticmethod
    def test_get_prompt(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        def mock_server():
            msg = write_stream.get(timeout=2)
            assert msg.message.root.method == "prompts/get"
            assert msg.message.root.params["name"] == "test-prompt"
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(jsonrpc="2.0", id=req_id, result={"messages": []})
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            result = session.get_prompt("test-prompt")
            assert result.messages == []
        t.join(timeout=1)

    @staticmethod
    def test_complete(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)
        ref = types.PromptReference(type="ref/prompt", name="test")

        def mock_server():
            msg = write_stream.get(timeout=2)
            assert msg.message.root.method == "completion/complete"
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(
                jsonrpc="2.0", id=req_id, result={"completion": {"values": [], "hasMore": False}}
            )
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            result = session.complete(ref, argument={"name": "val", "value": "x"})
            assert result.completion.hasMore is False
        t.join(timeout=1)

    @staticmethod
    def test_list_tools(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        def mock_server():
            msg = write_stream.get(timeout=2)
            assert msg.message.root.method == "tools/list"
            req_id = msg.message.root.id
            resp = types.JSONRPCResponse(jsonrpc="2.0", id=req_id, result={"tools": []})
            read_stream.put(_client_session_SessionMessage(message=types.JSONRPCMessage(resp)))

        import threading

        t = threading.Thread(target=mock_server, daemon=True)
        t.start()

        with session:
            result = session.list_tools()
            assert result.tools == []
        t.join(timeout=1)

    @staticmethod
    def test_send_roots_list_changed(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        session.send_roots_list_changed()

        msg = write_stream.get_nowait()
        assert msg.message.root.method == "notifications/roots/list_changed"

    @staticmethod
    def test_received_request_sampling(streams):
        read_stream, write_stream = streams
        sampling_cb = MagicMock(
            return_value=types.CreateMessageResult(
                role="assistant", content=types.TextContent(type="text", text="hello"), model="gpt-4"
            )
        )
        session = ClientSession(read_stream, write_stream, sampling_callback=sampling_cb)

        req = types.ServerRequest(
            root=types.CreateMessageRequest(
                method="sampling/createMessage", params=types.CreateMessageRequestParams(messages=[], maxTokens=100)
            )
        )

        responder = RequestResponder(
            request_id=1, request_meta=None, request=req, session=session, on_complete=MagicMock()
        )

        session._received_request(responder)

        msg = write_stream.get_nowait()
        assert msg.message.root.result["model"] == "gpt-4"
        sampling_cb.assert_called_once()

    @staticmethod
    def test_received_request_list_roots(streams):
        read_stream, write_stream = streams
        list_roots_cb = MagicMock(return_value=types.ListRootsResult(roots=[]))
        session = ClientSession(read_stream, write_stream, list_roots_callback=list_roots_cb)

        req = types.ServerRequest(root=types.ListRootsRequest(method="roots/list"))

        responder = RequestResponder(
            request_id=1, request_meta=None, request=req, session=session, on_complete=MagicMock()
        )

        session._received_request(responder)

        msg = write_stream.get_nowait()
        assert msg.message.root.result["roots"] == []
        list_roots_cb.assert_called_once()

    @staticmethod
    def test_received_request_ping(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        req = types.ServerRequest(root=types.PingRequest(method="ping"))

        responder = RequestResponder(
            request_id=1, request_meta=None, request=req, session=session, on_complete=MagicMock()
        )

        session._received_request(responder)

        msg = write_stream.get_nowait()
        assert msg.message.root.result == {}

    @staticmethod
    def test_handle_incoming(streams):
        read_stream, write_stream = streams
        msg_handler = MagicMock()
        session = ClientSession(read_stream, write_stream, message_handler=msg_handler)

        item = MagicMock()
        session._handle_incoming(item)
        msg_handler.assert_called_once_with(item)

    @staticmethod
    def test_received_notification_logging(streams):
        read_stream, write_stream = streams
        logging_cb = MagicMock()
        session = ClientSession(read_stream, write_stream, logging_callback=logging_cb)

        notif = types.ServerNotification(
            root=types.LoggingMessageNotification(
                method="notifications/message",
                params=types.LoggingMessageNotificationParams(level="info", data={"msg": "test"}),
            )
        )

        session._received_notification(notif)
        logging_cb.assert_called_once()
        assert logging_cb.call_args[0][0].level == "info"

    @staticmethod
    def test_default_message_handler(streams):
        # Exception case
        with pytest.raises(ValueError, match="test error"):
            _default_message_handler(Exception("test error"))

        # Notification case - should do nothing
        _default_message_handler(types.ServerNotification(root=types.ToolListChangedNotification()))

        # RequestResponder case - should do nothing
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)
        with RequestResponder(
            request_id=1,
            request_meta=None,
            request=types.ServerRequest(root=types.PingRequest()),
            session=session,
            on_complete=lambda _responder: None,
        ) as responder:
            _default_message_handler(responder)
            assert not responder.completed

    @staticmethod
    def test_default_sampling_callback():
        ctx = MagicMock()
        params = MagicMock()
        res = _default_sampling_callback(ctx, params)
        assert res.code == types.INVALID_REQUEST
        assert "not supported" in res.message

    @staticmethod
    def test_default_list_roots_callback():
        ctx = MagicMock()
        res = _default_list_roots_callback(ctx)
        assert res.code == types.INVALID_REQUEST
        assert "not supported" in res.message

    @staticmethod
    def test_default_logging_callback():
        params = MagicMock()
        _default_logging_callback(params)  # Should do nothing

    @staticmethod
    def test_received_notification_unknown(streams):
        read_stream, write_stream = streams
        session = ClientSession(read_stream, write_stream)

        # Use a notification type that is NOT LoggingMessageNotification
        notif = types.ServerNotification(
            root=types.ResourceListChangedNotification(method="notifications/resources/list_changed")
        )

        session._received_notification(notif)
