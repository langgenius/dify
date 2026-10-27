from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import timedelta
from http import HTTPStatus
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from machinery.context import RequestContext
from models.oauth import OAuthAccessToken
from repositories.oauth_authorization_code_repository import RedisAuthorizationCodeRepository
from repositories.oauth_device_token_repository import SQLAlchemyOAuthDeviceTokenRepository
from repositories.oauth_server_repository import RedisOAuthServerTokenRepository
from services.entities.oauth_server_entities import OAuthProviderAccountRecord, OAuthProviderAppRecord
from services.oauth_authorize_service import AuthorizeRequest, OAuthAuthorizeService
from services.oauth_device_adapters import OAuthDeviceTokenIssuanceGateway
from services.oauth_device_application_service import OAuthDeviceTokenIssuer
from services.oauth_device_contracts import (
    AccessDeniedError,
    AuthorizationPendingError,
    ClientMismatchError,
    ExpiredTokenError,
    OAuthDeviceError,
    PollPayload,
    PollTooFastError,
)
from services.oauth_server_service import OAuthServerRequestError, OAuthServerService
from services.oauth_token_contracts import GrantType, TokenEndpointError, TokenErrorCode, TokenRequest
from services.oauth_token_grants import AuthorizationCodeGrantHandler, DeviceCodeGrantHandler, build_grant_handlers
from services.oauth_token_service import GrantHandler, OAuthTokenService
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    ACCOUNT_ID,
    CHALLENGE,
    CONFIDENTIAL_ID,
    CONFIDENTIAL_REDIRECT,
    CONFIDENTIAL_SECRET,
    ISSUER,
    PUBLIC_ID,
    VERIFIER,
    WORKSPACE_ID,
    DictRedis,
    FakeAccounts,
    FakeTokenIssuer,
    FakeTokenSettings,
    FakeWorkspaces,
    RateLimitHits,
    confidential_client,
    install_rate_limit_store,
    public_client,
    registry,
)

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


@dataclass
class _RawCacheRedis:
    deleted: list[str | bytes] = field(default_factory=list)

    def delete(self, *names: str | bytes) -> None:
        self.deleted.extend(names)


@dataclass
class _FixedTTLPolicy:
    def ttl_days(self, workspace_id: str | None) -> int:
        _ = workspace_id
        return 14


@dataclass
class _AuthCodeWorld:
    handler: AuthorizationCodeGrantHandler
    authorize: OAuthAuthorizeService
    codes: RedisAuthorizationCodeRepository
    tokens: FakeTokenIssuer
    accounts: FakeAccounts


def _auth_code_world(*, tokens: OAuthDeviceTokenIssuer | None = None, redis: DictRedis | None = None) -> _AuthCodeWorld:
    clients = registry(
        confidential_client(),
        confidential_client(client_id="other"),
        confidential_client(client_id="device-only", grant_types=frozenset({GrantType.DEVICE_CODE})),
        public_client(),
    )
    codes = RedisAuthorizationCodeRepository(redis or DictRedis())
    fake_tokens = FakeTokenIssuer()
    accounts = FakeAccounts()
    settings = FakeTokenSettings()
    handler = AuthorizationCodeGrantHandler(
        clients=clients,
        codes=codes,
        accounts=accounts,
        workspaces=FakeWorkspaces(),
        tokens=tokens or fake_tokens,
        settings=settings,
    )
    authorize = OAuthAuthorizeService(clients=clients, codes=codes, settings=settings)
    return _AuthCodeWorld(handler=handler, authorize=authorize, codes=codes, tokens=fake_tokens, accounts=accounts)


def _approve(
    world: _AuthCodeWorld, *, client_id: str = CONFIDENTIAL_ID, redirect_uri: str = CONFIDENTIAL_REDIRECT
) -> str:
    url = world.authorize.approve(
        AUTH_CONTEXT,
        AuthorizeRequest(
            client_id=client_id,
            redirect_uri=redirect_uri,
            code_challenge=CHALLENGE,
            code_challenge_method="S256",
            resource=None,
            scope=None,
            state="st",
        ),
        issuer=ISSUER,
    )
    return parse_qs(urlsplit(url).query)["code"][0]


def _code_request(
    code: str | None,
    *,
    client_id: str | None = CONFIDENTIAL_ID,
    client_secret: str | None = CONFIDENTIAL_SECRET,
    code_verifier: str | None = VERIFIER,
    redirect_uri: str | None = CONFIDENTIAL_REDIRECT,
    resource: str | None = None,
) -> TokenRequest:
    return TokenRequest(
        grant_type=GrantType.AUTHORIZATION_CODE,
        client_id=client_id,
        client_secret=client_secret,
        code=code,
        code_verifier=code_verifier,
        redirect_uri=redirect_uri,
        device_code=None,
        refresh_token=None,
        resource=resource,
        scope=None,
        poll_ip="127.0.0.1",
        request_origin="https://api.example/",
    )


def _token_error(world: _AuthCodeWorld, request: TokenRequest) -> TokenEndpointError:
    with pytest.raises(TokenEndpointError) as caught:
        world.handler(request)
    return caught.value


AUTH_CONTEXT = RequestContext(request_id="r1", trace_id=None, account_id=ACCOUNT_ID, active_workspace_id=WORKSPACE_ID)


@pytest.fixture
def client_auth_hits(monkeypatch: pytest.MonkeyPatch) -> RateLimitHits:
    return install_rate_limit_store(monkeypatch)


@pytest.fixture
def issuer_from_origin(config_overrides: Callable[..., None]) -> None:
    config_overrides(CONSOLE_API_URL="")


@pytest.mark.usefixtures("client_auth_hits", "issuer_from_origin")
class TestAuthorizationCodeGrantCases:
    @staticmethod
    def test_confidential_client_without_resource_redeems_with_pkce() -> None:
        world = _auth_code_world()

        result = world.handler(_code_request(_approve(world)))

        assert result.payload["token"] == "dfoa_token-1"
        assert result.payload["subject_type"] == "account"
        assert result.payload["default_workspace_id"] == WORKSPACE_ID
        assert result.refresh_token is None
        [call] = world.tokens.calls
        assert (call.account_id, call.workspace_id, call.client_id) == (ACCOUNT_ID, WORKSPACE_ID, CONFIDENTIAL_ID)
        assert call.lifetime == timedelta(hours=24)
        assert call.device_label.startswith("QwenWork (")

    @staticmethod
    def test_public_loopback_client_redeems_on_the_port_it_used() -> None:
        world = _auth_code_world()
        redirect = "http://127.0.0.1:53412/callback"
        code = _approve(world, client_id=PUBLIC_ID, redirect_uri=redirect)

        result = world.handler(_code_request(code, client_id=PUBLIC_ID, client_secret=None, redirect_uri=redirect))

        assert result.payload["token"] == "dfoa_token-1"

    @staticmethod
    def test_canonical_resource_is_accepted() -> None:
        world = _auth_code_world()

        assert world.handler(_code_request(_approve(world), resource=ISSUER)).payload["token"]

    @staticmethod
    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({"code_verifier": "w" * 43}, id="wrong-verifier"),
            pytest.param({"code_verifier": None}, id="missing-verifier"),
            pytest.param({"code_verifier": CHALLENGE}, id="challenge-as-verifier"),
            pytest.param({"redirect_uri": CONFIDENTIAL_REDIRECT + "?x=1"}, id="other-redirect"),
            pytest.param({"redirect_uri": None}, id="missing-redirect"),
        ],
    )
    def test_mismatch_is_invalid_grant_and_burns_the_code(overrides: dict[str, str | None]) -> None:
        world = _auth_code_world()
        code = _approve(world)

        assert _token_error(world, _code_request(code, **overrides)).code is TokenErrorCode.INVALID_GRANT
        assert _token_error(world, _code_request(code)).code is TokenErrorCode.INVALID_GRANT
        assert world.tokens.calls == []

    @staticmethod
    @pytest.mark.parametrize("code", [None, "", "not-a-code"])
    def test_missing_or_unknown_code_is_invalid_grant(code: str | None) -> None:
        assert _token_error(_auth_code_world(), _code_request(code)).code is TokenErrorCode.INVALID_GRANT

    @staticmethod
    def test_reused_code_is_invalid_grant() -> None:
        world = _auth_code_world()
        code = _approve(world)
        world.handler(_code_request(code))

        assert _token_error(world, _code_request(code)).code is TokenErrorCode.INVALID_GRANT
        assert len(world.tokens.calls) == 1

    @staticmethod
    def test_code_saved_for_one_client_is_rejected_for_another() -> None:
        world = _auth_code_world()
        code = _approve(world)

        error = _token_error(world, _code_request(code, client_id="other"))

        assert error.code is TokenErrorCode.INVALID_GRANT

    @staticmethod
    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({"client_secret": "wrong"}, id="wrong-secret"),
            pytest.param({"client_secret": None}, id="confidential-without-secret"),
            pytest.param({"client_id": PUBLIC_ID, "client_secret": "a-secret"}, id="public-with-secret"),
            pytest.param({"client_id": "unknown"}, id="unknown-client"),
            pytest.param({"client_id": None}, id="missing-client"),
        ],
    )
    def test_client_auth_failure_is_invalid_client_and_leaves_the_code(overrides: dict[str, str | None]) -> None:
        world = _auth_code_world()
        code = _approve(world)

        error = _token_error(world, _code_request(code, **overrides))

        assert error.code is TokenErrorCode.INVALID_CLIENT
        assert error.status == HTTPStatus.UNAUTHORIZED
        assert world.handler(_code_request(code)).payload["token"]

    @staticmethod
    def test_client_without_the_grant_is_unauthorized_client() -> None:
        world = _auth_code_world()

        error = _token_error(world, _code_request("any", client_id="device-only"))

        assert error.code is TokenErrorCode.UNAUTHORIZED_CLIENT

    @staticmethod
    @pytest.mark.parametrize("resource", ["https://api.example", "https://other.example/openapi/v1", ""])
    def test_unknown_resource_is_invalid_target(resource: str) -> None:
        world = _auth_code_world()

        error = _token_error(world, _code_request(_approve(world), resource=resource))

        assert error.code is TokenErrorCode.INVALID_TARGET
        assert world.tokens.calls == []

    @staticmethod
    def test_deleted_account_is_invalid_grant() -> None:
        world = _auth_code_world()
        code = _approve(world)
        world.accounts.accounts.clear()

        assert _token_error(world, _code_request(code)).code is TokenErrorCode.INVALID_GRANT

    @staticmethod
    def test_two_logins_of_one_user_and_client_keep_two_live_rows(
        sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        cache = RedisClientWrapper()
        cache.initialize(_RawCacheRedis())  # type: ignore[arg-type]
        issuer = OAuthDeviceTokenIssuanceGateway(
            tokens=SQLAlchemyOAuthDeviceTokenRepository(
                session_factory=sqlite_session_factory, redis=cache, max_sessions_per_account=15
            ),
            ttl_policy=_FixedTTLPolicy(),
        )
        world = _auth_code_world(tokens=issuer)

        first = world.handler(_code_request(_approve(world)))
        second = world.handler(_code_request(_approve(world)))

        live = sqlite_session.scalars(select(OAuthAccessToken).where(OAuthAccessToken.revoked_at.is_(None))).all()
        assert {row.id for row in live} == {first.payload["token_id"], second.payload["token_id"]}
        assert {row.client_id for row in live} == {CONFIDENTIAL_ID}
        assert len({row.device_label for row in live}) == 2


@pytest.mark.usefixtures("client_auth_hits", "issuer_from_origin")
class TestAuthorizationCodeCrossSystemCases:
    @staticmethod
    @pytest.fixture
    def shared_redis(config_overrides: Callable[..., None]) -> tuple[DictRedis, RedisClientWrapper]:
        config_overrides(REDIS_KEY_PREFIX="")
        raw = DictRedis()
        wrapper = RedisClientWrapper()
        wrapper.initialize(raw)  # type: ignore[arg-type]
        return raw, wrapper

    @staticmethod
    def test_creators_platform_code_is_invalid_grant_here(shared_redis: tuple[DictRedis, RedisClientWrapper]) -> None:
        raw, wrapper = shared_redis
        legacy_code = RedisOAuthServerTokenRepository(wrapper).issue_authorization_code(CONFIDENTIAL_ID, ACCOUNT_ID)
        world = _auth_code_world(redis=raw)

        error = _token_error(world, _code_request(legacy_code))

        assert error.code is TokenErrorCode.INVALID_GRANT
        assert len(raw.data) == 1

    @staticmethod
    def test_openapi_code_is_rejected_by_the_creators_platform(
        shared_redis: tuple[DictRedis, RedisClientWrapper],
    ) -> None:
        raw, wrapper = shared_redis
        world = _auth_code_world(redis=raw)
        code = _approve(world)
        legacy = OAuthServerService(
            repository=_ProviderApps(),
            tokens=RedisOAuthServerTokenRepository(wrapper),
            access_token_expires_in=3600,
        )

        with pytest.raises(OAuthServerRequestError, match="invalid code"):
            legacy.exchange_token(
                client_id=CONFIDENTIAL_ID,
                grant_type="authorization_code",
                code=code,
                client_secret=CONFIDENTIAL_SECRET,
                redirect_uri=CONFIDENTIAL_REDIRECT,
                refresh_token=None,
            )
        assert world.handler(_code_request(code)).payload["token"]


@dataclass
class _ProviderApps:
    def get_provider_app_by_client_id(self, client_id: str) -> OAuthProviderAppRecord | None:
        return OAuthProviderAppRecord(
            app_icon="icon",
            client_id=client_id,
            client_secret=CONFIDENTIAL_SECRET,
            app_label={"en-US": "Same id"},
            redirect_uris=(CONFIDENTIAL_REDIRECT,),
            scope="read",
            auto_authorize=False,
        )

    def get_account_by_id(self, account_id: str) -> OAuthProviderAccountRecord | None:
        _ = account_id
        return None


def test_build_grant_handlers_registers_authorization_code_only_when_enabled() -> None:
    def handlers(enabled: bool) -> Mapping[GrantType, GrantHandler]:
        return build_grant_handlers(
            device=FakeDevice(),
            clients=registry(confidential_client()),
            codes=RedisAuthorizationCodeRepository(DictRedis()),
            accounts=FakeAccounts(),
            workspaces=FakeWorkspaces(),
            tokens=FakeTokenIssuer(),
            settings=FakeTokenSettings(authorization_code_enabled=enabled),
        )

    assert isinstance(handlers(True)[GrantType.AUTHORIZATION_CODE], AuthorizationCodeGrantHandler)
    disabled = handlers(False)
    assert GrantType.AUTHORIZATION_CODE not in disabled
    assert isinstance(disabled[GrantType.DEVICE_CODE], DeviceCodeGrantHandler)
    with pytest.raises(TokenEndpointError) as caught:
        OAuthTokenService(handlers=disabled).exchange(_code_request("any"))
    assert caught.value.code is TokenErrorCode.UNSUPPORTED_GRANT_TYPE
