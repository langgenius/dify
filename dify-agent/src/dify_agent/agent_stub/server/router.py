"""Embeddable router factory for Dify Agent stub endpoints.

Both the standalone stub server and the standard run server mount the same
router so the back proxy protocol, token validation, and file-control-plane
behavior stay identical regardless of hosting mode. The factory is intentionally
settings-agnostic: callers must pass already constructed token-codec and file
handler dependencies rather than having this module read environment variables
or import server settings directly.
"""

from __future__ import annotations

from fastapi import APIRouter

from dify_agent.agent_stub.server.back_proxy_files import BackProxyFileRequestHandler
from dify_agent.agent_stub.server.routes.back_proxy import create_back_proxy_router
from dify_agent.agent_stub.server.tokens.back_proxy import BackProxyTokenCodec


def create_agent_stub_router(
    *,
    token_codec: BackProxyTokenCodec | None,
    file_request_handler: BackProxyFileRequestHandler | None = None,
) -> APIRouter:
    """Build the embeddable stub router from pre-built server dependencies."""
    return create_back_proxy_router(
        lambda: token_codec,
        lambda: file_request_handler,
    )


__all__ = ["create_agent_stub_router"]
