from _thread import LockType
from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from threading import Barrier, Lock
from typing import NoReturn

import pytest

from services.account_errors import (
    AccountEmailDomainSuspendedError,
    AccountEmailFrozenError,
    InvalidOAuthInvitationError,
    InvalidOAuthProviderError,
    OAuthAccountBannedError,
    OAuthIdentityLockUnavailableError,
    OAuthInvitationAccountMismatchError,
    OAuthRegistrationError,
    OAuthWorkspaceCreationNotAllowedError,
)
from services.account_oauth_service import AccountOAuthService
from services.entities.account_entities import AccountSnapshot
from services.entities.account_oauth_entities import (
    AccountSessionTokens,
    OAuthAccountRegistration,
    OAuthAuthorizationRequest,
    OAuthCallbackCommand,
    OAuthIdentity,
    OAuthInvitation,
    OAuthInvitationResult,
    OAuthSignInResult,
)

NOW = datetime(2026, 8, 24, 12, 0)


def _account(
    *,
    account_id: str = "account-1",
    email: str = "user@example.com",
    status: str = "active",
) -> AccountSnapshot:
    return AccountSnapshot(
        id=account_id,
        name="User",
        email=email,
        avatar=None,
        is_password_set=False,
        interface_language="en-US",
        interface_theme="light",
        timezone="UTC",
        last_login_at=None,
        last_login_ip=None,
        status=status,
        initialized_at=None,
        created_at=NOW,
    )


class FakeProvider:
    def __init__(self, identity: OAuthIdentity | None = None) -> None:
        self.identity = identity or OAuthIdentity(id="provider-user", name="User", email="user@example.com")
        self.authorization_requests: list[OAuthAuthorizationRequest] = []
        self.codes: list[str] = []
        self.identity_hook: Callable[[], None] | None = None

    def get_authorization_url(self, request: OAuthAuthorizationRequest) -> str:
        self.authorization_requests.append(request)
        return "https://provider.example/authorize"

    def get_identity(self, code: str) -> OAuthIdentity:
        self.codes.append(code)
        if self.identity_hook is not None:
            self.identity_hook()
        return self.identity


@dataclass
class FakeAccounts:
    email_account: AccountSnapshot | None = None
    stored: dict[str, AccountSnapshot] = field(default_factory=dict)
    get_calls: list[str] = field(default_factory=list)
    email_lookups: list[str] = field(default_factory=list)
    activations: list[tuple[str, datetime]] = field(default_factory=list)

    def get(self, account_id: str) -> AccountSnapshot | None:
        self.get_calls.append(account_id)
        return self.stored.get(account_id)

    def find_by_email(self, email: str) -> AccountSnapshot | None:
        self.email_lookups.append(email)
        return self.email_account

    def activate_pending(self, account_id: str, *, initialized_at: datetime) -> None:
        self.activations.append((account_id, initialized_at))

    def get_credentials(self, account_id: str) -> NoReturn:
        raise AssertionError(account_id)

    def update_profile(self, account_id: str, changes: object) -> NoReturn:
        raise AssertionError((account_id, changes))

    def update_password(self, account_id: str, password: object) -> NoReturn:
        raise AssertionError((account_id, password))

    def initialize(
        self,
        account_id: str,
        initialization: object,
        *,
        invitation_code: str | None,
        workspace_id: str | None,
    ) -> NoReturn:
        raise AssertionError((account_id, initialization, invitation_code, workspace_id))

    def email_exists(self, email: str) -> bool:
        raise AssertionError(email)

    def reset_email(self, account_id: str, *, expected_old_email: str, new_email: str) -> NoReturn:
        raise AssertionError((account_id, expected_old_email, new_email))


@dataclass
class FakeIntegrations:
    accounts: FakeAccounts
    account_ids_by_identity: dict[tuple[str, str], str] = field(default_factory=dict)
    identity_lookups: list[tuple[str, str]] = field(default_factory=list)
    links: list[tuple[str, str, str]] = field(default_factory=list)

    def find_account_id(self, *, provider: str, open_id: str) -> str | None:
        self.identity_lookups.append((provider, open_id))
        return self.account_ids_by_identity.get((provider, open_id))

    def list_for_account(self, account_id: str) -> NoReturn:
        raise AssertionError(account_id)

    def link(self, account_id: str, *, provider: str, open_id: str) -> None:
        self.links.append((account_id, provider, open_id))
        self.account_ids_by_identity[(provider, open_id)] = account_id
        account = self.accounts.get(account_id) or self.accounts.email_account
        if account is not None:
            self.accounts.email_account = account


@dataclass
class FakeAccountClaimLease:
    lost: bool = False
    checks: int = 0

    def ensure_owned(self) -> None:
        self.checks += 1
        if self.lost:
            raise OAuthIdentityLockUnavailableError


@dataclass
class FakeAccountClaims:
    claims: list[tuple[str, str, str]] = field(default_factory=list)
    account_ids: list[str] = field(default_factory=list)
    identity_leases: list[FakeAccountClaimLease] = field(default_factory=list)
    account_leases: list[FakeAccountClaimLease] = field(default_factory=list)
    lose_identity_on_acquire: bool = False
    _locks: dict[str, LockType] = field(default_factory=dict, repr=False)
    _registry_lock: LockType = field(default_factory=Lock, repr=False)

    @contextmanager
    def acquire(self, *, provider: str, open_id: str, email: str) -> Generator[FakeAccountClaimLease, None, None]:
        self.claims.append((provider, open_id, email))
        lease = FakeAccountClaimLease(lost=self.lose_identity_on_acquire)
        self.identity_leases.append(lease)
        with self._acquire_keys((f"email:{email}", f"identity:{provider}:{open_id}")):
            yield lease
            lease.ensure_owned()

    @contextmanager
    def acquire_account(self, account_id: str) -> Generator[FakeAccountClaimLease, None, None]:
        self.account_ids.append(account_id)
        lease = FakeAccountClaimLease()
        self.account_leases.append(lease)
        with self._acquire_keys((f"account:{account_id}",)):
            yield lease
            lease.ensure_owned()

    @contextmanager
    def _acquire_keys(self, keys: tuple[str, ...]) -> Generator[None, None, None]:
        with self._registry_lock:
            locks = [self._locks.setdefault(key, Lock()) for key in sorted(keys)]
        for lock in locks:
            lock.acquire()
        try:
            yield
        finally:
            for lock in reversed(locks):
                lock.release()


@dataclass
class FakeMemberships:
    workspace_ids: tuple[str, ...] = ("workspace-1",)
    account_ids: list[str] = field(default_factory=list)
    check_hook: Callable[[], None] | None = None

    def list_ids_for_account(self, account_id: str) -> tuple[str, ...]:
        self.account_ids.append(account_id)
        return self.workspace_ids

    def has_active_membership(self, account_id: str) -> bool:
        self.account_ids.append(account_id)
        if self.check_hook is not None:
            self.check_hook()
        return bool(self.workspace_ids)


@dataclass
class FakeInvitations:
    invitation: OAuthInvitation | None = None
    resolutions: list[str] = field(default_factory=list)

    def resolve(self, invite_token: str) -> OAuthInvitation | None:
        self.resolutions.append(invite_token)
        return self.invitation


@dataclass
class FakeRegistration:
    account_id: str = "new-account"
    registrations: list[OAuthAccountRegistration] = field(default_factory=list)
    registration_hook: Callable[[], None] | None = None

    def register(self, registration: OAuthAccountRegistration) -> str:
        self.registrations.append(registration)
        if self.registration_hook is not None:
            self.registration_hook()
        return self.account_id


@dataclass
class FakeRuntime:
    memberships: FakeMemberships
    integrations: FakeIntegrations
    created_accounts: list[str] = field(default_factory=list)
    default_workspace_accounts: list[str] = field(default_factory=list)
    workspace_operations: list[tuple[str, str]] = field(default_factory=list)
    logins: list[tuple[str, str]] = field(default_factory=list)
    default_workspace_id: str | None = None
    workspace_creation_error: Exception | None = None

    def create_owner_workspace(self, account_id: str) -> None:
        self._assert_identity_linked(account_id)
        if self.workspace_creation_error is not None:
            raise self.workspace_creation_error
        self.created_accounts.append(account_id)
        self.workspace_operations.append(("owner", account_id))
        self.memberships.workspace_ids = (*self.memberships.workspace_ids, f"owner-{account_id}")

    def try_join_default_workspace(self, account_id: str) -> None:
        self._assert_identity_linked(account_id)
        self.default_workspace_accounts.append(account_id)
        self.workspace_operations.append(("default", account_id))
        if self.default_workspace_id is not None:
            self.memberships.workspace_ids = (*self.memberships.workspace_ids, self.default_workspace_id)

    def login(self, account_id: str, *, ip_address: str) -> AccountSessionTokens:
        self.logins.append((account_id, ip_address))
        return AccountSessionTokens("access", "refresh", "csrf")

    def _assert_identity_linked(self, account_id: str) -> None:
        if not any(linked_account_id == account_id for linked_account_id, _, _ in self.integrations.links):
            raise AssertionError(f"workspace provisioning preceded identity link for {account_id}")


@dataclass
class FakePolicy:
    registration_allowed: bool = True
    creation_allowed: bool = True
    freeze_type: str | None = None
    freeze_lookups: list[str] = field(default_factory=list)

    def is_registration_allowed(self) -> bool:
        return self.registration_allowed

    def get_freeze_type(self, email: str) -> str | None:
        self.freeze_lookups.append(email)
        return self.freeze_type

    def is_creation_allowed(self) -> bool:
        return self.creation_allowed


@dataclass
class Harness:
    service: AccountOAuthService
    provider: FakeProvider
    providers: dict[str, FakeProvider]
    accounts: FakeAccounts
    integrations: FakeIntegrations
    account_claims: FakeAccountClaims
    memberships: FakeMemberships
    invitations: FakeInvitations
    registration: FakeRegistration
    runtime: FakeRuntime
    policy: FakePolicy


def _harness(
    *,
    identity: OAuthIdentity | None = None,
    additional_identities: dict[str, OAuthIdentity] | None = None,
) -> Harness:
    provider = FakeProvider(identity)
    providers = {"github": provider}
    providers.update(
        {name: FakeProvider(additional_identity) for name, additional_identity in (additional_identities or {}).items()}
    )
    accounts = FakeAccounts()
    integrations = FakeIntegrations(accounts=accounts)
    account_claims = FakeAccountClaims()
    memberships = FakeMemberships()
    invitations = FakeInvitations()
    registration = FakeRegistration()
    runtime = FakeRuntime(memberships=memberships, integrations=integrations)
    policy = FakePolicy()
    service = AccountOAuthService(
        providers=providers,
        accounts=accounts,
        integrations=integrations,
        memberships=memberships,
        invitations=invitations,
        account_claims=account_claims,
        registration=registration,
        workspaces=runtime,
        sessions=runtime,
        registration_policy=policy,
        workspace_policy=policy,
        supported_languages=("en-US", "zh-Hans"),
        now=lambda: NOW,
    )
    return Harness(
        service=service,
        provider=provider,
        providers=providers,
        accounts=accounts,
        integrations=integrations,
        account_claims=account_claims,
        memberships=memberships,
        invitations=invitations,
        registration=registration,
        runtime=runtime,
        policy=policy,
    )


def _bind_identity(
    harness: Harness,
    account: AccountSnapshot,
    *,
    provider: str = "github",
    open_id: str = "provider-user",
) -> None:
    harness.accounts.stored[account.id] = account
    harness.integrations.account_ids_by_identity[(provider, open_id)] = account.id


def _command(**overrides: object) -> OAuthCallbackCommand:
    values: dict[str, object] = {
        "provider": "github",
        "code": "code-1",
        "invite_token": None,
        "timezone": None,
        "language": None,
        "browser_language": "en-US",
        "ip_address": "203.0.113.10",
    }
    values.update(overrides)
    return OAuthCallbackCommand(**values)  # type: ignore[arg-type]


def test_start_authorization_delegates_to_configured_provider() -> None:
    harness = _harness()
    request = OAuthAuthorizationRequest(invite_token="invite", timezone="Asia/Shanghai")

    result = harness.service.start_authorization("github", request)

    assert result == "https://provider.example/authorize"
    assert harness.provider.authorization_requests == [request]


def test_unknown_provider_is_rejected_before_any_account_work() -> None:
    harness = _harness()

    with pytest.raises(InvalidOAuthProviderError):
        harness.service.complete_authorization(_command(provider="unknown"))

    assert harness.integrations.identity_lookups == []


def test_existing_account_login_uses_repositories_and_runtime_gateways() -> None:
    harness = _harness()
    _bind_identity(harness, _account())

    result = harness.service.complete_authorization(_command())

    assert isinstance(result, OAuthSignInResult)
    assert result.oauth_new_user is False
    assert harness.integrations.identity_lookups == [("github", "provider-user")]
    assert harness.accounts.get_calls[0] == "account-1"
    assert harness.accounts.email_lookups == []
    assert harness.integrations.links == [("account-1", "github", "provider-user")]
    assert harness.runtime.created_accounts == []
    assert harness.runtime.logins == [("account-1", "203.0.113.10")]
    assert harness.registration.registrations == []


def test_existing_account_without_workspace_obeys_creation_policy() -> None:
    harness = _harness()
    harness.accounts.email_account = _account()
    harness.memberships.workspace_ids = ()
    harness.policy.creation_allowed = False

    with pytest.raises(OAuthWorkspaceCreationNotAllowedError):
        harness.service.complete_authorization(_command())

    assert harness.integrations.links == [("account-1", "github", "provider-user")]
    assert harness.runtime.created_accounts == []


def test_existing_account_without_active_workspace_creates_owner_workspace() -> None:
    harness = _harness()
    harness.accounts.email_account = _account()
    harness.memberships.workspace_ids = ()

    harness.service.complete_authorization(_command())

    assert harness.runtime.created_accounts == ["account-1"]


def test_new_account_registration_normalizes_email_and_prefers_state_language() -> None:
    identity = OAuthIdentity(id="provider-user", name="", email="User@Example.com")
    harness = _harness(identity=identity)
    harness.accounts.stored["new-account"] = _account(account_id="new-account", email="user@example.com")
    harness.memberships.workspace_ids = ()
    harness.runtime.default_workspace_id = "enterprise-default"

    result = harness.service.complete_authorization(
        _command(language="zh-Hans", browser_language="en-US", timezone="Asia/Shanghai")
    )

    assert isinstance(result, OAuthSignInResult)
    assert result.oauth_new_user is True
    assert harness.registration.registrations == [
        OAuthAccountRegistration(
            email="user@example.com",
            name="Dify",
            language="zh-Hans",
            timezone="Asia/Shanghai",
            ip_address="203.0.113.10",
        )
    ]
    assert harness.memberships.account_ids == ["new-account"]
    assert harness.runtime.created_accounts == ["new-account"]
    assert harness.runtime.default_workspace_accounts == ["new-account"]
    assert harness.runtime.workspace_operations == [("owner", "new-account"), ("default", "new-account")]
    assert harness.memberships.workspace_ids == ("owner-new-account", "enterprise-default")
    assert harness.integrations.links == [("new-account", "github", "provider-user")]


def test_new_account_workspace_provisioning_obeys_the_same_policy_as_existing_accounts() -> None:
    harness = _harness()
    harness.accounts.stored["new-account"] = _account(account_id="new-account")
    harness.memberships.workspace_ids = ()
    harness.policy.creation_allowed = False

    with pytest.raises(OAuthWorkspaceCreationNotAllowedError):
        harness.service.complete_authorization(_command())

    assert len(harness.registration.registrations) == 1
    assert harness.runtime.created_accounts == []
    assert harness.runtime.default_workspace_accounts == ["new-account"]
    assert harness.integrations.links == [("new-account", "github", "provider-user")]


def test_new_account_uses_default_workspace_fallback_when_creation_is_disallowed() -> None:
    harness = _harness()
    harness.accounts.stored["new-account"] = _account(account_id="new-account")
    harness.memberships.workspace_ids = ()
    harness.runtime.default_workspace_id = "enterprise-default"
    harness.policy.creation_allowed = False

    result = harness.service.complete_authorization(_command())

    assert isinstance(result, OAuthSignInResult)
    assert result.oauth_new_user is True
    assert harness.runtime.default_workspace_accounts == ["new-account"]
    assert harness.memberships.account_ids == ["new-account", "new-account"]
    assert harness.memberships.workspace_ids == ("enterprise-default",)
    assert harness.runtime.created_accounts == []
    assert harness.runtime.workspace_operations == [("default", "new-account")]


def test_new_account_default_workspace_membership_bypasses_personal_workspace_quota() -> None:
    harness = _harness()
    harness.accounts.stored["new-account"] = _account(account_id="new-account")
    harness.memberships.workspace_ids = ()
    harness.runtime.default_workspace_id = "enterprise-default"
    harness.runtime.workspace_creation_error = OAuthWorkspaceCreationNotAllowedError()

    harness.service.complete_authorization(_command())

    assert harness.runtime.default_workspace_accounts == ["new-account"]
    assert harness.memberships.workspace_ids == ("enterprise-default",)
    assert harness.runtime.created_accounts == []
    assert harness.runtime.workspace_operations == [("default", "new-account")]


def test_concurrent_callbacks_claim_identity_before_creating_account_or_workspace() -> None:
    harness = _harness()
    harness.accounts.stored["new-account"] = _account(account_id="new-account")
    harness.memberships.workspace_ids = ()
    identity_resolved = Barrier(2)

    def synchronize_callbacks() -> None:
        identity_resolved.wait(timeout=5)

    harness.provider.identity_hook = synchronize_callbacks
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(harness.service.complete_authorization, _command()) for _ in range(2)]
        results = [future.result(timeout=5) for future in futures]

    assert len(harness.registration.registrations) == 1
    assert harness.account_claims.claims == [
        ("github", "provider-user", "user@example.com"),
        ("github", "provider-user", "user@example.com"),
    ]
    assert harness.integrations.links == [
        ("new-account", "github", "provider-user"),
        ("new-account", "github", "provider-user"),
    ]
    assert harness.runtime.default_workspace_accounts == ["new-account"]
    assert harness.runtime.created_accounts == ["new-account"]
    assert sorted(result.oauth_new_user for result in results if isinstance(result, OAuthSignInResult)) == [False, True]


def test_concurrent_provider_callbacks_claim_normalized_email_before_registration() -> None:
    harness = _harness(
        identity=OAuthIdentity("github-user", "User", "Shared@Example.com"),
        additional_identities={"google": OAuthIdentity("google-user", "User", "shared@example.COM")},
    )
    harness.accounts.stored["new-account"] = _account(account_id="new-account", email="shared@example.com")
    harness.memberships.workspace_ids = ()
    identity_resolved = Barrier(2)

    def synchronize_callbacks() -> None:
        identity_resolved.wait(timeout=5)

    harness.providers["github"].identity_hook = synchronize_callbacks
    harness.providers["google"].identity_hook = synchronize_callbacks
    commands = [
        _command(provider="github"),
        _command(provider="google"),
    ]
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(harness.service.complete_authorization, command) for command in commands]
        results = [future.result(timeout=5) for future in futures]

    assert len(harness.registration.registrations) == 1
    assert sorted(harness.account_claims.claims) == [
        ("github", "github-user", "shared@example.com"),
        ("google", "google-user", "shared@example.com"),
    ]
    assert sorted(harness.integrations.links) == [
        ("new-account", "github", "github-user"),
        ("new-account", "google", "google-user"),
    ]
    assert harness.runtime.default_workspace_accounts == ["new-account"]
    assert harness.runtime.created_accounts == ["new-account"]
    assert sorted(result.oauth_new_user for result in results if isinstance(result, OAuthSignInResult)) == [False, True]


def test_concurrent_provider_callbacks_for_one_account_serialize_workspace_provisioning() -> None:
    harness = _harness(
        identity=OAuthIdentity("github-user", "User", "github@example.com"),
        additional_identities={"google": OAuthIdentity("google-user", "User", "google@example.com")},
    )
    account = _account(email="primary@example.com")
    _bind_identity(harness, account, provider="github", open_id="github-user")
    _bind_identity(harness, account, provider="google", open_id="google-user")
    harness.memberships.workspace_ids = ()
    identity_resolved = Barrier(2)

    def synchronize_callbacks() -> None:
        identity_resolved.wait(timeout=5)

    harness.providers["github"].identity_hook = synchronize_callbacks
    harness.providers["google"].identity_hook = synchronize_callbacks
    commands = [
        _command(provider="github"),
        _command(provider="google"),
    ]
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(harness.service.complete_authorization, command) for command in commands]
        results = [future.result(timeout=5) for future in futures]

    assert harness.registration.registrations == []
    assert sorted(harness.account_claims.claims) == [
        ("github", "github-user", "github@example.com"),
        ("google", "google-user", "google@example.com"),
    ]
    assert harness.account_claims.account_ids == ["account-1", "account-1"]
    assert harness.runtime.created_accounts == ["account-1"]
    assert all(isinstance(result, OAuthSignInResult) and not result.oauth_new_user for result in results)


def test_lost_identity_claim_stops_before_registration() -> None:
    harness = _harness()
    harness.account_claims.lose_identity_on_acquire = True

    with pytest.raises(OAuthIdentityLockUnavailableError):
        harness.service.complete_authorization(_command())

    assert harness.registration.registrations == []
    assert harness.integrations.links == []
    assert harness.runtime.created_accounts == []


def test_identity_claim_lost_during_registration_stops_follow_up_writes() -> None:
    harness = _harness()
    harness.accounts.stored["new-account"] = _account(account_id="new-account")

    def lose_identity_claim() -> None:
        harness.account_claims.identity_leases[0].lost = True

    harness.registration.registration_hook = lose_identity_claim

    with pytest.raises(OAuthIdentityLockUnavailableError):
        harness.service.complete_authorization(_command())

    assert len(harness.registration.registrations) == 1
    assert harness.integrations.links == []
    assert harness.runtime.default_workspace_accounts == []
    assert harness.runtime.created_accounts == []


def test_lost_account_claim_stops_before_workspace_creation() -> None:
    harness = _harness()
    _bind_identity(harness, _account())
    harness.memberships.workspace_ids = ()

    def lose_account_claim() -> None:
        harness.account_claims.account_leases[0].lost = True

    harness.memberships.check_hook = lose_account_claim

    with pytest.raises(OAuthIdentityLockUnavailableError):
        harness.service.complete_authorization(_command())

    assert harness.runtime.created_accounts == []
    assert harness.runtime.logins == []


@pytest.mark.parametrize(
    ("freeze_type", "expected_error"),
    [
        ("email_domain_suspended", AccountEmailDomainSuspendedError),
        ("freeze", AccountEmailFrozenError),
        (None, OAuthRegistrationError),
    ],
)
def test_disabled_registration_applies_account_policy(
    freeze_type: str | None,
    expected_error: type[Exception],
) -> None:
    harness = _harness()
    harness.policy.registration_allowed = False
    harness.policy.freeze_type = freeze_type

    with pytest.raises(expected_error):
        harness.service.complete_authorization(_command())

    assert harness.policy.freeze_lookups == ["user@example.com"]
    assert harness.registration.registrations == []


def test_pending_account_is_activated_through_repository() -> None:
    harness = _harness()
    _bind_identity(harness, _account(status="pending"))

    harness.service.complete_authorization(_command())

    assert harness.accounts.activations == [("account-1", NOW)]


def test_pending_account_is_not_activated_when_workspace_creation_is_disallowed() -> None:
    harness = _harness()
    _bind_identity(harness, _account(status="pending"))
    harness.memberships.workspace_ids = ()
    harness.policy.creation_allowed = False

    with pytest.raises(OAuthWorkspaceCreationNotAllowedError):
        harness.service.complete_authorization(_command())

    assert harness.accounts.activations == []
    assert harness.runtime.logins == []


def test_pending_account_is_not_activated_when_workspace_creation_fails() -> None:
    harness = _harness()
    _bind_identity(harness, _account(status="pending"))
    harness.memberships.workspace_ids = ()
    harness.runtime.workspace_creation_error = RuntimeError("workspace quota exceeded")

    with pytest.raises(RuntimeError, match="workspace quota exceeded"):
        harness.service.complete_authorization(_command())

    assert harness.accounts.activations == []
    assert harness.runtime.logins == []


def test_valid_invitation_links_and_logs_in_invited_account() -> None:
    harness = _harness(identity=OAuthIdentity("provider-user", "User", "Invitee@Example.com"))
    harness.invitations.invitation = OAuthInvitation("invited-account", "invitee@example.com", "active")

    result = harness.service.complete_authorization(_command(invite_token="invite-token"))

    assert isinstance(result, OAuthInvitationResult)
    assert result.invite_token == "invite-token"
    assert harness.integrations.links == [("invited-account", "github", "provider-user")]
    assert harness.runtime.logins == [("invited-account", "203.0.113.10")]
    assert harness.integrations.identity_lookups == []
    assert harness.invitations.resolutions == ["invite-token"]


def test_resolvable_invitation_requires_matching_email() -> None:
    harness = _harness()
    harness.invitations.invitation = OAuthInvitation("invited-account", "other@example.com", "active")

    with pytest.raises(OAuthInvitationAccountMismatchError) as raised:
        harness.service.complete_authorization(_command(invite_token="invite-token"))

    assert raised.value.invite_token == "invite-token"
    assert harness.integrations.links == []


def test_stale_invitation_is_rejected() -> None:
    harness = _harness()

    with pytest.raises(InvalidOAuthInvitationError):
        harness.service.complete_authorization(_command(invite_token="invite-token"))

    assert harness.invitations.resolutions == ["invite-token"]
    assert harness.integrations.identity_lookups == []
    assert harness.registration.registrations == []


def test_banned_account_is_rejected_before_writes() -> None:
    harness = _harness()
    _bind_identity(harness, _account(status="banned"))

    with pytest.raises(OAuthAccountBannedError):
        harness.service.complete_authorization(_command())

    assert harness.integrations.links == []
