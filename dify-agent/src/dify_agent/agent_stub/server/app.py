"""Standalone FastAPI application factory for the Dify Agent Stub server.

The standalone stub server is only a convenience wrapper around the shared
router. It reuses the main ``ServerSettings`` model and derives the Agent Stub
token codec and optional file-request bridge from the same helper methods that
the standard run server uses before mounting ``create_agent_stub_router(...)``.
"""

from __future__ import annotations

from fastapi import FastAPI

from dify_agent.agent_stub.server.router import create_agent_stub_router
from dify_agent.server.settings import ServerSettings


def create_agent_stub_app(settings: ServerSettings | None = None) -> FastAPI:
    """Build the standalone FastAPI app for authenticated stub endpoints."""
    resolved_settings = settings or ServerSettings()
    app = FastAPI(title="Dify Agent Stub Server", version="0.1.0")
    app.include_router(
        create_agent_stub_router(
            token_codec=resolved_settings.create_agent_stub_token_codec(),
            file_request_handler=resolved_settings.create_agent_stub_file_request_handler(),
        )
    )
    return app


app = create_agent_stub_app()


__all__ = ["app", "create_agent_stub_app"]
