"""Contracts shared by the OAuth token endpoint and its services."""

from dataclasses import dataclass
from enum import StrEnum
from http import HTTPStatus
from typing import Protocol

from services.oauth_device_contracts import PollPayload


class GrantType(StrEnum):
    AUTHORIZATION_CODE = "authorization_code"
    REFRESH_TOKEN = "refresh_token"
    DEVICE_CODE = "urn:ietf:params:oauth:grant-type:device_code"


class TokenErrorCode(StrEnum):
    INVALID_REQUEST = "invalid_request"
    INVALID_CLIENT = "invalid_client"
    INVALID_GRANT = "invalid_grant"
    UNAUTHORIZED_CLIENT = "unauthorized_client"
    UNSUPPORTED_GRANT_TYPE = "unsupported_grant_type"
    INVALID_SCOPE = "invalid_scope"
    INVALID_TARGET = "invalid_target"
    AUTHORIZATION_PENDING = "authorization_pending"
    SLOW_DOWN = "slow_down"
    EXPIRED_TOKEN = "expired_token"
    ACCESS_DENIED = "access_denied"
    TEMPORARILY_UNAVAILABLE = "temporarily_unavailable"

    @property
    def status(self) -> HTTPStatus:
        if self is TokenErrorCode.INVALID_CLIENT:
            return HTTPStatus.UNAUTHORIZED
        if self is TokenErrorCode.TEMPORARILY_UNAVAILABLE:
            return HTTPStatus.TOO_MANY_REQUESTS
        return HTTPStatus.BAD_REQUEST


class TokenEndpointError(Exception):
    def __init__(self, code: TokenErrorCode, status: HTTPStatus | None = None) -> None:
        super().__init__(code.value)
        self.code = code
        self.status = status or code.status


@dataclass(frozen=True)
class TokenRequest:
    grant_type: str
    client_id: str | None
    client_secret: str | None
    code: str | None
    code_verifier: str | None
    redirect_uri: str | None
    device_code: str | None
    refresh_token: str | None
    resource: str | None
    scope: str | None
    poll_ip: str
    request_origin: str


@dataclass(frozen=True)
class TokenGrantResult:
    payload: PollPayload
    refresh_token: str | None = None


class OAuthTokenSettings(Protocol):
    """Token endpoint settings; later tasks add properties."""
