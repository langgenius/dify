"""gRPC transport adapter for the Agent Stub control plane.

This module owns the gRPC-specific semantics that differ from the HTTP router:

- compact-JWE auth is read from inbound ``authorization`` metadata rather than
  an HTTP header object;
- protobuf request-shape or JSON-decoding failures are mapped to
  ``INVALID_ARGUMENT`` before the shared business layer runs;
- auth/configuration/downstream failures raised by
  ``AgentStubControlPlaneService`` are translated into gRPC statuses;
- structured downstream error details are stringified because gRPC status
  details are text, unlike the HTTP path which can preserve object-shaped
  ``detail`` payloads.

The shared control-plane service still owns auth policy, connection-id
generation, and file-handler delegation so HTTP and gRPC stay semantically
aligned outside these transport-specific mappings.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

from pydantic import ValidationError

from dify_agent.agent_stub.server.control_plane import (
    AgentStubAuthenticationError,
    AgentStubConfigurationError,
    AgentStubControlPlaneError,
    AgentStubControlPlaneService,
)

if TYPE_CHECKING:
    from grpclib.server import Stream

    from dify_agent.agent_stub.grpc._generated import agent_stub_pb2
    from dify_agent.agent_stub.grpc._generated.agent_stub_grpc import AgentStubServiceBase


@dataclass(slots=True)
class AgentStubGRPCTransport:
    """Shared gRPC adapter that converts protobuf messages around control-plane calls.

    Each method validates the protobuf request at the transport boundary,
    extracts ``authorization`` metadata, and translates shared control-plane
    failures into grpclib ``GRPCError`` instances.
    """

    service: AgentStubControlPlaneService

    async def connect(
        self,
        *,
        request,
        metadata: object,
    ):
        """Handle one gRPC connect request.

        Invalid protobuf/message-shape input maps to ``INVALID_ARGUMENT``. Auth
        and configuration failures raised by the shared service are translated by
        ``_grpc_error_from_control_plane_error``.
        """
        authorization = _authorization_from_metadata(metadata)
        conversions = _require_conversions()
        try:
            _ = conversions.connect_request_from_proto(request)
            response = await self.service.connect(authorization=authorization)
            return conversions.proto_connect_response(response)
        except (ValidationError, ValueError, TypeError) as exc:
            raise _grpc_error("INVALID_ARGUMENT", "invalid Agent Stub connect request") from exc
        except AgentStubControlPlaneError as exc:
            raise _grpc_error_from_control_plane_error(exc) from exc

    async def create_file_upload_request(
        self,
        *,
        request,
        metadata: object,
    ):
        """Handle one gRPC file-upload request.

        This transport validates the protobuf request before delegating to the
        shared service, then stringifies any non-string downstream error detail
        when mapping the resulting failure into gRPC status text.
        """
        authorization = _authorization_from_metadata(metadata)
        conversions = _require_conversions()
        try:
            validated_request = conversions.file_upload_request_from_proto(request)
            response = await self.service.create_file_upload_request(
                request=validated_request,
                authorization=authorization,
            )
            return conversions.proto_file_upload_response(response)
        except (ValidationError, ValueError, TypeError) as exc:
            raise _grpc_error("INVALID_ARGUMENT", "invalid Agent Stub file upload request") from exc
        except AgentStubControlPlaneError as exc:
            raise _grpc_error_from_control_plane_error(exc) from exc

    async def create_file_download_request(
        self,
        *,
        request,
        metadata: object,
    ):
        """Handle one gRPC file-download request.

        This transport validates the protobuf request before delegating to the
        shared service, then stringifies any non-string downstream error detail
        when mapping the resulting failure into gRPC status text.
        """
        authorization = _authorization_from_metadata(metadata)
        conversions = _require_conversions()
        try:
            validated_request = conversions.file_download_request_from_proto(request)
            response = await self.service.create_file_download_request(
                request=validated_request,
                authorization=authorization,
            )
            return conversions.proto_file_download_response(response)
        except (ValidationError, ValueError, TypeError) as exc:
            raise _grpc_error("INVALID_ARGUMENT", "invalid Agent Stub file download request") from exc
        except AgentStubControlPlaneError as exc:
            raise _grpc_error_from_control_plane_error(exc) from exc


def create_agent_stub_grpc_service(
    service: AgentStubControlPlaneService,
) -> AgentStubServiceBase:
    """Wrap the shared control-plane service in a grpclib-generated service base.

    The generated grpclib service methods are unary-only and reject missing
    request messages with ``INVALID_ARGUMENT`` before handing control to the
    transport adapter.
    """
    try:
        from dify_agent.agent_stub.grpc._generated.agent_stub_grpc import AgentStubServiceBase
    except ImportError as exc:  # pragma: no cover - exercised via runtime import guard
        raise RuntimeError("Agent Stub gRPC support requires the optional grpc dependencies") from exc

    transport = AgentStubGRPCTransport(service)

    class _Service(AgentStubServiceBase):
        async def Connect(
            self,
            stream: Stream[agent_stub_pb2.ConnectRequest, agent_stub_pb2.ConnectResponse],
        ) -> None:  # type: ignore[name-defined]
            request = await stream.recv_message()
            if request is None:
                raise _grpc_error("INVALID_ARGUMENT", "missing Agent Stub request message")
            await stream.send_message(await transport.connect(request=request, metadata=stream.metadata))

        async def CreateFileUploadRequest(
            self,
            stream: Stream[agent_stub_pb2.FileUploadRequest, agent_stub_pb2.FileUploadResponse],
        ) -> None:  # type: ignore[name-defined]
            request = await stream.recv_message()
            if request is None:
                raise _grpc_error("INVALID_ARGUMENT", "missing Agent Stub request message")
            await stream.send_message(await transport.create_file_upload_request(request=request, metadata=stream.metadata))

        async def CreateFileDownloadRequest(
            self,
            stream: Stream[agent_stub_pb2.FileDownloadRequest, agent_stub_pb2.FileDownloadResponse],
        ) -> None:  # type: ignore[name-defined]
            request = await stream.recv_message()
            if request is None:
                raise _grpc_error("INVALID_ARGUMENT", "missing Agent Stub request message")
            await stream.send_message(
                await transport.create_file_download_request(request=request, metadata=stream.metadata)
            )

    return _Service()


def _authorization_from_metadata(metadata: object) -> str | None:
    """Extract the optional bearer token from grpclib metadata containers."""
    if metadata is None:
        return None
    if isinstance(metadata, Mapping):
        value = metadata.get("authorization")
        return value if isinstance(value, str) else None
    if isinstance(metadata, Sequence):
        for item in metadata:
            if isinstance(item, tuple) and len(item) == 2:
                key, value = item
                if isinstance(key, str) and key.lower() == "authorization" and isinstance(value, str):
                    return value
    return None


def _grpc_error_from_control_plane_error(exc: AgentStubControlPlaneError):
    """Translate shared control-plane failures into transport-visible gRPC status.

    ``detail`` is normalized to text because gRPC status details are strings;
    HTTP adapters can preserve richer object payloads.
    """
    detail_text = _grpc_detail_text(exc.detail)
    if isinstance(exc, AgentStubAuthenticationError):
        return _grpc_error("UNAUTHENTICATED", detail_text)
    if isinstance(exc, AgentStubConfigurationError):
        return _grpc_error("UNAVAILABLE", detail_text)
    if exc.status_code in {408, 504}:
        return _grpc_error("DEADLINE_EXCEEDED", detail_text)
    if exc.status_code == 429:
        return _grpc_error("RESOURCE_EXHAUSTED", detail_text)
    if exc.status_code == 404:
        return _grpc_error("NOT_FOUND", detail_text)
    if exc.status_code == 403:
        return _grpc_error("PERMISSION_DENIED", detail_text)
    if 400 <= exc.status_code < 500:
        return _grpc_error("FAILED_PRECONDITION", detail_text)
    if 500 <= exc.status_code < 600:
        return _grpc_error("UNAVAILABLE", detail_text)
    return _grpc_error("INTERNAL", "internal Agent Stub error")


def _grpc_error(status_name: str, detail: str):
    from grpclib.const import Status
    from grpclib.exceptions import GRPCError

    return GRPCError(getattr(Status, status_name), detail)


def _grpc_detail_text(detail: object) -> str:
    """Return the text form used for gRPC status details."""
    if isinstance(detail, str):
        return detail
    return str(detail)


def _require_conversions():
    try:
        from dify_agent.agent_stub.grpc import conversions
    except ImportError as exc:  # pragma: no cover - exercised by runtime import guard
        raise RuntimeError("Agent Stub gRPC support requires the optional grpc dependencies") from exc
    return conversions


__all__ = ["AgentStubGRPCTransport", "create_agent_stub_grpc_service"]
