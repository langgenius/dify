"""Unit tests for the framework-neutral Web authentication application service."""

from dataclasses import dataclass, field
from datetime import datetime

import pytest

from machinery.context import RequestContext
from services.entities.account_entities import AccountAuthenticationSnapshot, AccountPasswordDigest, AccountSnapshot
from services.entities.authentication_entities import LoginFailureReason, StoredAuthenticationToken
from services.web_authentication_service import (
    WebAccountBannedError,
    WebAuthenticationFailedError,
    WebAuthenticationService,
    WebEmailSendIPLimitedError,
    WebInvalidCodeError,
    WebInvalidTokenError,
    WebPasswordMismatchError,
)


@dataclass
class AccountRepositoryFake:
    accounts: dict[str, AccountAuthenticationSnapshot]
    updated: tuple[str, AccountPasswordDigest] | None = None

    def find_for_authentication(self, email: str) -> AccountAuthenticationSnapshot | None:
        return self.accounts.get(email) or self.accounts.get(email.lower())

    def update_password(self, account_id: str, password: AccountPasswordDigest) -> AccountSnapshot | None:
        self.updated = (account_id, password)
        account = next((account for account in self.accounts.values() if account.id == account_id), None)
        if account is None:
            return None
        return AccountSnapshot(
            id=account.id,
            name="Account",
            email=account.email,
            avatar=None,
            is_password_set=True,
            interface_language="en-US",
            interface_theme="light",
            timezone="UTC",
            last_login_at=None,
            last_login_ip=None,
            status=account.status,
            initialized_at=None,
            created_at=datetime(2026, 1, 1),
        )


class PasswordHasherFake:
    def verify(self, password: str, *, password_hash: str, password_salt: str) -> bool:
        return (password, password_hash, password_salt) == ("Valid1234", "hash", "salt")

    def hash(self, password: str) -> AccountPasswordDigest:
        return AccountPasswordDigest(password_hash=f"hashed:{password}", password_salt="new-salt")


@dataclass
class TokenGatewayFake:
    email_login_token: StoredAuthenticationToken | None = None
    reset_token: StoredAuthenticationToken | None = None
    revoked: list[tuple[str, str]] = field(default_factory=list)

    def issue_access_token(self, *, account_id: str, email: str) -> str:
        return f"access:{account_id}:{email}"

    def verify_access_token(self, token: str | None) -> bool:
        return token == "valid-access"

    def send_email_login_code(self, *, account_id: str, email: str, language: str) -> str:
        return f"email:{account_id}:{email}:{language}"

    def get_email_login_token(self, token: str) -> StoredAuthenticationToken | None:
        del token
        return self.email_login_token

    def revoke_email_login_token(self, token: str) -> None:
        self.revoked.append(("email", token))

    def send_reset_password_code(self, *, account_id: str, email: str, language: str) -> str:
        return f"reset:{account_id}:{email}:{language}"

    def get_reset_password_token(self, token: str) -> StoredAuthenticationToken | None:
        del token
        return self.reset_token

    def replace_reset_password_token(self, *, email: str, code: str) -> str:
        return f"replacement:{email}:{code}"

    def revoke_reset_password_token(self, token: str) -> None:
        self.revoked.append(("reset", token))


@dataclass
class SecurityGatewayFake:
    ip_limited: bool = False
    reset_limited: bool = False
    reset_failures: list[str] = field(default_factory=list)
    reset_cleared: list[str] = field(default_factory=list)
    login_cleared: list[str] = field(default_factory=list)

    def is_email_send_ip_limited(self, ip_address: str) -> bool:
        del ip_address
        return self.ip_limited

    def is_password_reset_verification_limited(self, email: str) -> bool:
        del email
        return self.reset_limited

    def record_password_reset_verification_failure(self, email: str) -> None:
        self.reset_failures.append(email)

    def reset_password_reset_verification_failures(self, email: str) -> None:
        self.reset_cleared.append(email)

    def reset_login_failures(self, email: str) -> None:
        self.login_cleared.append(email)


@dataclass
class AppAccessGatewayFake:
    permission_required: bool = True
    authentication_required: bool = True

    def find_app_id_by_code(self, app_code: str) -> str | None:
        return "app-1" if app_code == "site-code" else None

    def requires_permission_check(self, app_id: str) -> bool:
        del app_id
        return self.permission_required

    def requires_authentication(self, app_id: str) -> bool:
        del app_id
        return self.authentication_required

    def is_user_allowed(self, *, user_id: str, app_id: str) -> bool:
        del user_id, app_id
        return True


@dataclass
class AppSessionGatewayFake:
    valid: bool = False

    def verify(self, *, token: str | None, app_code: str, user_id: str | None) -> bool:
        del app_code, user_id
        return self.valid and token == "valid-passport"


@dataclass
class AuditGatewayFake:
    failures: list[tuple[str, LoginFailureReason, str]] = field(default_factory=list)

    def login_failed(self, *, email: str, reason: LoginFailureReason, ip_address: str) -> None:
        self.failures.append((email, reason, ip_address))


@dataclass
class ServiceFixture:
    service: WebAuthenticationService
    accounts: AccountRepositoryFake
    tokens: TokenGatewayFake
    security: SecurityGatewayFake
    app_access: AppAccessGatewayFake
    app_sessions: AppSessionGatewayFake
    audit: AuditGatewayFake


@pytest.fixture
def service_fixture() -> ServiceFixture:
    account = AccountAuthenticationSnapshot(
        id="account-1",
        email="user@example.com",
        status="active",
        password_hash="hash",
        password_salt="salt",
    )
    accounts = AccountRepositoryFake({"user@example.com": account})
    tokens = TokenGatewayFake()
    security = SecurityGatewayFake()
    app_access = AppAccessGatewayFake()
    app_sessions = AppSessionGatewayFake()
    audit = AuditGatewayFake()
    service = WebAuthenticationService(
        accounts=accounts,
        passwords=PasswordHasherFake(),
        tokens=tokens,
        security=security,
        app_access=app_access,
        app_sessions=app_sessions,
        audit=audit,
        private_app_access_enabled=True,
    )
    return ServiceFixture(service, accounts, tokens, security, app_access, app_sessions, audit)


def request_context() -> RequestContext:
    return RequestContext("request-1", "trace-1", "", None, "127.0.0.1")


def test_password_login_authenticates_and_issues_token(service_fixture: ServiceFixture) -> None:
    token = service_fixture.service.login_with_password(
        request_context(),
        email="user@example.com",
        password="Valid1234",
    )

    assert token == "access:account-1:user@example.com"
    assert service_fixture.audit.failures == []


@pytest.mark.parametrize(
    ("email", "password", "reason"),
    [
        pytest.param("missing@example.com", "Valid1234", LoginFailureReason.ACCOUNT_NOT_FOUND, id="missing"),
        pytest.param("user@example.com", "wrong", LoginFailureReason.INVALID_CREDENTIALS, id="password"),
    ],
)
def test_password_login_audits_rejected_credentials(
    service_fixture: ServiceFixture,
    email: str,
    password: str,
    reason: LoginFailureReason,
) -> None:
    with pytest.raises(WebAuthenticationFailedError):
        service_fixture.service.login_with_password(request_context(), email=email, password=password)

    assert service_fixture.audit.failures == [(email, reason, "127.0.0.1")]


def test_password_login_rejects_banned_account(service_fixture: ServiceFixture) -> None:
    account = service_fixture.accounts.accounts["user@example.com"]
    service_fixture.accounts.accounts["user@example.com"] = AccountAuthenticationSnapshot(
        id=account.id,
        email=account.email,
        status="banned",
        password_hash=account.password_hash,
        password_salt=account.password_salt,
    )

    with pytest.raises(WebAccountBannedError):
        service_fixture.service.login_with_password(
            request_context(),
            email="user@example.com",
            password="Valid1234",
        )

    assert service_fixture.audit.failures[0][1] == LoginFailureReason.ACCOUNT_BANNED


def test_email_code_login_verifies_reissues_and_clears_failures(service_fixture: ServiceFixture) -> None:
    service_fixture.tokens.email_login_token = StoredAuthenticationToken(
        email="User@Example.com",
        code="123456",
    )

    token = service_fixture.service.login_with_email_code(
        request_context(),
        email="user@example.com",
        code="123456",
        token="challenge",
    )

    assert token == "access:account-1:user@example.com"
    assert service_fixture.tokens.revoked == [("email", "challenge")]
    assert service_fixture.security.login_cleared == ["user@example.com"]


def test_email_code_login_audits_invalid_code(service_fixture: ServiceFixture) -> None:
    service_fixture.tokens.email_login_token = StoredAuthenticationToken(email="user@example.com", code="123456")

    with pytest.raises(WebInvalidCodeError):
        service_fixture.service.login_with_email_code(
            request_context(),
            email="user@example.com",
            code="wrong",
            token="challenge",
        )

    assert service_fixture.audit.failures[0][1] == LoginFailureReason.INVALID_EMAIL_CODE


def test_forgot_password_send_applies_ip_limit(service_fixture: ServiceFixture) -> None:
    service_fixture.security.ip_limited = True

    with pytest.raises(WebEmailSendIPLimitedError):
        service_fixture.service.send_reset_password_email(
            request_context(),
            email="user@example.com",
            language=None,
        )


def test_reset_verification_rotates_token_and_clears_failures(service_fixture: ServiceFixture) -> None:
    service_fixture.tokens.reset_token = StoredAuthenticationToken(email="User@Example.com", code="1234")

    token = service_fixture.service.verify_reset_password_code(
        email="user@example.com",
        code="1234",
        token="verification-token",
    )

    assert token == "replacement:User@Example.com:1234"
    assert service_fixture.tokens.revoked == [("reset", "verification-token")]
    assert service_fixture.security.reset_cleared == ["user@example.com"]


def test_password_reset_updates_through_repository(service_fixture: ServiceFixture) -> None:
    service_fixture.tokens.reset_token = StoredAuthenticationToken(
        email="user@example.com",
        code="1234",
        phase="reset",
    )

    service_fixture.service.reset_password(
        token="reset-token",
        new_password="NewValid123!",
        password_confirmation="NewValid123!",
    )

    assert service_fixture.tokens.revoked == [("reset", "reset-token")]
    assert service_fixture.accounts.updated == (
        "account-1",
        AccountPasswordDigest(password_hash="hashed:NewValid123!", password_salt="new-salt"),
    )


def test_password_reset_rejects_mismatch_before_reading_token(service_fixture: ServiceFixture) -> None:
    with pytest.raises(WebPasswordMismatchError):
        service_fixture.service.reset_password(
            token="reset-token",
            new_password="one",
            password_confirmation="two",
        )


def test_login_status_uses_access_and_app_session_gateways(service_fixture: ServiceFixture) -> None:
    service_fixture.app_sessions.valid = True

    status = service_fixture.service.get_login_status(
        app_code="site-code",
        user_id="session-1",
        access_token="valid-access",
        app_session_token="valid-passport",
    )

    assert status.logged_in is True
    assert status.app_logged_in is True


def test_login_status_without_app_code_uses_token_presence_check(
    service_fixture: ServiceFixture,
) -> None:
    status = service_fixture.service.get_login_status(
        app_code=None,
        user_id=None,
        access_token="not-verified-here",
        app_session_token=None,
    )

    assert status.logged_in is True
    assert status.app_logged_in is False


def test_reset_rejects_token_outside_reset_phase(service_fixture: ServiceFixture) -> None:
    service_fixture.tokens.reset_token = StoredAuthenticationToken(email="user@example.com", code="1234")

    with pytest.raises(WebInvalidTokenError):
        service_fixture.service.reset_password(
            token="verification-token",
            new_password="NewValid123!",
            password_confirmation="NewValid123!",
        )
