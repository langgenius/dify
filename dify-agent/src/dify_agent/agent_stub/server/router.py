"""Embeddable router factory for Dify Agent stub endpoints.

Both the standalone stub server and the standard run server mount the same
router so the Agent Stub protocol, token validation, and file/drive
control-plane behavior stay identical regardless of hosting mode. The factory is
intentionally settings-agnostic: callers must pass already constructed
token-codec and request-handler dependencies rather than having this module read
environment variables or import server settings directly.
"""

from __future__ import annotations

from fastapi import APIRouter

from dify_agent.agent_stub.server.agent_stub_config import AgentStubConfigRequestHandler
from dify_agent.agent_stub.server.agent_stub_drive import AgentStubDriveRequestHandler
from dify_agent.agent_stub.server.agent_stub_files import AgentStubFileRequestHandler
from dify_agent.agent_stub.server.routes.agent_stub import create_agent_stub_http_router
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubTokenCodec


def create_agent_stub_router(
    *,
    token_codec: AgentStubTokenCodec | None,
    file_request_handler: AgentStubFileRequestHandler | None = None,
    drive_request_handler: AgentStubDriveRequestHandler | None = None,
    config_request_handler: AgentStubConfigRequestHandler | None = None,
) -> APIRouter:
    """Build the embeddable stub router from pre-built server dependencies."""
    return create_agent_stub_http_router(
        token_codec,
        file_request_handler,
        drive_request_handler,
        config_request_handler,
    )


__all__ = ["create_agent_stub_router"]
