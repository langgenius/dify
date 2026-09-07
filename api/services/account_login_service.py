"""Framework-neutral application service for Console authentication use cases."""

from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Never, Protocol

from constants.languages import get_valid_language, language_timezone_mapping
from services import account_errors
from services.account_ports import AccountPasswordHasher
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
    PasswordLoginResult,
    RefreshAccountStatus,
)
from services.entities.auth_audit_entities import LoginFailureReason

_BANNED_ACCOUNT_STATUS = "banned"
_EMAIL_DOMAIN_SUSPENDED = "email_domain_suspended"


class ConsoleAuthAccountRepository(Protocol):
    def list_for_login(self, email: str) -> Sequence[LoginAccountSnapshot]: ...

    def complete_password_login(self, completion: PasswordLoginCompletion) -> bool: ...

    def prepare_session(self, account_id: str, preparation: AccountSessionPreparation) -> bool: ...


class ConsoleAuthWorkspaceQuery(Protocol):
    def has_active_for_account(self, account_id: str) -> bool: ...


class ConsoleAuthInvitationGateway(Protocol):
    def resolve(self, *, email: str, token: str) -> LoginInvitation | None: ...


class ConsoleAuthPolicyGateway(Protocol):
    def get_email_freeze_type(self, email: str) -> str | None: ...

    def is_registration_allowed(self) -> bool: ...

    def is_workspace_creation_allowed(self) -> bool: ...

    def has_workspace_capacity(self) -> bool: ...

    def has_account_capacity(self) -> bool: ...


class ConsoleAuthSecurityGateway(Protocol):
    def is_login_limited(self, email: str) -> bool: ...

    def record_login_failure(self, email: str) -> None: ...

    def reset_login_failures(self, email: str) -> None: ...

    def is_email_send_ip_limited(self, ip_address: str) -> bool: ...


class HumanVerificationGateway(Protocol):
    def verify(self, *, token: str | None, remote_ip: str, action: str) -> None: ...


class AccountSessionGateway(Protocol):
    def issue(self, account_id: str) -> AuthTokenPair: ...

    def revoke(self, account_id: str) -> None: ...

    def resolve_refresh_token(self, refresh_token: str) -> str | None: ...

    def rotate(self, *, refresh_token: str, account_id: str) -> AuthTokenPair: ...


class AccountRefreshPreparationGateway(Protocol):
    def prepare(self, account_id: str) -> RefreshAccountStatus: ...


class AccountProvisioningGateway(Protocol):
    def create_with_owner_workspace(
        self,
        *,
        email: str,
        name: str,
        interface_language: str,
        timezone: str,
        ip_address: str,
    ) -> str: ...


class WorkspaceProvisioningGateway(Protocol):
    def create_owner_workspace(self, account_id: str) -> None: ...


class EmailCodeGateway(Protocol):
    def send(
        self,
        *,
        account_id: str | None,
        normalized_email: str,
        recipient_email: str,
        language: str,
    ) -> str: ...

    def verify(self, *, normalized_email: str, code: str, token: str) -> EmailCodeChallengeStatus: ...


class ResetPasswordEmailGateway(Protocol):
    def send(
        self,
        *,
        account_id: str | None,
        email: str,
        language: str,
        registration_allowed: bool,
    ) -> str: ...


class ConsoleAuthAuditGateway(Protocol):
    def login_failed(
        self,
        *,
        email: str,
        reason: LoginFailureReason,
        ip_address: str,
    ) -> None: ...


class ConsoleAuthenticationService:
    def __init__(
        self,
        *,
        accounts: ConsoleAuthAccountRepository,
        workspaces: ConsoleAuthWorkspaceQuery,
        invitations: ConsoleAuthInvitationGateway,
        policies: ConsoleAuthPolicyGateway,
        security: ConsoleAuthSecurityGateway,
        passwords: AccountPasswordHasher,
        human_verification: HumanVerificationGateway,
        sessions: AccountSessionGateway,
        refresh_preparation: AccountRefreshPreparationGateway,
        account_provisioning: AccountProvisioningGateway,
        workspace_provisioning: WorkspaceProvisioningGateway,
        email_codes: EmailCodeGateway,
        reset_password_emails: ResetPasswordEmailGateway,
        audit: ConsoleAuthAuditGateway,
        now: Callable[[], datetime],
        turnstile_enabled: bool,
        turnstile_verify_required: bool,
    ) -> None:
        self._accounts = accounts
        self._workspaces = workspaces
        self._invitations = invitations
        self._policies = policies
        self._security = security
        self._passwords = passwords
        self._human_verification = human_verification
        self._sessions = sessions
        self._refresh_preparation = refresh_preparation
        self._account_provisioning = account_provisioning
        self._workspace_provisioning = workspace_provisioning
        self._email_codes = email_codes
        self._reset_password_emails = reset_password_emails
        self._audit = audit
        self._now = now
        self._turnstile_enabled = turnstile_enabled
        self._turnstile_verify_required = turnstile_verify_required

    def login_with_password(self, command: PasswordLoginCommand) -> PasswordLoginResult:
        normalized_email = command.email.lower()
        self._ensure_email_eligible(normalized_email, command.ip_address)
        if self._security.is_login_limited(normalized_email):
            self._fail(
                account_errors.LoginRateLimitError(),
                email=normalized_email,
                reason=LoginFailureReason.LOGIN_RATE_LIMITED,
                ip_address=command.ip_address,
            )

        invitation_token = self._resolve_invitation_token(command, normalized_email)
        account = None
        for candidate in self._accounts.list_for_login(command.email):
            completion = self._password_login_completion(
                candidate,
                command,
                invitation_token=invitation_token,
                normalized_email=normalized_email,
            )
            if completion is not None and self._accounts.complete_password_login(completion):
                account = candidate
                break
        if account is None:
            self._invalid_credentials(normalized_email, command.ip_address)

        if not self._workspaces.has_active_for_account(account.id):
            if self._policies.is_workspace_creation_allowed() and not self._policies.has_workspace_capacity():
                raise account_errors.LoginWorkspaceLimitError
            return PasswordLoginResult(token_pair=None, workspace_found=False)

        token_pair = self._issue_session(
            account_id=account.id,
            ip_address=command.ip_address,
            activate_pending_account=False,
        )
        self._security.reset_login_failures(normalized_email)
        return PasswordLoginResult(token_pair=token_pair, workspace_found=True)

    def logout(self, account_id: str) -> None:
        self._sessions.revoke(account_id)

    def send_reset_password_email(self, *, email: str, language: str | None, ip_address: str) -> str:
        normalized_email = email.lower()
        self._ensure_email_eligible(normalized_email, ip_address)
        account = self._preferred_account(email)
        self._ensure_account_not_banned(account, normalized_email, ip_address)
        return self._reset_password_emails.send(
            account_id=account.id if account is not None else None,
            email=account.email if account is not None else normalized_email,
            language=self._email_language(language),
            registration_allowed=self._policies.is_registration_allowed(),
        )

    def send_email_code(self, command: EmailCodeSendCommand) -> str:
        if self._security.is_email_send_ip_limited(command.ip_address):
            raise account_errors.EmailCodeSendIPLimitedError
        if self._turnstile_enabled:
            self._human_verification.verify(
                token=command.turnstile_token,
                remote_ip=command.ip_address,
                action="signin_code",
            )

        normalized_email = command.email.lower()
        self._ensure_email_eligible(normalized_email, command.ip_address)
        account = self._preferred_account(command.email)
        self._ensure_account_not_banned(account, normalized_email, command.ip_address)
        if account is None and not self._policies.is_registration_allowed():
            raise account_errors.AccountNotFoundError

        return self._email_codes.send(
            account_id=account.id if account is not None else None,
            normalized_email=normalized_email,
            recipient_email=account.email if account is not None else normalized_email,
            language=self._email_language(command.language),
        )

    def login_with_email_code(self, command: EmailCodeLoginCommand) -> AuthTokenPair:
        normalized_email = command.email.lower()
        if not self._is_valid_email_code(command.code):
            self._fail(
                account_errors.InvalidEmailCodeError(),
                email=normalized_email,
                reason=LoginFailureReason.INVALID_EMAIL_CODE,
                ip_address=command.ip_address,
            )

        if self._turnstile_enabled and (self._turnstile_verify_required or command.turnstile_token):
            self._human_verification.verify(
                token=command.turnstile_token,
                remote_ip=command.ip_address,
                action="signin_code_verify",
            )

        status = self._email_codes.verify(normalized_email=normalized_email, code=command.code, token=command.token)
        self._ensure_email_code_verified(status, normalized_email, command.ip_address)

        self._ensure_email_eligible(normalized_email, command.ip_address)
        account = self._preferred_account(command.email)
        self._ensure_account_not_banned(account, normalized_email, command.ip_address)
        if account is not None:
            if not self._workspaces.has_active_for_account(account.id):
                if not self._policies.has_workspace_capacity():
                    raise account_errors.LoginWorkspaceLimitError
                if not self._policies.is_workspace_creation_allowed():
                    raise account_errors.LoginWorkspaceCreationNotAllowedError
                self._workspace_provisioning.create_owner_workspace(account.id)
            account_id = account.id
        else:
            if not self._policies.is_registration_allowed():
                raise account_errors.AccountNotFoundError
            if not self._policies.has_account_capacity():
                raise account_errors.LoginSeatLimitError
            if not self._policies.is_workspace_creation_allowed():
                raise account_errors.LoginWorkspaceCreationNotAllowedError
            if not self._policies.has_workspace_capacity():
                raise account_errors.LoginWorkspaceLimitError
            interface_language = get_valid_language(command.language)
            account_id = self._account_provisioning.create_with_owner_workspace(
                email=normalized_email,
                name=normalized_email,
                interface_language=interface_language,
                timezone=command.timezone or language_timezone_mapping.get(interface_language, "UTC"),
                ip_address=command.ip_address,
            )

        token_pair = self._issue_session(
            account_id=account_id,
            ip_address=command.ip_address,
            activate_pending_account=account is not None and account.status == "pending",
        )
        self._security.reset_login_failures(normalized_email)
        return token_pair

    def refresh(self, refresh_token: str) -> AuthTokenPair:
        account_id = self._sessions.resolve_refresh_token(refresh_token)
        if account_id is None:
            raise account_errors.InvalidRefreshTokenError("Invalid refresh token")
        refresh_status = self._refresh_preparation.prepare(account_id)
        if refresh_status == RefreshAccountStatus.BANNED:
            raise account_errors.InvalidRefreshTokenError("Account is banned.")
        if refresh_status == RefreshAccountStatus.NOT_FOUND:
            raise account_errors.InvalidRefreshTokenError("Invalid account")
        return self._sessions.rotate(refresh_token=refresh_token, account_id=account_id)

    def _password_login_completion(
        self,
        account: LoginAccountSnapshot,
        command: PasswordLoginCommand,
        *,
        invitation_token: str | None,
        normalized_email: str,
    ) -> PasswordLoginCompletion | None:
        if account.status == _BANNED_ACCOUNT_STATUS:
            self._fail(
                account_errors.LoginAccountBannedError(),
                email=normalized_email,
                reason=LoginFailureReason.ACCOUNT_BANNED,
                ip_address=command.ip_address,
            )

        password_update = None
        if account.password_hash is None:
            if invitation_token is None or not command.password:
                return None
            password_update = self._passwords.hash(command.password)
        elif account.password_salt is None or not self._passwords.verify(
            command.password,
            password_hash=account.password_hash,
            password_salt=account.password_salt,
        ):
            return None
        activate_pending_account = account.status == "pending"
        return PasswordLoginCompletion(
            account_id=account.id,
            password=password_update,
            activate_pending_account=activate_pending_account,
            initialized_at=self._now() if activate_pending_account else None,
        )

    def _preferred_account(self, email: str) -> LoginAccountSnapshot | None:
        return next(iter(self._accounts.list_for_login(email)), None)

    def _issue_session(
        self,
        *,
        account_id: str,
        ip_address: str,
        activate_pending_account: bool,
    ) -> AuthTokenPair:
        prepared = self._accounts.prepare_session(
            account_id,
            AccountSessionPreparation(
                logged_in_at=self._now(),
                ip_address=ip_address,
                activate_pending_account=activate_pending_account,
            ),
        )
        if not prepared:
            raise account_errors.AccountNotFoundError
        return self._sessions.issue(account_id)

    def _resolve_invitation_token(self, command: PasswordLoginCommand, normalized_email: str) -> str | None:
        if command.invite_token is None:
            return None
        invitation = self._invitations.resolve(email=command.email, token=command.invite_token)
        if invitation is None:
            return None
        if invitation.email.lower() != normalized_email:
            self._fail(
                account_errors.InvalidLoginInvitationEmailError(),
                email=normalized_email,
                reason=LoginFailureReason.INVALID_INVITATION_EMAIL,
                ip_address=command.ip_address,
            )
        return command.invite_token

    def _ensure_email_eligible(self, email: str, ip_address: str) -> None:
        freeze_type = self._policies.get_email_freeze_type(email)
        if freeze_type is None:
            return
        error: Exception
        if freeze_type == _EMAIL_DOMAIN_SUSPENDED:
            error = account_errors.AccountEmailDomainSuspendedError()
        else:
            error = account_errors.AccountEmailFrozenError()
        self._fail(
            error,
            email=email,
            reason=LoginFailureReason.ACCOUNT_IN_FREEZE,
            ip_address=ip_address,
        )

    def _ensure_account_not_banned(
        self,
        account: LoginAccountSnapshot | None,
        email: str,
        ip_address: str,
    ) -> None:
        if account is not None and account.status == _BANNED_ACCOUNT_STATUS:
            self._fail(
                account_errors.LoginAccountBannedError(),
                email=email,
                reason=LoginFailureReason.ACCOUNT_BANNED,
                ip_address=ip_address,
            )

    def _invalid_credentials(self, email: str, ip_address: str) -> Never:
        self._security.record_login_failure(email)
        self._fail(
            account_errors.InvalidLoginCredentialsError(),
            email=email,
            reason=LoginFailureReason.INVALID_CREDENTIALS,
            ip_address=ip_address,
        )

    def _ensure_email_code_verified(
        self,
        status: EmailCodeChallengeStatus,
        email: str,
        ip_address: str,
    ) -> None:
        if status == EmailCodeChallengeStatus.VERIFIED:
            return
        if status == EmailCodeChallengeStatus.INVALID_TOKEN:
            self._fail(
                account_errors.InvalidEmailCodeTokenError(),
                email=email,
                reason=LoginFailureReason.INVALID_EMAIL_CODE_TOKEN,
                ip_address=ip_address,
            )
        if status == EmailCodeChallengeStatus.EMAIL_MISMATCH:
            self._fail(
                account_errors.EmailCodeEmailMismatchError(),
                email=email,
                reason=LoginFailureReason.EMAIL_CODE_EMAIL_MISMATCH,
                ip_address=ip_address,
            )
        self._fail(
            account_errors.InvalidEmailCodeError(),
            email=email,
            reason=LoginFailureReason.INVALID_EMAIL_CODE,
            ip_address=ip_address,
        )

    def _fail(
        self,
        error: Exception,
        *,
        email: str,
        reason: LoginFailureReason,
        ip_address: str,
    ) -> Never:
        self._audit.login_failed(email=email, reason=reason, ip_address=ip_address)
        raise error

    @staticmethod
    def _email_language(language: str | None) -> str:
        return "zh-Hans" if language == "zh-Hans" else "en-US"

    @staticmethod
    def _is_valid_email_code(code: str) -> bool:
        return len(code) == 6 and code.isascii() and code.isdigit()
