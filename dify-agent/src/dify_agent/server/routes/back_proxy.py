"""FastAPI routes for authenticated shell back proxy connection setup.

The current route validates a compact-JWE bearer token, reconstructs the Dify
execution context principal for the request, and returns a placeholder
connection id. It intentionally does not persist connection state or execute the
 forwarded argv yet; the route exists to establish the external protocol and the
server-side authentication boundary first.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException

from dify_agent.protocol.back_proxy import BackProxyConnectRequest, BackProxyConnectResponse
from dify_agent.server.tokens.back_proxy import BackProxyTokenCodec, BackProxyTokenError


def create_back_proxy_router(get_token_codec: Callable[[], BackProxyTokenCodec | None]) -> APIRouter:
    """Create routes bound to the application's shell back proxy token codec."""
    router = APIRouter(prefix="/back-proxy", tags=["back-proxy"])

    @router.post("/connections", response_model=BackProxyConnectResponse)
    async def create_connection(
        request: BackProxyConnectRequest,
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> BackProxyConnectResponse:
        token_codec = get_token_codec()
        if token_codec is None:
            raise HTTPException(status_code=503, detail="shell back proxy is not configured")
        try:
            principal = token_codec.decode_authorization_header(authorization)
        except BackProxyTokenError as exc:
            raise HTTPException(status_code=401, detail="invalid or missing back proxy authorization") from exc
        del request, principal
        return BackProxyConnectResponse(connection_id=str(uuid4()), status="connected")

    return router


__all__ = ["create_back_proxy_router"]
