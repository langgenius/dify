"""Dispatch of ``/oauth/token`` requests to per-grant handlers."""

from collections.abc import Mapping
from typing import Protocol

from services.oauth_token_contracts import GrantType, TokenEndpointError, TokenErrorCode, TokenGrantResult, TokenRequest


class GrantHandler(Protocol):
    def __call__(self, request: TokenRequest) -> TokenGrantResult: ...


class OAuthTokenService:
    def __init__(self, *, handlers: Mapping[GrantType, GrantHandler]) -> None:
        self._handlers = handlers

    def exchange(self, request: TokenRequest) -> TokenGrantResult:
        try:
            grant_type = GrantType(request.grant_type)
        except ValueError:
            raise TokenEndpointError(TokenErrorCode.UNSUPPORTED_GRANT_TYPE) from None
        handler = self._handlers.get(grant_type)
        if handler is None:
            raise TokenEndpointError(TokenErrorCode.UNSUPPORTED_GRANT_TYPE)
        return handler(request)
