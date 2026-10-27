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


def _handler() -> _RecordingHandler:
    return _RecordingHandler(
        TokenGrantResult(
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
    )


@pytest.mark.parametrize("grant_type", ["password", "AUTHORIZATION_CODE", GrantType.REFRESH_TOKEN])
def test_exchange_rejects_unknown_or_unregistered_grant_type(grant_type: str) -> None:
    handler = _handler()
    service = OAuthTokenService(handlers={GrantType.AUTHORIZATION_CODE: handler})

    with pytest.raises(TokenEndpointError) as raised:
        service.exchange(_request(grant_type))

    assert raised.value.code == TokenErrorCode.UNSUPPORTED_GRANT_TYPE
    assert raised.value.status == HTTPStatus.BAD_REQUEST
    assert handler.seen == []


def test_exchange_dispatches_to_registered_handler() -> None:
    handler = _handler()
    service = OAuthTokenService(handlers={GrantType.AUTHORIZATION_CODE: handler})
    request = _request("authorization_code")

    assert service.exchange(request) is handler.result
    assert handler.seen == [request]
