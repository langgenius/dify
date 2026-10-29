from dataclasses import replace
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest

from machinery.context import RequestContext
from repositories.oauth_authorization_code_repository import AuthorizationCodeRecord, RedisAuthorizationCodeRepository
from services.oauth_authorize_service import (
    AuthorizeErrorCode,
    AuthorizeRequest,
    AuthorizeRequestError,
    OAuthAuthorizeService,
)
from services.oauth_token_contracts import GrantType
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    ACCOUNT_ID,
    CHALLENGE,
    ISSUER,
    NATIVE_ID,
    WEB_ID,
    WEB_REDIRECT,
    WORKSPACE_ID,
    DictRedis,
    native_client,
    registry,
    web_client,
)

CONTEXT = RequestContext(request_id="r1", trace_id=None, account_id=ACCOUNT_ID, active_workspace_id=WORKSPACE_ID)
QUERY_REDIRECT = "https://app.example/cb?tenant=a%20b&x=1"
INVALID_REGISTERED_REDIRECT = "http://evil.example/cb"
LOOPBACK_REDIRECT = "http://127.0.0.1:53412/callback"


REQUEST = AuthorizeRequest(
    client_id=WEB_ID,
    redirect_uri=WEB_REDIRECT,
    code_challenge=CHALLENGE,
    code_challenge_method="S256",
    resource=None,
    scope=None,
    state="xyz",
)


@pytest.fixture
def redis() -> DictRedis:
    return DictRedis()


@pytest.fixture
def codes(redis: DictRedis) -> RedisAuthorizationCodeRepository:
    return RedisAuthorizationCodeRepository(redis)


@pytest.fixture
def service(codes: RedisAuthorizationCodeRepository) -> OAuthAuthorizeService:
    clients = registry(
        web_client(redirect_uris=(WEB_REDIRECT, QUERY_REDIRECT, INVALID_REGISTERED_REDIRECT)),
        web_client(client_id="no-code-grant", grant_types=frozenset({GrantType.REFRESH_TOKEN})),
        native_client(),
    )
    return OAuthAuthorizeService(clients=clients, codes=codes)


def _query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlsplit(url).query, keep_blank_values=True)


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        pytest.param({"client_id": "unknown"}, AuthorizeErrorCode.INVALID_CLIENT, id="unknown-client"),
        pytest.param({"client_id": "no-code-grant"}, AuthorizeErrorCode.INVALID_CLIENT, id="client-without-grant"),
        pytest.param(
            {"redirect_uri": "https://attacker.example/cb"}, AuthorizeErrorCode.INVALID_REDIRECT_URI, id="unregistered"
        ),
        pytest.param(
            {"redirect_uri": INVALID_REGISTERED_REDIRECT},
            AuthorizeErrorCode.INVALID_REDIRECT_URI,
            id="registered-invalid",
        ),
    ],
)
def test_unverified_client_or_redirect_is_refused_without_a_redirect_or_code(
    service: OAuthAuthorizeService, redis: DictRedis, overrides: dict[str, str], code: AuthorizeErrorCode
) -> None:
    request = replace(REQUEST, **overrides)
    calls = [
        lambda: service.describe_client(request.client_id, request.redirect_uri),
        lambda: service.approve(CONTEXT, request, issuer=ISSUER),
        lambda: service.deny(request, issuer=ISSUER),
    ]

    for call in calls:
        with pytest.raises(AuthorizeRequestError) as caught:
            call()
        assert caught.value.code is code
    assert redis.data == {}


def test_approve_binds_the_code_and_redirects_with_code_state_and_iss(
    service: OAuthAuthorizeService, codes: RedisAuthorizationCodeRepository, redis: DictRedis
) -> None:
    url = service.approve(CONTEXT, replace(REQUEST, scope="apps:run"), issuer=ISSUER)

    assert url.startswith(WEB_REDIRECT + "?")
    query = _query(url)
    assert (query["state"], query["iss"]) == (["xyz"], [ISSUER])
    assert list(redis.ttls.values()) == [timedelta(seconds=600)]
    assert codes.consume(query["code"][0]) == AuthorizationCodeRecord(
        client_id=WEB_ID,
        redirect_uri=WEB_REDIRECT,
        code_challenge=CHALLENGE,
        resource=ISSUER,
        scope="apps:run",
        account_id=ACCOUNT_ID,
        workspace_id=WORKSPACE_ID,
    )


def test_approve_returns_to_the_requested_loopback_port(
    service: OAuthAuthorizeService, codes: RedisAuthorizationCodeRepository
) -> None:
    url = service.approve(CONTEXT, replace(REQUEST, client_id=NATIVE_ID, redirect_uri=LOOPBACK_REDIRECT), issuer=ISSUER)

    assert url.startswith(LOOPBACK_REDIRECT + "?code=")
    record = codes.consume(_query(url)["code"][0])
    assert record is not None
    assert record.redirect_uri == LOOPBACK_REDIRECT


@pytest.mark.parametrize(
    ("overrides", "error"),
    [
        pytest.param({"code_challenge_method": "plain"}, "invalid_request"),
        pytest.param({"code_challenge": "short"}, "invalid_request", id="short-challenge"),
        pytest.param({"resource": "https://other.example/openapi/v1"}, "invalid_target"),
    ],
)
def test_approve_reports_a_bad_request_to_the_verified_redirect_without_saving_a_code(
    service: OAuthAuthorizeService, redis: DictRedis, overrides: dict[str, str], error: str
) -> None:
    url = service.approve(CONTEXT, replace(REQUEST, redirect_uri=QUERY_REDIRECT, **overrides), issuer=ISSUER)

    assert url.startswith(QUERY_REDIRECT + "&")
    query = _query(url)
    assert (query["error"], query["state"], query["iss"]) == ([error], ["xyz"], [ISSUER])
    assert "code" not in query
    assert redis.data == {}


def test_deny_redirects_with_access_denied_and_needs_no_valid_challenge(
    service: OAuthAuthorizeService, redis: DictRedis
) -> None:
    url = service.deny(replace(REQUEST, code_challenge="", code_challenge_method="plain"), issuer=ISSUER)

    query = _query(url)
    assert (query["error"], query["state"], query["iss"]) == (["access_denied"], ["xyz"], [ISSUER])
    assert "code" not in query
    assert redis.data == {}
