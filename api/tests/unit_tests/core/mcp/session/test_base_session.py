import queue
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import timedelta
from typing import Union
from unittest.mock import MagicMock, patch

import pytest
from httpx import HTTPStatusError, Request, Response
from pydantic import BaseModel, ConfigDict, RootModel

from core.mcp.error import MCPAuthError, MCPConnectionError
from core.mcp.session.base_session import BaseSession, RequestResponder
from core.mcp.types import (
    CancelledNotification,
    ClientNotification,
    ClientRequest,
    ErrorData,
    JSONRPCError,
    JSONRPCMessage,
    JSONRPCNotification,
    JSONRPCResponse,
    Notification,
    RequestParams,
    SessionMessage,
)
from core.mcp.types import (
    Request as MCPRequest,
)


class MockRequestParams(RequestParams):
    name: str = "default"
    model_config = ConfigDict(extra="allow")


class MockRequest(MCPRequest[MockRequestParams, str]):
    method: str = "test/request"
    params: MockRequestParams = MockRequestParams()


class MockResult(BaseModel):
    result: str


class MockNotificationParams(BaseModel):
    message: str


class MockNotification(Notification[MockNotificationParams, str]):
    method: str = "test/notification"
    params: MockNotificationParams


class ReceiveRequest(RootModel[Union[MockRequest, ClientRequest]]):
    pass


class ReceiveNotification(RootModel[Union[CancelledNotification, MockNotification, JSONRPCNotification]]):
    pass


class MockSession(BaseSession[MockRequest, MockNotification, MockResult, ReceiveRequest, ReceiveNotification]):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.received_requests = []
        self.received_notifications = []
        self.handled_incoming = []

    def _received_request(self, responder):
        self.received_requests.append(responder)

    def _received_notification(self, notification):
        self.received_notifications.append(notification)

    def _handle_incoming(self, item):
        self.handled_incoming.append(item)


@pytest.fixture
def streams():
    return queue.Queue(), queue.Queue()


@pytest.mark.timeout(5)
def test_request_responder_respond(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)
    on_complete = MagicMock()
    request = ReceiveRequest(MockRequest(method="test", params=MockRequestParams(name="test")))

    responder = RequestResponder(
        request_id=1, request_meta=None, request=request, session=session, on_complete=on_complete
    )

    with pytest.raises(RuntimeError, match="RequestResponder must be used as a context manager"):
        responder.respond(MockResult(result="ok"))

    with responder as r:
        r.respond(MockResult(result="ok"))
        with pytest.raises(AssertionError, match="Request already responded to"):
            r.respond(MockResult(result="error"))

    assert responder.completed is True
    on_complete.assert_called_once_with(responder)

    msg = write_stream.get_nowait()
    assert isinstance(msg.message.root, JSONRPCResponse)
    assert msg.message.root.result == {"result": "ok"}


@pytest.mark.timeout(5)
def test_request_responder_cancel(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)
    on_complete = MagicMock()
    request = ReceiveRequest(MockRequest(method="test", params=MockRequestParams(name="test")))

    responder = RequestResponder(
        request_id=1, request_meta=None, request=request, session=session, on_complete=on_complete
    )

    with pytest.raises(RuntimeError, match="RequestResponder must be used as a context manager"):
        responder.cancel()

    with responder as r:
        r.cancel()

    assert responder.completed is True
    on_complete.assert_called_once_with(responder)

    msg = write_stream.get_nowait()
    assert isinstance(msg.message.root, JSONRPCError)
    assert msg.message.root.error.message == "Request cancelled"


@pytest.mark.timeout(10)
def test_base_session_lifecycle(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    with session as s:
        assert isinstance(s, MockSession)
        assert s._executor is not None
        assert s._receiver_future is not None

    session._receiver_future.result(timeout=5.0)
    assert session._receiver_future.done()


@pytest.mark.timeout(5)
def test_send_request_success(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    request = MockRequest(method="test", params=MockRequestParams(name="world"))

    def mock_response():
        try:
            msg = write_stream.get(timeout=2)
            req_id = msg.message.root.id
            response = JSONRPCResponse(jsonrpc="2.0", id=req_id, result={"result": "hello world"})
            read_stream.put(SessionMessage(message=JSONRPCMessage(response)))
        except Exception:
            pass

    import threading

    t = threading.Thread(target=mock_response, daemon=True)
    t.start()

    with session:
        result = session.send_request(request, MockResult)
        assert result.result == "hello world"
    t.join(timeout=1)


@pytest.mark.timeout(5)
def test_send_request_retry_loop_coverage(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)
    request = MockRequest(method="test", params=MockRequestParams(name="world"))

    def mock_delayed_response():
        try:
            msg = write_stream.get(timeout=2)
            req_id = msg.message.root.id
            time.sleep(0.2)
            response = JSONRPCResponse(jsonrpc="2.0", id=req_id, result={"result": "slow"})
            read_stream.put(SessionMessage(message=JSONRPCMessage(response)))
        except:
            pass

    import threading

    t = threading.Thread(target=mock_delayed_response, daemon=True)
    t.start()

    with session:
        result = session.send_request(request, MockResult, request_read_timeout_seconds=timedelta(seconds=0.1))
        assert result.result == "slow"
    t.join(timeout=1)


@pytest.mark.timeout(5)
def test_send_request_jsonrpc_error(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)
    request = MockRequest(method="test", params=MockRequestParams(name="world"))

    def mock_error():
        try:
            msg = write_stream.get(timeout=2)
            req_id = msg.message.root.id
            error = JSONRPCError(jsonrpc="2.0", id=req_id, error=ErrorData(code=-32000, message="Error"))
            read_stream.put(SessionMessage(message=JSONRPCMessage(error)))
        except:
            pass

    import threading

    t = threading.Thread(target=mock_error, daemon=True)
    t.start()

    with session:
        with pytest.raises(MCPConnectionError) as exc:
            session.send_request(request, MockResult)
        assert exc.value.args[0].message == "Error"
    t.join(timeout=1)


@pytest.mark.timeout(5)
def test_send_request_auth_error(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)
    request = MockRequest(method="test", params=MockRequestParams(name="world"))

    def mock_error():
        try:
            msg = write_stream.get(timeout=2)
            req_id = msg.message.root.id
            error = JSONRPCError(jsonrpc="2.0", id=req_id, error=ErrorData(code=401, message="Unauthorized"))
            read_stream.put(SessionMessage(message=JSONRPCMessage(error)))
        except:
            pass

    import threading

    t = threading.Thread(target=mock_error, daemon=True)
    t.start()

    with session:
        with pytest.raises(MCPAuthError):
            session.send_request(request, MockResult)
    t.join(timeout=1)


@pytest.mark.timeout(5)
def test_send_request_http_status_error_coverage(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)
    request = MockRequest(method="test", params=MockRequestParams(name="world"))

    def mock_direct_http_error():
        try:
            msg = write_stream.get(timeout=2)
            req_id = msg.message.root.id
            # To cover line 263 in base_session.py, we MUST put non-401 HTTPStatusError
            # DIRECTLY into response_streams, as _receive_loop would convert it to JSONRPCError.
            response = Response(status_code=403, request=Request("GET", "http://test"))
            error = HTTPStatusError("Forbidden", request=response.request, response=response)
            session._response_streams[req_id].put(error)
        except:
            pass

    import threading

    t = threading.Thread(target=mock_direct_http_error, daemon=True)
    t.start()

    # We still need the session for request ID generation and queue setup
    with session:
        with pytest.raises(MCPConnectionError) as exc:
            session.send_request(request, MockResult)
        assert exc.value.args[0].code == 403
    t.join(timeout=1)


@pytest.mark.timeout(5)
def test_send_request_http_status_auth_error(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)
    request = MockRequest(method="test", params=MockRequestParams(name="world"))

    def mock_error():
        try:
            msg = write_stream.get(timeout=2)
            req_id = msg.message.root.id
            response = Response(status_code=401, request=Request("GET", "http://test"))
            error = HTTPStatusError("Unauthorized", request=response.request, response=response)
            read_stream.put(error)
        except:
            pass

    import threading

    t = threading.Thread(target=mock_error, daemon=True)
    t.start()

    with session:
        with pytest.raises(MCPAuthError):
            session.send_request(request, MockResult)
    t.join(timeout=1)


@pytest.mark.timeout(5)
def test_send_notification(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)
    notification = MockNotification(method="notify", params=MockNotificationParams(message="hi"))

    session.send_notification(notification, related_request_id="rel-1")

    msg = write_stream.get_nowait()
    assert isinstance(msg.message.root, JSONRPCNotification)
    assert msg.message.root.method == "notify"
    assert msg.message.root.params == {"message": "hi"}
    assert msg.metadata.related_request_id == "rel-1"


@pytest.mark.timeout(10)
def test_receive_loop_request(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    with session:
        req_payload = {"jsonrpc": "2.0", "id": 1, "method": "test/request", "params": {"name": "test"}}
        read_stream.put(SessionMessage(message=JSONRPCMessage.model_validate(req_payload)))

        for _ in range(30):
            if session.received_requests:
                break
            time.sleep(0.1)

    assert len(session.received_requests) == 1
    responder = session.received_requests[0]
    assert responder.request_id == 1
    assert responder.request.root.method == "test/request"


@pytest.mark.timeout(10)
def test_receive_loop_notification(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    with session:
        notif_payload = {"jsonrpc": "2.0", "method": "test/notification", "params": {"message": "hello"}}
        read_stream.put(SessionMessage(message=JSONRPCMessage.model_validate(notif_payload)))

        for _ in range(30):
            if session.received_notifications:
                break
            time.sleep(0.1)

    assert len(session.received_notifications) == 1
    assert isinstance(session.received_notifications[0].root, MockNotification)
    assert session.received_notifications[0].root.method == "test/notification"


@pytest.mark.timeout(15)
def test_receive_loop_cancel_notification(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ClientNotification)

    with session:
        req_payload = {"jsonrpc": "2.0", "id": "req-1", "method": "test/request", "params": {"name": "test"}}
        read_stream.put(SessionMessage(message=JSONRPCMessage.model_validate(req_payload)))

        for _ in range(30):
            if "req-1" in session._in_flight:
                break
            time.sleep(0.1)

        assert "req-1" in session._in_flight
        responder = session._in_flight["req-1"]

        with responder:
            cancel_payload = {"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": "req-1"}}
            read_stream.put(SessionMessage(message=JSONRPCMessage.model_validate(cancel_payload)))

            for _ in range(30):
                if responder.completed:
                    break
                time.sleep(0.1)

    assert responder.completed is True
    msg = write_stream.get(timeout=2)
    assert isinstance(msg.message.root, JSONRPCError)
    assert msg.message.root.id == "req-1"


@pytest.mark.timeout(10)
def test_receive_loop_exception(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    with session:
        read_stream.put(Exception("Unexpected error"))
        for _ in range(30):
            if any(isinstance(x, Exception) for x in session.handled_incoming):
                break
            time.sleep(0.1)

    assert any(isinstance(x, Exception) and str(x) == "Unexpected error" for x in session.handled_incoming)


@pytest.mark.timeout(10)
def test_receive_loop_http_status_error(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    with session:
        session._request_id = 1
        resp_queue = queue.Queue()
        session._response_streams[0] = resp_queue

        response = Response(status_code=401, request=Request("GET", "http://test"))
        # Using 401 specifically as _receive_loop preserves it
        error = HTTPStatusError("Unauthorized", request=response.request, response=response)
        read_stream.put(error)

        got = resp_queue.get(timeout=2)
        assert isinstance(got, HTTPStatusError)


@pytest.mark.timeout(10)
def test_receive_loop_http_status_error_non_401(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    with session:
        session._request_id = 1
        resp_queue = queue.Queue()
        session._response_streams[0] = resp_queue

        response = Response(status_code=500, request=Request("GET", "http://test"))
        error = HTTPStatusError("Server Error", request=response.request, response=response)
        read_stream.put(error)

        got = resp_queue.get(timeout=2)
        assert isinstance(got, JSONRPCError)
        assert got.error.code == 500


@pytest.mark.timeout(5)
def test_check_receiver_status_fail(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    executor = ThreadPoolExecutor(max_workers=1)

    def raise_err():
        raise RuntimeError("Receiver failed")

    future = executor.submit(raise_err)
    session._receiver_future = future

    try:
        future.result()
    except:
        pass

    with pytest.raises(RuntimeError, match="Receiver failed"):
        session.check_receiver_status()
    executor.shutdown()


@pytest.mark.timeout(10)
def test_receive_loop_unknown_request_id(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    with session:
        resp = JSONRPCResponse(jsonrpc="2.0", id=999, result={"ok": True})
        read_stream.put(SessionMessage(message=JSONRPCMessage(resp)))

        for _ in range(30):
            if any(isinstance(x, RuntimeError) and "Server Error" in str(x) for x in session.handled_incoming):
                break
            time.sleep(0.1)

    assert any("Server Error" in str(x) for x in session.handled_incoming)


@pytest.mark.timeout(10)
def test_receive_loop_http_error_unknown_id(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    with session:
        response = Response(status_code=401, request=Request("GET", "http://test"))
        error = HTTPStatusError("Unauthorized", request=response.request, response=response)
        read_stream.put(error)

        for _ in range(30):
            if any(isinstance(x, RuntimeError) and "unknown request ID" in str(x) for x in session.handled_incoming):
                break
            time.sleep(0.1)

    assert any("unknown request ID" in str(x) for x in session.handled_incoming)


@pytest.mark.timeout(10)
def test_receive_loop_validation_error_notification(streams):
    from core.mcp.session.base_session import logger

    with patch.object(logger, "warning") as mock_warning:
        read_stream, write_stream = streams
        session = MockSession(read_stream, write_stream, ReceiveRequest, RootModel[MockNotification])

        with session:
            notif_payload = {"jsonrpc": "2.0", "method": "bad", "params": {"some": "data"}}
            read_stream.put(SessionMessage(message=JSONRPCMessage.model_validate(notif_payload)))
            time.sleep(1.0)

        assert mock_warning.called


@pytest.mark.timeout(5)
def test_send_request_none_response(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)
    request = MockRequest(method="test", params=MockRequestParams(name="world"))

    def mock_none():
        try:
            msg = write_stream.get(timeout=2)
            req_id = msg.message.root.id
            session._response_streams[req_id].put(None)
        except:
            pass

    import threading

    t = threading.Thread(target=mock_none, daemon=True)
    t.start()

    with session:
        with pytest.raises(MCPConnectionError) as exc:
            session.send_request(request, MockResult)
        assert exc.value.args[0].message == "No response received"
    t.join(timeout=1)


@pytest.mark.timeout(15)
def test_session_exit_timeout(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    mock_future = MagicMock(spec=Future)
    mock_future.result.side_effect = TimeoutError()
    mock_future.done.return_value = False

    session._receiver_future = mock_future
    session._executor = MagicMock(spec=ThreadPoolExecutor)

    session.__exit__(None, None, None)

    mock_future.cancel.assert_called_once()
    session._executor.shutdown.assert_called_once_with(wait=False)


@pytest.mark.timeout(10)
def test_receive_loop_fatal_exception(streams):
    read_stream, write_stream = streams
    session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    with patch.object(read_stream, "get", side_effect=RuntimeError("Fatal loop error")):
        with patch("core.mcp.session.base_session.logger") as mock_logger:
            with pytest.raises(RuntimeError, match="Fatal loop error"):
                with session:
                    pass
            mock_logger.exception.assert_called_with("Error in message processing loop")


@pytest.mark.timeout(5)
def test_receive_loop_empty_coverage(streams):
    with patch("core.mcp.session.base_session.DEFAULT_RESPONSE_READ_TIMEOUT", 0.1):
        read_stream, write_stream = streams
        session = MockSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)
        with session:
            time.sleep(0.3)


@pytest.mark.timeout(2)
def test_base_methods_noop(streams):
    read_stream, write_stream = streams
    session = BaseSession(read_stream, write_stream, ReceiveRequest, ReceiveNotification)

    session._received_request(MagicMock())
    session._received_notification(MagicMock())
    session.send_progress_notification("token", 0.5)
    session._handle_incoming(MagicMock())


@pytest.mark.timeout(5)
def test_send_request_session_timeout_retry_6(streams):
    read_stream, write_stream = streams
    session = MockSession(
        read_stream, write_stream, ReceiveRequest, ReceiveNotification, read_timeout_seconds=timedelta(seconds=0.1)
    )

    request = MockRequest(method="test", params=MockRequestParams(name="world"))

    with patch.object(session, "check_receiver_status", side_effect=[None, RuntimeError("timeout_broken")]):
        with pytest.raises(RuntimeError, match="timeout_broken"):
            session.send_request(request, MockResult)
