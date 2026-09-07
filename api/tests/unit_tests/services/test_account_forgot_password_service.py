"""Unit tests for the framework-neutral forgot-password application service."""

from __future__ import annotations

from datetime import datetime
from typing import cast

import pytest

from services import account_errors
from services.account_forgot_password_service import (
    AccountForgotPasswordService,
    ForgotPasswordCodeGenerator,
    ForgotPasswordNotificationGateway,
    ForgotPasswordRegistrationPolicy,
    ForgotPasswordSecurityGateway,
    ForgotPasswordSendLimiter,
    ForgotPasswordTokenGateway,
)
from services.account_ports import AccountPasswordHasher, AccountRepository
from services.entities.account_entities import (
    AccountPasswordDigest,
    AccountSnapshot,
    ForgotPasswordResetToken,
    ForgotPasswordToken,
    ForgotPasswordVerificationToken,
)


def _account(*, email: str = "User@Example.com") -> AccountSnapshot:
    return AccountSnapshot(
        id="account-1",
        name="User",
        email=email,
        avatar=None,
        is_password_set=False,
        interface_language="en-US",
        interface_theme="light",
        timezone="UTC",
        last_login_at=None,
        last_login_ip=None,
        status="active",
        initialized_at=None,
        created_at=datetime(2026, 8, 1),
    )


class FakeAccounts:
    def __init__(self, account: AccountSnapshot | None = None) -> None:
        self.account = account
        self.requested_ids: list[str] = []
        self.requested_emails: list[str] = []
        self.updated: tuple[str, AccountPasswordDigest] | None = None
        self.update_succeeds = True
        self.update_error: Exception | None = None

    def get(self, account_id: str) -> AccountSnapshot | None:
        self.requested_ids.append(account_id)
        return self.account

    def find_by_email(self, email: str) -> AccountSnapshot | None:
        self.requested_emails.append(email)
        return self.account

    def update_password(self, account_id: str, password: AccountPasswordDigest) -> AccountSnapshot | None:
        self.updated = (account_id, password)
        if self.update_error is not None:
            raise self.update_error
        return self.account if self.update_succeeds else None


class FakePasswords:
    def __init__(self) -> None:
        self.plaintext: str | None = None
        self.digest = AccountPasswordDigest(password_hash="hash", password_salt="salt")

    def hash(self, password: str) -> AccountPasswordDigest:
        self.plaintext = password
        return self.digest


class FakeTokens:
    def __init__(self) -> None:
        self.stored: dict[str, ForgotPasswordToken | None] = {}
        self.issued: list[ForgotPasswordToken] = []
        self.read_tokens: list[str] = []
        self.claimed_reset_tokens: list[str] = []
        self.promotions: list[tuple[str, ForgotPasswordResetToken]] = []
        self.promotion_succeeds = True

    def read_verification(self, token: str) -> ForgotPasswordVerificationToken | None:
        self.read_tokens.append(token)
        token_data = self.stored.get(token)
        return token_data if isinstance(token_data, ForgotPasswordVerificationToken) else None

    def claim_reset(self, token: str) -> ForgotPasswordResetToken | None:
        self.claimed_reset_tokens.append(token)
        token_data = self.stored.pop(token, None)
        return token_data if isinstance(token_data, ForgotPasswordResetToken) else None

    def issue(self, token_data: ForgotPasswordToken) -> str:
        self.issued.append(token_data)
        return f"issued-{len(self.issued)}"

    def promote(self, claimed_token: str, token_data: ForgotPasswordResetToken) -> str | None:
        self.promotions.append((claimed_token, token_data))
        self.stored.pop(claimed_token, None)
        if not self.promotion_succeeds:
            return None
        return self.issue(token_data)


class FakeCodeGenerator:
    def generate(self) -> str:
        return "123456"


class FakeNotifications:
    def __init__(self) -> None:
        self.sent: list[dict[str, object]] = []

    def send(
        self,
        *,
        email: str,
        code: str,
        language: str,
        account_exists: bool,
        registration_allowed: bool,
    ) -> None:
        self.sent.append(
            {
                "email": email,
                "code": code,
                "language": language,
                "account_exists": account_exists,
                "registration_allowed": registration_allowed,
            }
        )


class FakeSendLimiter:
    retry_after_minutes = 1

    def __init__(self) -> None:
        self.limited = False
        self.checked: list[str] = []
        self.recorded: list[str] = []

    def is_limited(self, email: str) -> bool:
        self.checked.append(email)
        return self.limited

    def record(self, email: str) -> None:
        self.recorded.append(email)


class FakeSecurity:
    def __init__(self) -> None:
        self.ip_limited = False
        self.verification_limited = False
        self.checked_ips: list[str] = []
        self.failed_emails: list[str] = []
        self.reset_emails: list[str] = []

    def is_ip_limited(self, ip_address: str) -> bool:
        self.checked_ips.append(ip_address)
        return self.ip_limited

    def is_verification_limited(self, _email: str) -> bool:
        return self.verification_limited

    def record_verification_failure(self, email: str) -> None:
        self.failed_emails.append(email)

    def reset_verification_failures(self, email: str) -> None:
        self.reset_emails.append(email)


class FakeRegistrationPolicy:
    def __init__(self, allowed: bool = True) -> None:
        self.allowed = allowed

    def is_registration_allowed(self) -> bool:
        return self.allowed


class Dependencies:
    def __init__(self, account: AccountSnapshot | None = None) -> None:
        self.accounts = FakeAccounts(account)
        self.passwords = FakePasswords()
        self.tokens = FakeTokens()
        self.codes = FakeCodeGenerator()
        self.notifications = FakeNotifications()
        self.send_limits = FakeSendLimiter()
        self.security = FakeSecurity()
        self.registration = FakeRegistrationPolicy()
        self.service = AccountForgotPasswordService(
            accounts=cast(AccountRepository, self.accounts),
            passwords=cast(AccountPasswordHasher, self.passwords),
            tokens=cast(ForgotPasswordTokenGateway, self.tokens),
            codes=cast(ForgotPasswordCodeGenerator, self.codes),
            notifications=cast(ForgotPasswordNotificationGateway, self.notifications),
            send_limits=cast(ForgotPasswordSendLimiter, self.send_limits),
            security=cast(ForgotPasswordSecurityGateway, self.security),
            registration=cast(ForgotPasswordRegistrationPolicy, self.registration),
        )


def test_send_code_preserves_existing_account_email_case() -> None:
    dependencies = Dependencies(_account())

    token = dependencies.service.send_code(
        email="USER@Example.com",
        language="zh-Hans",
        ip_address="127.0.0.1",
    )

    assert token == "issued-1"
    assert dependencies.accounts.requested_emails == ["USER@Example.com"]
    assert dependencies.tokens.issued == [
        ForgotPasswordVerificationToken(email="User@Example.com", code="123456", account_id="account-1")
    ]
    assert dependencies.notifications.sent == [
        {
            "email": "User@Example.com",
            "code": "123456",
            "language": "zh-Hans",
            "account_exists": True,
            "registration_allowed": True,
        }
    ]
    assert dependencies.send_limits.recorded == ["User@Example.com"]


def test_send_code_normalizes_unknown_account_email() -> None:
    dependencies = Dependencies()
    dependencies.registration.allowed = False

    dependencies.service.send_code(
        email="MISSING@Example.com",
        language="en-US",
        ip_address="127.0.0.1",
    )

    assert dependencies.tokens.issued == [ForgotPasswordVerificationToken(email="missing@example.com", code="123456")]
    assert dependencies.notifications.sent[0]["account_exists"] is False
    assert dependencies.notifications.sent[0]["registration_allowed"] is False


def test_send_code_stops_at_ip_limit() -> None:
    dependencies = Dependencies(_account())
    dependencies.security.ip_limited = True

    with pytest.raises(account_errors.ForgotPasswordSendIPLimitedError):
        dependencies.service.send_code(
            email="user@example.com",
            language="en-US",
            ip_address="127.0.0.1",
        )

    assert dependencies.accounts.requested_emails == []
    assert dependencies.tokens.issued == []


def test_send_code_stops_at_address_limit() -> None:
    dependencies = Dependencies(_account())
    dependencies.send_limits.limited = True

    with pytest.raises(account_errors.ForgotPasswordSendRateLimitError) as exc_info:
        dependencies.service.send_code(
            email="user@example.com",
            language="en-US",
            ip_address="127.0.0.1",
        )

    assert exc_info.value.retry_after_minutes == 1
    assert dependencies.tokens.issued == []


def test_verify_code_promotes_token_and_resets_failure_limit() -> None:
    dependencies = Dependencies()
    dependencies.tokens.stored["verification-token"] = ForgotPasswordVerificationToken(
        email="User@Example.com",
        code="123456",
        account_id="account-1",
    )

    result = dependencies.service.verify_code(
        email="USER@example.com",
        code="123456",
        token="verification-token",
    )

    assert result.email == "user@example.com"
    assert result.token == "issued-1"
    assert dependencies.tokens.read_tokens == ["verification-token"]
    assert "verification-token" not in dependencies.tokens.stored
    assert dependencies.tokens.issued == [
        ForgotPasswordResetToken(email="User@Example.com", code="123456", account_id="account-1")
    ]
    assert dependencies.tokens.promotions == [
        (
            "verification-token",
            ForgotPasswordResetToken(email="User@Example.com", code="123456", account_id="account-1"),
        )
    ]
    assert dependencies.security.reset_emails == ["user@example.com"]


def test_verify_code_rejects_promotion_after_token_is_superseded() -> None:
    dependencies = Dependencies()
    dependencies.tokens.stored["verification-token"] = ForgotPasswordVerificationToken(
        email="user@example.com",
        code="123456",
        account_id="account-1",
    )
    dependencies.tokens.promotion_succeeds = False

    with pytest.raises(account_errors.InvalidForgotPasswordTokenError):
        dependencies.service.verify_code(
            email="user@example.com",
            code="123456",
            token="verification-token",
        )

    assert "verification-token" not in dependencies.tokens.stored
    assert dependencies.security.reset_emails == []


def test_verify_code_rejects_reset_phase_token() -> None:
    dependencies = Dependencies()
    dependencies.tokens.stored["reset-token"] = ForgotPasswordResetToken(
        email="user@example.com",
        code="123456",
    )

    with pytest.raises(account_errors.InvalidForgotPasswordTokenError):
        dependencies.service.verify_code(
            email="user@example.com",
            code="123456",
            token="reset-token",
        )

    assert "reset-token" in dependencies.tokens.stored


def test_verify_code_rejects_mismatched_email() -> None:
    dependencies = Dependencies()
    dependencies.tokens.stored["token"] = ForgotPasswordVerificationToken(
        email="original@example.com",
        code="123456",
    )

    with pytest.raises(account_errors.InvalidForgotPasswordEmailError):
        dependencies.service.verify_code(
            email="different@example.com",
            code="123456",
            token="token",
        )

    assert "token" in dependencies.tokens.stored


def test_verify_code_keeps_token_after_wrong_code_and_allows_retry() -> None:
    dependencies = Dependencies()
    dependencies.tokens.stored["token"] = ForgotPasswordVerificationToken(
        email="user@example.com",
        code="123456",
    )

    with pytest.raises(account_errors.InvalidForgotPasswordCodeError):
        dependencies.service.verify_code(
            email="USER@example.com",
            code="wrong",
            token="token",
        )

    assert dependencies.security.failed_emails == ["user@example.com"]
    assert "token" in dependencies.tokens.stored

    result = dependencies.service.verify_code(
        email="USER@example.com",
        code="123456",
        token="token",
    )

    assert result.token == "issued-1"
    assert "token" not in dependencies.tokens.stored


def test_verify_code_stops_at_failure_limit() -> None:
    dependencies = Dependencies()
    dependencies.security.verification_limited = True

    with pytest.raises(account_errors.ForgotPasswordVerificationLimitError):
        dependencies.service.verify_code(
            email="user@example.com",
            code="123456",
            token="token",
        )


def test_reset_claims_token_and_updates_password() -> None:
    dependencies = Dependencies(_account(email="user@example.com"))
    dependencies.tokens.stored["reset-token"] = ForgotPasswordResetToken(
        email="User@Example.com",
        code="123456",
        account_id="account-1",
    )

    dependencies.service.reset(
        token="reset-token",
        new_password="ValidPass123!",
        password_confirm="ValidPass123!",
    )

    assert dependencies.tokens.claimed_reset_tokens == ["reset-token"]
    assert "reset-token" not in dependencies.tokens.stored
    assert dependencies.accounts.requested_ids == ["account-1"]
    assert dependencies.accounts.requested_emails == []
    assert dependencies.passwords.plaintext == "ValidPass123!"
    assert dependencies.accounts.updated == ("account-1", dependencies.passwords.digest)


def test_reset_rejects_password_mismatch_before_reading_token() -> None:
    dependencies = Dependencies(_account())

    with pytest.raises(account_errors.ForgotPasswordMismatchError):
        dependencies.service.reset(
            token="reset-token",
            new_password="ValidPass123!",
            password_confirm="OtherPass123!",
        )

    assert dependencies.tokens.claimed_reset_tokens == []


def test_reset_consumes_claimed_token_when_account_is_missing() -> None:
    dependencies = Dependencies()
    dependencies.tokens.stored["reset-token"] = ForgotPasswordResetToken(
        email="missing@example.com",
        code="123456",
        account_id="missing-account",
    )

    with pytest.raises(account_errors.AccountNotFoundError):
        dependencies.service.reset(
            token="reset-token",
            new_password="ValidPass123!",
            password_confirm="ValidPass123!",
        )

    assert "reset-token" not in dependencies.tokens.stored
    assert dependencies.accounts.updated is None


def test_reset_consumes_claimed_token_when_password_commit_fails() -> None:
    dependencies = Dependencies(_account())
    dependencies.tokens.stored["reset-token"] = ForgotPasswordResetToken(
        email="user@example.com",
        code="123456",
        account_id="account-1",
    )
    dependencies.accounts.update_error = RuntimeError("database unavailable")

    with pytest.raises(RuntimeError, match="database unavailable"):
        dependencies.service.reset(
            token="reset-token",
            new_password="ValidPass123!",
            password_confirm="ValidPass123!",
        )

    assert dependencies.tokens.claimed_reset_tokens == ["reset-token"]
    assert "reset-token" not in dependencies.tokens.stored


def test_reset_supports_legacy_token_without_account_id() -> None:
    dependencies = Dependencies(_account(email="user@example.com"))
    dependencies.tokens.stored["legacy-token"] = ForgotPasswordResetToken(
        email="User@Example.com",
        code="123456",
    )

    dependencies.service.reset(
        token="legacy-token",
        new_password="ValidPass123!",
        password_confirm="ValidPass123!",
    )

    assert dependencies.accounts.requested_ids == []
    assert dependencies.accounts.requested_emails == ["User@Example.com"]


def test_reset_rejects_account_when_email_changed_after_token_issue() -> None:
    dependencies = Dependencies(_account(email="changed@example.com"))
    dependencies.tokens.stored["reset-token"] = ForgotPasswordResetToken(
        email="original@example.com",
        code="123456",
        account_id="account-1",
    )

    with pytest.raises(account_errors.AccountNotFoundError):
        dependencies.service.reset(
            token="reset-token",
            new_password="ValidPass123!",
            password_confirm="ValidPass123!",
        )

    assert dependencies.accounts.updated is None
