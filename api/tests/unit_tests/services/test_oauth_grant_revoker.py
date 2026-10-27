from dataclasses import dataclass, field
from datetime import timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TOKEN_CACHE_KEY_FMT
from extensions.ext_redis import RedisClientWrapper
from libs.oauth_bearer import sha256_hex
from models.oauth import OpenAPIOAuthAccessToken, OpenAPIOAuthRefreshToken
from repositories.oauth_device_token_repository import SQLAlchemyOAuthDeviceTokenRepository
from repositories.oauth_refresh_token_repository import SQLAlchemyOAuthRefreshTokenRepository
from services.oauth_device_adapters import OAuthDeviceTokenIssuanceGateway
from services.oauth_device_contracts import GrantKey, IssuedOAuthToken
from services.oauth_grant_revoker import GrantRevoker, OAuthRevocationService, RevokeRequest
from services.oauth_token_contracts import TokenEndpointError, TokenErrorCode
from tests.helpers.unit.repositories.oauth_lock_order import record_locks
from tests.helpers.unit.repositories.oauth_refresh_tokens import seed_refresh_token
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    CONFIDENTIAL_ID,
    CONFIDENTIAL_SECRET,
    RateLimitHits,
    account_snapshot,
    confidential_client,
    install_rate_limit_store,
    registry,
)

OTHER_CLIENT_ID = "other-client"
REFRESH_LIFETIME = timedelta(days=30)


@dataclass
class _RawRedis:
    deleted: list[str | bytes] = field(default_factory=list)

    def delete(self, *names: str | bytes) -> None:
        self.deleted.extend(names)


@dataclass
class _TTLPolicy:
    def ttl_days(self, workspace_id: str | None) -> int:
        _ = workspace_id
        return 14


@dataclass
class _Harness:
    issuer: OAuthDeviceTokenIssuanceGateway
    tokens: SQLAlchemyOAuthDeviceTokenRepository
    refresh: SQLAlchemyOAuthRefreshTokenRepository
    revoker: GrantRevoker
    redis: _RawRedis
    factory: sessionmaker[Session]

    def login(self, *, client_id: str = CONFIDENTIAL_ID, device_label: str = "QwenWork abc123") -> IssuedOAuthToken:
        return self.issuer.issue_account_token(
            account=account_snapshot(),
            workspace_id="workspace-1",
            client_id=client_id,
            device_label=device_label,
        )

    def issue_refresh(self, grant: GrantKey) -> str:
        return seed_refresh_token(
            self.factory,
            grant=grant,
            account_id="account-1",
            workspace_id="workspace-1",
            lifetime=REFRESH_LIFETIME,
        )

    def access_row(self, token: IssuedOAuthToken) -> OpenAPIOAuthAccessToken:
        with self.factory() as session:
            row = session.get(OpenAPIOAuthAccessToken, token.token_id)
            assert row is not None
            return row

    def refresh_count(self, grant: GrantKey) -> int:
        with self.factory() as session:
            return (
                session.scalar(
                    select(func.count())
                    .select_from(OpenAPIOAuthRefreshToken)
                    .where(
                        OpenAPIOAuthRefreshToken.client_id == grant.client_id,
                        OpenAPIOAuthRefreshToken.device_label == grant.device_label,
                    )
                )
                or 0
            )


def _grant(client_id: str = CONFIDENTIAL_ID, device_label: str = "QwenWork abc123") -> GrantKey:
    return GrantKey(
        subject_email="ada@example.com",
        subject_issuer="dify:account",
        client_id=client_id,
        device_label=device_label,
    )


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]) -> _Harness:
    raw = _RawRedis()
    redis = RedisClientWrapper()
    redis.initialize(raw)  # type: ignore[arg-type]
    tokens = SQLAlchemyOAuthDeviceTokenRepository(
        session_factory=sqlite_session_factory, redis=redis, max_sessions_per_account=15
    )
    refresh = SQLAlchemyOAuthRefreshTokenRepository(session_factory=sqlite_session_factory)
    return _Harness(
        issuer=OAuthDeviceTokenIssuanceGateway(tokens=tokens, ttl_policy=_TTLPolicy()),
        tokens=tokens,
        refresh=refresh,
        revoker=GrantRevoker(session_factory=sqlite_session_factory, redis=redis, refresh=refresh),
        redis=raw,
        factory=sqlite_session_factory,
    )


def _cache_key(token: str) -> str:
    return TOKEN_CACHE_KEY_FMT.format(hash=sha256_hex(token))


def test_revoke_by_access_token_kills_the_refresh_token(harness: _Harness) -> None:
    access = harness.login()
    harness.issue_refresh(_grant())

    harness.revoker.revoke_by_token(access.token, client_id=CONFIDENTIAL_ID)

    row = harness.access_row(access)
    assert row.revoked_at is not None
    assert row.token_hash is None
    assert harness.refresh_count(_grant()) == 0
    assert _cache_key(access.token) in harness.redis.deleted


def test_revoke_by_refresh_token_kills_the_access_row(harness: _Harness) -> None:
    access = harness.login()
    refresh = harness.issue_refresh(_grant())

    harness.revoker.revoke_by_token(refresh, client_id=CONFIDENTIAL_ID)

    row = harness.access_row(access)
    assert row.revoked_at is not None
    assert row.token_hash is None
    assert harness.refresh_count(_grant()) == 0
    assert harness.redis.deleted == [_cache_key(access.token)]


@pytest.mark.parametrize("token", ["dfoa_unknown", "dfor_unknown", "future_token_format", ""])
def test_unknown_token_is_a_no_op(harness: _Harness, token: str) -> None:
    access = harness.login()
    harness.issue_refresh(_grant())

    harness.revoker.revoke_by_token(token, client_id=CONFIDENTIAL_ID)

    assert harness.access_row(access).revoked_at is None
    assert harness.refresh_count(_grant()) == 1
    assert harness.redis.deleted == []


def test_token_issued_to_another_client_is_untouched(harness: _Harness) -> None:
    other = _grant(client_id=OTHER_CLIENT_ID)
    access = harness.login(client_id=OTHER_CLIENT_ID)
    refresh = harness.issue_refresh(other)

    harness.revoker.revoke_by_token(access.token, client_id=CONFIDENTIAL_ID)
    harness.revoker.revoke_by_token(refresh, client_id=CONFIDENTIAL_ID)

    assert harness.access_row(access).revoked_at is None
    assert harness.refresh_count(other) == 1
    assert harness.redis.deleted == []


def test_revoke_grant_leaves_other_grants_alone(harness: _Harness) -> None:
    revoked = harness.login(device_label="QwenWork aaa")
    kept = harness.login(device_label="QwenWork bbb")
    harness.issue_refresh(_grant(device_label="QwenWork aaa"))
    harness.issue_refresh(_grant(device_label="QwenWork bbb"))

    harness.revoker.revoke_grant(_grant(device_label="QwenWork aaa"), account_id="account-1")

    assert harness.access_row(revoked).revoked_at is not None
    assert harness.access_row(kept).revoked_at is None
    assert harness.refresh_count(_grant(device_label="QwenWork aaa")) == 0
    assert harness.refresh_count(_grant(device_label="QwenWork bbb")) == 1


def test_revoked_access_token_no_longer_finds_its_grant(harness: _Harness) -> None:
    first = harness.login()
    second = harness.login()
    harness.issue_refresh(_grant())

    harness.revoker.revoke_by_token(first.token, client_id=CONFIDENTIAL_ID)

    assert harness.access_row(second).revoked_at is None
    assert harness.refresh_count(_grant()) == 1


def test_revoke_grant_stops_a_later_rollback_from_restoring_rows(harness: _Harness) -> None:
    first = harness.login()
    second = harness.login()

    harness.revoker.revoke_grant(_grant(), account_id="account-1")

    assert harness.tokens.rollback_rotation(second.rotation) is False
    assert harness.access_row(first).revoked_at is not None
    assert harness.access_row(first).token_hash is None
    assert harness.access_row(second).revoked_at is not None


@pytest.mark.parametrize("by", ["access", "refresh"])
def test_revoke_by_token_locks_the_account_row_first(harness: _Harness, by: str) -> None:
    access = harness.login()
    refresh = harness.issue_refresh(_grant())

    with record_locks(harness.factory) as log:
        harness.revoker.revoke_by_token(access.token if by == "access" else refresh, client_id=CONFIDENTIAL_ID)

    assert log.tables[0] == "accounts"
    assert log.tables.count("accounts") == 1
    assert log.follows_lock_order()


def test_revoke_of_a_refresh_only_grant_still_locks_the_account(harness: _Harness) -> None:
    harness.issue_refresh(_grant())

    with record_locks(harness.factory) as log:
        harness.revoker.revoke_grant(_grant(), account_id="account-1")

    assert log.tables[0] == "accounts"
    assert harness.refresh_count(_grant()) == 0


def test_external_sso_grant_revoke_takes_no_account_lock(harness: _Harness) -> None:
    external = harness.issuer.issue_external_token(
        subject_email="sso@example.com", subject_issuer="https://idp.example", client_id="difyctl", device_label="cli"
    )
    grant = GrantKey(
        subject_email="sso@example.com", subject_issuer="https://idp.example", client_id="difyctl", device_label="cli"
    )

    with record_locks(harness.factory) as log:
        harness.revoker.revoke_grant(grant, account_id=None)

    assert "accounts" not in log.tables
    assert harness.access_row(external).revoked_at is not None


@dataclass
class _RecordingRevoker:
    calls: list[tuple[str, str]] = field(default_factory=list)

    def revoke_by_token(self, token: str, *, client_id: str) -> None:
        self.calls.append((token, client_id))


@pytest.fixture
def client_auth_hits(monkeypatch: pytest.MonkeyPatch) -> RateLimitHits:
    return install_rate_limit_store(monkeypatch)


def _revocation(revoker: _RecordingRevoker) -> OAuthRevocationService:
    return OAuthRevocationService(clients=registry(confidential_client()), grants=revoker)


def _request(
    *, client_id: str | None = CONFIDENTIAL_ID, secret: str | None = CONFIDENTIAL_SECRET, token: str | None = "dfoa_x"
) -> RevokeRequest:
    return RevokeRequest(client_id=client_id, client_secret=secret, token=token, source_ip="192.0.2.10")


@pytest.mark.usefixtures("client_auth_hits")
def test_revocation_passes_the_storage_client_id() -> None:
    revoker = _RecordingRevoker()

    _revocation(revoker).revoke(_request())

    assert revoker.calls == [("dfoa_x", CONFIDENTIAL_ID)]


@pytest.mark.usefixtures("client_auth_hits")
@pytest.mark.parametrize(
    ("client_id", "secret"),
    [(CONFIDENTIAL_ID, "wrong"), ("unknown-client", CONFIDENTIAL_SECRET), (None, None)],
)
def test_revocation_rejects_bad_client_before_touching_tokens(client_id: str | None, secret: str | None) -> None:
    revoker = _RecordingRevoker()

    with pytest.raises(TokenEndpointError) as caught:
        _revocation(revoker).revoke(_request(client_id=client_id, secret=secret))

    assert caught.value.code is TokenErrorCode.INVALID_CLIENT
    assert revoker.calls == []


@pytest.mark.usefixtures("client_auth_hits")
@pytest.mark.parametrize("token", [None, ""])
def test_revocation_without_a_token_is_invalid_request(token: str | None) -> None:
    revoker = _RecordingRevoker()

    with pytest.raises(TokenEndpointError) as caught:
        _revocation(revoker).revoke(_request(token=token))

    assert caught.value.code is TokenErrorCode.INVALID_REQUEST
    assert revoker.calls == []
