"""Application service implementing the account change-email state machine."""

from machinery.context import RequestContext
from services.account_change_email_ports import (
    AccountEmailPolicyGateway,
    ChangeEmailCodeGenerator,
    ChangeEmailNotificationGateway,
    ChangeEmailSecurityGateway,
    ChangeEmailSendLimiter,
    ChangeEmailTokenGateway,
)
from services.account_errors import (
    AccountEmailAlreadyInUseError,
    AccountEmailDomainSuspendedError,
    AccountEmailFrozenError,
    AccountNotFoundError,
    ChangeEmailSendIPLimitedError,
    ChangeEmailSendRateLimitError,
    ChangeEmailVerificationLimitError,
    InvalidChangeEmailAddressError,
    InvalidChangeEmailCodeError,
    InvalidChangeEmailTokenError,
)
from services.account_ports import AccountRepository
from services.entities.account_entities import (
    AccountChangeEmailNewEmailToken,
    AccountChangeEmailNewEmailVerifiedToken,
    AccountChangeEmailOldEmailToken,
    AccountChangeEmailOldEmailVerifiedToken,
    AccountChangeEmailPhase,
    AccountEmailResetStatus,
    AccountSnapshot,
    ChangeEmailVerification,
)


class AccountChangeEmailService:
    def __init__(
        self,
        *,
        accounts: AccountRepository,
        tokens: ChangeEmailTokenGateway,
        codes: ChangeEmailCodeGenerator,
        notifications: ChangeEmailNotificationGateway,
        send_limits: ChangeEmailSendLimiter,
        security: ChangeEmailSecurityGateway,
        email_policy: AccountEmailPolicyGateway,
    ) -> None:
        self._accounts = accounts
        self._tokens = tokens
        self._codes = codes
        self._notifications = notifications
        self._send_limits = send_limits
        self._security = security
        self._email_policy = email_policy

    def send_code(
        self,
        context: RequestContext,
        *,
        requested_email: str,
        language: str,
        phase: str | None,
        predecessor_token: str | None,
        ip_address: str,
    ) -> str:
        if self._security.is_ip_limited(ip_address):
            raise ChangeEmailSendIPLimitedError

        account = self._accounts.get(context.account_id)
        if account is None:
            raise AccountNotFoundError

        email_for_sending = requested_email.lower()
        old_email = account.email
        send_phase = AccountChangeEmailPhase.OLD_EMAIL
        if phase == AccountChangeEmailPhase.NEW_EMAIL:
            send_phase = AccountChangeEmailPhase.NEW_EMAIL
            if predecessor_token is None:
                raise InvalidChangeEmailTokenError
            predecessor = self._tokens.get(predecessor_token)
            if not isinstance(predecessor, AccountChangeEmailOldEmailVerifiedToken):
                raise InvalidChangeEmailTokenError
            if not predecessor.is_bound_to_account(context.account_id):
                raise InvalidChangeEmailTokenError
            old_email = predecessor.email
            if old_email.lower() != account.email.lower():
                raise InvalidChangeEmailAddressError
        else:
            if email_for_sending != account.email.lower():
                raise InvalidChangeEmailAddressError
            email_for_sending = account.email

        if self._send_limits.is_limited(email_for_sending):
            raise ChangeEmailSendRateLimitError(self._send_limits.retry_after_minutes)

        code = self._codes.generate()
        token_data: AccountChangeEmailOldEmailToken | AccountChangeEmailNewEmailToken
        if send_phase == AccountChangeEmailPhase.OLD_EMAIL:
            token_data = AccountChangeEmailOldEmailToken(
                account_id=context.account_id,
                email=email_for_sending,
                old_email=old_email,
                code=code,
            )
        else:
            token_data = AccountChangeEmailNewEmailToken(
                account_id=context.account_id,
                email=email_for_sending,
                old_email=old_email,
                code=code,
            )
        token = self._tokens.issue(token_data)
        self._notifications.send_code(
            email=email_for_sending,
            code=code,
            language=language,
            phase=send_phase,
        )
        self._send_limits.record(email_for_sending)
        return token

    def verify_code(
        self,
        context: RequestContext,
        *,
        email: str,
        code: str,
        token: str,
    ) -> ChangeEmailVerification:
        normalized_email = email.lower()
        if self._security.is_verification_limited(normalized_email):
            raise ChangeEmailVerificationLimitError

        token_data = self._tokens.get(token)
        if token_data is None or not token_data.is_bound_to_account(context.account_id):
            raise InvalidChangeEmailTokenError
        normalized_token_email = token_data.email.lower()
        if normalized_email != normalized_token_email:
            raise InvalidChangeEmailAddressError
        if code != token_data.code:
            self._security.record_verification_failure(normalized_email)
            raise InvalidChangeEmailCodeError

        if isinstance(token_data, AccountChangeEmailOldEmailToken | AccountChangeEmailNewEmailToken):
            promoted = token_data.promote()
        else:
            raise InvalidChangeEmailTokenError

        self._tokens.revoke(token)
        promoted_token = self._tokens.issue(promoted)
        self._security.reset_verification_failures(normalized_email)
        return ChangeEmailVerification(email=normalized_token_email, token=promoted_token)

    def reset(
        self,
        context: RequestContext,
        *,
        new_email: str,
        token: str,
    ) -> AccountSnapshot:
        normalized_new_email = new_email.lower()
        freeze_type = self._email_policy.is_frozen(normalized_new_email)
        if freeze_type == "email_domain_suspended":
            raise AccountEmailDomainSuspendedError
        if freeze_type:
            raise AccountEmailFrozenError

        token_data = self._tokens.get(token)
        if not isinstance(token_data, AccountChangeEmailNewEmailVerifiedToken):
            raise InvalidChangeEmailTokenError
        if not token_data.is_bound_to_account(context.account_id):
            raise InvalidChangeEmailTokenError
        if token_data.email.lower() != normalized_new_email:
            raise InvalidChangeEmailTokenError

        result = self._accounts.reset_email(
            context.account_id,
            expected_old_email=token_data.old_email,
            new_email=normalized_new_email,
        )
        if result.status == AccountEmailResetStatus.EMAIL_IN_USE:
            raise AccountEmailAlreadyInUseError
        if result.status in {AccountEmailResetStatus.ACCOUNT_NOT_FOUND, AccountEmailResetStatus.EMAIL_CHANGED}:
            raise AccountNotFoundError
        if result.account is None:
            raise RuntimeError("Account repository returned an updated result without an account")

        self._tokens.revoke(token)
        self._notifications.send_completed(email=normalized_new_email, language="en-US")
        return result.account

    def ensure_available(self, email: str) -> None:
        normalized_email = email.lower()
        freeze_type = self._email_policy.is_frozen(normalized_email)
        if freeze_type == "email_domain_suspended":
            raise AccountEmailDomainSuspendedError
        if freeze_type:
            raise AccountEmailFrozenError
        if self._accounts.email_exists(normalized_email):
            raise AccountEmailAlreadyInUseError
