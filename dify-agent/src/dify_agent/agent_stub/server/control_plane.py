"""Shared Agent Stub control-plane service used by HTTP and gRPC transports."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from uuid import uuid4

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConnectResponse,
    AgentStubFileDownloadRequest,
    AgentStubFileDownloadResponse,
    AgentStubFileUploadRequest,
    AgentStubFileUploadResponse,
)
from dify_agent.agent_stub.server.agent_stub_files import AgentStubFileRequestError, AgentStubFileRequestHandler
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal, AgentStubTokenCodec, AgentStubTokenError


class AgentStubControlPlaneError(RuntimeError):
    """Raised when shared Agent Stub business logic cannot complete a request."""

    status_code: int
    detail: object

    def __init__(self, status_code: int, detail: object) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


class AgentStubAuthenticationError(AgentStubControlPlaneError):
    """Raised when Agent Stub authorization is missing or invalid."""


class AgentStubConfigurationError(AgentStubControlPlaneError):
    """Raised when required server-side Agent Stub dependencies are missing."""


@dataclass(slots=True)
class AgentStubControlPlaneService:
    """Shared business service for authenticated Agent Stub control-plane calls.

    HTTP and gRPC adapters validate or decode transport payloads before calling
    this service, so this layer focuses only on shared auth, connection-id
    generation, and file-request delegation.
    """

    token_codec: AgentStubTokenCodec | None
    file_request_handler: AgentStubFileRequestHandler | None = None
    connection_id_factory: Callable[[], str] = field(default=lambda: str(uuid4()))

    async def connect(self, *, authorization: str | None) -> AgentStubConnectResponse:
        """Authenticate and handle one connect request."""
        _ = self._authenticate(authorization)
        return AgentStubConnectResponse(connection_id=self.connection_id_factory(), status="connected")

    async def create_file_upload_request(
        self,
        *,
        request: AgentStubFileUploadRequest,
        authorization: str | None,
    ) -> AgentStubFileUploadResponse:
        """Authenticate and delegate one already-validated file-upload request."""
        principal = self._authenticate(authorization)
        handler = self._require_file_request_handler()
        try:
            return await handler.create_upload_request(principal=principal, request=request)
        except AgentStubFileRequestError as exc:
            raise AgentStubControlPlaneError(exc.status_code, exc.detail) from exc

    async def create_file_download_request(
        self,
        *,
        request: AgentStubFileDownloadRequest,
        authorization: str | None,
    ) -> AgentStubFileDownloadResponse:
        """Authenticate and delegate one already-validated file-download request."""
        principal = self._authenticate(authorization)
        handler = self._require_file_request_handler()
        try:
            return await handler.create_download_request(principal=principal, request=request)
        except AgentStubFileRequestError as exc:
            raise AgentStubControlPlaneError(exc.status_code, exc.detail) from exc

    def _authenticate(self, authorization: str | None) -> AgentStubPrincipal:
        token_codec = self.token_codec
        if token_codec is None:
            raise AgentStubConfigurationError(503, "Agent Stub is not configured")
        try:
            return token_codec.decode_authorization_header(authorization)
        except AgentStubTokenError as exc:
            raise AgentStubAuthenticationError(401, "invalid or missing Agent Stub authorization") from exc

    def _require_file_request_handler(self) -> AgentStubFileRequestHandler:
        if self.file_request_handler is None:
            raise AgentStubConfigurationError(503, "Agent Stub file API is not configured")
        return self.file_request_handler


__all__ = [
    "AgentStubAuthenticationError",
    "AgentStubConfigurationError",
    "AgentStubControlPlaneError",
    "AgentStubControlPlaneService",
]
