from dataclasses import dataclass

import pytest

from services.oauth_device_contracts import (
    AccessDeniedError,
    AuthorizationPendingError,
    ClientMismatchError,
    ExpiredTokenError,
    OAuthDeviceError,
    PollPayload,
    PollTooFastError,
)
from services.oauth_token_contracts import GrantType, TokenEndpointError, TokenErrorCode, TokenRequest
from services.oauth_token_grants import DeviceCodeGrantHandler, build_grant_handlers

PAYLOAD: PollPayload = {
    "token": "secret-token",
    "expires_at": "2030-01-01T00:00:00+00:00",
    "subject_type": "account",
    "account": None,
    "workspaces": [],
    "default_workspace_id": None,
    "token_id": "token-1",
}


@dataclass
class FakeDevice:
    error: Exception | None = None
    calls: int = 0

    def poll_device_grant(self, *, client_id: str, device_code: str, poll_ip: str) -> PollPayload:
        _ = (client_id, device_code, poll_ip)
        self.calls += 1
        if self.error is not None:
            raise self.error
        return PAYLOAD


class UnmappedDeviceError(OAuthDeviceError):
    pass


def _handler(device: FakeDevice) -> DeviceCodeGrantHandler:
    return DeviceCodeGrantHandler(device)


def _request(*, client_id: str | None = "difyctl", device_code: str | None = "device-1") -> TokenRequest:
    return TokenRequest(
        grant_type=GrantType.DEVICE_CODE,
        client_id=client_id,
        client_secret=None,
        code=None,
        code_verifier=None,
        redirect_uri=None,
        device_code=device_code,
        refresh_token=None,
        resource=None,
        scope=None,
        poll_ip="127.0.0.1",
        request_origin="https://api.example",
    )


def test_device_grant_success_maps_to_token_response() -> None:
    result = _handler(FakeDevice())(_request())

    assert result.payload["token"] == "secret-token"
    assert result.refresh_token is None


@pytest.mark.parametrize(
    ("device_error", "token_error"),
    [
        (PollTooFastError, TokenErrorCode.SLOW_DOWN),
        (AuthorizationPendingError, TokenErrorCode.AUTHORIZATION_PENDING),
        (AccessDeniedError, TokenErrorCode.ACCESS_DENIED),
        (ExpiredTokenError, TokenErrorCode.EXPIRED_TOKEN),
        (ClientMismatchError, TokenErrorCode.INVALID_CLIENT),
    ],
)
def test_device_grant_errors_use_standard_names(
    device_error: type[OAuthDeviceError], token_error: TokenErrorCode
) -> None:
    with pytest.raises(TokenEndpointError) as caught:
        _handler(FakeDevice(error=device_error()))(_request())

    assert caught.value.code is token_error


def test_device_grant_unmapped_error_is_reraised() -> None:
    with pytest.raises(UnmappedDeviceError):
        _handler(FakeDevice(error=UnmappedDeviceError()))(_request())


@pytest.mark.parametrize(
    "request_kwargs",
    [{"client_id": None}, {"client_id": ""}, {"device_code": None}, {"device_code": ""}],
)
def test_device_grant_requires_client_and_code(request_kwargs: dict[str, str | None]) -> None:
    device = FakeDevice()

    with pytest.raises(TokenEndpointError) as caught:
        _handler(device)(_request(**request_kwargs))

    assert caught.value.code is TokenErrorCode.INVALID_REQUEST
    assert device.calls == 0


def test_build_grant_handlers_registers_device_code() -> None:
    handlers = build_grant_handlers(device=FakeDevice())

    assert isinstance(handlers[GrantType.DEVICE_CODE], DeviceCodeGrantHandler)
