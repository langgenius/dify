from dataclasses import dataclass, field
from http import HTTPStatus

import pytest

from services.oauth_token_contracts import GrantType, TokenEndpointError, TokenErrorCode, TokenGrantResult, TokenRequest
from services.oauth_token_service import OAuthTokenService


def _request(grant_type: str) -> TokenRequest:
    return TokenRequest(
        grant_type=grant_type,
        client_id="client",
        client_secret=None,
        code=None,
        code_verifier=None,
        redirect_uri=None,
        device_code=None,
        refresh_token=None,
        resource=None,
        scope=None,
        poll_ip="192.0.2.1",
        request_origin="https://dify.example/",
    )


@dataclass
class _RecordingHandler:
    result: TokenGrantResult
    seen: list[TokenRequest] = field(default_factory=list)

    def __call__(self, request: TokenRequest) -> TokenGrantResult:
        self.seen.append(request)
        return self.result


def _result() -> TokenGrantResult:
    return TokenGrantResult(
        payload={
            "token": "dfoa_x",
            "expires_at": "2030-01-01T00:00:00+00:00",
            "subject_type": "account",
            "account": None,
            "workspaces": [],
            "default_workspace_id": None,
            "token_id": "t1",
        }
    )


@pytest.mark.parametrize("grant_type", ["password", "", "urn:x:future", "AUTHORIZATION_CODE"])
def test_exchange_rejects_unknown_grant_type(grant_type: str) -> None:
    service = OAuthTokenService(handlers={})

    with pytest.raises(TokenEndpointError) as raised:
        service.exchange(_request(grant_type))

    assert raised.value.code == TokenErrorCode.UNSUPPORTED_GRANT_TYPE
    assert raised.value.status == 400


def test_exchange_rejects_known_grant_without_handler() -> None:
    handler = _RecordingHandler(_result())
    service = OAuthTokenService(handlers={GrantType.AUTHORIZATION_CODE: handler})

    with pytest.raises(TokenEndpointError) as raised:
        service.exchange(_request(GrantType.REFRESH_TOKEN))

    assert raised.value.code == TokenErrorCode.UNSUPPORTED_GRANT_TYPE
    assert handler.seen == []


def test_exchange_dispatches_to_registered_handler() -> None:
    handler = _RecordingHandler(_result())
    service = OAuthTokenService(handlers={GrantType.AUTHORIZATION_CODE: handler})
    request = _request("authorization_code")

    assert service.exchange(request) is handler.result
    assert handler.seen == [request]


@pytest.mark.parametrize(
    ("code", "status"),
    [
        (TokenErrorCode.INVALID_CLIENT, HTTPStatus.UNAUTHORIZED),
        (TokenErrorCode.TEMPORARILY_UNAVAILABLE, HTTPStatus.TOO_MANY_REQUESTS),
        (TokenErrorCode.INVALID_GRANT, HTTPStatus.BAD_REQUEST),
        (TokenErrorCode.SLOW_DOWN, HTTPStatus.BAD_REQUEST),
    ],
)
def test_token_error_code_owns_its_status(code: TokenErrorCode, status: HTTPStatus) -> None:
    assert code.status == status
    assert TokenEndpointError(code).status == status


def test_token_error_codes_keep_their_wire_values() -> None:
    assert [str(code) for code in TokenErrorCode] == [
        "invalid_request",
        "invalid_client",
        "invalid_grant",
        "unauthorized_client",
        "unsupported_grant_type",
        "invalid_scope",
        "invalid_target",
        "authorization_pending",
        "slow_down",
        "expired_token",
        "access_denied",
        "temporarily_unavailable",
    ]
    assert TokenErrorCode("invalid_grant") is TokenErrorCode.INVALID_GRANT
