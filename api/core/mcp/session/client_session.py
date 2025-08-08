from datetime import timedelta
from typing import Any, Protocol

from pydantic import AnyUrl, TypeAdapter

from configs import dify_config
from core.mcp import types
from core.mcp.entities import SUPPORTED_PROTOCOL_VERSIONS, RequestContext
from core.mcp.session.base_session import BaseSession, RequestResponder

DEFAULT_CLIENT_INFO = types.Implementation(name="Dify", version=dify_config.project.version)


class SamplingFnT(Protocol):
    def __call__(
        self,
        context: RequestContext["ClientSession", Any],
        params: types.CreateMessageRequestParams,
    ) -> types.CreateMessageResult | types.ErrorData: ...


class ListRootsFnT(Protocol):
    def __call__(self, context: RequestContext["ClientSession", Any]) -> types.ListRootsResult | types.ErrorData: ...


class LoggingFnT(Protocol):
    def __call__(
        self,
        params: types.LoggingMessageNotificationParams,
    ) -> None: ...


class MessageHandlerFnT(Protocol):
    def __call__(
        self,
        message: RequestResponder[types.ServerRequest, types.ClientResult] | types.ServerNotification | Exception,
    ) -> None: ...


def _default_message_handler(
    message: RequestResponder[types.ServerRequest, types.ClientResult] | types.ServerNotification | Exception,
) -> None:
    if isinstance(message, Exception):
        raise ValueError(str(message))
    elif isinstance(message, (types.ServerNotification | RequestResponder)):
        pass


def _default_sampling_callback(
    context: RequestContext["ClientSession", Any],
    params: types.CreateMessageRequestParams,
) -> types.CreateMessageResult | types.ErrorData:
    return types.ErrorData(
        code=types.INVALID_REQUEST,
        message="Sampling not supported",
    )


def _default_list_roots_callback(
    context: RequestContext["ClientSession", Any],
) -> types.ListRootsResult | types.ErrorData:
    return types.ErrorData(
        code=types.INVALID_REQUEST,
        message="List roots not supported",
    )


def _default_logging_callback(
    params: types.LoggingMessageNotificationParams,
) -> None:
    pass


ClientResponse: TypeAdapter[types.ClientResult | types.ErrorData] = TypeAdapter(types.ClientResult | types.ErrorData)


class ClientSession(
    BaseSession[
        types.ClientRequest,
        types.ClientNotification,
        types.ClientResult,
        types.ServerRequest,
        types.ServerNotification,
    ]
):
    def __init__(
        self,
        read_stream,
        write_stream,
        read_timeout_seconds: timedelta | None = None,
        sampling_callback: SamplingFnT | None = None,
        list_roots_callback: ListRootsFnT | None = None,
        logging_callback: LoggingFnT | None = None,
        message_handler: MessageHandlerFnT | None = None,
        client_info: types.Implementation | None = None,
    ) -> None:
        super().__init__(
            read_stream,
            write_stream,
            types.ServerRequest,
            types.ServerNotification,
            read_timeout_seconds=read_timeout_seconds,
        )
        self._client_info = client_info or DEFAULT_CLIENT_INFO
        self._sampling_callback = sampling_callback or _default_sampling_callback
        self._list_roots_callback = list_roots_callback or _default_list_roots_callback
        self._logging_callback = logging_callback or _default_logging_callback
        self._message_handler = message_handler or _default_message_handler

    def initialize(self) -> types.InitializeResult:
        sampling = types.SamplingCapability()
        roots = types.RootsCapability(
            # TODO: Should this be based on whether we
            # _will_ send notifications, or only whether
            # they're supported?
            listChanged=True,
        )

        result = self.send_request(
            types.ClientRequest(
                types.InitializeRequest(
                    method="initialize",
                    params=types.InitializeRequestParams(
                        protocolVersion=types.LATEST_PROTOCOL_VERSION,
                        capabilities=types.ClientCapabilities(
                            sampling=sampling,
                            experimental=None,
                            roots=roots,
                        ),
                        clientInfo=self._client_info,
                    ),
                )
            ),
            types.InitializeResult,
        )

        if result.protocolVersion not in SUPPORTED_PROTOCOL_VERSIONS:
            raise RuntimeError(f"Unsupported protocol version from the server: {result.protocolVersion}")

        self.send_notification(
            types.ClientNotification(types.InitializedNotification(method="notifications/initialized"))
        )

        return result

    def send_ping(self) -> types.EmptyResult:
        """Send a ping request."""
        return self.send_request(
            types.ClientRequest(
                types.PingRequest(
                    method="ping",
                )
            ),
            types.EmptyResult,
        )

    def send_progress_notification(
        self, progress_token: str | int, progress: float, total: float | None = None
    ) -> None:
        """Send a progress notification."""
        self.send_notification(
            types.ClientNotification(
                types.ProgressNotification(
                    method="notifications/progress",
                    params=types.ProgressNotificationParams(
                        progressToken=progress_token,
                        progress=progress,
                        total=total,
                    ),
                ),
            )
        )

    def set_logging_level(self, level: types.LoggingLevel) -> types.EmptyResult:
        """Send a logging/setLevel request."""
        return self.send_request(
            types.ClientRequest(
                types.SetLevelRequest(
                    method="logging/setLevel",
                    params=types.SetLevelRequestParams(level=level),
                )
            ),
            types.EmptyResult,
        )

    def list_resources(self) -> types.ListResourcesResult:
        """Send a resources/list request."""
        return self.send_request(
            types.ClientRequest(
                types.ListResourcesRequest(
                    method="resources/list",
                )
            ),
            types.ListResourcesResult,
        )

    def list_resource_templates(self) -> types.ListResourceTemplatesResult:
        """Send a resources/templates/list request."""
        return self.send_request(
            types.ClientRequest(
                types.ListResourceTemplatesRequest(
                    method="resources/templates/list",
                )
            ),
            types.ListResourceTemplatesResult,
        )

    def read_resource(self, uri: AnyUrl) -> types.ReadResourceResult:
        """Send a resources/read request."""
        return self.send_request(
            types.ClientRequest(
                types.ReadResourceRequest(
                    method="resources/read",
                    params=types.ReadResourceRequestParams(uri=uri),
                )
            ),
            types.ReadResourceResult,
        )

    def subscribe_resource(self, uri: AnyUrl) -> types.EmptyResult:
        """Send a resources/subscribe request."""
        return self.send_request(
            types.ClientRequest(
                types.SubscribeRequest(
                    method="resources/subscribe",
                    params=types.SubscribeRequestParams(uri=uri),
                )
            ),
            types.EmptyResult,
        )

    def unsubscribe_resource(self, uri: AnyUrl) -> types.EmptyResult:
        """Send a resources/unsubscribe request."""
        return self.send_request(
            types.ClientRequest(
                types.UnsubscribeRequest(
                    method="resources/unsubscribe",
                    params=types.UnsubscribeRequestParams(uri=uri),
                )
            ),
            types.EmptyResult,
        )

    def call_tool(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
        read_timeout_seconds: timedelta | None = None,
    ) -> types.CallToolResult:
        """Send a tools/call request."""

        return self.send_request(
            types.ClientRequest(
                types.CallToolRequest(
                    method="tools/call",
                    params=types.CallToolRequestParams(name=name, arguments=arguments),
                )
            ),
            types.CallToolResult,
            request_read_timeout_seconds=read_timeout_seconds,
        )

    def list_prompts(self) -> types.ListPromptsResult:
        """Send a prompts/list request."""
        return self.send_request(
            types.ClientRequest(
                types.ListPromptsRequest(
                    method="prompts/list",
                )
            ),
            types.ListPromptsResult,
        )

    def get_prompt(self, name: str, arguments: dict[str, str] | None = None) -> types.GetPromptResult:
        """Send a prompts/get request."""
        return self.send_request(
            types.ClientRequest(
                types.GetPromptRequest(
                    method="prompts/get",
                    params=types.GetPromptRequestParams(name=name, arguments=arguments),
                )
            ),
            types.GetPromptResult,
        )

    def complete(
        self,
        ref: types.ResourceReference | types.PromptReference,
        argument: dict[str, str],
    ) -> types.CompleteResult:
        """Send a completion/complete request."""
        return self.send_request(
            types.ClientRequest(
                types.CompleteRequest(
                    method="completion/complete",
                    params=types.CompleteRequestParams(
                        ref=ref,
                        argument=types.CompletionArgument(**argument),
                    ),
                )
            ),
            types.CompleteResult,
        )

    def list_tools(self) -> types.ListToolsResult:
        """Send a tools/list request."""
        return self.send_request(
            types.ClientRequest(
                types.ListToolsRequest(
                    method="tools/list",
                )
            ),
            types.ListToolsResult,
        )

    def send_roots_list_changed(self) -> None:
        """Send a roots/list_changed notification."""
        self.send_notification(
            types.ClientNotification(
                types.RootsListChangedNotification(
                    method="notifications/roots/list_changed",
                )
            )
        )

    def _received_request(self, responder: RequestResponder[types.ServerRequest, types.ClientResult]) -> None:
        ctx = RequestContext[ClientSession, Any](
            request_id=responder.request_id,
            meta=responder.request_meta,
            session=self,
            lifespan_context=None,
        )

        match responder.request.root:
            case types.CreateMessageRequest(params=params):
                with responder:
                    response = self._sampling_callback(ctx, params)
                    client_response = ClientResponse.validate_python(response)
                    responder.respond(client_response)

            case types.ListRootsRequest():
                with responder:
                    list_roots_response = self._list_roots_callback(ctx)
                    client_response = ClientResponse.validate_python(list_roots_response)
                    responder.respond(client_response)

            case types.PingRequest():
                with responder:
                    return responder.respond(types.ClientResult(root=types.EmptyResult()))

    def _handle_incoming(
        self,
        req: RequestResponder[types.ServerRequest, types.ClientResult] | types.ServerNotification | Exception,
    ) -> None:
        """Handle incoming messages by forwarding to the message handler."""
        self._message_handler(req)

    def _received_notification(self, notification: types.ServerNotification) -> None:
        """Handle notifications from the server."""
        # Process specific notification types
        match notification.root:
            case types.LoggingMessageNotification(params=params):
                self._logging_callback(params)
            case _:
                pass
