from http import HTTPStatus

import pytest

from libs.rate_limit import LIMIT_CLIENT_AUTH_FAILURE, limiter_prefix
from services.oauth_client_auth import authenticate_client
from services.oauth_clients import OAuthClientRegistry
from services.oauth_token_contracts import TokenEndpointError, TokenErrorCode
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    CONFIDENTIAL_ID,
    CONFIDENTIAL_SECRET,
    PUBLIC_ID,
    RateLimitHits,
    confidential_client,
    install_rate_limit_store,
    public_client,
    registry,
)


@pytest.fixture
def hits(monkeypatch: pytest.MonkeyPatch) -> RateLimitHits:
    return install_rate_limit_store(monkeypatch)


@pytest.fixture
def clients() -> OAuthClientRegistry:
    return registry(confidential_client(), confidential_client(client_id="other"), public_client())


IP_A = "192.0.2.10"
IP_B = "198.51.100.20"


def _failure_key(client_id: str, ip: str = IP_A) -> str:
    return f"{limiter_prefix(LIMIT_CLIENT_AUTH_FAILURE)}:client:{client_id}:ip:{ip}"


def _authenticate(clients: OAuthClientRegistry, client_id: str | None, secret: str | None, ip: str = IP_A) -> str:
    return authenticate_client(clients, client_id=client_id, client_secret=secret, source_ip=ip).client_id


def _code(clients: OAuthClientRegistry, client_id: str | None, secret: str | None, ip: str = IP_A) -> TokenErrorCode:
    with pytest.raises(TokenEndpointError) as caught:
        _authenticate(clients, client_id, secret, ip)
    return caught.value.code


def test_confidential_and_public_clients_authenticate_without_counting(
    clients: OAuthClientRegistry, hits: RateLimitHits
) -> None:
    assert _authenticate(clients, CONFIDENTIAL_ID, CONFIDENTIAL_SECRET) == CONFIDENTIAL_ID
    assert _authenticate(clients, PUBLIC_ID, None) == PUBLIC_ID
    assert hits.hits == {}


@pytest.mark.parametrize(
    ("client_id", "secret"),
    [
        (CONFIDENTIAL_ID, "wrong"),
        (CONFIDENTIAL_ID, None),
        (PUBLIC_ID, "a-secret-from-a-public-client"),
    ],
)
def test_bad_secret_for_a_known_client_is_invalid_client_401_and_counts(
    clients: OAuthClientRegistry, hits: RateLimitHits, client_id: str, secret: str | None
) -> None:
    with pytest.raises(TokenEndpointError) as caught:
        _authenticate(clients, client_id, secret)

    assert caught.value.code is TokenErrorCode.INVALID_CLIENT
    assert caught.value.status == HTTPStatus.UNAUTHORIZED
    assert hits.hits == {_failure_key(client_id): 1}


@pytest.mark.parametrize("client_id", [None, ""])
def test_missing_client_id_is_invalid_client_without_a_bucket(
    clients: OAuthClientRegistry, hits: RateLimitHits, client_id: str | None
) -> None:
    assert _code(clients, client_id, CONFIDENTIAL_SECRET) is TokenErrorCode.INVALID_CLIENT
    assert hits.hits == {}


def test_unknown_client_is_never_counted_or_limited(clients: OAuthClientRegistry, hits: RateLimitHits) -> None:
    for _ in range(11):
        assert _code(clients, "unknown-" + "x" * 500, "anything") is TokenErrorCode.INVALID_CLIENT

    assert hits.hits == {}


def test_ten_failures_lock_that_client_from_that_ip_only(clients: OAuthClientRegistry, hits: RateLimitHits) -> None:
    for _ in range(10):
        assert _code(clients, CONFIDENTIAL_ID, "wrong") is TokenErrorCode.INVALID_CLIENT

    with pytest.raises(TokenEndpointError) as caught:
        _authenticate(clients, CONFIDENTIAL_ID, CONFIDENTIAL_SECRET)

    assert caught.value.code is TokenErrorCode.TEMPORARILY_UNAVAILABLE
    assert caught.value.status == HTTPStatus.TOO_MANY_REQUESTS
    assert _authenticate(clients, CONFIDENTIAL_ID, CONFIDENTIAL_SECRET, IP_B) == CONFIDENTIAL_ID
    assert _authenticate(clients, "other", CONFIDENTIAL_SECRET) == "other"
    assert hits.hits == {_failure_key(CONFIDENTIAL_ID): 10}


def test_successes_do_not_count_toward_the_limit(clients: OAuthClientRegistry, hits: RateLimitHits) -> None:
    for _ in range(20):
        _authenticate(clients, CONFIDENTIAL_ID, CONFIDENTIAL_SECRET)
    for _ in range(9):
        _code(clients, CONFIDENTIAL_ID, "wrong")

    assert _authenticate(clients, CONFIDENTIAL_ID, CONFIDENTIAL_SECRET) == CONFIDENTIAL_ID
    assert hits.hits == {_failure_key(CONFIDENTIAL_ID): 9}
