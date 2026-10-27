import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from enum import Enum, StrEnum
from http import HTTPStatus
from typing import override
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, sessionmaker

import services.oauth_token_grants as token_grants_module
from extensions.ext_redis import RedisClientWrapper
from libs.oauth_bearer import OAuthAccessTokenResolver, sha256_hex
from machinery.context import AccountRequestContext, RequestContext
from models.oauth import OpenAPIOAuthAccessToken, OpenAPIOAuthRefreshToken
from repositories.oauth_access_token_repository import SQLAlchemyOAuthAccessTokenRepository
from repositories.oauth_authorization_code_repository import RedisAuthorizationCodeRepository
from repositories.oauth_device_token_repository import SQLAlchemyOAuthDeviceTokenRepository
from repositories.oauth_refresh_token_repository import (
    REFRESH_TOKEN_PREFIX,
    RefreshTokenRecord,
    SQLAlchemyOAuthRefreshTokenRepository,
)
from repositories.oauth_server_repository import RedisOAuthServerTokenRepository
from services.account_access_service import AccountAccessService
from services.entities.account_access_entities import AccountWorkspaceSnapshot
from services.entities.oauth_server_entities import OAuthProviderAccountRecord, OAuthProviderAppRecord
from services.oauth_authorize_service import AuthorizeRequest, OAuthAuthorizeService
from services.oauth_cimd import UNLIMITED_FETCHES, CimdClientSource, CimdResponse, cimd_storage_id
from services.oauth_clients import ClientSource, OAuthClientRegistry
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
    RefreshTokenIssue,
    UnsupportedClientError,
)
from services.oauth_grant_revoker import GrantRevoker, OAuthRevocationService, RevokeRequest
from services.oauth_server_service import OAuthServerRequestError, OAuthServerService
from services.oauth_token_contracts import (
    GrantType,
    TokenEndpointError,
    TokenErrorCode,
    TokenGrantResult,
    TokenRequest,
)
from services.oauth_token_grants import (
    AuthorizationCodeGrantHandler,
    DeviceCodeGrantHandler,
    RefreshTokenGrantHandler,
    build_grant_handlers,
)
from services.oauth_token_service import GrantHandler, OAuthTokenService
from tests.helpers.unit.repositories.oauth_lock_order import LockLog, record_locks
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
    account_snapshot,
    confidential_client,
    install_rate_limit_store,
    public_client,
    registry,
)

# "suspended" stands for a status a later version may add.
INACTIVE_ACCOUNT_STATUSES = ("banned", "closed", "pending", "uninitialized", "suspended")

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


def _request(
    *, client_id: str | None = "difyctl", device_code: str | None = "device-1", resource: str | None = None
) -> TokenRequest:
    return TokenRequest(
        grant_type=GrantType.DEVICE_CODE,
        client_id=client_id,
        client_secret=None,
        code=None,
        code_verifier=None,
        redirect_uri=None,
        device_code=device_code,
        refresh_token=None,
        resource=resource,
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
        (UnsupportedClientError, TokenErrorCode.INVALID_CLIENT),
    ],
)
def test_device_grant_errors_use_standard_names(
    device_error: type[OAuthDeviceError], token_error: TokenErrorCode
) -> None:
    with pytest.raises(TokenEndpointError) as caught:
        _handler(FakeDevice(error=device_error()))(_request())

    assert caught.value.code is token_error


@pytest.mark.parametrize("resource", ["https://api.example", "https://other.example/openapi/v1"])
def test_device_grant_unknown_resource_is_invalid_target(resource: str) -> None:
    device = FakeDevice()
    with pytest.raises(TokenEndpointError) as caught:
        _handler(device)(_request(resource=resource))

    assert caught.value.code is TokenErrorCode.INVALID_TARGET
    assert device.calls == 0


def test_device_grant_canonical_resource_is_accepted() -> None:
    assert _handler(FakeDevice())(_request(resource=ISSUER)).payload


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
    negative: list[str | bytes] = field(default_factory=list)

    def delete(self, *names: str | bytes) -> None:
        self.deleted.extend(names)

    def setex(self, name: str | bytes, time: int | timedelta, value: str | bytes) -> bool:
        _ = time, value
        self.negative.append(name)
        return True


@dataclass
class _FixedTTLPolicy:
    def ttl_days(self, workspace_id: str | None) -> int:
        _ = workspace_id
        return 14


@dataclass
class _RecordingClientUsage:
    marked: list[str] = field(default_factory=list)
    failure: Exception | None = None

    def mark_token_issued(self, client_id: str) -> None:
        if self.failure is not None:
            raise self.failure
        self.marked.append(client_id)


@dataclass
class _AuthCodeWorld:
    handler: AuthorizationCodeGrantHandler
    usage: _RecordingClientUsage
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
    usage = _RecordingClientUsage()
    handler = AuthorizationCodeGrantHandler(
        clients=clients,
        codes=codes,
        accounts=accounts,
        workspaces=FakeWorkspaces(),
        tokens=tokens or fake_tokens,
        settings=settings,
        usage=usage,
    )
    authorize = OAuthAuthorizeService(clients=clients, codes=codes, settings=settings)
    return _AuthCodeWorld(
        handler=handler, usage=usage, authorize=authorize, codes=codes, tokens=fake_tokens, accounts=accounts
    )


def _approve(
    world: "_AuthCodeWorld | _RefreshWorld",
    *,
    client_id: str = CONFIDENTIAL_ID,
    redirect_uri: str = CONFIDENTIAL_REDIRECT,
    context: RequestContext | None = None,
    issuer: str = ISSUER,
) -> str:
    url = world.authorize.approve(
        context or AUTH_CONTEXT,
        AuthorizeRequest(
            client_id=client_id,
            redirect_uri=redirect_uri,
            code_challenge=CHALLENGE,
            code_challenge_method="S256",
            resource=None,
            scope=None,
            state="st",
        ),
        issuer=issuer,
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


# The browser reached Dify by another name than the token request (IP vs DNS, an alias).
BROWSER_ISSUER = "http://10.0.0.5/openapi/v1"

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
        assert result.refresh_token == "dfor_refresh-1"
        [call] = world.tokens.calls
        assert (call.account_id, call.workspace_id, call.client_id) == (ACCOUNT_ID, WORKSPACE_ID, CONFIDENTIAL_ID)
        assert call.lifetime == timedelta(hours=24)
        assert call.refresh == RefreshTokenIssue(lifetime=timedelta(days=30))
        assert call.device_label.startswith("QwenWork (")

    @staticmethod
    def test_redeeming_a_code_marks_the_client_as_used() -> None:
        world = _auth_code_world()

        world.handler(_code_request(_approve(world)))

        assert world.usage.marked == [CONFIDENTIAL_ID]

    @staticmethod
    def test_a_failed_mark_raises_and_mints_no_token() -> None:
        world = _auth_code_world()
        world.usage.failure = RuntimeError("db down")

        with pytest.raises(RuntimeError, match="db down"):
            world.handler(_code_request(_approve(world)))

        assert world.tokens.calls == []

    @staticmethod
    def test_failed_redemption_does_not_mark_the_client() -> None:
        world = _auth_code_world()

        _token_error(world, _code_request(_approve(world), code_verifier="w" * 43))

        assert world.usage.marked == []

    @staticmethod
    def test_public_loopback_client_redeems_on_the_port_it_used() -> None:
        world = _auth_code_world()
        redirect = "http://127.0.0.1:53412/callback"
        code = _approve(world, client_id=PUBLIC_ID, redirect_uri=redirect)

        result = world.handler(_code_request(code, client_id=PUBLIC_ID, client_secret=None, redirect_uri=redirect))

        assert result.payload["token"] == "dfoa_token-1"
        # This client is not registered for the refresh grant, so it gets no refresh token.
        assert result.refresh_token is None
        assert world.tokens.calls[0].refresh is None

    @staticmethod
    def test_canonical_resource_is_accepted() -> None:
        world = _auth_code_world()

        assert world.handler(_code_request(_approve(world), resource=ISSUER)).payload["token"]

    @staticmethod
    def test_code_approved_via_another_host_redeems_without_resource() -> None:
        world = _auth_code_world()
        code = _approve(world, issuer=BROWSER_ISSUER)

        assert world.handler(_code_request(code)).payload["token"] == "dfoa_token-1"

    @staticmethod
    def test_resource_bound_to_the_code_is_accepted_via_another_host() -> None:
        world = _auth_code_world()
        code = _approve(world, issuer=BROWSER_ISSUER)

        assert world.handler(_code_request(code, resource=BROWSER_ISSUER)).payload["token"] == "dfoa_token-1"

    @staticmethod
    def test_valid_resource_other_than_the_bound_one_is_invalid_grant() -> None:
        world = _auth_code_world()
        code = _approve(world, issuer=BROWSER_ISSUER)

        error = _token_error(world, _code_request(code, resource=ISSUER))

        assert error.code is TokenErrorCode.INVALID_GRANT
        assert world.tokens.calls == []

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
    @pytest.mark.parametrize("status", INACTIVE_ACCOUNT_STATUSES)
    def test_inactive_account_is_invalid_grant(status: str) -> None:
        world = _auth_code_world()
        code = _approve(world)
        world.accounts.accounts[ACCOUNT_ID] = account_snapshot(status=status)

        assert _token_error(world, _code_request(code)).code is TokenErrorCode.INVALID_GRANT
        assert world.tokens.calls == []

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

        live = sqlite_session.scalars(
            select(OpenAPIOAuthAccessToken).where(OpenAPIOAuthAccessToken.revoked_at.is_(None))
        ).all()
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


def test_build_grant_handlers_registers_browser_grants_only_when_enabled(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    refresh = SQLAlchemyOAuthRefreshTokenRepository(session_factory=sqlite_session_factory)

    def handlers(enabled: bool) -> Mapping[GrantType, GrantHandler]:
        return build_grant_handlers(
            device=FakeDevice(),
            clients=registry(confidential_client()),
            codes=RedisAuthorizationCodeRepository(DictRedis()),
            refresh=refresh,
            accounts=FakeAccounts(),
            workspaces=FakeWorkspaces(),
            tokens=FakeTokenIssuer(),
            revoke=GrantRevoker(session_factory=sqlite_session_factory, redis=_cache_wrapper(), refresh=refresh),
            settings=FakeTokenSettings(authorization_code_enabled=enabled),
            usage=_RecordingClientUsage(),
        )

    enabled = handlers(True)
    assert isinstance(enabled[GrantType.AUTHORIZATION_CODE], AuthorizationCodeGrantHandler)
    assert isinstance(enabled[GrantType.REFRESH_TOKEN], RefreshTokenGrantHandler)
    disabled = handlers(False)
    assert GrantType.AUTHORIZATION_CODE not in disabled
    assert GrantType.REFRESH_TOKEN not in disabled
    assert isinstance(disabled[GrantType.DEVICE_CODE], DeviceCodeGrantHandler)
    for request in (_code_request("any"), _refresh_request("dfor_any")):
        with pytest.raises(TokenEndpointError) as caught:
            OAuthTokenService(handlers=disabled).exchange(request)
        assert caught.value.code is TokenErrorCode.UNSUPPORTED_GRANT_TYPE


NO_REFRESH_ID = "no-refresh"
OTHER_ID = "other"


def _cache_wrapper() -> RedisClientWrapper:
    cache = RedisClientWrapper()
    cache.initialize(_RawCacheRedis())  # type: ignore[arg-type]
    return cache


def _refresh_request(
    token: str | None,
    *,
    client_id: str | None = CONFIDENTIAL_ID,
    client_secret: str | None = CONFIDENTIAL_SECRET,
    resource: str | None = None,
) -> TokenRequest:
    return TokenRequest(
        grant_type=GrantType.REFRESH_TOKEN,
        client_id=client_id,
        client_secret=client_secret,
        code=None,
        code_verifier=None,
        redirect_uri=None,
        device_code=None,
        refresh_token=token,
        resource=resource,
        scope=None,
        poll_ip="127.0.0.1",
        request_origin="https://api.example/",
    )


class _HookedRefreshTokens(SQLAlchemyOAuthRefreshTokenRepository):
    """Runs ``after_find`` between the handler's read and its locked write, like a concurrent request would."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        after_find: Callable[[RefreshTokenRecord], None],
    ) -> None:
        super().__init__(session_factory=session_factory)
        self._after_find = after_find

    @override
    def find(self, token: str) -> RefreshTokenRecord | None:
        record = super().find(token)
        if record is not None:
            self._after_find(record)
        return record


@dataclass
class _RecordingTokenCache:
    invalidated: list[str] = field(default_factory=list)

    def __call__(self, token_hash: str) -> None:
        self.invalidated.append(token_hash)


@dataclass
class _NoAccessWorkspaces:
    def list_account_access_workspaces(self, account_id: str) -> Sequence[AccountWorkspaceSnapshot]:
        _ = account_id
        return ()


@dataclass
class _RefreshWorld:
    login_handler: AuthorizationCodeGrantHandler
    usage: _RecordingClientUsage
    handler: RefreshTokenGrantHandler
    authorize: OAuthAuthorizeService
    clients: OAuthClientRegistry
    accounts: FakeAccounts
    revoker: GrantRevoker
    factory: sessionmaker[Session]
    console_sessions: SQLAlchemyOAuthDeviceTokenRepository
    account_access: AccountAccessService
    token_cache: _RecordingTokenCache

    def login(self, *, context: RequestContext | None = None) -> TokenGrantResult:
        return self.login_handler(_code_request(_approve(self, context=context)))

    def refresh(self, token: str | None, *, client_id: str = CONFIDENTIAL_ID) -> TokenGrantResult:
        return self.handler(_refresh_request(token, client_id=client_id))

    def refresh_error(self, token: str | None, *, client_id: str = CONFIDENTIAL_ID) -> TokenEndpointError:
        with pytest.raises(TokenEndpointError) as caught:
            self.refresh(token, client_id=client_id)
        return caught.value

    def refresh_row(self, token: str | None) -> OpenAPIOAuthRefreshToken | None:
        assert token is not None
        with self.factory() as session:
            return session.scalar(
                select(OpenAPIOAuthRefreshToken).where(OpenAPIOAuthRefreshToken.token_hash == sha256_hex(token))
            )

    def refresh_rows(self) -> list[OpenAPIOAuthRefreshToken]:
        with self.factory() as session:
            return list(session.scalars(select(OpenAPIOAuthRefreshToken)).all())

    def access_row(self, result: TokenGrantResult) -> OpenAPIOAuthAccessToken:
        with self.factory() as session:
            row = session.get(OpenAPIOAuthAccessToken, result.payload["token_id"])
            assert row is not None
            return row

    def live_access_ids(self) -> set[str]:
        with self.factory() as session:
            return set(
                session.scalars(select(OpenAPIOAuthAccessToken.id).where(OpenAPIOAuthAccessToken.revoked_at.is_(None)))
            )

    def set_refresh(self, token: str | None, **values: object) -> None:
        assert token is not None
        with self.factory() as session, session.begin():
            session.execute(
                update(OpenAPIOAuthRefreshToken)
                .where(OpenAPIOAuthRefreshToken.token_hash == sha256_hex(token))
                .values(**values)
            )

    def set_access(self, result: TokenGrantResult, **values: object) -> None:
        with self.factory() as session, session.begin():
            session.execute(
                update(OpenAPIOAuthAccessToken)
                .where(OpenAPIOAuthAccessToken.id == result.payload["token_id"])
                .values(**values)
            )

    def delete_access_rows(self) -> None:
        with self.factory() as session, session.begin():
            session.execute(delete(OpenAPIOAuthAccessToken))

    def account_context(self, token_id: str | None = None) -> AccountRequestContext:
        return AccountRequestContext(request_id="r1", trace_id=None, account_id=ACCOUNT_ID, access_token_id=token_id)

    def console_session_ids(self) -> list[str]:
        page = self.console_sessions.list_account_sessions(account_id=ACCOUNT_ID, page=1, limit=100)
        return [item.id for item in page.items]

    def openapi_session_ids(self) -> list[str]:
        page = self.account_access.list_sessions(self.account_context(), page=1, limit=100)
        return [item.id for item in page.items]


def _refresh_world(
    factory: sessionmaker[Session],
    *,
    settings: FakeTokenSettings | None = None,
    after_find: Callable[[RefreshTokenRecord], None] | None = None,
    max_sessions_per_account: int = 15,
    extra_sources: Sequence[ClientSource] = (),
) -> _RefreshWorld:
    settings = settings or FakeTokenSettings()
    cache = _cache_wrapper()
    clients = registry(
        confidential_client(),
        confidential_client(client_id=OTHER_ID),
        confidential_client(client_id=NO_REFRESH_ID, grant_types=frozenset({GrantType.AUTHORIZATION_CODE})),
        extra_sources=extra_sources,
    )
    codes = RedisAuthorizationCodeRepository(DictRedis())
    refresh = (
        SQLAlchemyOAuthRefreshTokenRepository(session_factory=factory)
        if after_find is None
        else _HookedRefreshTokens(session_factory=factory, after_find=after_find)
    )
    console_sessions = SQLAlchemyOAuthDeviceTokenRepository(
        session_factory=factory, redis=cache, max_sessions_per_account=max_sessions_per_account
    )
    tokens = OAuthDeviceTokenIssuanceGateway(tokens=console_sessions, ttl_policy=_FixedTTLPolicy())
    accounts = FakeAccounts()
    workspaces = FakeWorkspaces()
    revoker = GrantRevoker(session_factory=factory, redis=cache, refresh=refresh)
    token_cache = _RecordingTokenCache()
    usage = _RecordingClientUsage()
    return _RefreshWorld(
        login_handler=AuthorizationCodeGrantHandler(
            clients=clients,
            codes=codes,
            accounts=accounts,
            workspaces=workspaces,
            tokens=tokens,
            settings=settings,
            usage=usage,
        ),
        usage=usage,
        handler=RefreshTokenGrantHandler(
            clients=clients,
            refresh=refresh,
            accounts=accounts,
            workspaces=workspaces,
            tokens=tokens,
            revoke=revoker,
            settings=settings,
        ),
        authorize=OAuthAuthorizeService(clients=clients, codes=codes, settings=settings),
        clients=clients,
        accounts=accounts,
        revoker=revoker,
        factory=factory,
        console_sessions=console_sessions,
        account_access=AccountAccessService(
            accounts=accounts,
            workspaces=_NoAccessWorkspaces(),
            sessions=SQLAlchemyOAuthAccessTokenRepository(session_factory=factory),
            invalidate_token_cache=token_cache,
            now=lambda: datetime.now(UTC),
        ),
        token_cache=token_cache,
    )


@pytest.fixture
def refresh_world(sqlite_session_factory: sessionmaker[Session]) -> _RefreshWorld:
    return _refresh_world(sqlite_session_factory)


def _assert_close(value: datetime, expected: datetime) -> None:
    assert abs(value.replace(tzinfo=UTC) - expected) < timedelta(minutes=1)


@pytest.mark.usefixtures("client_auth_hits", "issuer_from_origin")
class TestRefreshTokenGrantCases:
    @staticmethod
    def test_refresh_with_the_canonical_resource_rotates(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()

        rotated = refresh_world.handler(_refresh_request(login.refresh_token, resource=ISSUER))

        assert rotated.refresh_token not in (None, login.refresh_token)

    @staticmethod
    @pytest.mark.parametrize("resource", ["https://api.example", "https://other.example/openapi/v1"])
    def test_refresh_with_an_unknown_resource_is_invalid_target_and_keeps_the_token(
        refresh_world: _RefreshWorld, resource: str
    ) -> None:
        login = refresh_world.login()

        with pytest.raises(TokenEndpointError) as caught:
            refresh_world.handler(_refresh_request(login.refresh_token, resource=resource))

        assert caught.value.code is TokenErrorCode.INVALID_TARGET
        row = refresh_world.refresh_row(login.refresh_token)
        assert row is not None
        assert row.rotated_at is None

    @staticmethod
    def test_login_returns_a_refresh_token_for_the_same_grant(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()

        assert login.refresh_token is not None
        assert login.refresh_token.startswith(REFRESH_TOKEN_PREFIX)
        row = refresh_world.refresh_row(login.refresh_token)
        assert row is not None
        access = refresh_world.access_row(login)
        assert (row.subject_email, row.subject_issuer, row.client_id, row.device_label) == (
            access.subject_email,
            access.subject_issuer,
            access.client_id,
            access.device_label,
        )
        assert (row.account_id, row.workspace_id, row.rotated_at) == (ACCOUNT_ID, WORKSPACE_ID, None)
        _assert_close(row.expires_at, datetime.now(UTC) + timedelta(days=30))

    @staticmethod
    def test_two_logins_start_two_families(refresh_world: _RefreshWorld) -> None:
        refresh_world.login()
        refresh_world.login()

        assert len({row.family_id for row in refresh_world.refresh_rows()}) == 2

    @staticmethod
    def test_refresh_does_not_mark_the_client_again(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()

        refresh_world.refresh(login.refresh_token)

        assert refresh_world.usage.marked == [CONFIDENTIAL_ID]

    @staticmethod
    def test_rotation_returns_a_new_pair_and_spends_the_old_refresh(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()

        rotated = refresh_world.refresh(login.refresh_token)

        assert rotated.payload["token"] != login.payload["token"]
        assert rotated.payload["token_id"] != login.payload["token_id"]
        assert rotated.refresh_token not in (None, login.refresh_token)
        assert refresh_world.live_access_ids() == {rotated.payload["token_id"]}
        old = refresh_world.refresh_row(login.refresh_token)
        new = refresh_world.refresh_row(rotated.refresh_token)
        assert old is not None
        assert new is not None
        assert old.rotated_at is not None
        assert new.rotated_at is None
        assert new.family_id == old.family_id
        assert new.device_label == old.device_label
        _assert_close(new.expires_at, datetime.now(UTC) + timedelta(days=30))
        _assert_close(datetime.fromisoformat(rotated.payload["expires_at"]), datetime.now(UTC) + timedelta(hours=24))

    @staticmethod
    def test_replay_within_the_grace_issues_one_more_refresh_and_leaves_the_family_alone(
        refresh_world: _RefreshWorld,
    ) -> None:
        login = refresh_world.login()
        rotated = refresh_world.refresh(login.refresh_token)

        replayed = refresh_world.refresh(login.refresh_token)

        assert replayed.refresh_token not in (None, login.refresh_token, rotated.refresh_token)
        successor = refresh_world.refresh_row(rotated.refresh_token)
        assert successor is not None
        assert successor.rotated_at is None
        assert len({row.family_id for row in refresh_world.refresh_rows()}) == 1
        assert len(refresh_world.refresh_rows()) == 3
        assert refresh_world.live_access_ids() == {replayed.payload["token_id"]}

    @staticmethod
    def test_two_refreshes_of_one_token_in_the_grace_both_keep_working(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()

        first = refresh_world.refresh(login.refresh_token)
        second = refresh_world.refresh(login.refresh_token)

        # One access row per login: the later refresh replaced the earlier caller's access token.
        assert refresh_world.access_row(first).revoked_at is not None
        assert refresh_world.live_access_ids() == {second.payload["token_id"]}
        after_first = refresh_world.refresh(first.refresh_token)
        after_second = refresh_world.refresh(second.refresh_token)
        assert after_first.refresh_token is not None
        assert after_second.refresh_token is not None
        assert refresh_world.live_access_ids() == {after_second.payload["token_id"]}
        assert refresh_world.refresh(after_first.refresh_token).payload["token"]
        assert refresh_world.refresh(after_second.refresh_token).payload["token"]

    @staticmethod
    def test_reuse_after_the_grace_revokes_the_grant(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()
        rotated = refresh_world.refresh(login.refresh_token)
        refresh_world.set_refresh(login.refresh_token, rotated_at=datetime.now(UTC) - timedelta(minutes=31))

        error = refresh_world.refresh_error(login.refresh_token)

        assert error.code is TokenErrorCode.INVALID_GRANT
        assert refresh_world.live_access_ids() == set()
        assert refresh_world.access_row(rotated).token_hash is None
        assert refresh_world.refresh_rows() == []
        assert refresh_world.refresh_error(rotated.refresh_token).code is TokenErrorCode.INVALID_GRANT

    @staticmethod
    def test_zero_grace_makes_any_reuse_revoke_the_grant(sqlite_session_factory: sessionmaker[Session]) -> None:
        world = _refresh_world(sqlite_session_factory, settings=FakeTokenSettings(refresh_reuse_grace=timedelta()))
        login = world.login()
        rotated = world.refresh(login.refresh_token)

        assert world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert world.live_access_ids() == set()
        assert world.refresh_rows() == []
        assert world.refresh_error(rotated.refresh_token).code is TokenErrorCode.INVALID_GRANT

    @staticmethod
    def test_expired_refresh_is_invalid_grant_and_issues_nothing(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()
        refresh_world.set_refresh(login.refresh_token, expires_at=datetime.now(UTC) - timedelta(seconds=1))

        assert refresh_world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert refresh_world.live_access_ids() == {login.payload["token_id"]}
        assert len(refresh_world.refresh_rows()) == 1

    @staticmethod
    def test_refresh_works_after_hard_expire_revoked_the_access_row(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()
        resolver = OAuthAccessTokenResolver(refresh_world.factory, _cache_wrapper())
        with refresh_world.factory() as session:
            resolver.hard_expire(session, login.payload["token_id"], sha256_hex(login.payload["token"]))
        assert refresh_world.live_access_ids() == set()

        rotated = refresh_world.refresh(login.refresh_token)

        assert refresh_world.live_access_ids() == {rotated.payload["token_id"]}

    @staticmethod
    def test_another_clients_refresh_token_is_invalid_grant(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()

        error = refresh_world.refresh_error(login.refresh_token, client_id=OTHER_ID)

        assert error.code is TokenErrorCode.INVALID_GRANT
        row = refresh_world.refresh_row(login.refresh_token)
        assert row is not None
        assert row.rotated_at is None

    @staticmethod
    @pytest.mark.parametrize("token", [None, "", "dfor_unknown", "dfoa_not-a-refresh-token", "future_token_format"])
    def test_missing_or_unknown_refresh_is_invalid_grant(refresh_world: _RefreshWorld, token: str | None) -> None:
        assert refresh_world.refresh_error(token).code is TokenErrorCode.INVALID_GRANT

    @staticmethod
    def test_client_without_the_refresh_grant_is_unauthorized_client(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()

        error = refresh_world.refresh_error(login.refresh_token, client_id=NO_REFRESH_ID)

        assert error.code is TokenErrorCode.UNAUTHORIZED_CLIENT

    @staticmethod
    @pytest.mark.parametrize(
        "overrides",
        [
            pytest.param({"client_secret": "wrong"}, id="wrong-secret"),
            pytest.param({"client_secret": None}, id="confidential-without-secret"),
            pytest.param({"client_id": "unknown"}, id="unknown-client"),
            pytest.param({"client_id": None}, id="missing-client"),
        ],
    )
    def test_client_auth_failure_is_invalid_client_and_leaves_the_token(
        refresh_world: _RefreshWorld, overrides: dict[str, str | None]
    ) -> None:
        login = refresh_world.login()

        with pytest.raises(TokenEndpointError) as caught:
            refresh_world.handler(_refresh_request(login.refresh_token, **overrides))

        assert caught.value.code is TokenErrorCode.INVALID_CLIENT
        assert refresh_world.refresh(login.refresh_token).payload["token"]

    @staticmethod
    def test_deleted_account_is_invalid_grant(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()
        refresh_world.accounts.accounts.clear()

        assert refresh_world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT

    @staticmethod
    @pytest.mark.parametrize("status", INACTIVE_ACCOUNT_STATUSES)
    def test_inactive_account_is_invalid_grant_and_spends_nothing(refresh_world: _RefreshWorld, status: str) -> None:
        login = refresh_world.login()
        refresh_world.accounts.accounts[ACCOUNT_ID] = account_snapshot(status=status)

        assert refresh_world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        row = refresh_world.refresh_row(login.refresh_token)
        assert row is not None
        assert row.rotated_at is None
        assert refresh_world.live_access_ids() == {login.payload["token_id"]}

    @staticmethod
    def test_changed_account_email_is_invalid_grant(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()
        refresh_world.accounts.accounts[ACCOUNT_ID] = replace(account_snapshot(), email="new@example.com")

        assert refresh_world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        # The grant can never refresh again, so it gives up its session slot.
        assert refresh_world.refresh_rows() == []
        assert refresh_world.live_access_ids() == set()

    @staticmethod
    def test_refresh_without_a_workspace_is_invalid_grant(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()
        refresh_world.set_refresh(login.refresh_token, workspace_id=None)

        assert refresh_world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert refresh_world.refresh_rows() == []

    @staticmethod
    def test_revoke_landing_after_the_read_is_not_undone(sqlite_session_factory: sessionmaker[Session]) -> None:
        revoked: list[RefreshTokenRecord] = []

        def revoke_concurrently(record: RefreshTokenRecord) -> None:
            revoked.append(record)
            world.revoker.revoke_grant(record.grant_key, account_id=record.account_id)

        world = _refresh_world(sqlite_session_factory, after_find=revoke_concurrently)
        login = world.login()

        assert world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert len(revoked) == 1
        assert world.live_access_ids() == set()
        assert world.refresh_rows() == []

    @staticmethod
    def test_refresh_does_not_take_another_session_slot(sqlite_session_factory: sessionmaker[Session]) -> None:
        world = _refresh_world(sqlite_session_factory, max_sessions_per_account=1)
        login = world.login()

        rotated = world.refresh(login.refresh_token)

        assert world.live_access_ids() == {rotated.payload["token_id"]}
        assert world.refresh(rotated.refresh_token).payload["token"]

    @staticmethod
    def test_refresh_locks_account_then_access_then_refresh_rows(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()

        with record_locks(refresh_world.factory) as log:
            refresh_world.refresh(login.refresh_token)

        assert log.tables[0] == "accounts"
        assert "openapi_oauth_access_tokens" in log.tables
        assert "openapi_oauth_refresh_tokens" in log.tables
        assert log.follows_lock_order()

    @staticmethod
    def test_reuse_revocation_locks_in_the_same_order(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()
        refresh_world.refresh(login.refresh_token)
        refresh_world.set_refresh(login.refresh_token, rotated_at=datetime.now(UTC) - timedelta(hours=1))

        with record_locks(refresh_world.factory) as log:
            refresh_world.refresh_error(login.refresh_token)

        # The rejected rotation rolls back, then the grant is revoked in a second transaction.
        assert log.tables.count("accounts") == 2
        second = log.tables.index("accounts", 1)
        assert LockLog(tables=log.tables[:second]).follows_lock_order()
        assert LockLog(tables=log.tables[second:]).follows_lock_order()


def _revoke_openapi_self(world: _RefreshWorld, session_id: str) -> None:
    world.account_access.revoke_current_session(world.account_context(session_id))


def _revoke_openapi_by_id(world: _RefreshWorld, session_id: str) -> None:
    world.account_access.revoke_session(world.account_context(), token_id=session_id)


def _revoke_in_console(world: _RefreshWorld, session_id: str) -> None:
    assert world.console_sessions.revoke_account_session(account_id=ACCOUNT_ID, token_id=session_id) is True


class _SessionRevokePath(Enum):
    OPENAPI_SELF = ("openapi-self", _revoke_openapi_self)
    OPENAPI_BY_ID = ("openapi-by-id", _revoke_openapi_by_id)
    CONSOLE = ("console", _revoke_in_console)

    def __init__(self, label: str, revoker: Callable[[_RefreshWorld, str], None]) -> None:
        self.label = label
        self.revoker = revoker

    def __str__(self) -> str:
        return self.label

    def revoke(self, world: _RefreshWorld, session_id: str) -> None:
        self.revoker(world, session_id)


# A session whose access token is gone can no longer call /account/sessions/self.
_REVOKE_BY_ID_PATHS = (_SessionRevokePath.OPENAPI_BY_ID, _SessionRevokePath.CONSOLE)


class _IdleAccess(StrEnum):
    EXPIRED = "expired"
    HARD_EXPIRED = "hard-expired"

    def apply(self, world: _RefreshWorld, login: TokenGrantResult) -> None:
        world.set_access(login, expires_at=datetime.now(UTC) - timedelta(hours=1))
        if self is _IdleAccess.HARD_EXPIRED:
            resolver = OAuthAccessTokenResolver(world.factory, _cache_wrapper())
            with world.factory() as session:
                resolver.hard_expire(session, login.payload["token_id"], sha256_hex(login.payload["token"]))


@pytest.mark.usefixtures("client_auth_hits", "issuer_from_origin")
class TestSessionPathsKnowRefreshGrants:
    @staticmethod
    @pytest.mark.parametrize("path", list(_SessionRevokePath))
    def test_session_revoke_ends_the_refresh_grant(refresh_world: _RefreshWorld, path: _SessionRevokePath) -> None:
        login = refresh_world.login()

        path.revoke(refresh_world, login.payload["token_id"])

        assert refresh_world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert refresh_world.refresh_rows() == []
        assert refresh_world.live_access_ids() == set()

    @staticmethod
    def test_openapi_revoke_clears_the_bearer_cache(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()

        _SessionRevokePath.OPENAPI_SELF.revoke(refresh_world, login.payload["token_id"])

        assert refresh_world.token_cache.invalidated == [sha256_hex(login.payload["token"])]

    @staticmethod
    @pytest.mark.parametrize("idle", list(_IdleAccess))
    def test_idle_grant_with_a_live_refresh_is_listed_by_its_latest_access_row(
        refresh_world: _RefreshWorld, idle: _IdleAccess
    ) -> None:
        login = refresh_world.login()
        idle.apply(refresh_world, login)

        assert refresh_world.console_session_ids() == [login.payload["token_id"]]
        assert refresh_world.openapi_session_ids() == [login.payload["token_id"]]

    @staticmethod
    @pytest.mark.parametrize("idle", list(_IdleAccess))
    def test_idle_grant_shows_its_refresh_tokens_expiry(refresh_world: _RefreshWorld, idle: _IdleAccess) -> None:
        login = refresh_world.login()
        idle.apply(refresh_world, login)
        row = refresh_world.refresh_row(login.refresh_token)
        assert row is not None

        [openapi_listed] = refresh_world.account_access.list_sessions(
            refresh_world.account_context(), page=1, limit=10
        ).items
        [console_listed] = refresh_world.console_sessions.list_account_sessions(
            account_id=ACCOUNT_ID, page=1, limit=10
        ).items

        assert openapi_listed.expires_at == row.expires_at
        assert console_listed.expires_at == row.expires_at

    @staticmethod
    @pytest.mark.parametrize("path", _REVOKE_BY_ID_PATHS)
    @pytest.mark.parametrize("idle", list(_IdleAccess))
    def test_revoking_an_idle_grant_by_its_listed_id_ends_the_refresh(
        refresh_world: _RefreshWorld, idle: _IdleAccess, path: _SessionRevokePath
    ) -> None:
        login = refresh_world.login()
        idle.apply(refresh_world, login)

        path.revoke(refresh_world, login.payload["token_id"])

        assert refresh_world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert refresh_world.console_session_ids() == []
        assert refresh_world.openapi_session_ids() == []

    @staticmethod
    def test_grant_without_access_rows_is_listed_by_its_refresh_token(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()
        refresh_world.delete_access_rows()
        row = refresh_world.refresh_row(login.refresh_token)
        assert row is not None

        page = refresh_world.account_access.list_sessions(refresh_world.account_context(), page=1, limit=10)

        [listed] = page.items
        assert listed.id == row.id
        assert listed.prefix == REFRESH_TOKEN_PREFIX
        assert (listed.client_id, listed.device_label) == (row.client_id, row.device_label)
        assert (listed.created_at, listed.expires_at) == (row.created_at, row.expires_at)
        assert listed.last_used_at is None
        assert refresh_world.console_session_ids() == [row.id]

    @staticmethod
    @pytest.mark.parametrize("path", _REVOKE_BY_ID_PATHS)
    def test_revoking_a_grant_by_its_refresh_token_id_ends_it(
        refresh_world: _RefreshWorld, path: _SessionRevokePath
    ) -> None:
        login = refresh_world.login()
        refresh_world.delete_access_rows()
        [session_id] = refresh_world.openapi_session_ids()

        path.revoke(refresh_world, session_id)

        assert refresh_world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert refresh_world.openapi_session_ids() == []

    @staticmethod
    def test_a_refreshed_grant_is_listed_once(refresh_world: _RefreshWorld) -> None:
        login = refresh_world.login()
        rotated = refresh_world.refresh(login.refresh_token)

        assert refresh_world.openapi_session_ids() == [rotated.payload["token_id"]]
        assert refresh_world.console_session_ids() == [rotated.payload["token_id"]]


OTHER_ACCOUNT_ID = "account-2"
OTHER_CONTEXT = RequestContext(
    request_id="r2", trace_id=None, account_id=OTHER_ACCOUNT_ID, active_workspace_id=WORKSPACE_ID
)


@dataclass
class _Collision:
    """Two accounts holding one grant key: the first moved off an email the second then took."""

    world: _RefreshWorld
    moved: TokenGrantResult
    taker: TokenGrantResult

    def assert_taker_untouched(self) -> None:
        assert self.world.access_row(self.taker).revoked_at is None
        assert self.world.refresh_row(self.taker.refresh_token) is not None

    def assert_moved_untouched(self) -> None:
        assert self.world.refresh_row(self.moved.refresh_token) is not None


def _fixed_device_label(client_name: str) -> str:
    return f"{client_name} (fixed)"


@pytest.fixture
def collision(refresh_world: _RefreshWorld, monkeypatch: pytest.MonkeyPatch) -> _Collision:
    monkeypatch.setattr(token_grants_module, "default_device_label", _fixed_device_label)
    moved = refresh_world.login()
    refresh_world.accounts.accounts[ACCOUNT_ID] = replace(account_snapshot(), email="moved@example.com")
    refresh_world.accounts.accounts[OTHER_ACCOUNT_ID] = account_snapshot(OTHER_ACCOUNT_ID)
    taker = refresh_world.login(context=OTHER_CONTEXT)
    assert refresh_world.access_row(moved).device_label == refresh_world.access_row(taker).device_label
    return _Collision(world=refresh_world, moved=moved, taker=taker)


@pytest.mark.usefixtures("client_auth_hits", "issuer_from_origin")
class TestGrantRevokeStaysInsideTheAccount:
    @staticmethod
    @pytest.mark.parametrize("path", _REVOKE_BY_ID_PATHS)
    def test_session_revoke_by_an_old_id_spares_the_other_account(
        collision: _Collision, path: _SessionRevokePath
    ) -> None:
        path.revoke(collision.world, collision.moved.payload["token_id"])

        assert collision.world.refresh_row(collision.moved.refresh_token) is None
        collision.assert_taker_untouched()

    @staticmethod
    def test_email_change_guard_spares_the_other_account(collision: _Collision) -> None:
        error = collision.world.refresh_error(collision.moved.refresh_token)

        assert error.code is TokenErrorCode.INVALID_GRANT
        assert collision.world.refresh_row(collision.moved.refresh_token) is None
        collision.assert_taker_untouched()

    @staticmethod
    def test_reuse_after_the_grace_spares_the_other_account(collision: _Collision) -> None:
        world = collision.world
        rotated = world.refresh(collision.taker.refresh_token)
        world.set_refresh(collision.taker.refresh_token, rotated_at=datetime.now(UTC) - timedelta(minutes=31))

        assert world.refresh_error(collision.taker.refresh_token).code is TokenErrorCode.INVALID_GRANT

        assert world.refresh_row(rotated.refresh_token) is None
        collision.assert_moved_untouched()

    @staticmethod
    def test_rfc7009_revoke_of_a_refresh_token_spares_the_other_account(collision: _Collision) -> None:
        assert collision.moved.refresh_token is not None

        collision.world.revoker.revoke_by_token(collision.moved.refresh_token, client_id=CONFIDENTIAL_ID)

        assert collision.world.refresh_row(collision.moved.refresh_token) is None
        collision.assert_taker_untouched()

    @staticmethod
    def test_rfc7009_revoke_of_an_access_token_spares_the_other_account(collision: _Collision) -> None:
        collision.world.revoker.revoke_by_token(collision.taker.payload["token"], client_id=CONFIDENTIAL_ID)

        assert collision.world.access_row(collision.taker).revoked_at is not None
        assert collision.world.refresh_row(collision.taker.refresh_token) is None
        collision.assert_moved_untouched()


CIMD_URL = "https://agent.example/oauth/client.json"
CIMD_REDIRECT = "https://agent.example/cb"


def _cimd_source() -> CimdClientSource:
    document = {"client_id": CIMD_URL, "client_name": "CIMD Agent", "redirect_uris": [CIMD_REDIRECT]}
    response = CimdResponse(body=json.dumps(document).encode(), max_age=None)

    def fetch(url: str) -> CimdResponse:
        _ = url
        return response

    def resolve_host(host: str) -> Sequence[str]:
        _ = host
        return ["93.184.216.34"]

    return CimdClientSource(
        cache=DictRedis(), fetch=fetch, resolve_host=resolve_host, fetch_limit_per_minute=UNLIMITED_FETCHES
    )


@pytest.mark.usefixtures("client_auth_hits", "issuer_from_origin")
class TestCimdClientEndToEnd:
    @staticmethod
    def test_cimd_client_logs_in_refreshes_and_revokes(sqlite_session_factory: sessionmaker[Session]) -> None:
        world = _refresh_world(sqlite_session_factory, extra_sources=[_cimd_source()])
        storage_id = cimd_storage_id(CIMD_URL)

        view = world.authorize.describe_client(CIMD_URL, CIMD_REDIRECT)
        code = _approve(world, client_id=CIMD_URL, redirect_uri=CIMD_REDIRECT)
        login = world.login_handler(
            _code_request(code, client_id=CIMD_URL, client_secret=None, redirect_uri=CIMD_REDIRECT)
        )

        assert view.display_name == "CIMD Agent"
        assert world.access_row(login).client_id == storage_id
        refreshed = world.handler(_refresh_request(login.refresh_token, client_id=CIMD_URL, client_secret=None))
        assert world.access_row(refreshed).client_id == storage_id
        assert refreshed.refresh_token not in (None, login.refresh_token)

        revocation = OAuthRevocationService(clients=world.clients, grants=world.revoker)
        revocation.revoke(
            RevokeRequest(
                client_id=CIMD_URL, client_secret=None, token=refreshed.payload["token"], source_ip="127.0.0.1"
            )
        )

        assert world.access_row(refreshed).revoked_at is not None
        assert world.refresh_row(refreshed.refresh_token) is None
