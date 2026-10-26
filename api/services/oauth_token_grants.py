"""Grant handlers registered into ``OAuthTokenService``."""

from collections.abc import Mapping
from typing import Protocol

from services.oauth_device_contracts import (
    AccessDeniedError,
    AuthorizationPendingError,
    ClientMismatchError,
    ExpiredTokenError,
    OAuthDeviceError,
    PollPayload,
    PollTooFastError,
)
from services.oauth_token_contracts import GrantType, TokenEndpointError, TokenErrorCode, TokenGrantResult, TokenRequest
from services.oauth_token_service import GrantHandler

_DEVICE_ERROR_TO_TOKEN_ERROR: Mapping[type[OAuthDeviceError], TokenErrorCode] = {
    PollTooFastError: TokenErrorCode.SLOW_DOWN,
    AuthorizationPendingError: TokenErrorCode.AUTHORIZATION_PENDING,
    AccessDeniedError: TokenErrorCode.ACCESS_DENIED,
    ExpiredTokenError: TokenErrorCode.EXPIRED_TOKEN,
    ClientMismatchError: TokenErrorCode.INVALID_CLIENT,
}


class DeviceGrantPoller(Protocol):
    def poll_device_grant(self, *, client_id: str, device_code: str, poll_ip: str) -> PollPayload: ...


class DeviceCodeGrantHandler:
    def __init__(self, device: DeviceGrantPoller) -> None:
        self._device = device

    def __call__(self, request: TokenRequest) -> TokenGrantResult:
        if not request.client_id or not request.device_code:
            raise TokenEndpointError(TokenErrorCode.INVALID_REQUEST)
        try:
            payload = self._device.poll_device_grant(
                client_id=request.client_id,
                device_code=request.device_code,
                poll_ip=request.poll_ip,
            )
        except OAuthDeviceError as error:
            code = _DEVICE_ERROR_TO_TOKEN_ERROR.get(type(error))
            if code is None:
                raise
            raise TokenEndpointError(code) from error
        return TokenGrantResult(payload=payload)


def build_grant_handlers(*, device: DeviceGrantPoller) -> Mapping[GrantType, GrantHandler]:
    return {GrantType.DEVICE_CODE: DeviceCodeGrantHandler(device)}
