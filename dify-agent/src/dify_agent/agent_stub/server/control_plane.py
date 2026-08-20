"""Shared Agent Stub HTTP control-plane service.

This layer owns authenticated delegation for file and config operations.
The HTTP adapter validates transport DTOs before calling into this service.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from uuid import uuid4

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConnectResponse,
    AgentStubConfigManifestResponse,
    AgentStubConfigPushRequest,
    AgentStubConfigPushResponse,
    AgentStubFileDownloadRequest,
    AgentStubFileDownloadResponse,
    AgentStubFileUploadRequest,
    AgentStubFileUploadResponse,
)
from dify_agent.agent_stub.server.agent_stub_config import AgentStubConfigRequestError, AgentStubConfigRequestHandler
from dify_agent.agent_stub.server.agent_stub_files import AgentStubFileRequestError, AgentStubFileRequestHandler
from dify_agent.agent_stub.server.tokens.agent_stub import (
    AgentStubPrincipal,
    AgentStubTokenCodec,
    AgentStubTokenError,
    AgentStubTokenExpiredError,
)


_AGENT_STUB_AUTHORIZATION_EXPIRED_DETAIL = {
    "code": "agent_stub_authorization_expired",
    "message": "Agent Stub authorization expired after 5 minutes; start a new shell tool call and retry the command.",
}


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

    The HTTP adapter validates transport payloads before calling this service,
    which focuses on auth, connection-id generation, and request delegation.
    """

    token_codec: AgentStubTokenCodec | None
    file_request_handler: AgentStubFileRequestHandler | None = None
    config_request_handler: AgentStubConfigRequestHandler | None = None
    connection_id_factory: Callable[[], str] = field(default=lambda: str(uuid4()))

    async def connect(self, *, authorization: str | None) -> AgentStubConnectResponse:
        """Authenticate and handle one connect request."""
        _ = self._authenticate(authorization, expose_expiration=True)
        return AgentStubConnectResponse(connection_id=self.connection_id_factory(), status="connected")

    async def create_file_upload_request(
        self,
        *,
        request: AgentStubFileUploadRequest,
        authorization: str | None,
        expose_expiration: bool = False,
    ) -> AgentStubFileUploadResponse:
        """Authenticate and delegate one already-validated file-upload request."""
        principal = self._authenticate(authorization, expose_expiration=expose_expiration)
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
        principal = self._authenticate(authorization, expose_expiration=True)
        if request.config is not None:
            handler = self._require_config_request_handler()
            try:
                return await handler.create_download_request(principal=principal, source=request.config)
            except AgentStubConfigRequestError as exc:
                raise AgentStubControlPlaneError(exc.status_code, exc.detail) from exc

        handler = self._require_file_request_handler()
        try:
            return await handler.create_download_request(principal=principal, request=request)
        except AgentStubFileRequestError as exc:
            raise AgentStubControlPlaneError(exc.status_code, exc.detail) from exc

    async def get_config_manifest(
        self,
        *,
        authorization: str | None,
    ) -> AgentStubConfigManifestResponse:
        principal = self._authenticate(authorization, expose_expiration=True)
        handler = self._require_config_request_handler()
        try:
            return await handler.manifest(principal=principal)
        except AgentStubConfigRequestError as exc:
            raise AgentStubControlPlaneError(exc.status_code, exc.detail) from exc

    async def inspect_config_skill(
        self,
        *,
        name: str,
        authorization: str | None,
    ) -> dict[str, object]:
        principal = self._authenticate(authorization, expose_expiration=True)
        handler = self._require_config_request_handler()
        try:
            return await handler.inspect_skill(principal=principal, name=name)
        except AgentStubConfigRequestError as exc:
            raise AgentStubControlPlaneError(exc.status_code, exc.detail) from exc

    async def push_config(
        self,
        *,
        request: AgentStubConfigPushRequest,
        authorization: str | None,
    ) -> AgentStubConfigPushResponse:
        principal = self._authenticate(authorization, expose_expiration=True)
        handler = self._require_config_request_handler()
        try:
            return await handler.push(principal=principal, request=request)
        except AgentStubConfigRequestError as exc:
            raise AgentStubControlPlaneError(exc.status_code, exc.detail) from exc

    async def update_config_env(
        self,
        *,
        env_text: str,
        authorization: str | None,
    ) -> dict[str, object]:
        principal = self._authenticate(authorization, expose_expiration=True)
        handler = self._require_config_request_handler()
        try:
            return await handler.update_env(principal=principal, env_text=env_text)
        except AgentStubConfigRequestError as exc:
            raise AgentStubControlPlaneError(exc.status_code, exc.detail) from exc

    async def update_config_note(
        self,
        *,
        note: str,
        authorization: str | None,
    ) -> dict[str, object]:
        principal = self._authenticate(authorization, expose_expiration=True)
        handler = self._require_config_request_handler()
        try:
            return await handler.update_note(principal=principal, note=note)
        except AgentStubConfigRequestError as exc:
            raise AgentStubControlPlaneError(exc.status_code, exc.detail) from exc

    def _authenticate(self, authorization: str | None, *, expose_expiration: bool = False) -> AgentStubPrincipal:
        token_codec = self.token_codec
        if token_codec is None:
            raise AgentStubConfigurationError(503, "Agent Stub is not configured")
        try:
            return token_codec.decode_authorization_header(authorization)
        except AgentStubTokenExpiredError as exc:
            detail = (
                _AGENT_STUB_AUTHORIZATION_EXPIRED_DETAIL
                if expose_expiration
                else "invalid or missing Agent Stub authorization"
            )
            raise AgentStubAuthenticationError(401, detail) from exc
        except AgentStubTokenError as exc:
            raise AgentStubAuthenticationError(401, "invalid or missing Agent Stub authorization") from exc

    def _require_file_request_handler(self) -> AgentStubFileRequestHandler:
        if self.file_request_handler is None:
            raise AgentStubConfigurationError(503, "Agent Stub file API is not configured")
        return self.file_request_handler

    def _require_config_request_handler(self) -> AgentStubConfigRequestHandler:
        if self.config_request_handler is None:
            raise AgentStubConfigurationError(503, "Agent Stub config API is not configured")
        return self.config_request_handler


__all__ = [
    "AgentStubAuthenticationError",
    "AgentStubConfigurationError",
    "AgentStubControlPlaneError",
    "AgentStubControlPlaneService",
]
