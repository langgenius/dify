from http import HTTPStatus

import pytest

from services.oauth_client_auth import authenticate_client
from services.oauth_clients import OAuthClientRegistry
from services.oauth_token_contracts import TokenEndpointError, TokenErrorCode
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    NATIVE_ID,
    WEB_ID,
    native_client,
    registry,
    web_client,
)


@pytest.fixture
def clients() -> OAuthClientRegistry:
    return registry(web_client(), native_client())


def test_a_known_client_without_a_secret_authenticates(clients: OAuthClientRegistry) -> None:
    assert authenticate_client(clients, client_id=WEB_ID, client_secret=None).client_id == WEB_ID
    assert authenticate_client(clients, client_id=NATIVE_ID, client_secret=None).client_id == NATIVE_ID


@pytest.mark.parametrize(
    ("client_id", "secret"),
    [
        pytest.param(WEB_ID, "a-secret", id="secret-sent"),
        pytest.param(None, None, id="no-client-id"),
        pytest.param("unknown-" + "x" * 500, None, id="unknown-client"),
    ],
)
def test_a_secret_or_an_unknown_client_is_invalid_client_401(
    clients: OAuthClientRegistry, client_id: str | None, secret: str | None
) -> None:
    with pytest.raises(TokenEndpointError) as caught:
        authenticate_client(clients, client_id=client_id, client_secret=secret)

    assert caught.value.code is TokenErrorCode.INVALID_CLIENT
    assert caught.value.status == HTTPStatus.UNAUTHORIZED
