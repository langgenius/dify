"""Runtime helpers for starting and stopping the optional Agent Stub gRPC server."""

from __future__ import annotations

from dataclasses import dataclass

from dify_agent.agent_stub.server.agent_stub_files import AgentStubFileRequestHandler
from dify_agent.agent_stub.server.control_plane import AgentStubControlPlaneService
from dify_agent.agent_stub.server.grpc_bind import AgentStubGRPCBindTarget, derive_agent_stub_grpc_bind_target
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec


@dataclass(slots=True)
class RunningAgentStubGRPCServer:
    """Handle for one started grpclib Agent Stub server."""

    server: object
    bind_target: AgentStubGRPCBindTarget

    async def aclose(self) -> None:
        """Stop accepting new requests and wait for open RPCs to close."""
        close = getattr(self.server, "close")
        wait_closed = getattr(self.server, "wait_closed")
        close()
        await wait_closed()


async def start_agent_stub_grpc_server(
    *,
    public_url: str,
    bind_address: str | None,
    token_codec: AgentStubTokenCodec | None,
    file_request_handler: AgentStubFileRequestHandler | None,
) -> RunningAgentStubGRPCServer:
    """Start the optional grpclib Agent Stub server for one process."""
    from dify_agent.agent_stub.server.grpc_service import create_agent_stub_grpc_service

    runtime = _require_runtime()
    bind_target = derive_agent_stub_grpc_bind_target(public_url=public_url, bind_address=bind_address)
    service = AgentStubControlPlaneService(token_codec, file_request_handler)
    server = runtime.Server([create_agent_stub_grpc_service(service)])
    await server.start(bind_target.host, bind_target.port)
    return RunningAgentStubGRPCServer(server=server, bind_target=bind_target)


@dataclass(frozen=True, slots=True)
class _GRPCRuntime:
    Server: type


def _require_runtime() -> _GRPCRuntime:
    try:
        from grpclib.server import Server
    except ImportError as exc:
        raise RuntimeError("Agent Stub gRPC support requires the optional dify-agent[grpc] dependencies") from exc
    return _GRPCRuntime(Server=Server)


__all__ = ["RunningAgentStubGRPCServer", "start_agent_stub_grpc_server"]
