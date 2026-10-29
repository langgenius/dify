from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Unpack, override
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker
from typing_extensions import TypedDict

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
from services.oauth_authorize_service import AuthorizeRequest, OAuthAuthorizeService
from services.oauth_device_adapters import OAuthDeviceTokenIssuanceGateway
from services.oauth_device_contracts import (
    AccessDeniedError,
    AuthorizationPendingError,
    ClientMismatchError,
    ExpiredTokenError,
    OAuthDeviceError,
    PollPayload,
    PollTooFastError,
)
from services.oauth_grant_revoker import GrantRevoker
from services.oauth_token_contracts import GrantType, TokenEndpointError, TokenErrorCode, TokenGrantResult, TokenRequest
from services.oauth_token_grants import DeviceCodeGrantHandler, build_grant_handlers
from services.oauth_token_service import OAuthTokenService
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    ACCOUNT_ID,
    CHALLENGE,
    ISSUER,
    NATIVE_ID,
    VERIFIER,
    WEB_ID,
    WEB_REDIRECT,
    WORKSPACE_ID,
    DictRedis,
    FakeAccounts,
    FakeTokenSettings,
    FakeWorkspaces,
    account_snapshot,
    native_client,
    registry,
    web_client,
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
NO_REFRESH_ID = "no-refresh"
OTHER_ID = "other"
DEVICE_ONLY_ID = "device-only"
ALIASED_ID = "https://agent.example/oauth/client.json"
ALIASED_STORAGE_ID = "cimd_agent"
UNKNOWN_RESOURCE = "https://other.example/openapi/v1"
# The browser reached Dify by another name than the token request (IP vs DNS, an alias).
BROWSER_ISSUER = "http://10.0.0.5/openapi/v1"
AUTH_CONTEXT = RequestContext(request_id="r1", trace_id=None, account_id=ACCOUNT_ID, active_workspace_id=WORKSPACE_ID)
_BLANK_REQUEST = TokenRequest(
    grant_type="",
    client_id=None,
    client_secret=None,
    code=None,
    code_verifier=None,
    redirect_uri=None,
    device_code=None,
    refresh_token=None,
    resource=None,
    scope=None,
    poll_ip="127.0.0.1",
    request_origin="https://api.example/",
)


class _Overrides(TypedDict, total=False, closed=True):
    client_id: str | None
    client_secret: str | None
    code_verifier: str | None
    redirect_uri: str | None
    resource: str | None


def _device_request(**overrides: Unpack[_Overrides]) -> TokenRequest:
    request = replace(_BLANK_REQUEST, grant_type=GrantType.DEVICE_CODE, client_id="difyctl", device_code="device-1")
    return replace(request, **overrides)


def _code_request(code: str | None, **overrides: Unpack[_Overrides]) -> TokenRequest:
    request = replace(
        _BLANK_REQUEST,
        grant_type=GrantType.AUTHORIZATION_CODE,
        code=code,
        client_id=WEB_ID,
        code_verifier=VERIFIER,
        redirect_uri=WEB_REDIRECT,
    )
    return replace(request, **overrides)


def _refresh_request(token: str | None, **overrides: Unpack[_Overrides]) -> TokenRequest:
    request = replace(
        _BLANK_REQUEST,
        grant_type=GrantType.REFRESH_TOKEN,
        refresh_token=token,
        client_id=WEB_ID,
    )
    return replace(request, **overrides)


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


def test_device_grant_with_the_canonical_resource_maps_to_token_response() -> None:
    result = DeviceCodeGrantHandler(FakeDevice())(_device_request(resource=ISSUER))

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
        DeviceCodeGrantHandler(FakeDevice(error=device_error()))(_device_request())

    assert caught.value.code is token_error


@pytest.mark.parametrize(
    ("overrides", "token_error"),
    [
        ({"resource": UNKNOWN_RESOURCE}, TokenErrorCode.INVALID_TARGET),
        ({"client_id": None}, TokenErrorCode.INVALID_REQUEST),
        ({"device_code": ""}, TokenErrorCode.INVALID_REQUEST),
    ],
)
def test_device_grant_rejects_a_bad_request_before_polling(
    overrides: dict[str, str | None], token_error: TokenErrorCode
) -> None:
    device = FakeDevice()

    with pytest.raises(TokenEndpointError) as caught:
        DeviceCodeGrantHandler(device)(_device_request(**overrides))

    assert caught.value.code is token_error
    assert device.calls == 0


@dataclass
class _RawCacheRedis:
    def delete(self, *names: str | bytes) -> None:
        _ = names

    def setex(self, name: str | bytes, time: int | timedelta, value: str | bytes) -> bool:
        _ = name, time, value
        return True


@dataclass
class _FixedTTLPolicy:
    def ttl_days(self, workspace_id: str | None) -> int:
        _ = workspace_id
        return 14


@dataclass
class _RecordingClientUsage:
    marked: list[str] = field(default_factory=list)

    def mark_token_issued(self, client_id: str) -> None:
        self.marked.append(client_id)


class _HookedRefreshTokens(SQLAlchemyOAuthRefreshTokenRepository):
    """Runs ``after_find`` between the handler's read and its locked write, like a concurrent request would."""

    def __init__(
        self, *, session_factory: sessionmaker[Session], after_find: Callable[[RefreshTokenRecord], None]
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
class _NoAccessWorkspaces:
    def list_account_access_workspaces(self, account_id: str) -> Sequence[AccountWorkspaceSnapshot]:
        _ = account_id
        return ()


def _ignore_cache(token_hash: str) -> None:
    _ = token_hash


def _cache_wrapper(raw: object | None = None) -> RedisClientWrapper:
    cache = RedisClientWrapper()
    cache.initialize(raw or _RawCacheRedis())  # type: ignore[arg-type]
    return cache


@dataclass
class _World:
    service: OAuthTokenService
    authorize: OAuthAuthorizeService
    accounts: FakeAccounts
    revoker: GrantRevoker
    factory: sessionmaker[Session]
    console_sessions: SQLAlchemyOAuthDeviceTokenRepository
    account_access: AccountAccessService
    usage: _RecordingClientUsage

    def approve(
        self,
        *,
        client_id: str = WEB_ID,
        redirect_uri: str = WEB_REDIRECT,
        context: RequestContext = AUTH_CONTEXT,
        issuer: str = ISSUER,
    ) -> str:
        request = AuthorizeRequest(
            client_id=client_id,
            redirect_uri=redirect_uri,
            code_challenge=CHALLENGE,
            code_challenge_method="S256",
            resource=None,
            scope=None,
            state="st",
        )
        url = self.authorize.approve(context, request, issuer=issuer)
        return parse_qs(urlsplit(url).query)["code"][0]

    def login(self, *, context: RequestContext = AUTH_CONTEXT) -> TokenGrantResult:
        return self.service.exchange(_code_request(self.approve(context=context)))

    def code_error(self, request: TokenRequest) -> TokenEndpointError:
        with pytest.raises(TokenEndpointError) as caught:
            self.service.exchange(request)
        return caught.value

    def refresh(self, token: str | None, **overrides: str | None) -> TokenGrantResult:
        return self.service.exchange(_refresh_request(token, **overrides))

    def refresh_error(self, token: str | None, **overrides: str | None) -> TokenEndpointError:
        with pytest.raises(TokenEndpointError) as caught:
            self.refresh(token, **overrides)
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

    def hard_expire(self, result: TokenGrantResult) -> None:
        resolver = OAuthAccessTokenResolver(self.factory, _cache_wrapper())
        with self.factory() as session:
            resolver.hard_expire(session, result.payload["token_id"], sha256_hex(result.payload["token"]))

    def listed_sessions(self) -> tuple[list[tuple[str, datetime | None]], list[tuple[str, datetime | None]]]:
        context = AccountRequestContext(request_id="r1", trace_id=None, account_id=ACCOUNT_ID, access_token_id=None)
        openapi = self.account_access.list_sessions(context, page=1, limit=100).items
        console = self.console_sessions.list_account_sessions(account_id=ACCOUNT_ID, page=1, limit=100).items
        return [(item.id, item.expires_at) for item in openapi], [(item.id, item.expires_at) for item in console]


def _world(
    factory: sessionmaker[Session],
    *,
    redis: DictRedis | None = None,
    after_find: Callable[[RefreshTokenRecord], None] | None = None,
    authorization_code_enabled: bool = True,
) -> _World:
    settings = FakeTokenSettings(authorization_code_enabled=authorization_code_enabled)
    cache = _cache_wrapper()
    clients = registry(
        web_client(),
        web_client(client_id=OTHER_ID),
        web_client(client_id=NO_REFRESH_ID, grant_types=frozenset({GrantType.AUTHORIZATION_CODE})),
        web_client(client_id=DEVICE_ONLY_ID, grant_types=frozenset({GrantType.DEVICE_CODE})),
        replace(web_client(client_id=ALIASED_ID), storage_client_id=ALIASED_STORAGE_ID),
        native_client(),
    )
    codes = RedisAuthorizationCodeRepository(redis or DictRedis())
    refresh = (
        SQLAlchemyOAuthRefreshTokenRepository(session_factory=factory)
        if after_find is None
        else _HookedRefreshTokens(session_factory=factory, after_find=after_find)
    )
    console_sessions = SQLAlchemyOAuthDeviceTokenRepository(
        session_factory=factory, redis=cache, max_sessions_per_account=15
    )
    accounts = FakeAccounts()
    revoker = GrantRevoker(session_factory=factory, redis=cache, refresh=refresh)
    usage = _RecordingClientUsage()
    return _World(
        service=OAuthTokenService(
            handlers=build_grant_handlers(
                device=FakeDevice(),
                clients=clients,
                codes=codes,
                refresh=refresh,
                accounts=accounts,
                workspaces=FakeWorkspaces(),
                tokens=OAuthDeviceTokenIssuanceGateway(tokens=console_sessions, ttl_policy=_FixedTTLPolicy()),
                revoke=revoker,
                settings=settings,
                usage=usage,
            )
        ),
        authorize=OAuthAuthorizeService(clients=clients, codes=codes, settings=settings),
        accounts=accounts,
        revoker=revoker,
        factory=factory,
        console_sessions=console_sessions,
        account_access=AccountAccessService(
            accounts=accounts,
            workspaces=_NoAccessWorkspaces(),
            sessions=SQLAlchemyOAuthAccessTokenRepository(session_factory=factory),
            invalidate_token_cache=_ignore_cache,
            now=lambda: datetime.now(UTC),
        ),
        usage=usage,
    )


@pytest.fixture
def issuer_from_origin(config_overrides: Callable[..., None]) -> None:
    config_overrides(CONSOLE_API_URL="")


@pytest.fixture
def world(sqlite_session_factory: sessionmaker[Session]) -> _World:
    return _world(sqlite_session_factory)


def _assert_close(value: datetime, expected: datetime) -> None:
    assert abs(value.replace(tzinfo=UTC) - expected) < timedelta(minutes=1)


@pytest.mark.usefixtures("issuer_from_origin")
class TestAuthorizationCodeGrantCases:
    @staticmethod
    def test_web_client_redeems_with_pkce(world: _World) -> None:
        login = world.login()

        assert login.payload["default_workspace_id"] == WORKSPACE_ID
        assert login.refresh_token is not None
        assert login.refresh_token.startswith(REFRESH_TOKEN_PREFIX)
        access = world.access_row(login)
        row = world.refresh_row(login.refresh_token)
        assert row is not None
        assert (row.account_id, row.workspace_id, row.client_id) == (ACCOUNT_ID, WORKSPACE_ID, WEB_ID)
        assert (row.subject_email, row.device_label) == (access.subject_email, access.device_label)
        assert access.device_label.startswith("QwenWork (")
        _assert_close(datetime.fromisoformat(login.payload["expires_at"]), datetime.now(UTC) + timedelta(hours=24))
        _assert_close(row.expires_at, datetime.now(UTC) + timedelta(days=30))
        assert world.usage.marked == [WEB_ID]

    @staticmethod
    def test_client_without_the_refresh_grant_gets_no_refresh_token(world: _World) -> None:
        redirect = "http://127.0.0.1:53412/callback"
        code = world.approve(client_id=NATIVE_ID, redirect_uri=redirect)

        result = world.service.exchange(_code_request(code, client_id=NATIVE_ID, redirect_uri=redirect))

        assert result.refresh_token is None
        assert world.refresh_rows() == []

    @staticmethod
    def test_resource_must_match_the_one_bound_to_the_code(world: _World) -> None:
        bound = world.approve(issuer=BROWSER_ISSUER)
        other = world.approve(issuer=BROWSER_ISSUER)

        assert world.service.exchange(_code_request(bound, resource=BROWSER_ISSUER)).payload["token"]
        assert world.code_error(_code_request(other, resource=ISSUER)).code is TokenErrorCode.INVALID_GRANT

    @staticmethod
    @pytest.mark.parametrize(
        ("overrides", "token_error"),
        [
            pytest.param({"code_verifier": "w" * 43}, TokenErrorCode.INVALID_GRANT, id="wrong-verifier"),
            pytest.param({"code_verifier": None}, TokenErrorCode.INVALID_GRANT, id="missing-verifier"),
            pytest.param({"redirect_uri": WEB_REDIRECT + "?x=1"}, TokenErrorCode.INVALID_GRANT, id="redirect"),
            pytest.param({"client_id": OTHER_ID}, TokenErrorCode.INVALID_GRANT, id="other-client"),
            pytest.param({"resource": UNKNOWN_RESOURCE}, TokenErrorCode.INVALID_TARGET, id="unknown-resource"),
        ],
    )
    def test_mismatch_burns_the_code(
        world: _World, overrides: dict[str, str | None], token_error: TokenErrorCode
    ) -> None:
        code = world.approve()

        assert world.code_error(_code_request(code, **overrides)).code is token_error
        assert world.code_error(_code_request(code)).code is TokenErrorCode.INVALID_GRANT
        assert world.live_access_ids() == set()
        assert world.usage.marked == []

    @staticmethod
    def test_unknown_code_is_invalid_grant(world: _World) -> None:
        assert world.code_error(_code_request("not-a-code")).code is TokenErrorCode.INVALID_GRANT

    @staticmethod
    def test_reused_code_is_invalid_grant(world: _World) -> None:
        code = world.approve()
        first = world.service.exchange(_code_request(code))

        assert world.code_error(_code_request(code)).code is TokenErrorCode.INVALID_GRANT
        assert world.live_access_ids() == {first.payload["token_id"]}

    @staticmethod
    @pytest.mark.parametrize(
        ("overrides", "token_error"),
        [
            pytest.param({"client_secret": "a-secret"}, TokenErrorCode.INVALID_CLIENT, id="secret-sent"),
            pytest.param({"client_id": DEVICE_ONLY_ID}, TokenErrorCode.UNAUTHORIZED_CLIENT, id="no-grant"),
        ],
    )
    def test_client_rejection_leaves_the_code(
        world: _World, overrides: dict[str, str | None], token_error: TokenErrorCode
    ) -> None:
        code = world.approve()

        assert world.code_error(_code_request(code, **overrides)).code is token_error
        assert world.service.exchange(_code_request(code)).payload["token"]

    @staticmethod
    @pytest.mark.parametrize("status", ["banned", "suspended"])
    def test_inactive_account_is_invalid_grant(world: _World, status: str) -> None:
        code = world.approve()
        world.accounts.accounts[ACCOUNT_ID] = account_snapshot(status=status)

        assert world.code_error(_code_request(code)).code is TokenErrorCode.INVALID_GRANT
        assert world.live_access_ids() == set()

    @staticmethod
    def test_creators_platform_code_is_invalid_grant_here(
        config_overrides: Callable[..., None], sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        config_overrides(REDIS_KEY_PREFIX="")
        raw = DictRedis()
        legacy = RedisOAuthServerTokenRepository(_cache_wrapper(raw)).issue_authorization_code(WEB_ID, ACCOUNT_ID)
        world = _world(sqlite_session_factory, redis=raw)

        assert world.code_error(_code_request(legacy)).code is TokenErrorCode.INVALID_GRANT
        assert len(raw.data) == 1


def test_browser_grants_are_unsupported_when_disabled(sqlite_session_factory: sessionmaker[Session]) -> None:
    world = _world(sqlite_session_factory, authorization_code_enabled=False)

    for request in (_code_request("any"), _refresh_request("dfor_any")):
        with pytest.raises(TokenEndpointError) as caught:
            world.service.exchange(request)
        assert caught.value.code is TokenErrorCode.UNSUPPORTED_GRANT_TYPE


@pytest.mark.usefixtures("issuer_from_origin")
class TestRefreshTokenGrantCases:
    @staticmethod
    def test_each_login_starts_its_own_grant(world: _World) -> None:
        first = world.login()
        second = world.login()

        assert world.live_access_ids() == {first.payload["token_id"], second.payload["token_id"]}
        assert len({row.family_id for row in world.refresh_rows()}) == 2

    @staticmethod
    def test_rotation_returns_a_new_pair_and_spends_the_old_refresh(world: _World) -> None:
        login = world.login()

        rotated = world.refresh(login.refresh_token, resource=ISSUER)

        assert rotated.payload["token"] != login.payload["token"]
        assert rotated.refresh_token not in (None, login.refresh_token)
        assert world.live_access_ids() == {rotated.payload["token_id"]}
        old = world.refresh_row(login.refresh_token)
        new = world.refresh_row(rotated.refresh_token)
        assert old is not None
        assert new is not None
        assert (old.rotated_at is not None, new.rotated_at) == (True, None)
        assert (new.family_id, new.device_label) == (old.family_id, old.device_label)
        _assert_close(new.expires_at, datetime.now(UTC) + timedelta(days=30))
        assert world.usage.marked == [WEB_ID]

    @staticmethod
    @pytest.mark.parametrize(
        ("overrides", "token_error"),
        [
            pytest.param({"resource": UNKNOWN_RESOURCE}, TokenErrorCode.INVALID_TARGET, id="unknown-resource"),
            pytest.param({"client_id": OTHER_ID}, TokenErrorCode.INVALID_GRANT, id="other-client"),
            pytest.param({"client_secret": "a-secret"}, TokenErrorCode.INVALID_CLIENT, id="secret-sent"),
            pytest.param({"client_id": NO_REFRESH_ID}, TokenErrorCode.UNAUTHORIZED_CLIENT, id="no-grant"),
        ],
    )
    def test_rejected_refresh_keeps_the_token(
        world: _World, overrides: dict[str, str | None], token_error: TokenErrorCode
    ) -> None:
        login = world.login()

        assert world.refresh_error(login.refresh_token, **overrides).code is token_error
        assert world.refresh(login.refresh_token).payload["token"]

    @staticmethod
    @pytest.mark.parametrize("token", [None, "dfor_unknown"])
    def test_missing_or_unknown_refresh_is_invalid_grant(world: _World, token: str | None) -> None:
        assert world.refresh_error(token).code is TokenErrorCode.INVALID_GRANT

    @staticmethod
    def test_replay_within_the_grace_issues_one_more_refresh_and_leaves_the_family_alone(world: _World) -> None:
        login = world.login()
        rotated = world.refresh(login.refresh_token)

        replayed = world.refresh(login.refresh_token)

        assert replayed.refresh_token not in (None, login.refresh_token, rotated.refresh_token)
        successor = world.refresh_row(rotated.refresh_token)
        assert successor is not None
        assert successor.rotated_at is None
        assert len(world.refresh_rows()) == 3
        assert world.live_access_ids() == {replayed.payload["token_id"]}

    @staticmethod
    def test_reuse_after_the_grace_revokes_the_grant(world: _World) -> None:
        login = world.login()
        rotated = world.refresh(login.refresh_token)
        world.set_refresh(login.refresh_token, rotated_at=datetime.now(UTC) - timedelta(minutes=31))

        assert world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert world.live_access_ids() == set()
        assert world.refresh_rows() == []
        assert world.refresh_error(rotated.refresh_token).code is TokenErrorCode.INVALID_GRANT

    @staticmethod
    def test_expired_refresh_is_invalid_grant_and_issues_nothing(world: _World) -> None:
        login = world.login()
        world.set_refresh(login.refresh_token, expires_at=datetime.now(UTC) - timedelta(seconds=1))

        assert world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert world.live_access_ids() == {login.payload["token_id"]}

    @staticmethod
    def test_refresh_works_after_hard_expire_revoked_the_access_row(world: _World) -> None:
        login = world.login()
        world.hard_expire(login)

        rotated = world.refresh(login.refresh_token)

        assert world.live_access_ids() == {rotated.payload["token_id"]}

    @staticmethod
    def test_inactive_account_is_invalid_grant_and_spends_nothing(world: _World) -> None:
        login = world.login()
        world.accounts.accounts[ACCOUNT_ID] = account_snapshot(status="banned")

        assert world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        row = world.refresh_row(login.refresh_token)
        assert row is not None
        assert row.rotated_at is None

    @staticmethod
    def test_changed_account_email_ends_the_grant(world: _World) -> None:
        login = world.login()
        world.accounts.accounts[ACCOUNT_ID] = replace(account_snapshot(), email="new@example.com")

        assert world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert world.refresh_rows() == []
        assert world.live_access_ids() == set()

    @staticmethod
    def test_revoke_landing_after_the_read_is_not_undone(sqlite_session_factory: sessionmaker[Session]) -> None:
        def revoke_concurrently(record: RefreshTokenRecord) -> None:
            world.revoker.revoke_grant(record.grant_key, account_id=record.account_id)

        world = _world(sqlite_session_factory, after_find=revoke_concurrently)
        login = world.login()

        assert world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert world.live_access_ids() == set()
        assert world.refresh_rows() == []

    @staticmethod
    def test_client_stored_under_another_id_refreshes_under_it(world: _World) -> None:
        code = world.approve(client_id=ALIASED_ID)
        login = world.service.exchange(_code_request(code, client_id=ALIASED_ID))
        # Checked before the refresh, which reuses the row under a new id.
        assert world.access_row(login).client_id == ALIASED_STORAGE_ID

        refreshed = world.refresh(login.refresh_token, client_id=ALIASED_ID)

        assert world.access_row(refreshed).client_id == ALIASED_STORAGE_ID


@pytest.mark.usefixtures("issuer_from_origin")
class TestSessionPathsKnowRefreshGrants:
    @staticmethod
    def test_idle_grant_is_listed_with_its_refresh_expiry_and_revoked_by_that_id(world: _World) -> None:
        login = world.login()
        world.hard_expire(login)
        row = world.refresh_row(login.refresh_token)
        assert row is not None
        listed = [(login.payload["token_id"], row.expires_at)]

        assert world.listed_sessions() == (listed, listed)
        assert world.console_sessions.revoke_account_session(account_id=ACCOUNT_ID, token_id=login.payload["token_id"])
        assert world.refresh_error(login.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert world.listed_sessions() == ([], [])

    @staticmethod
    def test_ending_a_grant_spares_another_account_holding_the_same_grant_key(
        world: _World, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(token_grants_module, "default_device_label", lambda client_name: f"{client_name} (fixed)")
        moved = world.login()
        world.accounts.accounts[ACCOUNT_ID] = replace(account_snapshot(), email="moved@example.com")
        world.accounts.accounts["account-2"] = account_snapshot("account-2")
        taker = world.login(context=AUTH_CONTEXT._replace(account_id="account-2"))
        # One row per grant key: the taker's login reused the moved account's row.
        assert world.live_access_ids() == {taker.payload["token_id"]}

        assert world.refresh_error(moved.refresh_token).code is TokenErrorCode.INVALID_GRANT
        assert world.refresh_row(moved.refresh_token) is None
        assert world.access_row(taker).revoked_at is None
        assert world.refresh_row(taker.refresh_token) is not None
