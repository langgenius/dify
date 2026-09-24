from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import pytest

from services import account_errors
from services.account_login_service import ConsoleAuthenticationService
from services.entities.account_entities import AccountPasswordDigest
from services.entities.account_login_entities import (
    AccountSessionPreparation,
    AuthTokenPair,
    EmailCodeChallengeStatus,
    EmailCodeLoginCommand,
    EmailCodeSendCommand,
    LoginAccountSnapshot,
    LoginInvitation,
    PasswordLoginCommand,
    PasswordLoginCompletion,
    RefreshAccountStatus,
)
from services.entities.auth_audit_entities import LoginFailureReason

TOKEN_PAIR = AuthTokenPair(access_token="access", refresh_token="refresh", csrf_token="csrf")
LOGIN_TIME = datetime(2026, 8, 24, 12, 0, 0)


@dataclass
class FakeAccounts:
    candidates: list[LoginAccountSnapshot] = field(default_factory=list)
    lookup_email: str | None = None
    session_prepared: bool = True
    completions: list[PasswordLoginCompletion] = field(default_factory=list)
    session_preparations: list[tuple[str, AccountSessionPreparation]] = field(default_factory=list)

    def list_for_login(self, email: str) -> tuple[LoginAccountSnapshot, ...]:
        self.lookup_email = email
        return tuple(self.candidates)

    def complete_password_login(self, completion: PasswordLoginCompletion) -> bool:
        self.completions.append(completion)
        return any(completion.account_id == account.id for account in self.candidates)

    def prepare_session(self, account_id: str, preparation: AccountSessionPreparation) -> bool:
        self.session_preparations.append((account_id, preparation))
        return self.session_prepared


@dataclass
class FakeWorkspaces:
    active: bool = False

    def has_active_for_account(self, account_id: str) -> bool:
        _ = account_id
        return self.active


@dataclass
class FakeInvitations:
    invitation: LoginInvitation | None = None

    def resolve(self, *, email: str, token: str) -> LoginInvitation | None:
        _ = email, token
        return self.invitation


@dataclass
class FakePolicies:
    freeze_type: str | None = None
    registration_allowed: bool = True
    workspace_creation_allowed: bool = True
    workspace_capacity: bool = True
    account_capacity: bool = True

    def get_email_freeze_type(self, email: str) -> str | None:
        _ = email
        return self.freeze_type

    def is_registration_allowed(self) -> bool:
        return self.registration_allowed

    def is_workspace_creation_allowed(self) -> bool:
        return self.workspace_creation_allowed

    def has_workspace_capacity(self) -> bool:
        return self.workspace_capacity

    def has_account_capacity(self) -> bool:
        return self.account_capacity


@dataclass
class FakeSecurity:
    login_limited: bool = False
    ip_limited: bool = False
    failures: list[str] = field(default_factory=list)
    resets: list[str] = field(default_factory=list)

    def is_login_limited(self, email: str) -> bool:
        _ = email
        return self.login_limited

    def record_login_failure(self, email: str) -> None:
        self.failures.append(email)

    def reset_login_failures(self, email: str) -> None:
        self.resets.append(email)

    def is_email_send_ip_limited(self, ip_address: str) -> bool:
        _ = ip_address
        return self.ip_limited


@dataclass
class FakePasswords:
    valid: bool = True
    valid_password_hashes: set[str] | None = None
    hash_error: account_errors.InvalidAccountPasswordError | None = None
    hashed_passwords: list[str] = field(default_factory=list)

    def verify(self, password: str, *, password_hash: str, password_salt: str) -> bool:
        _ = password, password_hash, password_salt
        if self.valid_password_hashes is not None:
            return password_hash in self.valid_password_hashes
        return self.valid

    def hash(self, password: str) -> AccountPasswordDigest:
        self.hashed_passwords.append(password)
        if self.hash_error is not None:
            raise self.hash_error
        return AccountPasswordDigest(password_hash=f"hashed:{password}", password_salt="salt")


@dataclass
class FakeHumanVerification:
    calls: list[tuple[str | None, str, str]] = field(default_factory=list)

    def verify(self, *, token: str | None, remote_ip: str, action: str) -> None:
        self.calls.append((token, remote_ip, action))


@dataclass
class FakeSessions:
    issued: list[str] = field(default_factory=list)
    revoked: list[str] = field(default_factory=list)
    refresh_account_id: str | None = "account-1"
    rotations: list[tuple[str, str]] = field(default_factory=list)

    def issue(self, account_id: str) -> AuthTokenPair:
        self.issued.append(account_id)
        return TOKEN_PAIR

    def revoke(self, account_id: str) -> None:
        self.revoked.append(account_id)

    def resolve_refresh_token(self, refresh_token: str) -> str | None:
        assert refresh_token == "old-refresh"
        return self.refresh_account_id

    def rotate(self, *, refresh_token: str, account_id: str) -> AuthTokenPair:
        self.rotations.append((refresh_token, account_id))
        return TOKEN_PAIR


@dataclass
class FakeRefreshPreparation:
    status: RefreshAccountStatus = RefreshAccountStatus.READY
    account_ids: list[str] = field(default_factory=list)

    def prepare(self, account_id: str) -> RefreshAccountStatus:
        self.account_ids.append(account_id)
        return self.status


@dataclass
class FakeAccountProvisioning:
    calls: list[dict[str, str]] = field(default_factory=list)

    def create_with_owner_workspace(
        self,
        *,
        email: str,
        name: str,
        interface_language: str,
        timezone: str,
        ip_address: str,
    ) -> str:
        self.calls.append(
            {
                "email": email,
                "name": name,
                "interface_language": interface_language,
                "timezone": timezone,
                "ip_address": ip_address,
            }
        )
        return "new-account"


@dataclass
class FakeWorkspaceProvisioning:
    account_ids: list[str] = field(default_factory=list)

    def create_owner_workspace(self, account_id: str) -> None:
        self.account_ids.append(account_id)


@dataclass
class FakeEmailCodes:
    status: EmailCodeChallengeStatus = EmailCodeChallengeStatus.VERIFIED
    sent: list[tuple[str | None, str, str, str]] = field(default_factory=list)

    def send(
        self,
        *,
        account_id: str | None,
        normalized_email: str,
        recipient_email: str,
        language: str,
    ) -> str:
        self.sent.append((account_id, normalized_email, recipient_email, language))
        return "email-token"

    def verify(self, *, normalized_email: str, code: str, token: str) -> EmailCodeChallengeStatus:
        _ = normalized_email, code, token
        return self.status


@dataclass
class FakeResetPasswordEmails:
    sent: list[tuple[str | None, str, str, bool]] = field(default_factory=list)

    def send(
        self,
        *,
        account_id: str | None,
        email: str,
        language: str,
        registration_allowed: bool,
    ) -> str:
        self.sent.append((account_id, email, language, registration_allowed))
        return "reset-token"


@dataclass
class FakeAudit:
    failures: list[tuple[str, LoginFailureReason, str]] = field(default_factory=list)

    def login_failed(self, *, email: str, reason: LoginFailureReason, ip_address: str) -> None:
        self.failures.append((email, reason, ip_address))


@dataclass
class Dependencies:
    accounts: FakeAccounts = field(default_factory=FakeAccounts)
    workspaces: FakeWorkspaces = field(default_factory=FakeWorkspaces)
    invitations: FakeInvitations = field(default_factory=FakeInvitations)
    policies: FakePolicies = field(default_factory=FakePolicies)
    security: FakeSecurity = field(default_factory=FakeSecurity)
    passwords: FakePasswords = field(default_factory=FakePasswords)
    human: FakeHumanVerification = field(default_factory=FakeHumanVerification)
    sessions: FakeSessions = field(default_factory=FakeSessions)
    refresh_preparation: FakeRefreshPreparation = field(default_factory=FakeRefreshPreparation)
    accounts_provisioning: FakeAccountProvisioning = field(default_factory=FakeAccountProvisioning)
    workspaces_provisioning: FakeWorkspaceProvisioning = field(default_factory=FakeWorkspaceProvisioning)
    email_codes: FakeEmailCodes = field(default_factory=FakeEmailCodes)
    reset_emails: FakeResetPasswordEmails = field(default_factory=FakeResetPasswordEmails)
    audit: FakeAudit = field(default_factory=FakeAudit)

    def service(
        self,
        *,
        turnstile_enabled: bool = False,
        turnstile_verify_required: bool = False,
    ) -> ConsoleAuthenticationService:
        return ConsoleAuthenticationService(
            accounts=self.accounts,
            workspaces=self.workspaces,
            invitations=self.invitations,
            policies=self.policies,
            security=self.security,
            passwords=self.passwords,
            human_verification=self.human,
            sessions=self.sessions,
            refresh_preparation=self.refresh_preparation,
            account_provisioning=self.accounts_provisioning,
            workspace_provisioning=self.workspaces_provisioning,
            email_codes=self.email_codes,
            reset_password_emails=self.reset_emails,
            audit=self.audit,
            now=lambda: LOGIN_TIME,
            turnstile_enabled=turnstile_enabled,
            turnstile_verify_required=turnstile_verify_required,
        )


def _account(
    *,
    account_id: str = "account-1",
    password: bool = True,
    password_hash: str = "hash",
    status: str = "active",
    email: str = "user@example.com",
) -> LoginAccountSnapshot:
    return LoginAccountSnapshot(
        id=account_id,
        email=email,
        status=status,
        password_hash=password_hash if password else None,
        password_salt="salt" if password else None,
    )


def _password_command(**changes: str | None) -> PasswordLoginCommand:
    values = {
        "email": "User@Example.com",
        "password": "password",
        "invite_token": None,
        "ip_address": "127.0.0.1",
    }
    values.update(changes)
    return PasswordLoginCommand(**values)  # type: ignore[arg-type]


def _email_code_command(**changes: str | None) -> EmailCodeLoginCommand:
    values = {
        "email": "User@Example.com",
        "code": "123456",
        "token": "challenge-token",
        "turnstile_token": None,
        "language": "zh-Hans",
        "timezone": "Asia/Singapore",
        "ip_address": "127.0.0.1",
    }
    values.update(changes)
    return EmailCodeLoginCommand(**values)  # type: ignore[arg-type]


def test_password_login_issues_session_and_resets_failures() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account()]
    dependencies.workspaces.active = True

    result = dependencies.service().login_with_password(_password_command())

    assert result.token_pair == TOKEN_PAIR
    assert dependencies.accounts.lookup_email == "User@Example.com"
    assert dependencies.accounts.completions == [
        PasswordLoginCompletion(
            account_id="account-1",
            password=None,
            activate_pending_account=False,
            initialized_at=None,
        )
    ]
    assert dependencies.accounts.session_preparations == [
        (
            "account-1",
            AccountSessionPreparation(
                logged_in_at=LOGIN_TIME,
                ip_address="127.0.0.1",
                activate_pending_account=False,
            ),
        )
    ]
    assert dependencies.sessions.issued == ["account-1"]
    assert dependencies.security.resets == ["user@example.com"]


def test_password_login_rejects_account_removed_during_session_preparation() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account()]
    dependencies.accounts.session_prepared = False
    dependencies.workspaces.active = True

    with pytest.raises(account_errors.AccountNotFoundError):
        dependencies.service().login_with_password(_password_command())

    assert dependencies.sessions.issued == []
    assert dependencies.security.resets == []


def test_invitation_login_sets_missing_password() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account(password=False, status="pending")]
    dependencies.invitations.invitation = LoginInvitation(email="USER@example.com")
    dependencies.workspaces.active = True

    dependencies.service().login_with_password(_password_command(password="password123", invite_token="invite"))

    assert dependencies.accounts.completions == [
        PasswordLoginCompletion(
            account_id="account-1",
            password=AccountPasswordDigest(password_hash="hashed:password123", password_salt="salt"),
            activate_pending_account=True,
            initialized_at=LOGIN_TIME,
        )
    ]


def test_invitation_login_rejects_empty_password_without_completing_account() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account(password=False, status="pending")]
    dependencies.invitations.invitation = LoginInvitation(email="USER@example.com")

    with pytest.raises(account_errors.InvalidLoginCredentialsError):
        dependencies.service().login_with_password(_password_command(password="", invite_token="invite"))

    assert dependencies.passwords.hashed_passwords == []
    assert dependencies.accounts.completions == []
    assert dependencies.security.failures == ["user@example.com"]


def test_invitation_login_does_not_initialize_password_when_token_is_unknown() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account(password=False, status="pending")]

    with pytest.raises(account_errors.InvalidLoginCredentialsError):
        dependencies.service().login_with_password(_password_command(invite_token="unknown-invite"))

    assert dependencies.passwords.hashed_passwords == []
    assert dependencies.accounts.completions == []


def test_invitation_login_applies_new_password_policy_before_completion() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account(password=False, status="pending")]
    dependencies.invitations.invitation = LoginInvitation(email="USER@example.com")
    dependencies.passwords.hash_error = account_errors.InvalidAccountPasswordError(
        "Password must contain letters and numbers"
    )

    with pytest.raises(account_errors.InvalidAccountPasswordError, match="letters and numbers"):
        dependencies.service().login_with_password(_password_command(password="letters-only", invite_token="invite"))

    assert dependencies.passwords.hashed_passwords == ["letters-only"]
    assert dependencies.accounts.completions == []


def test_invalid_password_records_rate_limit_and_audit() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account()]
    dependencies.passwords.valid = False

    with pytest.raises(account_errors.InvalidLoginCredentialsError):
        dependencies.service().login_with_password(_password_command())

    assert dependencies.security.failures == ["user@example.com"]
    assert dependencies.audit.failures == [("user@example.com", LoginFailureReason.INVALID_CREDENTIALS, "127.0.0.1")]


def test_password_login_rejects_locked_account_before_loading_candidates() -> None:
    dependencies = Dependencies()
    dependencies.security.login_limited = True

    with pytest.raises(account_errors.LoginRateLimitError):
        dependencies.service().login_with_password(_password_command())

    assert dependencies.accounts.lookup_email is None
    assert dependencies.audit.failures == [("user@example.com", LoginFailureReason.LOGIN_RATE_LIMITED, "127.0.0.1")]


@pytest.mark.parametrize(
    ("freeze_type", "error_type"),
    [
        ("freeze", account_errors.AccountEmailFrozenError),
        ("email_domain_suspended", account_errors.AccountEmailDomainSuspendedError),
    ],
)
def test_password_login_enforces_email_freeze_policy(
    freeze_type: str,
    error_type: type[account_errors.AccountApplicationError],
) -> None:
    dependencies = Dependencies()
    dependencies.policies.freeze_type = freeze_type

    with pytest.raises(error_type):
        dependencies.service().login_with_password(_password_command())

    assert dependencies.accounts.lookup_email is None
    assert dependencies.audit.failures == [("user@example.com", LoginFailureReason.ACCOUNT_IN_FREEZE, "127.0.0.1")]


def test_password_login_rejects_banned_account() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account(status="banned")]

    with pytest.raises(account_errors.LoginAccountBannedError):
        dependencies.service().login_with_password(_password_command())

    assert dependencies.accounts.completions == []
    assert dependencies.audit.failures == [("user@example.com", LoginFailureReason.ACCOUNT_BANNED, "127.0.0.1")]


def test_password_login_rejects_invitation_for_another_email() -> None:
    dependencies = Dependencies()
    dependencies.invitations.invitation = LoginInvitation(email="invited@example.com")

    with pytest.raises(account_errors.InvalidLoginInvitationEmailError):
        dependencies.service().login_with_password(_password_command(invite_token="invite"))

    assert dependencies.accounts.lookup_email is None
    assert dependencies.audit.failures == [
        ("user@example.com", LoginFailureReason.INVALID_INVITATION_EMAIL, "127.0.0.1")
    ]


def test_password_login_tries_lowercase_candidate_after_exact_candidate_password_fails() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [
        _account(account_id="mixed-case", email="User@example.com", password_hash="mixed-hash"),
        _account(account_id="lowercase", email="user@example.com", password_hash="lower-hash"),
    ]
    dependencies.passwords.valid_password_hashes = {"lower-hash"}
    dependencies.workspaces.active = True

    result = dependencies.service().login_with_password(_password_command(email="User@example.com"))

    assert result.token_pair == TOKEN_PAIR
    assert [completion.account_id for completion in dependencies.accounts.completions] == ["lowercase"]
    assert dependencies.sessions.issued == ["lowercase"]
    assert dependencies.security.failures == []


def test_password_login_returns_no_workspace_without_creating_one() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account()]

    result = dependencies.service().login_with_password(_password_command())

    assert not result.workspace_found
    assert result.token_pair is None
    assert dependencies.workspaces_provisioning.account_ids == []


def test_password_login_enforces_workspace_capacity() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account()]
    dependencies.policies.workspace_capacity = False

    with pytest.raises(account_errors.LoginWorkspaceLimitError):
        dependencies.service().login_with_password(_password_command())


def test_send_email_code_normalizes_identity_and_preserves_account_recipient_address() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account(email="User@Example.COM")]

    token = dependencies.service(turnstile_enabled=True).send_email_code(
        EmailCodeSendCommand(
            email="User@Example.com",
            language="zh-Hans",
            turnstile_token="turnstile",
            ip_address="127.0.0.1",
        )
    )

    assert token == "email-token"
    assert dependencies.human.calls == [("turnstile", "127.0.0.1", "signin_code")]
    assert dependencies.email_codes.sent == [("account-1", "user@example.com", "User@Example.COM", "zh-Hans")]


def test_send_email_code_rejects_unknown_account_when_registration_is_disabled() -> None:
    dependencies = Dependencies()
    dependencies.policies.registration_allowed = False

    with pytest.raises(account_errors.AccountNotFoundError):
        dependencies.service().send_email_code(
            EmailCodeSendCommand(
                email="user@example.com",
                language=None,
                turnstile_token=None,
                ip_address="127.0.0.1",
            )
        )


def test_send_email_code_rejects_ip_rate_limit_before_human_verification() -> None:
    dependencies = Dependencies()
    dependencies.security.ip_limited = True

    with pytest.raises(account_errors.EmailCodeSendIPLimitedError):
        dependencies.service(turnstile_enabled=True).send_email_code(
            EmailCodeSendCommand(
                email="user@example.com",
                language=None,
                turnstile_token="turnstile",
                ip_address="127.0.0.1",
            )
        )

    assert dependencies.human.calls == []
    assert dependencies.email_codes.sent == []


def test_send_email_code_skips_turnstile_when_disabled() -> None:
    dependencies = Dependencies()

    dependencies.service(turnstile_enabled=False).send_email_code(
        EmailCodeSendCommand(
            email="user@example.com",
            language=None,
            turnstile_token="ignored-token",
            ip_address="127.0.0.1",
        )
    )

    assert dependencies.human.calls == []


@pytest.mark.parametrize("code", ["12345", "1234567", "abcdef", "١٢٣٤٥٦"])
def test_email_code_login_rejects_malformed_codes(code: str) -> None:
    dependencies = Dependencies()

    with pytest.raises(account_errors.InvalidEmailCodeError):
        dependencies.service().login_with_email_code(_email_code_command(code=code))

    assert dependencies.audit.failures[0][1] == LoginFailureReason.INVALID_EMAIL_CODE


@pytest.mark.parametrize(
    ("status", "error_type", "reason"),
    [
        (
            EmailCodeChallengeStatus.INVALID_TOKEN,
            account_errors.InvalidEmailCodeTokenError,
            LoginFailureReason.INVALID_EMAIL_CODE_TOKEN,
        ),
        (
            EmailCodeChallengeStatus.EMAIL_MISMATCH,
            account_errors.EmailCodeEmailMismatchError,
            LoginFailureReason.EMAIL_CODE_EMAIL_MISMATCH,
        ),
        (
            EmailCodeChallengeStatus.INVALID_CODE,
            account_errors.InvalidEmailCodeError,
            LoginFailureReason.INVALID_EMAIL_CODE,
        ),
        (
            EmailCodeChallengeStatus.EXHAUSTED,
            account_errors.InvalidEmailCodeError,
            LoginFailureReason.INVALID_EMAIL_CODE,
        ),
    ],
)
def test_email_code_login_maps_challenge_status(
    status: EmailCodeChallengeStatus,
    error_type: type[account_errors.AccountApplicationError],
    reason: LoginFailureReason,
) -> None:
    dependencies = Dependencies()
    dependencies.email_codes.status = status

    with pytest.raises(error_type):
        dependencies.service().login_with_email_code(_email_code_command())

    assert dependencies.audit.failures == [("user@example.com", reason, "127.0.0.1")]


@pytest.mark.parametrize(
    ("turnstile_enabled", "verify_required", "turnstile_token", "expected_calls"),
    [
        (False, True, "provided-token", []),
        (True, False, None, []),
        (True, False, "provided-token", [("provided-token", "127.0.0.1", "signin_code_verify")]),
        (True, True, None, [(None, "127.0.0.1", "signin_code_verify")]),
    ],
)
def test_email_code_login_applies_turnstile_switches(
    turnstile_enabled: bool,
    verify_required: bool,
    turnstile_token: str | None,
    expected_calls: list[tuple[str | None, str, str]],
) -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account()]
    dependencies.workspaces.active = True

    dependencies.service(
        turnstile_enabled=turnstile_enabled,
        turnstile_verify_required=verify_required,
    ).login_with_email_code(_email_code_command(turnstile_token=turnstile_token))

    assert dependencies.human.calls == expected_calls


def test_email_code_login_rejects_banned_account() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account(status="banned")]

    with pytest.raises(account_errors.LoginAccountBannedError):
        dependencies.service().login_with_email_code(_email_code_command())

    assert dependencies.audit.failures == [("user@example.com", LoginFailureReason.ACCOUNT_BANNED, "127.0.0.1")]


@pytest.mark.parametrize(
    ("workspace_capacity", "workspace_creation_allowed", "error_type"),
    [
        (False, True, account_errors.LoginWorkspaceLimitError),
        (True, False, account_errors.LoginWorkspaceCreationNotAllowedError),
    ],
)
def test_email_code_login_enforces_workspace_policy(
    workspace_capacity: bool,
    workspace_creation_allowed: bool,
    error_type: type[account_errors.AccountApplicationError],
) -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account()]
    dependencies.policies.workspace_capacity = workspace_capacity
    dependencies.policies.workspace_creation_allowed = workspace_creation_allowed

    with pytest.raises(error_type):
        dependencies.service().login_with_email_code(_email_code_command())

    assert dependencies.workspaces_provisioning.account_ids == []
    assert dependencies.sessions.issued == []


def test_email_code_login_rejects_registration_when_account_is_missing() -> None:
    dependencies = Dependencies()
    dependencies.policies.registration_allowed = False

    with pytest.raises(account_errors.AccountNotFoundError):
        dependencies.service().login_with_email_code(_email_code_command())

    assert dependencies.accounts_provisioning.calls == []
    assert dependencies.sessions.issued == []


@pytest.mark.parametrize(
    ("account_capacity", "workspace_creation_allowed", "workspace_capacity", "error_type"),
    [
        (False, True, True, account_errors.LoginSeatLimitError),
        (True, False, True, account_errors.LoginWorkspaceCreationNotAllowedError),
        (True, True, False, account_errors.LoginWorkspaceLimitError),
    ],
)
def test_email_code_login_enforces_new_account_provisioning_policy(
    account_capacity: bool,
    workspace_creation_allowed: bool,
    workspace_capacity: bool,
    error_type: type[account_errors.AccountApplicationError],
) -> None:
    dependencies = Dependencies()
    dependencies.policies.account_capacity = account_capacity
    dependencies.policies.workspace_creation_allowed = workspace_creation_allowed
    dependencies.policies.workspace_capacity = workspace_capacity

    with pytest.raises(error_type):
        dependencies.service().login_with_email_code(_email_code_command())

    assert dependencies.accounts_provisioning.calls == []
    assert dependencies.sessions.issued == []


def test_email_code_login_creates_workspace_for_existing_account() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account()]

    result = dependencies.service().login_with_email_code(_email_code_command())

    assert result == TOKEN_PAIR
    assert dependencies.workspaces_provisioning.account_ids == ["account-1"]


def test_email_code_login_provisions_new_account() -> None:
    dependencies = Dependencies()

    result = dependencies.service().login_with_email_code(_email_code_command())

    assert result == TOKEN_PAIR
    assert dependencies.accounts_provisioning.calls == [
        {
            "email": "user@example.com",
            "name": "user@example.com",
            "interface_language": "zh-Hans",
            "timezone": "Asia/Singapore",
            "ip_address": "127.0.0.1",
        }
    ]
    assert dependencies.sessions.issued == ["new-account"]


def test_reset_password_email_uses_shared_account_snapshot() -> None:
    dependencies = Dependencies()
    dependencies.accounts.candidates = [_account()]

    token = dependencies.service().send_reset_password_email(
        email="User@Example.com",
        language="fr-FR",
        ip_address="127.0.0.1",
    )

    assert token == "reset-token"
    assert dependencies.reset_emails.sent == [("account-1", "user@example.com", "en-US", True)]


def test_logout_and_refresh_delegate_to_session_gateway() -> None:
    dependencies = Dependencies()
    service = dependencies.service()

    service.logout("account-1")

    assert dependencies.sessions.revoked == ["account-1"]
    assert service.refresh("old-refresh") == TOKEN_PAIR
    assert dependencies.refresh_preparation.account_ids == ["account-1"]
    assert dependencies.sessions.rotations == [("old-refresh", "account-1")]


@pytest.mark.parametrize(
    ("refresh_account_id", "refresh_status", "message"),
    [
        (None, RefreshAccountStatus.READY, "Invalid refresh token"),
        ("account-1", RefreshAccountStatus.NOT_FOUND, "Invalid account"),
        ("account-1", RefreshAccountStatus.BANNED, "Account is banned"),
    ],
)
def test_refresh_rejects_invalid_account_state(
    refresh_account_id: str | None,
    refresh_status: RefreshAccountStatus,
    message: str,
) -> None:
    dependencies = Dependencies()
    dependencies.sessions.refresh_account_id = refresh_account_id
    dependencies.refresh_preparation.status = refresh_status

    with pytest.raises(account_errors.InvalidRefreshTokenError, match=message):
        dependencies.service().refresh("old-refresh")

    assert dependencies.sessions.rotations == []
