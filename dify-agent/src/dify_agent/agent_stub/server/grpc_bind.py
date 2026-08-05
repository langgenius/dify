"""Bind-address helpers for optional Agent Stub gRPC hosting."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit

from dify_agent.agent_stub.protocol.agent_stub import parse_agent_stub_endpoint


@dataclass(frozen=True, slots=True)
class AgentStubGRPCBindTarget:
    """Validated host/port bind target for a grpclib Agent Stub server."""

    host: str
    port: int

    @property
    def address(self) -> str:
        return f"{_format_host(self.host)}:{self.port}"


def normalize_agent_stub_grpc_bind_address(value: str) -> str:
    """Normalize one ``host:port`` gRPC bind address."""
    target = parse_agent_stub_grpc_bind_address(value)
    return target.address


def parse_agent_stub_grpc_bind_address(value: str) -> AgentStubGRPCBindTarget:
    """Parse one explicit ``host:port`` gRPC bind override."""
    stripped = value.strip()
    if not stripped:
        raise ValueError("Agent Stub gRPC bind address must not be empty")
    parsed = urlsplit(f"grpc://{stripped}")
    if not parsed.netloc or parsed.hostname is None:
        raise ValueError("Agent Stub gRPC bind address must include a host")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Agent Stub gRPC bind address must not include user info")
    if parsed.port is None:
        raise ValueError("Agent Stub gRPC bind address must include an explicit port")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("Agent Stub gRPC bind address must be in host:port form")
    return AgentStubGRPCBindTarget(host=parsed.hostname, port=parsed.port)


def derive_agent_stub_grpc_bind_target(
    *,
    public_url: str,
    bind_address: str | None = None,
) -> AgentStubGRPCBindTarget:
    """Resolve the runtime gRPC bind target from public URL plus optional override."""
    if bind_address is not None:
        return parse_agent_stub_grpc_bind_address(bind_address)
    endpoint = parse_agent_stub_endpoint(public_url)
    if not endpoint.is_grpc or endpoint.port is None:
        raise ValueError("Agent Stub gRPC bind target requires a grpc://host:port public URL")
    return AgentStubGRPCBindTarget(host="0.0.0.0", port=endpoint.port)


def _format_host(host: str) -> str:
    return f"[{host}]" if ":" in host and not host.startswith("[") else host


__all__ = [
    "AgentStubGRPCBindTarget",
    "derive_agent_stub_grpc_bind_target",
    "normalize_agent_stub_grpc_bind_address",
    "parse_agent_stub_grpc_bind_address",
]
