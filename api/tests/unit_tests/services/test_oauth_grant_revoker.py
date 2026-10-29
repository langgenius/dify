from dataclasses import dataclass, field
from datetime import timedelta

import pytest
from sqlalchemy import select
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
    WEB_ID,
    account_snapshot,
    registry,
    web_client,
)

OTHER_CLIENT_ID = "other-client"


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
    revoker: GrantRevoker
    redis: _RawRedis
    factory: sessionmaker[Session]

    def login(self, *, client_id: str = WEB_ID, device_label: str = "QwenWork abc123") -> IssuedOAuthToken:
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
            lifetime=timedelta(days=30),
        )

    def access_row(self, token: IssuedOAuthToken) -> OpenAPIOAuthAccessToken:
        with self.factory() as session:
            row = session.get(OpenAPIOAuthAccessToken, token.token_id)
            assert row is not None
            return row

    def refresh_labels(self) -> set[str]:
        with self.factory() as session:
            return set(session.scalars(select(OpenAPIOAuthRefreshToken.device_label)).all())


def _grant(client_id: str = WEB_ID, device_label: str = "QwenWork abc123") -> GrantKey:
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
        revoker=GrantRevoker(session_factory=sqlite_session_factory, redis=redis, refresh=refresh),
        redis=raw,
        factory=sqlite_session_factory,
    )


def _cache_key(token: str) -> str:
    return TOKEN_CACHE_KEY_FMT.format(hash=sha256_hex(token))


@pytest.mark.parametrize("by", ["access", "refresh"])
def test_revoke_by_either_token_ends_the_whole_login(harness: _Harness, by: str) -> None:
    access = harness.login()
    refresh = harness.issue_refresh(_grant())

    with record_locks(harness.factory) as log:
        harness.revoker.revoke_by_token(access.token if by == "access" else refresh, client_id=WEB_ID)

    row = harness.access_row(access)
    assert row.revoked_at is not None
    assert row.token_hash is None
    assert harness.refresh_labels() == set()
    assert harness.redis.deleted == [_cache_key(access.token)]
    assert log.tables[0] == "accounts"
    assert log.tables.count("accounts") == 1
    assert log.follows_lock_order()


@pytest.mark.parametrize("token", ["dfor_unknown", "future_token_format"])
def test_unknown_token_is_a_no_op(harness: _Harness, token: str) -> None:
    access = harness.login()
    harness.issue_refresh(_grant())

    harness.revoker.revoke_by_token(token, client_id=WEB_ID)

    assert harness.access_row(access).revoked_at is None
    assert harness.refresh_labels() == {"QwenWork abc123"}
    assert harness.redis.deleted == []


def test_token_issued_to_another_client_is_untouched(harness: _Harness) -> None:
    other = _grant(client_id=OTHER_CLIENT_ID)
    access = harness.login(client_id=OTHER_CLIENT_ID)
    refresh = harness.issue_refresh(other)

    harness.revoker.revoke_by_token(access.token, client_id=WEB_ID)
    harness.revoker.revoke_by_token(refresh, client_id=WEB_ID)

    assert harness.access_row(access).revoked_at is None
    assert harness.refresh_labels() == {"QwenWork abc123"}
    assert harness.redis.deleted == []


def test_revoke_grant_leaves_other_grants_alone(harness: _Harness) -> None:
    revoked = harness.login(device_label="QwenWork aaa")
    kept = harness.login(device_label="QwenWork bbb")
    harness.issue_refresh(_grant(device_label="QwenWork aaa"))
    harness.issue_refresh(_grant(device_label="QwenWork bbb"))

    harness.revoker.revoke_grant(_grant(device_label="QwenWork aaa"), account_id="account-1")

    assert harness.access_row(revoked).revoked_at is not None
    assert harness.access_row(kept).revoked_at is None
    assert harness.refresh_labels() == {"QwenWork bbb"}


@dataclass
class _RecordingRevoker:
    calls: list[tuple[str, str]] = field(default_factory=list)

    def revoke_by_token(self, token: str, *, client_id: str) -> None:
        self.calls.append((token, client_id))


def _revoke(revoker: _RecordingRevoker, *, secret: str | None = None, token: str | None = "dfoa_x") -> None:
    service = OAuthRevocationService(clients=registry(web_client()), grants=revoker)
    service.revoke(RevokeRequest(client_id=WEB_ID, client_secret=secret, token=token))


def test_revocation_authenticates_the_client_before_touching_tokens() -> None:
    revoker = _RecordingRevoker()

    with pytest.raises(TokenEndpointError) as bad_client:
        _revoke(revoker, secret="a-secret")
    with pytest.raises(TokenEndpointError) as no_token:
        _revoke(revoker, token=None)

    assert bad_client.value.code is TokenErrorCode.INVALID_CLIENT
    assert no_token.value.code is TokenErrorCode.INVALID_REQUEST
    assert revoker.calls == []

    _revoke(revoker)

    assert revoker.calls == [("dfoa_x", WEB_ID)]
