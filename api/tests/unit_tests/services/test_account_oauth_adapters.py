from threading import Event
from typing import override

import httpx
import pytest
from redis.exceptions import LockNotOwnedError
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from libs.oauth import JsonObject, OAuth, OAuthUserInfo
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin
from repositories import account_oauth_repository
from repositories.account_oauth_repository import (
    AccountServiceOAuthAccountRegistrationGateway,
    AccountServiceOAuthWorkspaceGateway,
)
from services import account_oauth_adapters
from services.account_errors import (
    OAuthIdentityLockUnavailableError,
    OAuthProviderAuthorizationError,
    OAuthProviderRequestError,
    OAuthWorkspaceCreationNotAllowedError,
)
from services.account_oauth_adapters import DifyOAuthProviderGateway, RedisOAuthAccountClaimLock
from services.account_service import AccountService, TenantService
from services.entities.account_oauth_entities import OAuthAccountRegistration, OAuthAuthorizationRequest, OAuthIdentity
from services.errors.workspace import WorkspacesLimitExceededError


class StubOAuthClient(OAuth):
    def __init__(self) -> None:
        super().__init__("client-id", "client-secret", "https://api.example/callback")
        self.authorization_args: tuple[str | None, str | None, str | None, str | None] | None = None
        self.access_codes: list[str] = []
        self.user_tokens: list[str] = []
        self.failure: Exception | None = None

    @override
    def get_authorization_url(
        self,
        invite_token: str | None = None,
        timezone: str | None = None,
        language: str | None = None,
        redirect_url: str | None = None,
    ) -> str:
        self.authorization_args = (invite_token, timezone, language, redirect_url)
        return "https://provider.example/authorize"

    @override
    def get_access_token(self, code: str) -> str:
        self.access_codes.append(code)
        if self.failure is not None:
            raise self.failure
        return "provider-token"

    @override
    def get_user_info(self, token: str) -> OAuthUserInfo:
        self.user_tokens.append(token)
        return OAuthUserInfo(id="provider-user", name="User", email="user@example.com")

    @override
    def get_raw_user_info(self, token: str) -> JsonObject:
        raise AssertionError(token)

    @override
    def _transform_user_info(self, raw_info: JsonObject) -> OAuthUserInfo:
        raise AssertionError(raw_info)


class StubRedisLock:
    def __init__(self, *, acquire_result: bool = True, reacquire_error: Exception | None = None) -> None:
        self.acquire_result = acquire_result
        self.reacquire_error = reacquire_error
        self.acquire_calls = 0
        self.reacquire_calls = 0
        self.release_calls = 0
        self.reacquired = Event()

    def acquire(self) -> bool:
        self.acquire_calls += 1
        return self.acquire_result

    def reacquire(self) -> bool:
        self.reacquire_calls += 1
        self.reacquired.set()
        if self.reacquire_error is not None:
            raise self.reacquire_error
        return True

    def release(self) -> None:
        self.release_calls += 1


class StubRedisClient:
    def __init__(self, *locks: StubRedisLock) -> None:
        self._locks = locks
        self.lock_calls: list[tuple[str, float | None, float | None, bool]] = []

    def lock(
        self,
        name: str,
        timeout: float | None = None,
        sleep: float = 0.1,
        blocking: bool = True,
        blocking_timeout: float | None = None,
        thread_local: bool = True,
    ) -> StubRedisLock:
        del sleep, blocking
        self.lock_calls.append((name, timeout, blocking_timeout, thread_local))
        return self._locks[len(self.lock_calls) - 1]


def test_account_claim_lock_uses_redis_without_exposing_identity_or_email() -> None:
    locks = (StubRedisLock(), StubRedisLock())
    client = StubRedisClient(*locks)
    account_claims = RedisOAuthAccountClaimLock(client=client)  # type: ignore[arg-type]

    with account_claims.acquire(provider="github", open_id="provider-user", email="user@example.com"):
        assert all(lock.acquire_calls == 1 for lock in locks)

    assert all(lock.release_calls == 1 for lock in locks)
    assert len(client.lock_calls) == 2
    for lock_name, timeout, blocking_timeout, thread_local in client.lock_calls:
        assert lock_name.startswith("oauth:account-claim:")
        assert "provider-user" not in lock_name
        assert "user@example.com" not in lock_name
        assert timeout == 60
        assert blocking_timeout == 10
        assert thread_local is False
    assert [call[0] for call in client.lock_calls] == sorted(call[0] for call in client.lock_calls)


def test_account_claim_lock_hashes_final_account_id() -> None:
    lock = StubRedisLock()
    client = StubRedisClient(lock)
    account_claims = RedisOAuthAccountClaimLock(client=client)  # type: ignore[arg-type]

    with account_claims.acquire_account("account-1"):
        assert lock.acquire_calls == 1

    assert lock.release_calls == 1
    assert len(client.lock_calls) == 1
    lock_name, _, _, _ = client.lock_calls[0]
    assert lock_name.startswith("oauth:account-claim:")
    assert "account-1" not in lock_name


def test_account_claim_lock_renews_both_leases_while_the_flow_is_running(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(account_oauth_adapters, "_OAUTH_ACCOUNT_CLAIM_LOCK_RENEW_INTERVAL_SECONDS", 0.01)
    locks = (StubRedisLock(), StubRedisLock())
    client = StubRedisClient(*locks)
    account_claims = RedisOAuthAccountClaimLock(client=client)  # type: ignore[arg-type]

    with account_claims.acquire(provider="github", open_id="provider-user", email="user@example.com"):
        assert all(lock.reacquired.wait(timeout=1) for lock in locks)

    assert all(lock.reacquire_calls >= 1 for lock in locks)
    assert all(lock.release_calls == 1 for lock in locks)


def test_account_claim_lease_notifies_caller_when_heartbeat_loses_ownership(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(account_oauth_adapters, "_OAUTH_ACCOUNT_CLAIM_LOCK_RENEW_INTERVAL_SECONDS", 0.01)
    lock = StubRedisLock(reacquire_error=LockNotOwnedError("lease lost"))
    client = StubRedisClient(lock)
    account_claims = RedisOAuthAccountClaimLock(client=client)  # type: ignore[arg-type]
    writes: list[str] = []

    def use_lost_lease() -> None:
        with account_claims.acquire_account("account-1") as lease:
            assert lock.reacquired.wait(timeout=1)
            lease.ensure_owned()
            writes.append("must-not-run")

    with pytest.raises(OAuthIdentityLockUnavailableError):
        use_lost_lease()

    assert writes == []
    assert lock.release_calls == 1


def test_account_claim_lock_releases_partial_acquisition_on_failure() -> None:
    first_lock = StubRedisLock()
    failed_lock = StubRedisLock(acquire_result=False)
    client = StubRedisClient(first_lock, failed_lock)
    account_claims = RedisOAuthAccountClaimLock(client=client)  # type: ignore[arg-type]

    with pytest.raises(OAuthIdentityLockUnavailableError):
        with account_claims.acquire(provider="github", open_id="provider-user", email="user@example.com"):
            raise AssertionError("lock body must not run")

    assert first_lock.release_calls == 1
    assert failed_lock.release_calls == 0


def test_registration_gateway_creates_only_the_account(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str, str, str | None, str | None]] = []

    def create_account(
        email: str,
        name: str,
        interface_language: str,
        password: str | None = None,
        interface_theme: str = "light",
        is_setup: bool | None = False,
        timezone: str | None = None,
        ip_address: str | None = None,
        *,
        session: Session,
    ) -> Account:
        del password, interface_theme, is_setup
        calls.append((email, name, interface_language, timezone, ip_address))
        account = Account(
            email=email,
            name=name,
            interface_language=interface_language,
            timezone=timezone,
            last_login_ip=ip_address,
        )
        session.add(account)
        session.flush()
        return account

    def unexpected_default_workspace_join(account_id: str) -> None:
        raise AssertionError(account_id)

    monkeypatch.setattr(AccountService, "create_account", create_account)
    monkeypatch.setattr(account_oauth_repository, "try_join_default_workspace", unexpected_default_workspace_join)
    gateway = AccountServiceOAuthAccountRegistrationGateway(session_factory=sqlite_session_factory)

    account_id = gateway.register(
        OAuthAccountRegistration(
            email="user@example.com",
            name="User",
            language="en-US",
            timezone="Asia/Singapore",
            ip_address="203.0.113.10",
        )
    )

    assert calls == [("user@example.com", "User", "en-US", "Asia/Singapore", "203.0.113.10")]
    with sqlite_session_factory() as session:
        account = session.get(Account, account_id)
        assert account is not None
        assert account.status == AccountStatus.ACTIVE
        assert account.initialized_at is not None
        assert session.scalar(select(func.count()).select_from(Tenant)) == 0
        assert session.scalar(select(func.count()).select_from(TenantAccountJoin)) == 0


def test_workspace_gateway_maps_workspace_quota_failure(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with sqlite_session_factory.begin() as session:
        account = Account(name="User", email="user@example.com")
        session.add(account)
        session.flush()
        account_id = account.id

    def raise_workspace_limit(account: Account, *, session: Session) -> None:
        assert account.id == account_id
        assert session.get(Account, account_id) is account
        raise WorkspacesLimitExceededError

    monkeypatch.setattr(TenantService, "create_owner_tenant", raise_workspace_limit)
    gateway = AccountServiceOAuthWorkspaceGateway(session_factory=sqlite_session_factory)

    with pytest.raises(OAuthWorkspaceCreationNotAllowedError):
        gateway.create_owner_workspace(account_id)


def test_provider_gateway_adapts_authorization_and_identity_contracts() -> None:
    client = StubOAuthClient()
    gateway = DifyOAuthProviderGateway(provider_name="github", client=client)
    request = OAuthAuthorizationRequest(
        invite_token="invite",
        timezone="Asia/Shanghai",
        language="zh-Hans",
        redirect_url="/apps",
    )

    authorization_url = gateway.get_authorization_url(request)
    identity = gateway.get_identity("authorization-code")

    assert authorization_url == "https://provider.example/authorize"
    assert client.authorization_args == ("invite", "Asia/Shanghai", "zh-Hans", "/apps")
    assert client.access_codes == ["authorization-code"]
    assert client.user_tokens == ["provider-token"]
    assert identity == OAuthIdentity("provider-user", "User", "user@example.com")


def test_provider_gateway_translates_transport_failure() -> None:
    client = StubOAuthClient()
    client.failure = httpx.ConnectError("provider unavailable")
    gateway = DifyOAuthProviderGateway(provider_name="github", client=client)

    with pytest.raises(OAuthProviderRequestError) as raised:
        gateway.get_identity("authorization-code")

    assert raised.value.__cause__ is client.failure


def test_provider_gateway_translates_provider_rejection() -> None:
    client = StubOAuthClient()
    client.failure = ValueError("invalid authorization code")
    gateway = DifyOAuthProviderGateway(provider_name="github", client=client)

    with pytest.raises(OAuthProviderAuthorizationError) as raised:
        gateway.get_identity("authorization-code")

    assert raised.value.description == "invalid authorization code"
    assert raised.value.__cause__ is client.failure
