"""Console entry point for the standalone Dify Agent stub server.

This module backs the ``dify-agent-stub-server`` console script and serves the
Agent Stub HTTP API through Uvicorn.
"""

from __future__ import annotations

import argparse
import uvicorn


def main(argv: list[str] | None = None) -> None:
    """Run the standalone stub server with parsed uvicorn bind options.

    Args:
        argv: Optional CLI argument list used mainly by tests. When omitted,
            ``argparse`` reads the process command line.

    Side effects:
        Starts ``dify_agent.agent_stub.server.app:app`` via ``uvicorn.run``.
    """
    parser = argparse.ArgumentParser(prog="dify-agent-stub-server")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args(argv)
    uvicorn.run(
        "dify_agent.agent_stub.server.app:app",
        host=args.host or "127.0.0.1",
        port=args.port or 8001,
        reload=args.reload,
    )


__all__ = ["main"]
