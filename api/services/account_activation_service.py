"""Application service for checking and accepting account invitations."""

from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Protocol

from services.entities.account_activation_entities import (
    AccountInvitation,
    AccountSetup,
    ActivationCheckData,
    ActivationCheckResult,
    ActivationCommand,
    InvitationLookup,
    InvitationToken,
)

_DEFAULT_ROLE = "normal"
_NON_OWNER_ROLES = frozenset({"admin", "editor", "normal", "dataset_operator"})
_PENDING_ACCOUNT_STATUS = "pending"
_ACTIVATABLE_ACCOUNT_STATUSES = frozenset({_PENDING_ACCOUNT_STATUS, "active"})

InvitationMembershipAssigner = Callable[[AccountInvitation, str], AbstractContextManager[str]]


class InvitationTokenStore(Protocol):
    def find(self, invitation: InvitationLookup) -> InvitationToken | None: ...

    def revoke(self, token: str) -> None: ...


class AccountActivationRepository(Protocol):
    def resolve(self, invitation: InvitationToken) -> AccountInvitation | None: ...

    def activate(
        self,
        invitation: AccountInvitation,
        *,
        setup: AccountSetup | None,
        membership_role: str,
    ) -> bool: ...


class WorkspaceInvitePolicy(Protocol):
    def ensure_allowed(self, workspace_id: str) -> None: ...


class AccountActivationEligibility(Protocol):
    def is_frozen(self, email: str) -> bool: ...


class InvalidInvitationError(Exception):
    """The invitation is invalid, stale, or missing required activation data."""


class InvitationAccountMismatchError(Exception):
    """An authenticated account attempted to consume another account's invitation."""


class FrozenAccountError(Exception):
    """The invited account is temporarily ineligible for activation."""


class AccountActivationService:
    def __init__(
        self,
        *,
        tokens: InvitationTokenStore,
        accounts: AccountActivationRepository,
        workspace_policy: WorkspaceInvitePolicy,
        eligibility: AccountActivationEligibility,
        membership_assigner: InvitationMembershipAssigner,
    ) -> None:
        self._tokens = tokens
        self._accounts = accounts
        self._workspace_policy = workspace_policy
        self._eligibility = eligibility
        self._membership_assigner = membership_assigner

    def check(self, invitation: InvitationLookup) -> ActivationCheckResult:
        resolved = self._resolve(invitation)
        if resolved is None or resolved.account_status not in _ACTIVATABLE_ACCOUNT_STATUSES:
            return ActivationCheckResult(is_valid=False)

        self._workspace_policy.ensure_allowed(resolved.workspace_id)
        return ActivationCheckResult(
            is_valid=True,
            data=ActivationCheckData(
                workspace_name=resolved.workspace_name,
                workspace_id=resolved.workspace_id,
                email=resolved.account_email,
                account_status=resolved.account_status,
                requires_setup=resolved.account_status == _PENDING_ACCOUNT_STATUS,
            ),
        )

    def activate(self, command: ActivationCommand, *, authenticated_account_id: str | None) -> None:
        invitation = self._resolve(command.invitation)
        if invitation is None:
            raise InvalidInvitationError

        if authenticated_account_id is not None and authenticated_account_id != invitation.account_id:
            raise InvitationAccountMismatchError

        if invitation.account_status not in _ACTIVATABLE_ACCOUNT_STATUSES:
            raise InvalidInvitationError

        self._workspace_policy.ensure_allowed(invitation.workspace_id)

        if self._eligibility.is_frozen(invitation.account_email):
            raise FrozenAccountError

        setup = self._resolve_setup(invitation, command)
        role = invitation.role if invitation.role in _NON_OWNER_ROLES else _DEFAULT_ROLE

        with self._membership_assigner(invitation, role) as membership_role:
            activated = self._accounts.activate(
                invitation,
                setup=setup,
                membership_role=membership_role,
            )
            if not activated:
                raise InvalidInvitationError

        self._tokens.revoke(command.invitation.token)

    def _resolve(self, invitation: InvitationLookup) -> AccountInvitation | None:
        token = self._tokens.find(invitation)
        return self._accounts.resolve(token) if token is not None else None

    @staticmethod
    def _resolve_setup(invitation: AccountInvitation, command: ActivationCommand) -> AccountSetup | None:
        if invitation.account_status != _PENDING_ACCOUNT_STATUS:
            return None
        if not command.name or not command.interface_language or not command.timezone:
            raise InvalidInvitationError
        return AccountSetup(
            name=command.name,
            interface_language=command.interface_language,
            timezone=command.timezone,
        )
