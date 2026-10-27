"""Fakes shared by the authorization-code service, grant and controller tests."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest

from enums.oauth_client import OAuthClientKind
from libs.helper import RateLimiter
from libs.oauth_bearer import sha256_hex
from models.oauth import OpenAPIOAuthClient
from services.entities.account_entities import AccountSnapshot
from services.oauth_clients import ClientSource, OAuthClientRegistry, ResolvedClient
from services.oauth_device_contracts import (
    DeviceWorkspace,
    IssuedOAuthToken,
    OAuthDeviceTokenRotation,
    RefreshTokenIssue,
)
from services.oauth_token_contracts import GrantType

MAX_DISPLAY_NAME_LENGTH = 255
MAX_LOGO_URI_COLUMN_LENGTH = 1024
CONFIDENTIAL_ID = "qwenwork"
CONFIDENTIAL_SECRET = "s3cret"
CONFIDENTIAL_REDIRECT = "https://nango-qwenwork.cn/oauth/callback"
PUBLIC_ID = "native-app"
PUBLIC_REDIRECT = "http://127.0.0.1/callback"
ISSUER = "https://api.example/openapi/v1"
VERIFIER = "v" * 43
# S256 of VERIFIER
CHALLENGE = "7w_YNF9DSfIdPf_pRjSq646_kPr-2-o9NAl16JGghdM"
ACCOUNT_ID = "account-1"
WORKSPACE_ID = "workspace-1"


def confidential_client(
    *,
    client_id: str = CONFIDENTIAL_ID,
    redirect_uris: Sequence[str] = (CONFIDENTIAL_REDIRECT,),
    grant_types: frozenset[GrantType] = frozenset({GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN}),
) -> ResolvedClient:
    return ResolvedClient(
        client_id=client_id,
        storage_client_id=client_id,
        kind=OAuthClientKind.CONFIDENTIAL,
        display_name="QwenWork",
        logo_uri="https://nango-qwenwork.cn/logo.png",
        redirect_uris=tuple(redirect_uris),
        grant_types=grant_types,
        secret_hash=sha256_hex(CONFIDENTIAL_SECRET),
    )


def public_client(*, redirect_uris: Sequence[str] = (PUBLIC_REDIRECT,)) -> ResolvedClient:
    return ResolvedClient(
        client_id=PUBLIC_ID,
        storage_client_id=PUBLIC_ID,
        kind=OAuthClientKind.PUBLIC,
        display_name="Native App",
        logo_uri=None,
        redirect_uris=tuple(redirect_uris),
        grant_types=frozenset({GrantType.AUTHORIZATION_CODE}),
        secret_hash=None,
    )


@dataclass
class FakeClientSource:
    clients: dict[str, ResolvedClient] = field(default_factory=dict)

    def resolve(self, client_id: str) -> ResolvedClient | None:
        return self.clients.get(client_id)


@dataclass
class FakeClientRepository:
    """In-memory client store with the repository's ``create`` and ``resolve``."""

    rows: dict[str, OpenAPIOAuthClient] = field(default_factory=dict)

    def create(
        self,
        *,
        client_id: str,
        kind: OAuthClientKind,
        display_name: str,
        redirect_uris: Sequence[str],
        grant_types: Sequence[GrantType],
        client_secret_hash: str | None = None,
        logo_uri: str | None = None,
    ) -> None:
        assert len(display_name) <= MAX_DISPLAY_NAME_LENGTH
        assert logo_uri is None or len(logo_uri) <= MAX_LOGO_URI_COLUMN_LENGTH
        row = OpenAPIOAuthClient(
            client_id=client_id,
            kind=kind,
            display_name=display_name,
            redirect_uris=list(redirect_uris),
            grant_types=[str(grant) for grant in grant_types],
            client_secret_hash=client_secret_hash,
            logo_uri=logo_uri,
        )
        self.rows[client_id] = row

    def resolve(self, client_id: str) -> ResolvedClient | None:
        row = self.rows.get(client_id)
        if row is None:
            return None
        return ResolvedClient(
            client_id=row.client_id,
            storage_client_id=row.client_id,
            kind=row.kind,
            display_name=row.display_name,
            logo_uri=row.logo_uri,
            redirect_uris=tuple(row.redirect_uris),
            grant_types=frozenset(grant for grant in GrantType if grant.value in row.grant_types),
            secret_hash=row.client_secret_hash,
        )


def registry(*clients: ResolvedClient, extra_sources: Sequence[ClientSource] = ()) -> OAuthClientRegistry:
    return OAuthClientRegistry([FakeClientSource({client.client_id: client for client in clients}), *extra_sources])


@dataclass
class DictRedis:
    """Dict-backed stand-in for the raw Redis client behind ``RedisClientWrapper``."""

    data: dict[str, str | bytes] = field(default_factory=dict)
    ttls: dict[str, int | timedelta] = field(default_factory=dict)

    def set(self, name: str, value: str | bytes, ex: int | None = None, **_options: object) -> bool:
        self.data[name] = value
        if ex is not None:
            self.ttls[name] = ex
        return True

    def get(self, name: str) -> str | bytes | None:
        return self.data.get(name)

    def setex(self, name: str, time: int | timedelta, value: str | bytes) -> bool:
        self.data[name] = value
        self.ttls[name] = time
        return True

    def delete(self, *names: str) -> int:
        return sum(self.data.pop(name, None) is not None for name in names)

    def getdel(self, name: str) -> str | bytes | None:
        return self.data.pop(name, None)

    def incr(self, name: str) -> int:
        count = int(self.data.get(name, 0)) + 1
        self.data[name] = str(count)
        return count

    def expire(self, name: str, time: int) -> bool:
        self.ttls[name] = time
        return True


@dataclass(frozen=True)
class FakeTokenSettings:
    authorization_code_enabled: bool = True
    auth_code_access_token_lifetime: timedelta = timedelta(hours=24)
    authorization_code_ttl: timedelta = timedelta(seconds=600)
    refresh_token_lifetime: timedelta = timedelta(days=30)
    refresh_reuse_grace: timedelta = timedelta(minutes=30)


def account_snapshot(account_id: str = ACCOUNT_ID, *, status: str = "active") -> AccountSnapshot:
    now = datetime.now(UTC)
    return AccountSnapshot(
        id=account_id,
        name="Ada",
        email="ada@example.com",
        avatar=None,
        is_password_set=True,
        interface_language="en-US",
        interface_theme="light",
        timezone="UTC",
        last_login_at=now,
        last_login_ip="127.0.0.1",
        status=status,
        initialized_at=now,
        created_at=now,
    )


@dataclass
class FakeAccounts:
    accounts: dict[str, AccountSnapshot] = field(default_factory=lambda: {ACCOUNT_ID: account_snapshot()})

    def get(self, account_id: str) -> AccountSnapshot | None:
        return self.accounts.get(account_id)

    def has_active_email(self, email: str) -> bool:
        _ = email
        return False


@dataclass
class FakeWorkspaces:
    rows: tuple[DeviceWorkspace, ...] = (DeviceWorkspace(id=WORKSPACE_ID, name="Main", role="owner", current=True),)

    def list_for_device_flow(self, account_id: str) -> tuple[DeviceWorkspace, ...]:
        _ = account_id
        return self.rows


@dataclass(frozen=True)
class IssueCall:
    account_id: str
    workspace_id: str
    client_id: str
    device_label: str
    lifetime: timedelta | None
    refresh: RefreshTokenIssue | None


@dataclass
class FakeTokenIssuer:
    calls: list[IssueCall] = field(default_factory=list)

    def issue_account_token(
        self,
        *,
        account: AccountSnapshot,
        workspace_id: str,
        client_id: str,
        device_label: str,
        lifetime: timedelta | None = None,
        refresh: RefreshTokenIssue | None = None,
    ) -> IssuedOAuthToken:
        self.calls.append(
            IssueCall(
                account_id=account.id,
                workspace_id=workspace_id,
                client_id=client_id,
                device_label=device_label,
                lifetime=lifetime,
                refresh=refresh,
            )
        )
        number = len(self.calls)
        return IssuedOAuthToken(
            token=f"dfoa_token-{number}",
            expires_at=(datetime.now(UTC) + (lifetime or timedelta(days=14))).isoformat(),
            rotation=OAuthDeviceTokenRotation(
                token_id=f"token-{number}", replaced_token_id=None, replaced_token_hash=None
            ),
            refresh_token=None if refresh is None else f"dfor_refresh-{number}",
        )

    def issue_external_token(
        self,
        *,
        subject_email: str,
        subject_issuer: str,
        client_id: str,
        device_label: str,
    ) -> IssuedOAuthToken:
        raise AssertionError("external tokens are not issued by the authorization-code grant")

    def rollback_token(self, token: IssuedOAuthToken) -> bool:
        _ = token
        return True


@dataclass
class RateLimitHits:
    """Hit counts per full limiter key (``<prefix>:<key>``)."""

    hits: dict[str, int] = field(default_factory=dict)


def install_rate_limit_store(monkeypatch: pytest.MonkeyPatch) -> RateLimitHits:
    store = RateLimitHits()

    def is_rate_limited(limiter: RateLimiter, key: str) -> bool:
        return store.hits.get(f"{limiter.prefix}:{key}", 0) >= limiter.max_attempts

    def increment(limiter: RateLimiter, key: str) -> None:
        full_key = f"{limiter.prefix}:{key}"
        store.hits[full_key] = store.hits.get(full_key, 0) + 1

    monkeypatch.setattr(RateLimiter, "is_rate_limited", is_rate_limited)
    monkeypatch.setattr(RateLimiter, "increment_rate_limit", increment)
    return store
