"""Console entry point for the standalone Dify Agent stub server.

This module backs the ``dify-agent-stub-server`` console script introduced by
the stub-package move. HTTP(S) endpoints continue to run through Uvicorn while
``grpc://`` Agent Stub URLs switch the process into grpclib server mode.
"""

from __future__ import annotations

import argparse
import asyncio

import uvicorn

from dify_agent.agent_stub.protocol.agent_stub import parse_agent_stub_endpoint
from dify_agent.agent_stub.server.grpc_bind import AgentStubGRPCBindTarget, derive_agent_stub_grpc_bind_target
from dify_agent.agent_stub.server.grpc_runtime import start_agent_stub_grpc_server
from dify_agent.server.settings import ServerSettings


def main(argv: list[str] | None = None) -> None:
    """Run the standalone stub server with parsed uvicorn bind options.

    Args:
        argv: Optional CLI argument list used mainly by tests. When omitted,
            ``argparse`` reads the process command line.

    Side effects:
        Starts either ``dify_agent.agent_stub.server.app:app`` via
        ``uvicorn.run`` or the grpclib Agent Stub server depending on the
        configured ``DIFY_AGENT_STUB_API_BASE_URL`` scheme.
    """
    parser = argparse.ArgumentParser(prog="dify-agent-stub-server")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args(argv)
    settings = ServerSettings()
    if (
        settings.agent_stub_api_base_url is not None
        and parse_agent_stub_endpoint(settings.agent_stub_api_base_url).is_grpc
    ):
        asyncio.run(_serve_grpc(settings=settings, host=args.host, port=args.port))
        return
    uvicorn.run(
        "dify_agent.agent_stub.server.app:app",
        host=args.host or "127.0.0.1",
        port=args.port or 8001,
        reload=args.reload,
    )


async def _serve_grpc(*, settings: ServerSettings, host: str | None, port: int | None) -> None:
    bind_target = derive_agent_stub_grpc_bind_target(
        public_url=settings.agent_stub_api_base_url or "",
        bind_address=settings.agent_stub_grpc_bind_address,
    )
    if host is not None or port is not None:
        bind_target = AgentStubGRPCBindTarget(host=host or bind_target.host, port=port or bind_target.port)

    server = await start_agent_stub_grpc_server(
        public_url=settings.agent_stub_api_base_url or "",
        bind_address=bind_target.address,
        token_codec=settings.create_agent_stub_token_codec(),
        file_request_handler=settings.create_agent_stub_file_request_handler(),
    )
    try:
        await asyncio.Event().wait()
    finally:
        await server.aclose()


__all__ = ["main"]
