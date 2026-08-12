"""Process-level Logfire setup for the Dify Agent run server.

The run server performs observability setup at the FastAPI app boundary rather
than inside agent runtime code. Global instrumentations cover shared HTTPX,
Redis, and Pydantic AI clients once per process; the FastAPI instrumentation is
applied per app instance because tests and embedded callers can build multiple
apps in one Python process. Remote export remains token-gated through Logfire's
``if-token-present`` mode and Logfire's default environment-variable handling,
so development without a token only writes Logfire's console output locally.
"""

from __future__ import annotations

import logfire
from fastapi import FastAPI

_global_instrumentation_ready = False


def configure_server_observability(app: FastAPI) -> None:
    """Configure Logfire and instrument the server's framework/client boundaries.

    Instrumentation calls intentionally use Logfire's defaults instead of
    re-exposing capture options through Dify settings. The only Dify-owned
    policy here is that remote export stays token-gated while local console
    output still works without a token.
    """
    global _global_instrumentation_ready

    logfire.configure(
        send_to_logfire="if-token-present",
        inspect_arguments=False,
    )

    if not _global_instrumentation_ready:
        logfire.instrument_httpx()
        logfire.instrument_redis()
        logfire.instrument_pydantic_ai()
        _global_instrumentation_ready = True

    if getattr(app.state, "dify_agent_logfire_instrumented", False):
        return
    logfire.instrument_fastapi(app)
    app.state.dify_agent_logfire_instrumented = True


__all__ = ["configure_server_observability"]
