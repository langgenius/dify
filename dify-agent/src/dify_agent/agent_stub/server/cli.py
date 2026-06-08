"""Console entry point for the standalone Dify Agent stub server.

This module backs the ``dify-agent-stub-server`` console script introduced by
the stub-package move. The command always launches
``dify_agent.agent_stub.server.app:app`` through ``uvicorn.run`` and defaults
to ``127.0.0.1:8001`` with ``reload=False`` unless callers override those
values with CLI flags.
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
        The default bind contract is host ``127.0.0.1``, port ``8001``, and
        ``reload=False`` unless ``--host``, ``--port``, or ``--reload`` are
        supplied.
    """
    parser = argparse.ArgumentParser(prog="dify-agent-stub-server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args(argv)
    uvicorn.run(
        "dify_agent.agent_stub.server.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


__all__ = ["main"]
