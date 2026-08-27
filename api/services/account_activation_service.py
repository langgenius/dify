"""Application service for checking and accepting account invitations."""

from typing import Protocol

from services.entities.account_activation_entities import (
    AccountInvitation,
    AccountSetup,
    ActivationCheckData,
    ActivationCheckResult,
    ActivationCommand,
    ActivationPersistenceResult,
    InvitationLookup,
    InvitationToken,
)

_DEFAULT_ROLE = "normal"
_NON_OWNER_ROLES = frozenset({"admin", "editor", "normal", "dataset_operator"})
_PENDING_ACCOUNT_STATUS = "pending"


class InvitationTokenStore(Protocol):
    def find(self, invitation: InvitationLookup) -> InvitationToken | None: ...

    def revoke(self, invitation: InvitationLookup) -> None: ...


class AccountActivationRepository(Protocol):
    def resolve(self, invitation: InvitationToken) -> AccountInvitation | None: ...

    def activate(
        self,
        invitation: AccountInvitation,
        *,
        role: str,
        setup: AccountSetup | None,
    ) -> ActivationPersistenceResult | None: ...


class WorkspaceInvitePolicy(Protocol):
    def ensure_allowed(self, workspace_id: str) -> None: ...


class AccountActivationEligibility(Protocol):
    def get_freeze_type(self, email: str) -> str | None: ...


class WorkspaceMembershipCache(Protocol):
    def invalidate(self, workspace_id: str) -> None: ...


class InvalidInvitationError(Exception):
    """The invitation is invalid, stale, or missing required activation data."""


class InvitationAccountMismatchError(Exception):
    """An authenticated account attempted to consume another account's invitation."""


class FrozenAccountError(Exception):
    """The invited account is temporarily ineligible for activation."""


class EmailDomainSuspendedError(Exception):
    """The invited account uses a suspended email domain."""


class AccountActivationService:
    def __init__(
        self,
        *,
        tokens: InvitationTokenStore,
        accounts: AccountActivationRepository,
        workspace_policy: WorkspaceInvitePolicy,
        eligibility: AccountActivationEligibility,
        membership_cache: WorkspaceMembershipCache,
    ) -> None:
        self._tokens = tokens
        self._accounts = accounts
        self._workspace_policy = workspace_policy
        self._eligibility = eligibility
        self._membership_cache = membership_cache

    def check(self, invitation: InvitationLookup) -> ActivationCheckResult:
        resolved = self._resolve(invitation)
        if resolved is None:
            return ActivationCheckResult(is_valid=False)

        self._workspace_policy.ensure_allowed(resolved.workspace_id)
        return ActivationCheckResult(
            is_valid=True,
            data=ActivationCheckData(
                workspace_name=resolved.workspace_name,
                workspace_id=resolved.workspace_id,
                email=resolved.account_email,
                account_status=resolved.account_status,
                requires_setup=self._requires_setup(resolved),
            ),
        )

    def activate(self, command: ActivationCommand, *, authenticated_account_id: str | None) -> None:
        invitation = self._resolve(command.invitation)
        if invitation is None:
            raise InvalidInvitationError

        if authenticated_account_id is not None and authenticated_account_id != invitation.account_id:
            raise InvitationAccountMismatchError

        freeze_type = self._eligibility.get_freeze_type(invitation.account_email)
        if freeze_type == "email_domain_suspended":
            raise EmailDomainSuspendedError
        if freeze_type:
            raise FrozenAccountError

        setup = self._resolve_setup(invitation, command)
        raw_role = invitation.role
        role = raw_role if raw_role is not None and raw_role in _NON_OWNER_ROLES else _DEFAULT_ROLE

        normalized_email = command.invitation.email.lower() if command.invitation.email else None
        self._tokens.revoke(
            InvitationLookup(
                workspace_id=command.invitation.workspace_id,
                email=normalized_email,
                token=command.invitation.token,
            )
        )
        result = self._accounts.activate(invitation, role=role, setup=setup)
        if result is None:
            raise InvalidInvitationError
        if result.membership_created:
            self._membership_cache.invalidate(invitation.workspace_id)

    def _resolve(self, invitation: InvitationLookup) -> AccountInvitation | None:
        token = self._tokens.find(invitation)
        resolved = self._accounts.resolve(token) if token is not None else None
        if resolved is not None:
            return resolved

        if invitation.email is None or invitation.email == invitation.email.lower():
            return None

        token = self._tokens.find(
            InvitationLookup(
                workspace_id=invitation.workspace_id,
                email=invitation.email.lower(),
                token=invitation.token,
            )
        )
        if token is None:
            return None
        return self._accounts.resolve(token)

    @staticmethod
    def _requires_setup(invitation: AccountInvitation) -> bool:
        if invitation.requires_setup is not None:
            return invitation.requires_setup
        return invitation.account_status == _PENDING_ACCOUNT_STATUS

    @classmethod
    def _resolve_setup(cls, invitation: AccountInvitation, command: ActivationCommand) -> AccountSetup | None:
        if not cls._requires_setup(invitation):
            return None
        if not command.name or not command.interface_language or not command.timezone:
            raise InvalidInvitationError
        return AccountSetup(
            name=command.name,
            interface_language=command.interface_language,
            timezone=command.timezone,
        )
