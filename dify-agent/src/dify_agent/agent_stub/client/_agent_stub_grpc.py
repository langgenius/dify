"""Client-safe gRPC helpers for Agent Stub control-plane endpoints.

These entrypoints mirror the HTTP helpers in ``_agent_stub_http.py`` but keep
the gRPC dependency chain lazy so default installs remain import-safe. Callers
only reach this module after choosing a ``grpc://`` Agent Stub URL. At that
point the public failure contract is:

- missing optional gRPC/protobuf dependencies raise
  ``AgentStubMissingGRPCDependencyError``;
- non-OK server statuses raise ``AgentStubGRPCError`` with the surfaced gRPC
  status name and detail text;
- transport/runtime failures such as bad targets, terminated streams, or socket
  errors raise ``AgentStubClientError``.

Authentication follows gRPC conventions rather than HTTP headers: the compact
JWE bearer token is sent as ``authorization: Bearer <token>`` metadata on each
unary RPC.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from types import ModuleType
from typing import TYPE_CHECKING

import httpx
from pydantic import JsonValue

from dify_agent.agent_stub.client._errors import (
    AgentStubClientError,
    AgentStubGRPCError,
    AgentStubMissingGRPCDependencyError,
)
from dify_agent.agent_stub.protocol.agent_stub import AgentStubFileMapping, parse_agent_stub_endpoint

if TYPE_CHECKING:
    from grpclib.client import Channel
    from grpclib.exceptions import GRPCError, StreamTerminatedError

    from dify_agent.agent_stub.grpc._generated.agent_stub_grpc import AgentStubServiceStub


@dataclass(frozen=True, slots=True)
class _GRPCRuntime:
    Channel: type[Channel]
    AgentStubServiceStub: type[AgentStubServiceStub]
    agent_stub_pb2: ModuleType
    GRPCError: type[GRPCError]
    StreamTerminatedError: type[StreamTerminatedError]


def connect_agent_stub_grpc_sync(
    *,
    url: str,
    auth_jwe: str,
    argv: list[str],
    metadata: dict[str, JsonValue] | None = None,
    timeout: float | httpx.Timeout = 30.0,
):
    """Create one gRPC Agent Stub connection using the provided bearer JWE.

    Raises:
        AgentStubMissingGRPCDependencyError: if the optional gRPC runtime or
            generated protobuf support is not installed.
        AgentStubGRPCError: if the server returns a non-OK gRPC status.
        AgentStubClientError: if the target URL is invalid for gRPC or the
            runtime/transport fails before a valid gRPC response is received.
    """
    return asyncio.run(
        _call_grpc(
            url=url,
            auth_jwe=auth_jwe,
            method_name="Connect",
            request_factory=lambda runtime: _require_conversions().proto_connect_request(
                runtime.agent_stub_pb2,
                argv=argv,
                metadata=metadata,
            ),
            response_parser=lambda response: _require_conversions().connect_response_from_proto(response),
            timeout=timeout,
        )
    )


def request_agent_stub_file_upload_grpc_sync(
    *,
    url: str,
    auth_jwe: str,
    filename: str,
    mimetype: str,
    timeout: float | httpx.Timeout = 30.0,
):
    """Request one signed upload URL through the gRPC Agent Stub endpoint.

    The compact-JWE bearer token is sent via ``authorization`` metadata on the
    unary RPC rather than an HTTP header.

    Raises:
        AgentStubMissingGRPCDependencyError: if the optional gRPC runtime or
            generated protobuf support is not installed.
        AgentStubGRPCError: if the server returns a non-OK gRPC status.
        AgentStubClientError: if the target URL is invalid for gRPC or the
            runtime/transport fails before a valid gRPC response is received.
    """
    return asyncio.run(
        _call_grpc(
            url=url,
            auth_jwe=auth_jwe,
            method_name="CreateFileUploadRequest",
            request_factory=lambda runtime: _require_conversions().proto_file_upload_request(
                runtime.agent_stub_pb2,
                filename=filename,
                mimetype=mimetype,
            ),
            response_parser=lambda response: _require_conversions().file_upload_response_from_proto(response),
            timeout=timeout,
        )
    )


def request_agent_stub_file_download_grpc_sync(
    *,
    url: str,
    auth_jwe: str,
    file: AgentStubFileMapping,
    timeout: float | httpx.Timeout = 30.0,
):
    """Request one signed download URL through the gRPC Agent Stub endpoint.

    The compact-JWE bearer token is sent via ``authorization`` metadata on the
    unary RPC rather than an HTTP header.

    Raises:
        AgentStubMissingGRPCDependencyError: if the optional gRPC runtime or
            generated protobuf support is not installed.
        AgentStubGRPCError: if the server returns a non-OK gRPC status.
        AgentStubClientError: if the target URL is invalid for gRPC or the
            runtime/transport fails before a valid gRPC response is received.
    """
    return asyncio.run(
        _call_grpc(
            url=url,
            auth_jwe=auth_jwe,
            method_name="CreateFileDownloadRequest",
            request_factory=lambda runtime: _require_conversions().proto_file_download_request(runtime.agent_stub_pb2, file=file),
            response_parser=lambda response: _require_conversions().file_download_response_from_proto(response),
            timeout=timeout,
        )
    )


async def _call_grpc[TProto, TResult](
    *,
    url: str,
    auth_jwe: str,
    method_name: str,
    request_factory,
    response_parser,
    timeout: float | httpx.Timeout,
) -> TResult:
    """Execute one unary Agent Stub gRPC call with shared error mapping.

    This helper attaches ``authorization`` metadata for every RPC, normalizes
    ``httpx.Timeout`` into one gRPC timeout value, and translates grpclib status
    failures into ``AgentStubGRPCError`` while keeping lower-level transport
    failures in the broader ``AgentStubClientError`` family.
    """
    runtime = _require_runtime()
    endpoint = parse_agent_stub_endpoint(url)
    if not endpoint.is_grpc or endpoint.port is None:
        raise AgentStubClientError("gRPC Agent Stub requests require a grpc://host:port URL")

    channel = runtime.Channel(host=endpoint.host, port=endpoint.port, ssl=False)
    try:
        stub = runtime.AgentStubServiceStub(channel)
        method = getattr(stub, method_name)
        response = await method(
            request_factory(runtime),
            metadata=(("authorization", f"Bearer {auth_jwe}"),),
            timeout=_grpc_timeout_seconds(timeout),
        )
        return response_parser(response)
    except runtime.GRPCError as exc:
        detail = getattr(exc, "message", "") or getattr(exc, "details", "") or "request failed"
        status = getattr(getattr(exc, "status", None), "name", str(getattr(exc, "status", "UNKNOWN")))
        raise AgentStubGRPCError(status, detail) from exc
    except runtime.StreamTerminatedError as exc:
        raise AgentStubClientError(f"Agent Stub gRPC {method_name} request terminated unexpectedly") from exc
    except OSError as exc:
        raise AgentStubClientError(f"Agent Stub gRPC {method_name} request failed: {exc}") from exc
    finally:
        channel.close()


def _grpc_timeout_seconds(timeout: float | httpx.Timeout) -> float | None:
    if isinstance(timeout, httpx.Timeout):
        values = [timeout.read, timeout.connect, timeout.write, timeout.pool]
        resolved = next((value for value in values if value is not None), None)
        return float(resolved) if resolved is not None else None
    return float(timeout)


def _require_runtime() -> _GRPCRuntime:
    """Import grpclib and generated protobuf runtime only when gRPC is selected."""
    try:
        from grpclib.client import Channel
        from grpclib.exceptions import GRPCError, StreamTerminatedError

        from dify_agent.agent_stub.grpc._generated import agent_stub_pb2
        from dify_agent.agent_stub.grpc._generated.agent_stub_grpc import AgentStubServiceStub
    except ImportError as exc:
        raise AgentStubMissingGRPCDependencyError(
            "Agent Stub gRPC transport requires the optional dify-agent[grpc] dependencies"
        ) from exc
    return _GRPCRuntime(
        Channel=Channel,
        AgentStubServiceStub=AgentStubServiceStub,
        agent_stub_pb2=agent_stub_pb2,
        GRPCError=GRPCError,
        StreamTerminatedError=StreamTerminatedError,
    )


def _require_conversions():
    """Import protobuf conversion helpers lazily for HTTP-only installations."""
    try:
        from dify_agent.agent_stub.grpc import conversions
    except ImportError as exc:
        raise AgentStubMissingGRPCDependencyError(
            "Agent Stub gRPC transport requires the optional dify-agent[grpc] dependencies"
        ) from exc
    return conversions


__all__ = [
    "connect_agent_stub_grpc_sync",
    "request_agent_stub_file_download_grpc_sync",
    "request_agent_stub_file_upload_grpc_sync",
]
