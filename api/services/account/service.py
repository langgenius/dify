"""Account creation, registration and session use cases, independent of ORM and HTTP."""

from collections.abc import Callable
from datetime import datetime
from typing import Protocol

from constants.languages import get_valid_language, language_timezone_mapping
from enums.account import TenantAccountRole
from services.account.contracts import AccountCreation, SetupInput
from services.account.login_service import AccountSessionGateway, ConsoleAuthSecurityGateway
from services.account_errors import (
    AccountEmailDomainSuspendedError,
    AccountLoginError,
    AccountNormalizedEmailAlreadyInUseError,
    AccountNotFoundError,
    AccountPasswordError,
    AccountRegisterError,
    SeatsLimitExceededError,
)
from services.account_ports import AccountPasswordHasher
from services.entities.account_entities import (
    AccountCredentials,
    AccountPasswordDigest,
    AccountSessionTokens,
    AccountSnapshot,
)
from services.entities.account_login_entities import AccountSessionPreparation
from services.errors.workspace import WorkspaceInvitationQuotaError, WorkSpaceNotAllowedCreateError
from services.workspace.contracts import CreatedWorkspace, WorkspaceMemberWrite
from services.workspace.quota import DeploymentQuotaSnapshot, WorkspaceMemberQuotaSnapshot


class AccountLifecycleStore(Protocol):
    def get(self, account_id: str) -> AccountSnapshot | None: ...

    def find_by_email(self, email: str) -> AccountSnapshot | None: ...

    def normalized_email_exists(self, email: str) -> bool: ...

    def create(self, creation: AccountCreation, quota: DeploymentQuotaSnapshot) -> AccountSnapshot: ...

    def create_workspace_member(
        self,
        creation: AccountCreation,
        *,
        workspace_id: str,
        role: TenantAccountRole,
        deployment_quota: DeploymentQuotaSnapshot,
        member_quota: WorkspaceMemberQuotaSnapshot,
    ) -> tuple[AccountSnapshot, WorkspaceMemberWrite]: ...

    def prepare_session(self, account_id: str, preparation: AccountSessionPreparation) -> bool: ...

    def get_credentials(self, account_id: str) -> AccountCredentials | None: ...

    def update_password(self, account_id: str, password: AccountPasswordDigest) -> AccountSnapshot | None: ...

    def set_email(self, account_id: str, email: str) -> None: ...


class AccountLifecyclePolicy(Protocol):
    def is_registration_allowed(self) -> bool: ...

    def quota_snapshot(self) -> DeploymentQuotaSnapshot: ...

    def get_email_freeze_type(self, email: str) -> str | None: ...

    def is_workspace_creation_allowed(self) -> bool: ...

    def validate_timezone(self, timezone: str) -> str: ...

    def try_join_default_workspace(self, account_id: str) -> None: ...


class AccountWorkspaceProvisioner(Protocol):
    def create_account_with_owner_workspace(self, account: AccountCreation) -> AccountSnapshot: ...

    def create_owner_workspace(
        self, account_id: str, *, name: str | None = None, is_setup: bool = False, if_missing: bool = False
    ) -> CreatedWorkspace | None: ...

    def cancel_setup_workspace(self, *, workspace_id: str, owner_id: str) -> None: ...


class AccountService:
    def __init__(
        self,
        *,
        accounts: AccountLifecycleStore,
        policies: AccountLifecyclePolicy,
        passwords: AccountPasswordHasher,
        workspaces: AccountWorkspaceProvisioner,
        sessions: AccountSessionGateway,
        security: ConsoleAuthSecurityGateway,
        now: Callable[[], datetime],
    ) -> None:
        self._accounts = accounts
        self._policies = policies
        self._passwords = passwords
        self._workspaces = workspaces
        self._sessions = sessions
        self._security = security
        self._now = now

    def get_account_by_id(self, account_id: str) -> AccountSnapshot | None:
        return self._accounts.get(account_id)

    def get_account_by_email_with_case_fallback(self, email: str) -> AccountSnapshot | None:
        return self._accounts.find_by_email(email)

    def authenticate(self, email: str, password: str) -> AccountSnapshot:
        account = self.get_account_by_email_with_case_fallback(email)
        if account is None:
            raise AccountNotFoundError()
        if account.status == "banned":
            raise AccountLoginError("Account is banned.")
        credentials = self._accounts.get_credentials(account.id)
        if (
            not credentials
            or not credentials.password_hash
            or not credentials.password_salt
            or not self._passwords.verify(
                password, password_hash=credentials.password_hash, password_salt=credentials.password_salt
            )
        ):
            raise AccountPasswordError("Invalid email or password.")
        return account

    def reset_login_failures(self, email: str) -> None:
        self._security.reset_login_failures(email)

    def reset_password(self, account_id: str, password: str, *, email: str) -> None:
        if self._accounts.update_password(account_id, self._passwords.hash(password)) is None:
            raise AccountNotFoundError()
        self.reset_login_failures(email)

    def set_email(self, account_id: str, email: str) -> None:
        self._accounts.set_email(account_id, email)

    def create_account(
        self,
        email: str,
        name: str,
        interface_language: str,
        password: str | None = None,
        interface_theme: str = "light",
        is_setup: bool = False,
        timezone: str | None = None,
        ip_address: str | None = None,
        check_normalized_email: bool = False,
        *,
        status: str = "active",
        initialized: bool = False,
    ) -> AccountSnapshot:
        creation = self._prepare_creation(
            email=email,
            name=name,
            interface_language=interface_language,
            password=password,
            interface_theme=interface_theme,
            is_setup=is_setup,
            timezone=timezone,
            ip_address=ip_address,
            check_normalized_email=check_normalized_email,
            status=status,
            initialized=initialized,
        )
        quota = self._policies.quota_snapshot()
        return self._accounts.create(creation, quota)

    def _prepare_creation(
        self,
        *,
        email: str,
        name: str,
        interface_language: str,
        password: str | None,
        interface_theme: str,
        is_setup: bool,
        timezone: str | None,
        ip_address: str | None,
        check_normalized_email: bool,
        status: str,
        initialized: bool,
    ) -> AccountCreation:
        if not self._policies.is_registration_allowed() and not is_setup:
            raise AccountNotFoundError("Account registration is disabled.")
        if check_normalized_email and self._accounts.normalized_email_exists(email):
            raise AccountNormalizedEmailAlreadyInUseError("An account with an equivalent email already exists.")
        freeze_type = self._policies.get_email_freeze_type(email)
        if freeze_type == "email_domain_suspended":
            raise AccountEmailDomainSuspendedError()
        if freeze_type:
            raise AccountRegisterError(
                "This email account has been deleted within the past "
                "30 days and is temporarily unavailable for new account registration"
            )
        resolved_timezone = (
            self._policies.validate_timezone(timezone)
            if timezone is not None
            else language_timezone_mapping.get(interface_language, "UTC")
        )
        return AccountCreation(
            email=email,
            name=name,
            interface_language=interface_language,
            interface_theme=interface_theme,
            timezone=resolved_timezone,
            password=self._passwords.hash(password) if password else None,
            ip_address=ip_address,
            check_normalized_email=check_normalized_email,
            status=status,
            initialized_at=self._now() if initialized else None,
        )

    def create_account_and_tenant(
        self,
        email: str,
        name: str,
        interface_language: str,
        password: str | None = None,
        timezone: str | None = None,
        ip_address: str | None = None,
        check_normalized_email: bool = False,
    ) -> AccountSnapshot:
        creation = self._prepare_creation(
            email=email,
            name=name,
            interface_language=interface_language,
            password=password,
            timezone=timezone,
            ip_address=ip_address,
            check_normalized_email=check_normalized_email,
            interface_theme="light",
            is_setup=False,
            status="active",
            initialized=False,
        )
        account = self._workspaces.create_account_with_owner_workspace(creation)
        self._policies.try_join_default_workspace(account.id)
        return account

    def register(
        self,
        email: str,
        name: str,
        password: str | None = None,
        language: str | None = None,
        status: str | None = None,
        is_setup: bool = False,
        create_workspace_required: bool = True,
        timezone: str | None = None,
        ip_address: str | None = None,
        check_normalized_email: bool = True,
    ) -> AccountSnapshot:
        try:
            creation = self._prepare_creation(
                email=email,
                name=name,
                interface_language=get_valid_language(language),
                password=password,
                is_setup=is_setup,
                timezone=timezone,
                ip_address=ip_address,
                check_normalized_email=check_normalized_email,
                status=status or "active",
                initialized=True,
                interface_theme="light",
            )
            if create_workspace_required and self._policies.is_workspace_creation_allowed():
                account = self._workspaces.create_account_with_owner_workspace(creation)
            else:
                account = self._accounts.create(creation, self._policies.quota_snapshot())
            self._policies.try_join_default_workspace(account.id)
            return account
        except WorkSpaceNotAllowedCreateError as exc:
            raise AccountRegisterError("Workspace is not allowed to create.") from exc
        except (SeatsLimitExceededError, AccountRegisterError):
            raise
        except Exception as exc:
            raise AccountRegisterError(f"Registration failed: {exc}") from exc

    def register_workspace_member(
        self,
        *,
        email: str,
        name: str,
        language: str | None,
        status: str,
        is_setup: bool,
        check_normalized_email: bool,
        workspace_id: str,
        role: TenantAccountRole,
        member_quota: WorkspaceMemberQuotaSnapshot,
    ) -> tuple[AccountSnapshot, WorkspaceMemberWrite]:
        """Register a pending invitee and its initial membership atomically."""
        try:
            creation = self._prepare_creation(
                email=email,
                name=name,
                interface_language=get_valid_language(language),
                password=None,
                is_setup=is_setup,
                timezone=None,
                ip_address=None,
                check_normalized_email=check_normalized_email,
                status=status,
                initialized=True,
                interface_theme="light",
            )
            account, membership = self._accounts.create_workspace_member(
                creation,
                workspace_id=workspace_id,
                role=role,
                deployment_quota=self._policies.quota_snapshot(),
                member_quota=member_quota,
            )
            self._policies.try_join_default_workspace(account.id)
            return account, membership
        except (SeatsLimitExceededError, WorkspaceInvitationQuotaError, AccountRegisterError):
            raise
        except Exception as exc:
            raise AccountRegisterError(f"Registration failed: {exc}") from exc

    def login(self, account_id: str, *, ip_address: str) -> AccountSessionTokens:
        prepared = self._accounts.prepare_session(
            account_id,
            AccountSessionPreparation(logged_in_at=self._now(), ip_address=ip_address, activate_pending_account=True),
        )
        if not prepared:
            raise AccountNotFoundError()
        return self._sessions.issue(account_id)


class InstallationStore(Protocol):
    def mark_setup(self) -> None: ...

    def reset_setup(self, *, account_id: str | None) -> None: ...


class InstallationTelemetry(Protocol):
    def report(self) -> None: ...


class AccountSetupProvisioner:
    def __init__(
        self,
        *,
        accounts: AccountService,
        workspaces: AccountWorkspaceProvisioner,
        installation: InstallationStore,
        telemetry: InstallationTelemetry,
    ) -> None:
        self._accounts = accounts
        self._workspaces = workspaces
        self._installation = installation
        self._telemetry = telemetry

    def provision(self, setup: SetupInput) -> None:
        account: AccountSnapshot | None = None
        workspace: CreatedWorkspace | None = None
        try:
            account = self._accounts.create_account(
                email=setup.email,
                name=setup.name,
                interface_language=get_valid_language(setup.language),
                password=setup.password,
                ip_address=setup.ip_address,
                is_setup=True,
                initialized=True,
            )
            workspace = self._workspaces.create_owner_workspace(account.id, is_setup=True, if_missing=True)
            self._installation.mark_setup()
        except Exception as exc:
            if account is not None and workspace is not None:
                self._workspaces.cancel_setup_workspace(workspace_id=workspace.id, owner_id=account.id)
            self._installation.reset_setup(account_id=account.id if account is not None else None)
            raise ValueError(f"Setup failed: {exc}") from exc
        self._telemetry.report()
