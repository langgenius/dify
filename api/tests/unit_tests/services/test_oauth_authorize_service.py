from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest

from machinery.context import RequestContext
from repositories.oauth_authorization_code_repository import AuthorizationCodeRecord, RedisAuthorizationCodeRepository
from services.oauth_authorize_service import (
    AuthorizeErrorCode,
    AuthorizeRequest,
    AuthorizeRequestError,
    ConsentClientView,
    OAuthAuthorizeService,
)
from services.oauth_token_contracts import GrantType
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    ACCOUNT_ID,
    CHALLENGE,
    CONFIDENTIAL_ID,
    CONFIDENTIAL_REDIRECT,
    ISSUER,
    PUBLIC_ID,
    WORKSPACE_ID,
    DictRedis,
    FakeTokenSettings,
    confidential_client,
    public_client,
    registry,
)

CONTEXT = RequestContext(request_id="r1", trace_id=None, account_id=ACCOUNT_ID, active_workspace_id=WORKSPACE_ID)
QUERY_REDIRECT = "https://app.example/cb?tenant=a%20b&x=1"
INVALID_REGISTERED_REDIRECT = "http://evil.example/cb"
UNVERIFIED = [
    pytest.param({"client_id": "unknown"}, AuthorizeErrorCode.INVALID_CLIENT, id="unknown-client"),
    pytest.param({"client_id": "no-code-grant"}, AuthorizeErrorCode.INVALID_CLIENT, id="client-without-grant"),
    pytest.param(
        {"redirect_uri": "https://attacker.example/cb"}, AuthorizeErrorCode.INVALID_REDIRECT_URI, id="unregistered"
    ),
    pytest.param(
        {"redirect_uri": INVALID_REGISTERED_REDIRECT}, AuthorizeErrorCode.INVALID_REDIRECT_URI, id="registered-invalid"
    ),
    pytest.param(
        {"redirect_uri": CONFIDENTIAL_REDIRECT + "/extra"}, AuthorizeErrorCode.INVALID_REDIRECT_URI, id="prefix-only"
    ),
]


def _request(
    *,
    client_id: str = CONFIDENTIAL_ID,
    redirect_uri: str = CONFIDENTIAL_REDIRECT,
    code_challenge: str = CHALLENGE,
    code_challenge_method: str = "S256",
    resource: str | None = None,
    scope: str | None = None,
    state: str | None = "xyz",
) -> AuthorizeRequest:
    return AuthorizeRequest(
        client_id=client_id,
        redirect_uri=redirect_uri,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        resource=resource,
        scope=scope,
        state=state,
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
        confidential_client(redirect_uris=(CONFIDENTIAL_REDIRECT, QUERY_REDIRECT, INVALID_REGISTERED_REDIRECT)),
        confidential_client(client_id="no-code-grant", grant_types=frozenset({GrantType.REFRESH_TOKEN})),
        public_client(),
    )
    return OAuthAuthorizeService(clients=clients, codes=codes, settings=FakeTokenSettings())


def _query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlsplit(url).query, keep_blank_values=True)


def _code(url: str) -> str:
    return _query(url)["code"][0]


def test_describe_client_shows_redirect_host_and_https_is_not_localhost_only(service: OAuthAuthorizeService) -> None:
    view = service.describe_client(CONFIDENTIAL_ID, CONFIDENTIAL_REDIRECT)

    assert view == ConsentClientView(
        client_id=CONFIDENTIAL_ID,
        display_name="QwenWork",
        logo_uri="https://nango-qwenwork.cn/logo.png",
        redirect_host="nango-qwenwork.cn",
        localhost_only=False,
    )


def test_describe_client_flags_a_loopback_only_client(service: OAuthAuthorizeService) -> None:
    view = service.describe_client(PUBLIC_ID, "http://127.0.0.1:53412/callback")

    assert view.redirect_host == "127.0.0.1"
    assert view.localhost_only is True


@pytest.mark.parametrize(("overrides", "code"), UNVERIFIED)
def test_describe_client_rejects_unverified_client_or_redirect(
    service: OAuthAuthorizeService, overrides: dict[str, str], code: AuthorizeErrorCode
) -> None:
    request = _request(**overrides)

    with pytest.raises(AuthorizeRequestError) as caught:
        service.describe_client(request.client_id, request.redirect_uri)

    assert caught.value.code is code


def test_approve_binds_the_code_and_redirects_with_code_state_and_iss(
    service: OAuthAuthorizeService, codes: RedisAuthorizationCodeRepository, redis: DictRedis
) -> None:
    url = service.approve(CONTEXT, _request(scope="apps:run"), issuer=ISSUER)

    assert url.startswith(CONFIDENTIAL_REDIRECT + "?")
    query = _query(url)
    assert query["state"] == ["xyz"]
    assert query["iss"] == [ISSUER]
    assert list(redis.ttls.values()) == [timedelta(seconds=600)]
    assert codes.consume(_code(url)) == AuthorizationCodeRecord(
        client_id=CONFIDENTIAL_ID,
        redirect_uri=CONFIDENTIAL_REDIRECT,
        code_challenge=CHALLENGE,
        resource=ISSUER,
        scope="apps:run",
        account_id=ACCOUNT_ID,
        workspace_id=WORKSPACE_ID,
    )


def test_approve_uses_the_configured_code_ttl(codes: RedisAuthorizationCodeRepository, redis: DictRedis) -> None:
    service = OAuthAuthorizeService(
        clients=registry(confidential_client()),
        codes=codes,
        settings=FakeTokenSettings(authorization_code_ttl=timedelta(seconds=90)),
    )

    service.approve(CONTEXT, _request(), issuer=ISSUER)

    assert list(redis.ttls.values()) == [timedelta(seconds=90)]


def test_approve_keeps_the_client_query_and_encodes_added_values(service: OAuthAuthorizeService) -> None:
    url = service.approve(CONTEXT, _request(redirect_uri=QUERY_REDIRECT, state="a b&c=d"), issuer=ISSUER)

    assert url.startswith(QUERY_REDIRECT + "&code=")
    query = _query(url)
    assert query["tenant"] == ["a b"]
    assert query["x"] == ["1"]
    assert query["state"] == ["a b&c=d"]
    assert "&c=d" not in url


def test_approve_omits_state_when_absent(service: OAuthAuthorizeService) -> None:
    url = service.approve(CONTEXT, _request(state=None), issuer=ISSUER)

    assert set(_query(url)) == {"code", "iss"}


def test_approve_returns_to_the_requested_loopback_port(
    service: OAuthAuthorizeService, codes: RedisAuthorizationCodeRepository
) -> None:
    requested = "http://127.0.0.1:53412/callback"

    url = service.approve(CONTEXT, _request(client_id=PUBLIC_ID, redirect_uri=requested), issuer=ISSUER)

    assert url.startswith(requested + "?code=")
    record = codes.consume(_code(url))
    assert record is not None
    assert record.redirect_uri == requested


@pytest.mark.parametrize("resource", [None, ISSUER])
def test_approve_accepts_missing_or_canonical_resource(service: OAuthAuthorizeService, resource: str | None) -> None:
    assert "code=" in service.approve(CONTEXT, _request(resource=resource), issuer=ISSUER)


@pytest.mark.parametrize(("overrides", "code"), UNVERIFIED)
def test_approve_rejects_unverified_client_or_redirect_without_saving_a_code(
    service: OAuthAuthorizeService, redis: DictRedis, overrides: dict[str, str], code: AuthorizeErrorCode
) -> None:
    with pytest.raises(AuthorizeRequestError) as caught:
        service.approve(CONTEXT, _request(**overrides), issuer=ISSUER)

    assert caught.value.code is code
    assert redis.data == {}


@pytest.mark.parametrize(
    ("overrides", "error"),
    [
        pytest.param({"code_challenge_method": "plain"}, "invalid_request"),
        pytest.param({"code_challenge_method": ""}, "invalid_request", id="missing-method"),
        pytest.param({"code_challenge_method": "S512"}, "invalid_request"),
        pytest.param({"code_challenge_method": "s256"}, "invalid_request"),
        pytest.param({"code_challenge": ""}, "invalid_request", id="missing-challenge"),
        pytest.param({"code_challenge": "short"}, "invalid_request", id="short-challenge"),
        pytest.param({"code_challenge": "x" * 129}, "invalid_request", id="long-challenge"),
        pytest.param({"resource": "https://api.example"}, "invalid_target", id="bare-host"),
        pytest.param({"resource": "https://other.example/openapi/v1"}, "invalid_target"),
        pytest.param({"resource": ""}, "invalid_target", id="empty-resource"),
    ],
)
def test_approve_reports_a_bad_request_to_the_verified_redirect_without_saving_a_code(
    service: OAuthAuthorizeService, redis: DictRedis, overrides: dict[str, str], error: str
) -> None:
    url = service.approve(CONTEXT, _request(redirect_uri=QUERY_REDIRECT, **overrides), issuer=ISSUER)

    assert url.startswith(QUERY_REDIRECT + "&")
    query = _query(url)
    assert query["error"] == [error]
    assert query["state"] == ["xyz"]
    assert query["iss"] == [ISSUER]
    assert "code" not in query
    assert redis.data == {}


def test_deny_redirects_with_access_denied_state_and_iss(service: OAuthAuthorizeService, redis: DictRedis) -> None:
    url = service.deny(_request(redirect_uri=QUERY_REDIRECT), issuer=ISSUER)

    assert url.startswith(QUERY_REDIRECT + "&")
    query = _query(url)
    assert query["error"] == ["access_denied"]
    assert query["state"] == ["xyz"]
    assert query["iss"] == [ISSUER]
    assert "code" not in query
    assert redis.data == {}


def test_deny_does_not_need_a_valid_challenge(service: OAuthAuthorizeService) -> None:
    url = service.deny(_request(code_challenge="", code_challenge_method="plain"), issuer=ISSUER)

    assert _query(url)["error"] == ["access_denied"]


@pytest.mark.parametrize(("overrides", "code"), UNVERIFIED)
def test_deny_rejects_unverified_client_or_redirect(
    service: OAuthAuthorizeService, overrides: dict[str, str], code: AuthorizeErrorCode
) -> None:
    with pytest.raises(AuthorizeRequestError) as caught:
        service.deny(_request(**overrides), issuer=ISSUER)

    assert caught.value.code is code
