"""Application service for checking and accepting account invitations."""

from contextlib import AbstractContextManager
from typing import Protocol

from services.account_errors import (
    AccountEmailDomainSuspendedError,
    FrozenAccountError,
    InvalidInvitationError,
    InvitationAccountMismatchError,
    InvitationWorkspaceFullError,
)
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
    def is_membership_consumed(self, invitation: InvitationLookup) -> bool: ...

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
        create_membership: bool = True,
    ) -> ActivationPersistenceResult | None: ...


class WorkspaceInvitePolicy(Protocol):
    def ensure_allowed(self, workspace_id: str) -> None: ...


class AccountActivationEligibility(Protocol):
    def get_freeze_type(self, email: str) -> str | None: ...


class WorkspaceMembershipCache(Protocol):
    def invalidate(self, workspace_id: str) -> None: ...


class WorkspaceMemberAccessSync(Protocol):
    def sync(self, workspace_id: str, account_id: str) -> None: ...


class WorkspaceMemberCapacity(Protocol):
    def acquire(self, workspace_id: str) -> AbstractContextManager[object]: ...

    def can_join(self, workspace_id: str, account_id: str) -> bool: ...


class AccountActivationService:
    def __init__(
        self,
        *,
        tokens: InvitationTokenStore,
        accounts: AccountActivationRepository,
        workspace_policy: WorkspaceInvitePolicy,
        eligibility: AccountActivationEligibility,
        membership_cache: WorkspaceMembershipCache,
        member_access_sync: WorkspaceMemberAccessSync,
        capacity: WorkspaceMemberCapacity,
    ) -> None:
        self._tokens = tokens
        self._accounts = accounts
        self._workspace_policy = workspace_policy
        self._eligibility = eligibility
        self._membership_cache = membership_cache
        self._member_access_sync = member_access_sync
        self._capacity = capacity

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
        """Accept an invitation, creating the membership when the workspace still has room.

        On success the membership exists and is the account's current workspace, then the link
        is retired. A failed write leaves the link valid for a retry.

        Raises:
            InvalidInvitationError: The invitation is missing, stale, or lacks setup data.
            InvitationAccountMismatchError: The session belongs to another account.
            AccountEmailDomainSuspendedError: The email domain is suspended.
            FrozenAccountError: The email is frozen after a recent deletion.
            InvitationWorkspaceFullError: The workspace reached its member limit; the link stays valid.

        The link is resolved again under the workspace lock, so a link revoked or replaced by a
        resend after the first read never grants membership.
        """
        invitation = self._resolve(command.invitation)
        if invitation is None:
            raise InvalidInvitationError

        if authenticated_account_id is not None and authenticated_account_id != invitation.account_id:
            raise InvitationAccountMismatchError

        freeze_type = self._eligibility.get_freeze_type(invitation.account_email)
        if freeze_type == "email_domain_suspended":
            raise AccountEmailDomainSuspendedError
        if freeze_type:
            raise FrozenAccountError

        setup = self._resolve_setup(invitation, command)
        role = self._membership_role(invitation.role)
        # An invitation that already restored membership at sign-in must not grant it again after removal.
        membership_consumed = self._tokens.is_membership_consumed(command.invitation)

        normalized_email = command.invitation.email.lower() if command.invitation.email else None
        with self._capacity.acquire(invitation.workspace_id):
            if self._resolve(command.invitation) != invitation:
                raise InvalidInvitationError
            if not membership_consumed and not self._capacity.can_join(invitation.workspace_id, invitation.account_id):
                raise InvitationWorkspaceFullError
            result = self._accounts.activate(
                invitation, role=role, setup=setup, create_membership=not membership_consumed
            )
            if result is None:
                raise InvalidInvitationError
            self._tokens.revoke(
                InvitationLookup(
                    workspace_id=command.invitation.workspace_id,
                    email=normalized_email,
                    token=command.invitation.token,
                )
            )
        if result.membership_created:
            self._membership_cache.invalidate(invitation.workspace_id)
        self._member_access_sync.sync(invitation.workspace_id, invitation.account_id)

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
    def _membership_role(role: str | None) -> str:
        if role is not None and role in _NON_OWNER_ROLES:
            return role
        return _DEFAULT_ROLE

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
