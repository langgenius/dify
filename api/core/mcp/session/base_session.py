import logging
import queue
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError
from datetime import timedelta
from types import TracebackType
from typing import Any, Generic, Self, TypeVar

from httpx import HTTPStatusError
from pydantic import BaseModel

from core.mcp.error import MCPAuthError, MCPConnectionError
from core.mcp.types import (
    CancelledNotification,
    ClientNotification,
    ClientRequest,
    ClientResult,
    ErrorData,
    JSONRPCError,
    JSONRPCMessage,
    JSONRPCNotification,
    JSONRPCRequest,
    JSONRPCResponse,
    MessageMetadata,
    RequestId,
    RequestParams,
    ServerMessageMetadata,
    ServerNotification,
    ServerRequest,
    ServerResult,
    SessionMessage,
)

logger = logging.getLogger(__name__)


SendRequestT = TypeVar("SendRequestT", ClientRequest, ServerRequest)
SendResultT = TypeVar("SendResultT", ClientResult, ServerResult)
SendNotificationT = TypeVar("SendNotificationT", ClientNotification, ServerNotification)
ReceiveRequestT = TypeVar("ReceiveRequestT", ClientRequest, ServerRequest)
ReceiveResultT = TypeVar("ReceiveResultT", bound=BaseModel)
ReceiveNotificationT = TypeVar("ReceiveNotificationT", ClientNotification, ServerNotification)
DEFAULT_RESPONSE_READ_TIMEOUT = 1.0


class RequestResponder(Generic[ReceiveRequestT, SendResultT]):
    """Handles responding to MCP requests and manages request lifecycle.

    This class MUST be used as a context manager to ensure proper cleanup and
    cancellation handling:

    Example:
        with request_responder as resp:
            resp.respond(result)

    The context manager ensures:
    1. Proper cancellation scope setup and cleanup
    2. Request completion tracking
    3. Cleanup of in-flight requests
    """

    request: ReceiveRequestT
    _session: Any
    _on_complete: Callable[["RequestResponder[ReceiveRequestT, SendResultT]"], Any]

    def __init__(
        self,
        request_id: RequestId,
        request_meta: RequestParams.Meta | None,
        request: ReceiveRequestT,
        session: """BaseSession[SendRequestT, SendNotificationT, SendResultT, ReceiveRequestT, ReceiveNotificationT]""",
        on_complete: Callable[["RequestResponder[ReceiveRequestT, SendResultT]"], Any],
    ):
        self.request_id = request_id
        self.request_meta = request_meta
        self.request = request
        self._session = session
        self.completed = False
        self._on_complete = on_complete
        self._entered = False  # Track if we're in a context manager

    def __enter__(self) -> "RequestResponder[ReceiveRequestT, SendResultT]":
        """Enter the context manager, enabling request cancellation tracking."""
        self._entered = True
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ):
        """Exit the context manager, performing cleanup and notifying completion."""
        try:
            if self.completed:
                self._on_complete(self)
        finally:
            self._entered = False

    def respond(self, response: SendResultT | ErrorData):
        """Send a response for this request.

        Must be called within a context manager block.
        Raises:
            RuntimeError: If not used within a context manager
            AssertionError: If request was already responded to
        """
        if not self._entered:
            raise RuntimeError("RequestResponder must be used as a context manager")
        assert not self.completed, "Request already responded to"

        self.completed = True

        self._session._send_response(request_id=self.request_id, response=response)

    def cancel(self):
        """Cancel this request and mark it as completed."""
        if not self._entered:
            raise RuntimeError("RequestResponder must be used as a context manager")

        self.completed = True  # Mark as completed so it's removed from in_flight
        # Send an error response to indicate cancellation
        self._session._send_response(
            request_id=self.request_id,
            response=ErrorData(code=0, message="Request cancelled", data=None),
        )


class BaseSession(
    Generic[
        SendRequestT,
        SendNotificationT,
        SendResultT,
        ReceiveRequestT,
        ReceiveNotificationT,
    ],
):
    """
    Implements an MCP "session" on top of read/write streams, including features
    like request/response linking, notifications, and progress.

    This class is a context manager that automatically starts processing
    messages when entered.
    """

    _response_streams: dict[RequestId, queue.Queue[JSONRPCResponse | JSONRPCError | HTTPStatusError]]
    _request_id: int
    _in_flight: dict[RequestId, RequestResponder[ReceiveRequestT, SendResultT]]
    _receive_request_type: type[ReceiveRequestT]
    _receive_notification_type: type[ReceiveNotificationT]

    def __init__(
        self,
        read_stream: queue.Queue,
        write_stream: queue.Queue,
        receive_request_type: type[ReceiveRequestT],
        receive_notification_type: type[ReceiveNotificationT],
        # If none, reading will never time out
        read_timeout_seconds: timedelta | None = None,
    ):
        self._read_stream = read_stream
        self._write_stream = write_stream
        self._response_streams = {}
        self._request_id = 0
        self._receive_request_type = receive_request_type
        self._receive_notification_type = receive_notification_type
        self._session_read_timeout_seconds = read_timeout_seconds
        self._in_flight = {}
        # Initialize executor and future to None for proper cleanup checks
        self._executor: ThreadPoolExecutor | None = None
        self._receiver_future: Future | None = None

    def __enter__(self) -> Self:
        # The thread pool is dedicated to running `_receive_loop`. Setting `max_workers` to 1
        # ensures no unnecessary threads are created.
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._receiver_future = self._executor.submit(self._receive_loop)
        return self

    def check_receiver_status(self):
        """`check_receiver_status` ensures that any exceptions raised during the
        execution of `_receive_loop` are retrieved and propagated."""
        if self._receiver_future and self._receiver_future.done():
            self._receiver_future.result()

    def __exit__(
        self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: TracebackType | None
    ):
        self._read_stream.put(None)
        self._write_stream.put(None)

        # Wait for the receiver loop to finish
        if self._receiver_future:
            try:
                self._receiver_future.result(timeout=5.0)  # Wait up to 5 seconds
            except TimeoutError:
                # If the receiver loop is still running after timeout, we'll force shutdown
                # Cancel the future to interrupt the receiver loop
                self._receiver_future.cancel()

        # Shutdown the executor
        if self._executor:
            # Use non-blocking shutdown to prevent hanging
            # The receiver thread should have already exited due to the None message in the queue
            self._executor.shutdown(wait=False)

    def send_request(
        self,
        request: SendRequestT,
        result_type: type[ReceiveResultT],
        request_read_timeout_seconds: timedelta | None = None,
        metadata: MessageMetadata | None = None,
    ) -> ReceiveResultT:
        """
        Sends a request and wait for a response. Raises an McpError if the
        response contains an error. If a request read timeout is provided, it
        will take precedence over the session read timeout.

        Do not use this method to emit notifications! Use send_notification()
        instead.
        """
        self.check_receiver_status()

        request_id = self._request_id
        self._request_id = request_id + 1

        response_queue: queue.Queue[JSONRPCResponse | JSONRPCError | HTTPStatusError] = queue.Queue()
        self._response_streams[request_id] = response_queue

        try:
            jsonrpc_request = JSONRPCRequest(
                jsonrpc="2.0",
                id=request_id,
                **request.model_dump(by_alias=True, mode="json", exclude_none=True),
            )

            self._write_stream.put(SessionMessage(message=JSONRPCMessage(jsonrpc_request), metadata=metadata))
            timeout = DEFAULT_RESPONSE_READ_TIMEOUT
            if request_read_timeout_seconds is not None:
                timeout = float(request_read_timeout_seconds.total_seconds())
            elif self._session_read_timeout_seconds is not None:
                timeout = float(self._session_read_timeout_seconds.total_seconds())
            while True:
                try:
                    response_or_error = response_queue.get(timeout=timeout)
                    break
                except queue.Empty:
                    self.check_receiver_status()
                    continue

            if response_or_error is None:
                raise MCPConnectionError(
                    ErrorData(
                        code=500,
                        message="No response received",
                    )
                )
            elif isinstance(response_or_error, HTTPStatusError):
                # HTTPStatusError from streamable_client with preserved response object
                if response_or_error.response.status_code == 401:
                    raise MCPAuthError(response=response_or_error.response)
                else:
                    raise MCPConnectionError(
                        ErrorData(code=response_or_error.response.status_code, message=str(response_or_error))
                    )
            elif isinstance(response_or_error, JSONRPCError):
                if response_or_error.error.code == 401:
                    raise MCPAuthError(message=response_or_error.error.message)
                else:
                    raise MCPConnectionError(
                        ErrorData(code=response_or_error.error.code, message=response_or_error.error.message)
                    )
            else:
                return result_type.model_validate(response_or_error.result)

        finally:
            self._response_streams.pop(request_id, None)

    def send_notification(
        self,
        notification: SendNotificationT,
        related_request_id: RequestId | None = None,
    ):
        """
        Emits a notification, which is a one-way message that does not expect
        a response.
        """
        self.check_receiver_status()

        # Some transport implementations may need to set the related_request_id
        # to attribute to the notifications to the request that triggered them.
        jsonrpc_notification = JSONRPCNotification(
            jsonrpc="2.0",
            **notification.model_dump(by_alias=True, mode="json", exclude_none=True),
        )
        session_message = SessionMessage(
            message=JSONRPCMessage(jsonrpc_notification),
            metadata=ServerMessageMetadata(related_request_id=related_request_id) if related_request_id else None,
        )
        self._write_stream.put(session_message)

    def _send_response(self, request_id: RequestId, response: SendResultT | ErrorData):
        if isinstance(response, ErrorData):
            jsonrpc_error = JSONRPCError(jsonrpc="2.0", id=request_id, error=response)
            session_message = SessionMessage(message=JSONRPCMessage(jsonrpc_error))
            self._write_stream.put(session_message)
        else:
            jsonrpc_response = JSONRPCResponse(
                jsonrpc="2.0",
                id=request_id,
                result=response.model_dump(by_alias=True, mode="json", exclude_none=True),
            )
            session_message = SessionMessage(message=JSONRPCMessage(jsonrpc_response))
            self._write_stream.put(session_message)

    def _receive_loop(self):
        """
        Main message processing loop.
        In a real synchronous implementation, this would likely run in a separate thread.
        """
        while True:
            try:
                # Attempt to receive a message (this would be blocking in a synchronous context)
                message = self._read_stream.get(timeout=DEFAULT_RESPONSE_READ_TIMEOUT)
                if message is None:
                    break
                if isinstance(message, HTTPStatusError):
                    response_queue = self._response_streams.get(self._request_id - 1)
                    if response_queue is not None:
                        # For 401 errors, pass the HTTPStatusError directly to preserve response object
                        if message.response.status_code == 401:
                            response_queue.put(message)
                        else:
                            response_queue.put(
                                JSONRPCError(
                                    jsonrpc="2.0",
                                    id=self._request_id - 1,
                                    error=ErrorData(code=message.response.status_code, message=message.args[0]),
                                )
                            )
                    else:
                        self._handle_incoming(RuntimeError(f"Received response with an unknown request ID: {message}"))
                elif isinstance(message, Exception):
                    self._handle_incoming(message)
                elif isinstance(message.message.root, JSONRPCRequest):
                    validated_request = self._receive_request_type.model_validate(
                        message.message.root.model_dump(by_alias=True, mode="json", exclude_none=True)
                    )

                    responder = RequestResponder(
                        request_id=message.message.root.id,
                        request_meta=validated_request.root.params.meta if validated_request.root.params else None,
                        request=validated_request,
                        session=self,
                        on_complete=lambda r: self._in_flight.pop(r.request_id, None),
                    )

                    self._in_flight[responder.request_id] = responder
                    self._received_request(responder)

                    if not responder.completed:
                        self._handle_incoming(responder)

                elif isinstance(message.message.root, JSONRPCNotification):
                    try:
                        notification = self._receive_notification_type.model_validate(
                            message.message.root.model_dump(by_alias=True, mode="json", exclude_none=True)
                        )
                        # Handle cancellation notifications
                        if isinstance(notification.root, CancelledNotification):
                            cancelled_id = notification.root.params.requestId
                            if cancelled_id in self._in_flight:
                                self._in_flight[cancelled_id].cancel()
                        else:
                            self._received_notification(notification)
                            self._handle_incoming(notification)
                    except Exception as e:
                        # For other validation errors, log and continue
                        logger.warning("Failed to validate notification: %s. Message was: %s", e, message.message.root)
                else:  # Response or error
                    response_queue = self._response_streams.get(message.message.root.id)
                    if response_queue is not None:
                        response_queue.put(message.message.root)
                    else:
                        self._handle_incoming(RuntimeError(f"Server Error: {message}"))
            except queue.Empty:
                continue
            except Exception:
                logger.exception("Error in message processing loop")
                raise

    def _received_request(self, responder: RequestResponder[ReceiveRequestT, SendResultT]):
        """
        Can be overridden by subclasses to handle a request without needing to
        listen on the message stream.

        If the request is responded to within this method, it will not be
        forwarded on to the message stream.
        """

    def _received_notification(self, notification: ReceiveNotificationT):
        """
        Can be overridden by subclasses to handle a notification without needing
        to listen on the message stream.
        """

    def send_progress_notification(self, progress_token: str | int, progress: float, total: float | None = None):
        """
        Sends a progress notification for a request that is currently being
        processed.
        """

    def _handle_incoming(
        self,
        req: RequestResponder[ReceiveRequestT, SendResultT] | ReceiveNotificationT | Exception,
    ):
        """A generic handler for incoming messages. Overwritten by subclasses."""
