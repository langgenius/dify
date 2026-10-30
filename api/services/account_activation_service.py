"""Application service for checking and accepting account invitations."""

import logging
from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Protocol

from services.account_errors import (
    AccountEmailDomainSuspendedError,
    FrozenAccountError,
    InvalidInvitationError,
    InvitationAccountMismatchError,
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
from services.errors.base import PersistenceCommitOutcomeUnknownError
from services.errors.workspace import WorkspaceInvitationQuotaError

_DEFAULT_ROLE = "normal"
_NON_OWNER_ROLES = frozenset({"admin", "editor", "normal", "dataset_operator"})
_PENDING_ACCOUNT_STATUS = "pending"

logger = logging.getLogger(__name__)


class ActivationCommitOutcomeUnknownError(PersistenceCommitOutcomeUnknownError):
    """The activation transaction may have committed before the database connection failed."""


class InvitationTokenStore(Protocol):
    def claim(self, invitation: InvitationLookup, *, require_unused_membership: bool) -> str | None: ...

    def release(self, invitation: InvitationLookup, claim_id: str) -> None: ...

    def complete_activation(self, invitation: InvitationLookup, claim_id: str) -> None: ...

    def complete_membership(self, invitation: InvitationLookup, claim_id: str) -> None: ...

    def is_membership_consumed(self, invitation: InvitationLookup) -> bool: ...

    def find(self, invitation: InvitationLookup) -> InvitationToken | None: ...

    def revoke_subject(self, workspace_id: str, account_id: str) -> None: ...


class AccountActivationRepository(Protocol):
    def resolve(self, invitation: InvitationToken) -> AccountInvitation | None: ...

    def activate(
        self,
        invitation: AccountInvitation,
        *,
        role: str,
        setup: AccountSetup | None,
        create_membership: bool = True,
    ) -> ActivationPersistenceResult | None:
        """Persist and commit activation.

        Raise ``ActivationCommitOutcomeUnknownError`` only when the commit may
        have reached the database. Other exceptions guarantee no commit.
        """
        ...


class WorkspaceInvitePolicy(Protocol):
    def ensure_allowed(self, workspace_id: str) -> None: ...


class WorkspaceInvitationAdmission(Protocol):
    def acquire(self, workspace_id: str) -> AbstractContextManager[object]: ...

    def check_invitation_quota(self, workspace_id: str) -> None: ...


class AccountActivationEligibility(Protocol):
    def get_freeze_type(self, email: str) -> str | None: ...

    def has_account_capacity(self) -> bool: ...


class WorkspaceMembershipCache(Protocol):
    def invalidate(self, workspace_id: str) -> None: ...


class WorkspaceMemberAccessSync(Protocol):
    def sync(self, workspace_id: str, account_id: str) -> None: ...


class AccountActivationService:
    def __init__(
        self,
        *,
        tokens: InvitationTokenStore,
        accounts: AccountActivationRepository,
        workspace_policy: WorkspaceInvitePolicy,
        eligibility: AccountActivationEligibility,
        invitation_admission: WorkspaceInvitationAdmission,
        membership_cache: WorkspaceMembershipCache,
        member_access_sync: WorkspaceMemberAccessSync,
    ) -> None:
        self._tokens = tokens
        self._accounts = accounts
        self._workspace_policy = workspace_policy
        self._eligibility = eligibility
        self._invitation_admission = invitation_admission
        self._membership_cache = membership_cache
        self._member_access_sync = member_access_sync

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
            raise AccountEmailDomainSuspendedError
        if freeze_type:
            raise FrozenAccountError

        setup = self._resolve_setup(invitation, command)
        role = self._membership_role(invitation.role)
        lookup = self._normalized_lookup(command.invitation)
        claim_id = self._tokens.claim(lookup, require_unused_membership=False)
        if claim_id is None:
            raise InvalidInvitationError

        persistence_committed = False
        result: ActivationPersistenceResult | None = None
        try:
            with self._invitation_admission.acquire(invitation.workspace_id):
                current = self._resolve(lookup)
                if current is None or not self._same_invitation(invitation, current):
                    raise InvalidInvitationError

                # A membership restored during sign-in must not be granted again after a later removal.
                membership_consumed = self._tokens.is_membership_consumed(lookup)
                create_membership = not membership_consumed and not current.membership_exists
                if create_membership:
                    self._invitation_admission.check_invitation_quota(current.workspace_id)
                if current.account_status == _PENDING_ACCOUNT_STATUS and setup is not None:
                    if not self._eligibility.has_account_capacity():
                        raise WorkspaceInvitationQuotaError(seats=True)

                result = self._accounts.activate(
                    current,
                    role=role,
                    setup=setup,
                    create_membership=create_membership,
                )
                if result is None:
                    raise InvalidInvitationError
                persistence_committed = True
                self._finalize_committed_acceptance(
                    lookup,
                    claim_id,
                    complete=lambda: self._tokens.complete_activation(lookup, claim_id),
                    workspace_id=invitation.workspace_id,
                    account_id=invitation.account_id,
                )
        except ActivationCommitOutcomeUnknownError:
            raise
        except BaseException:
            if not persistence_committed:
                self._release_claim(lookup, claim_id)
            raise
        assert result is not None

    def ensure_membership(self, *, account_id: str, email: str, token: str) -> bool:
        lookup = InvitationLookup(workspace_id=None, email=email, token=token)
        invitation = self._resolve(lookup)
        if invitation is None or invitation.account_id != account_id:
            return False
        claim_id = self._tokens.claim(lookup, require_unused_membership=True)
        if claim_id is None:
            return False

        persistence_committed = False
        result: ActivationPersistenceResult | None = None
        try:
            with self._invitation_admission.acquire(invitation.workspace_id):
                current = self._resolve(lookup)
                if (
                    current is None
                    or not self._same_invitation(invitation, current)
                    or current.account_id != account_id
                ):
                    self._release_claim(lookup, claim_id)
                    return False
                if not current.membership_exists:
                    self._invitation_admission.check_invitation_quota(current.workspace_id)

                result = self._accounts.activate(
                    current,
                    role=self._membership_role(current.role),
                    setup=None,
                    create_membership=not current.membership_exists,
                )
                if result is None:
                    self._release_claim(lookup, claim_id)
                    return False
                persistence_committed = True
                self._finalize_committed_acceptance(
                    lookup,
                    claim_id,
                    complete=lambda: self._tokens.complete_membership(lookup, claim_id),
                    workspace_id=invitation.workspace_id,
                    account_id=invitation.account_id,
                )
        except ActivationCommitOutcomeUnknownError:
            raise
        except BaseException:
            if not persistence_committed:
                self._release_claim(lookup, claim_id)
            raise
        assert result is not None
        return True

    def _finalize_committed_acceptance(
        self,
        invitation: InvitationLookup,
        claim_id: str,
        *,
        complete: Callable[[], None],
        workspace_id: str,
        account_id: str,
    ) -> None:
        errors: list[Exception] = []
        try:
            self._membership_cache.invalidate(workspace_id)
        except Exception as error:
            logger.exception(
                "Failed to invalidate membership cache after invitation acceptance: workspace_id=%s",
                workspace_id,
            )
            errors.append(error)
        try:
            self._member_access_sync.sync(workspace_id, account_id)
        except Exception as error:
            logger.exception(
                "Failed to synchronize member access after invitation acceptance: workspace_id=%s, account_id=%s",
                workspace_id,
                account_id,
            )
            errors.append(error)
        if errors:
            self._release_claim(invitation, claim_id)
            raise errors[0]
        try:
            complete()
        except Exception:
            logger.exception(
                "Failed to finalize committed invitation acceptance: workspace_id=%s, account_id=%s",
                workspace_id,
                account_id,
            )
            self._release_claim(invitation, claim_id)
            raise

    def _release_claim(self, invitation: InvitationLookup, claim_id: str) -> None:
        try:
            self._tokens.release(invitation, claim_id)
        except Exception:
            logger.exception("Failed to release invitation acceptance claim")

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
    def _normalized_lookup(invitation: InvitationLookup) -> InvitationLookup:
        return InvitationLookup(
            workspace_id=invitation.workspace_id,
            email=invitation.email.lower() if invitation.email else None,
            token=invitation.token,
        )

    @staticmethod
    def _same_invitation(expected: AccountInvitation, current: AccountInvitation) -> bool:
        return current.account_id == expected.account_id and current.workspace_id == expected.workspace_id

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
