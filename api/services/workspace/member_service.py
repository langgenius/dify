"""Workspace membership, invitation and ownership use cases with application-owned ports."""

from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager
from typing import Protocol

from enums.account import TenantAccountRole
from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError
from services.account_ports import AccountSnapshotQuery
from services.entities.account_activation_entities import InvitationToken, PendingWorkspaceInvitation
from services.entities.account_entities import AccountSnapshot
from services.errors.base import NoPermissionError
from services.errors.workspace import (
    AccountAlreadyInTenantError,
    CannotOperateSelfError,
    InvalidActionError,
    InvalidOwnerTransferCodeError,
    InvalidOwnerTransferEmailError,
    InvalidOwnerTransferTokenError,
    InvalidWorkspaceMemberRoleError,
    MemberNotInTenantError,
    OwnerTransferSendIPLimitedError,
    OwnerTransferVerificationLimitError,
    PendingInvitationNotFoundError,
    RoleAlreadyAssignedError,
    WorkspaceAlreadyHasOwnerError,
    WorkspaceNotFoundError,
)
from services.workspace.contracts import (
    OwnerTransferToken,
    WorkspaceInvitation,
    WorkspaceInvitationResult,
    WorkspaceMemberPage,
    WorkspaceMemberRecord,
    WorkspaceMemberRemoval,
    WorkspaceMemberRole,
    WorkspaceMemberRoleSubject,
    WorkspaceMembership,
    WorkspaceMemberSummary,
    WorkspaceMemberWrite,
    WorkspaceSnapshot,
)


class WorkspaceMemberQuery(Protocol):
    def list_for_workspace(
        self, workspace_id: str, *, role: TenantAccountRole | None = None
    ) -> Sequence[WorkspaceMemberRecord]: ...


class WorkspaceMemberRoleResolver(Protocol):
    def resolve_many(
        self,
        workspace_id: str,
        actor_account_id: str,
        subjects: Sequence[WorkspaceMemberRoleSubject],
        *,
        language: str | None = None,
    ) -> Mapping[str, Sequence[WorkspaceMemberRole]]: ...


class WorkspaceMemberQueryService:
    def __init__(
        self,
        *,
        members: WorkspaceMemberQuery,
        roles: WorkspaceMemberRoleResolver,
    ) -> None:
        self._members = members
        self._roles = roles

    def list_members(
        self, workspace_id: str, *, dataset_operators_only: bool = False
    ) -> tuple[WorkspaceMemberRecord, ...]:
        role = TenantAccountRole.DATASET_OPERATOR if dataset_operators_only else None
        return tuple(self._members.list_for_workspace(workspace_id, role=role))

    def list_page(self, context: RequestContext, *, page: int, limit: int) -> WorkspaceMemberPage:
        records = self.list_members(context.active_workspace_id)
        start = (page - 1) * limit
        return WorkspaceMemberPage(members=records[start : start + limit], total=len(records))

    def list_current(
        self, context: RequestContext, *, language: str | None = None
    ) -> tuple[WorkspaceMemberSummary, ...]:
        workspace_id = context.active_workspace_id

        records = tuple(self._members.list_for_workspace(workspace_id))
        role_subjects = tuple(
            WorkspaceMemberRoleSubject(account_id=record.id, legacy_role=record.legacy_role) for record in records
        )

        # The repository closes its read Session before role resolution
        # performs enterprise I/O.
        roles_by_member = self._roles.resolve_many(workspace_id, context.account_id, role_subjects, language=language)

        return tuple(
            WorkspaceMemberSummary(
                id=record.id,
                name=record.name,
                email=record.email,
                avatar=record.avatar,
                last_login_at=record.last_login_at,
                last_active_at=record.last_active_at,
                created_at=record.created_at,
                role=record.legacy_role,
                roles=tuple(roles_by_member.get(record.id, ())),
                status=record.status,
            )
            for record in records
        )


class WorkspaceMemberStore(Protocol):
    def get(self, workspace_id: str) -> WorkspaceSnapshot | None: ...

    def member_role(self, workspace_id: str, account_id: str | None) -> TenantAccountRole | None: ...

    def owner_id(self, workspace_id: str) -> str | None: ...

    def upsert_member(
        self,
        *,
        workspace_id: str,
        account_id: str,
        role: TenantAccountRole,
        actor_account_id: str | None = None,
    ) -> WorkspaceMemberWrite: ...

    def remove_member(
        self,
        *,
        workspace_id: str,
        account_id: str,
        owner_id: str,
        actor_account_id: str,
    ) -> WorkspaceMemberRemoval: ...

    def update_member_role(
        self,
        *,
        workspace_id: str,
        account_id: str,
        role: TenantAccountRole,
        actor_account_id: str,
        previous_owner_account_ids: Sequence[str] = (),
    ) -> None: ...


class WorkspaceMemberAccessGateway(Protocol):
    @property
    def rbac_enabled(self) -> bool: ...

    def ensure_role_enabled(self, role: str) -> None: ...

    def permission_keys(self, workspace_id: str, actor_id: str) -> set[str]: ...

    def is_owner(self, workspace_id: str, actor_id: str, member_id: str) -> bool: ...

    def owner_id(self, workspace_id: str, actor_id: str) -> str: ...

    def assign_role(self, workspace_id: str, actor_id: str, member_id: str, role_id: str) -> None: ...

    def change_role(self, workspace_id: str, actor_id: str, member_id: str, role: TenantAccountRole) -> None: ...

    def transfer_owner(self, workspace_id: str, actor_id: str, member_id: str) -> None: ...

    def membership_changed(self, membership: WorkspaceMemberWrite, operator_account_id: str | None) -> None: ...

    def member_removed(self, workspace_id: str, removal: WorkspaceMemberRemoval) -> None: ...


class WorkspaceInvitationLinks(Protocol):
    def acquire(self, workspace_id: str) -> AbstractContextManager[object]: ...

    def revoke_pending(
        self, workspace_id: str, email: str, *, account_id: str | None, keep_token: str | None
    ) -> None: ...


class WorkspaceMemberService:
    def __init__(
        self,
        *,
        workspaces: WorkspaceMemberStore,
        accounts: AccountSnapshotQuery,
        access: WorkspaceMemberAccessGateway,
        invitation_links: WorkspaceInvitationLinks,
    ) -> None:
        self._workspaces = workspaces
        self._accounts = accounts
        self._access = access
        self._invitation_links = invitation_links

    @property
    def rbac_enabled(self) -> bool:
        return self._access.rbac_enabled

    def get_role(self, workspace_id: str, account_id: str | None) -> TenantAccountRole | None:
        return self._workspaces.member_role(workspace_id, account_id)

    def check_permission(self, workspace_id: str, operator_id: str, member_id: str | None, action: str) -> None:
        if action not in {"add", "remove", "update"}:
            raise InvalidActionError("Invalid action.")
        if member_id == operator_id:
            raise CannotOperateSelfError("Cannot operate self.")
        if self._access.rbac_enabled:
            permission = "workspace.member.manage" if action in {"add", "remove"} else "workspace.role.manage"
            if permission not in self._access.permission_keys(workspace_id, operator_id):
                raise NoPermissionError(f"No permission to {action} member.")
            if action == "remove" and member_id and self._access.is_owner(workspace_id, operator_id, member_id):
                raise NoPermissionError(f"No permission to {action} member.")
            return
        role = self.get_role(workspace_id, operator_id)
        if role not in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN}:
            raise NoPermissionError(f"No permission to {action} member.")
        if (
            action == "remove"
            and role == TenantAccountRole.ADMIN
            and member_id
            and self.get_role(workspace_id, member_id) == TenantAccountRole.OWNER
        ):
            raise NoPermissionError(f"No permission to {action} member.")

    def join_member(
        self,
        *,
        workspace_id: str,
        account_id: str,
        email: str,
        role: TenantAccountRole,
        operator_account_id: str | None,
    ) -> WorkspaceMembership:
        """Add or update a member and synchronize their workspace access.

        Raises:
            WorkspaceNotFoundError: The workspace is missing or is not active.
            AccountNotFoundError: The account is missing or its email does not match.
            WorkspaceAlreadyHasOwnerError: An owner is requested but the workspace
                already has one.
        """
        workspace = self._workspaces.get(workspace_id)
        if workspace is None or workspace.status != "normal":
            raise WorkspaceNotFoundError()
        account = self._accounts.get(account_id)
        if account is None or account.email != email:
            raise AccountNotFoundError()
        if role == TenantAccountRole.OWNER and self._workspaces.owner_id(workspace_id) is not None:
            raise WorkspaceAlreadyHasOwnerError("Tenant already has an owner.")
        membership = self._workspaces.upsert_member(
            workspace_id=workspace_id,
            account_id=account_id,
            role=role,
            actor_account_id=operator_account_id,
        )
        self._access.membership_changed(membership, operator_account_id)
        return WorkspaceMembership(workspace_id, account_id, role.value)

    def assign_role(self, workspace_id: str, operator_id: str, member_id: str, role_id: str) -> None:
        self._access.assign_role(workspace_id, operator_id, member_id, role_id)

    def remove(self, workspace_id: str, account_id: str, operator_id: str) -> None:
        """Remove a member under the workspace invitation lock; see ``remove_locked``."""
        with self._invitation_links.acquire(workspace_id):
            self.remove_locked(workspace_id, account_id, operator_id)

    def remove_locked(self, workspace_id: str, account_id: str, operator_id: str) -> None:
        """Remove a member while the caller holds the workspace invitation lock.

        Postconditions on success: the membership is gone, the member's resources belong to the
        workspace owner, and no invitation link for the account in this workspace is accepted.
        The account and its invitations to other workspaces are kept.

        Raises:
            AccountNotFoundError: The member account does not exist.
            CannotOperateSelfError: The operator tries to remove themselves.
            NoPermissionError: The operator cannot remove the member.
            MemberNotInTenantError: The account is not a member of the workspace.
            ValueError: The workspace has no owner to receive the member's resources.
        """
        account = self._accounts.get(account_id)
        if account is None:
            raise AccountNotFoundError()
        self.check_permission(workspace_id, operator_id, account_id, "remove")
        if self.get_role(workspace_id, account_id) is None:
            raise MemberNotInTenantError("Member not in tenant.")
        owner_id = (
            self._access.owner_id(workspace_id, operator_id)
            if self._access.rbac_enabled
            else self._workspaces.owner_id(workspace_id)
        )
        if owner_id is None:
            raise ValueError(f"Workspace owner not found for tenant {workspace_id}.")
        self._invitation_links.revoke_pending(workspace_id, account.email, account_id=account_id, keep_token=None)
        removal = self._workspaces.remove_member(
            workspace_id=workspace_id,
            account_id=account_id,
            owner_id=owner_id,
            actor_account_id=operator_id,
        )
        self._access.member_removed(workspace_id, removal)

    def update_role(self, workspace_id: str, member_id: str, new_role: str, operator_id: str) -> None:
        if not TenantAccountRole.is_valid_role(new_role):
            raise InvalidWorkspaceMemberRoleError()
        self._access.ensure_role_enabled(new_role)
        if self._accounts.get(member_id) is None:
            raise AccountNotFoundError()
        self.check_permission(workspace_id, operator_id, member_id, "update")
        role = TenantAccountRole(new_role)
        previous = self.get_role(workspace_id, member_id)
        if previous is None:
            raise MemberNotInTenantError("Member not in tenant.")
        # RBAC ownership can be ahead of local membership after a failed local commit.
        if previous == TenantAccountRole.OWNER or (
            self._access.rbac_enabled and self._access.is_owner(workspace_id, operator_id, member_id)
        ):
            raise NoPermissionError("No permission to update member.")
        if role == TenantAccountRole.OWNER and (
            self.get_role(workspace_id, operator_id) != TenantAccountRole.OWNER
            or (self._access.rbac_enabled and not self._access.is_owner(workspace_id, operator_id, operator_id))
        ):
            raise NoPermissionError("No permission to update member.")
        if previous == role:
            raise RoleAlreadyAssignedError("The provided role is already assigned to the member.")
        previous_owner_account_ids: tuple[str, ...] = ()
        if self._access.rbac_enabled:
            if role == TenantAccountRole.OWNER:
                previous_owner_account_ids = (self._access.owner_id(workspace_id, operator_id),)
                self._access.transfer_owner(workspace_id, operator_id, member_id)
            else:
                self._access.change_role(workspace_id, operator_id, member_id, role)
        self._workspaces.update_member_role(
            workspace_id=workspace_id,
            account_id=member_id,
            role=role,
            actor_account_id=operator_id,
            previous_owner_account_ids=previous_owner_account_ids,
        )


class InvitedAccountRegistration(Protocol):
    def get_account_by_id(self, account_id: str) -> AccountSnapshot | None: ...

    def get_account_by_email_with_case_fallback(self, email: str) -> AccountSnapshot | None: ...

    def register(
        self,
        email: str,
        name: str,
        *,
        language: str | None,
        status: str,
        is_setup: bool,
        check_normalized_email: bool,
    ) -> AccountSnapshot: ...


class InvitationWorkspaceStore(Protocol):
    def get(self, workspace_id: str) -> WorkspaceSnapshot | None: ...

    def switch(self, *, account_id: str, workspace_id: str) -> WorkspaceSnapshot: ...

    def count_members(self, workspace_id: str) -> int: ...

    def nonmember_emails(self, workspace_id: str, account_ids: Sequence[str]) -> Mapping[str, str]: ...


class WorkspaceInvitationDelivery(Protocol):
    @property
    def requires_capacity_check(self) -> bool: ...

    def acquire(self, workspace_id: str) -> AbstractContextManager[object]: ...

    def ensure_role_enabled(self, role: str) -> None: ...

    def check_capacity(
        self,
        workspace_id: str,
        *,
        current_members: int,
        pending_invitations: int,
        new_members: int,
        new_accounts: int,
    ) -> None: ...

    def ensure_allowed(self, workspace_id: str) -> None: ...

    def check_invitation_quota(self, workspace_id: str) -> None: ...

    def create(self, invitation: InvitationToken) -> str: ...

    def list_pending(self, workspace_id: str) -> tuple[PendingWorkspaceInvitation, ...]: ...

    def revoke_pending(
        self, workspace_id: str, email: str, *, account_id: str | None, keep_token: str | None
    ) -> None: ...

    def discard(self, workspace_id: str, token: str) -> None: ...

    def send(self, *, language: str, email: str, token: str, inviter_name: str, workspace_name: str) -> None: ...


class WorkspaceInvitationService:
    """Workspace invitations without RBAC are records of their own.

    Invariants:
    - Inviting never creates a membership; accepting the link does.
    - Every issued link is indexed under its workspace, so live invitations can be listed,
      counted against the member limit and revoked.
    - Each email has at most one live link per workspace; issuing a new one revokes the rest.
    - Admission, issuing and revocation for a workspace run under that workspace's lock.
    """

    def __init__(
        self,
        *,
        accounts: InvitedAccountRegistration,
        workspaces: InvitationWorkspaceStore,
        members: WorkspaceMemberService,
        invitations: WorkspaceInvitationDelivery,
    ) -> None:
        self._accounts = accounts
        self._workspaces = workspaces
        self._members = members
        self._invitations = invitations

    def check_invitation_quota(self, context: RequestContext) -> None:
        self._invitations.check_invitation_quota(context.active_workspace_id)

    def list_pending(self, context: RequestContext) -> tuple[PendingWorkspaceInvitation, ...]:
        """Return live invitations to non-members of the caller's workspace, subject to member management permission."""
        workspace_id = context.active_workspace_id
        self._members.check_permission(workspace_id, context.account_id, None, "add")
        return self._live_pending(workspace_id)

    def revoke_pending(self, context: RequestContext, email: str) -> None:
        """Withdraw the invitation for an email, releasing the seat it reserved.

        Covers both live invitation links and legacy invitees who joined as pending members
        before invitations became their own records. Active members are never removed.

        Postconditions on success: no link for the email is accepted in this workspace, and an
        account with status ``pending`` for the email is no longer a member of it.

        Raises:
            NoPermissionError: The caller cannot manage workspace members.
            PendingInvitationNotFoundError: The email has neither a live link nor a pending membership.
        """
        workspace_id = context.active_workspace_id
        self._members.check_permission(workspace_id, context.account_id, None, "remove")
        normalized_email = email.lower()
        with self._invitations.acquire(workspace_id):
            has_live_link = any(item.email.lower() == normalized_email for item in self._live_pending(workspace_id))
            account = self._accounts.get_account_by_email_with_case_fallback(normalized_email)
            pending_member = (
                account is not None
                and account.status == "pending"
                and self._members.get_role(workspace_id, account.id) not in {None, TenantAccountRole.OWNER}
            )
            if not has_live_link and not pending_member:
                raise PendingInvitationNotFoundError()
            if pending_member and account is not None:
                self._members.remove_locked(workspace_id, account.id, context.account_id)
            else:
                self._invitations.revoke_pending(
                    workspace_id,
                    normalized_email,
                    account_id=account.id if account is not None else None,
                    keep_token=None,
                )

    def _live_pending(self, workspace_id: str) -> tuple[PendingWorkspaceInvitation, ...]:
        pending = self._invitations.list_pending(workspace_id)
        if not pending:
            return ()
        current_emails = self._workspaces.nonmember_emails(workspace_id, [item.account_id for item in pending])
        return tuple(item for item in pending if current_emails.get(item.account_id) == item.email)

    def _admit(self, workspace_id: str, emails: Sequence[str]) -> None:
        """Reject a batch that would exceed the member limit; the caller holds the workspace lock.

        Seats in use are joined members plus live invitations. Re-inviting an email with a live
        invitation takes no new seat, so a batch of only resends is always admitted.

        Raises:
            WorkspaceInvitationQuotaError: The batch does not fit the member or seat limit.
        """
        if not self._invitations.requires_capacity_check:
            return
        pending = self._live_pending(workspace_id)
        pending_emails = {item.email.lower() for item in pending}
        new_members, new_accounts = 0, 0
        for email in emails:
            account = self._accounts.get_account_by_email_with_case_fallback(email)
            if account is None:
                new_accounts += 1
                new_members += 1
            elif (
                account.email.lower() not in pending_emails and self._members.get_role(workspace_id, account.id) is None
            ):
                new_members += 1
        if new_members:
            self._invitations.check_capacity(
                workspace_id,
                current_members=self._workspaces.count_members(workspace_id),
                pending_invitations=len(pending),
                new_members=new_members,
                new_accounts=new_accounts,
            )

    def invite_many(
        self, context: RequestContext, *, emails: Sequence[str], language: str | None, role: str
    ) -> tuple[WorkspaceInvitationResult, ...]:
        """Invite a batch under the workspace lock, reporting each email's outcome.

        Raises:
            InvalidWorkspaceMemberRoleError: The role cannot be invited.
            NoPermissionError: Workspace policy forbids invitations.
            WorkspaceInvitationQuotaError: The batch does not fit; nothing is issued.
        """
        if not self._members.rbac_enabled and (not TenantAccountRole.is_valid_role(role) or role == "owner"):
            raise InvalidWorkspaceMemberRoleError()
        self._invitations.ensure_role_enabled(role)
        workspace_id = context.active_workspace_id
        self._invitations.ensure_allowed(workspace_id)
        results: list[WorkspaceInvitationResult] = []
        with self._invitations.acquire(workspace_id):
            self._admit(workspace_id, emails)
            for email in emails:
                try:
                    invitation = self._invite(context, email, language, role)
                    results.append(WorkspaceInvitationResult(email, "success", token=invitation.token))
                except AccountAlreadyInTenantError:
                    results.append(
                        WorkspaceInvitationResult(email, "already_member", message="Account already in workspace.")
                    )
                except Exception as error:
                    results.append(WorkspaceInvitationResult(email, "failed", message=str(error)))
        return tuple(results)

    def invite(
        self,
        context: RequestContext,
        email: str,
        language: str | None,
        role: str = "normal",
    ) -> WorkspaceInvitation:
        """Invite one email with the same locked, invitation-aware admission as a batch.

        Raises:
            WorkspaceInvitationQuotaError: The invitation does not fit the member or seat limit.
            AccountAlreadyInTenantError: The account is already a member.
        """
        workspace_id = context.active_workspace_id
        with self._invitations.acquire(workspace_id):
            self._admit(workspace_id, (email,))
            return self._invite(context, email, language, role)

    def _invite(
        self,
        context: RequestContext,
        email: str,
        language: str | None,
        role: str,
    ) -> WorkspaceInvitation:
        """Issue one invitation; the caller holds the workspace lock and has admitted the email.

        Postconditions on success: exactly one indexed link is live for the email in this
        workspace and its mail is enqueued. When the new link cannot be issued or its mail cannot
        be enqueued, the new link is gone, earlier links stay valid, and the error propagates.
        """
        workspace_id = context.active_workspace_id
        inviter_id = context.account_id
        inviter = self._accounts.get_account_by_id(inviter_id)
        workspace = self._workspaces.get(workspace_id)
        if inviter is None:
            raise ValueError("Inviter is required")
        if workspace is None:
            raise WorkspaceNotFoundError()
        self._invitations.ensure_allowed(workspace_id)
        normalized_email = email.lower()
        join_role = TenantAccountRole.NORMAL if self._members.rbac_enabled else TenantAccountRole(role)
        account = self._accounts.get_account_by_email_with_case_fallback(email)
        rbac_enabled = self._members.rbac_enabled
        requires_setup = False
        already_member = False
        if account is None:
            self._members.check_permission(workspace_id, inviter_id, None, "add")
            account = self._accounts.register(
                email=normalized_email,
                name=normalized_email.split("@")[0],
                language=language,
                status="pending",
                is_setup=True,
                check_normalized_email=True,
            )
            if rbac_enabled:
                self._members.join_member(
                    workspace_id=workspace_id,
                    account_id=account.id,
                    email=account.email,
                    role=join_role,
                    operator_account_id=inviter_id,
                )
                self._workspaces.switch(account_id=account.id, workspace_id=workspace_id)
            requires_setup = True
        else:
            self._members.check_permission(workspace_id, inviter_id, account.id, "add")
            previous_role = self._members.get_role(workspace_id, account.id)
            already_member = previous_role is not None
            requires_setup = account.status == "pending"
            if previous_role is None and rbac_enabled:
                self._members.join_member(
                    workspace_id=workspace_id,
                    account_id=account.id,
                    email=account.email,
                    role=join_role,
                    operator_account_id=inviter_id,
                )
            if account.status != "pending":
                if self._members.rbac_enabled and previous_role is None:
                    self._members.assign_role(workspace_id, inviter_id, account.id, role)
                if previous_role is not None or self._members.rbac_enabled:
                    raise AccountAlreadyInTenantError("Account already in tenant.")
        if rbac_enabled and not already_member:
            self._members.assign_role(workspace_id, inviter_id, account.id, role)
        token = self._invitations.create(InvitationToken(account.id, account.email, workspace_id, role, requires_setup))
        try:
            self._invitations.send(
                language=account.interface_language or "en-US",
                email=account.email,
                token=token,
                inviter_name=inviter.name,
                workspace_name=workspace.name,
            )
        except Exception:
            self._invitations.discard(workspace_id, token)
            raise
        if not rbac_enabled:
            self._invitations.revoke_pending(workspace_id, account.email, account_id=account.id, keep_token=token)
        return WorkspaceInvitation(workspace_id, account.id, normalized_email, role, token)


class OwnerTransferGateway(Protocol):
    def is_ip_limited(self, ip_address: str) -> bool: ...

    def is_verification_limited(self, email: str) -> bool: ...

    def record_verification_failure(self, email: str) -> None: ...

    def reset_verification_failures(self, email: str) -> None: ...

    def send_confirmation(self, account: AccountSnapshot, workspace_name: str, language: str) -> str: ...

    def read_token(self, token: str) -> OwnerTransferToken | None: ...

    def issue_token(self, token: OwnerTransferToken) -> str: ...

    def revoke_token(self, token: str) -> None: ...

    def notify(self, *, old_owner: AccountSnapshot, new_owner: AccountSnapshot, workspace_name: str) -> None: ...


class WorkspaceOwnerTransferService:
    def __init__(
        self,
        *,
        accounts: AccountSnapshotQuery,
        workspaces: WorkspaceMemberStore,
        members: WorkspaceMemberService,
        challenges: OwnerTransferGateway,
    ) -> None:
        self._accounts = accounts
        self._workspaces = workspaces
        self._members = members
        self._challenges = challenges

    def _owner(self, context: RequestContext) -> AccountSnapshot:
        if self._members.get_role(context.active_workspace_id, context.account_id) != TenantAccountRole.OWNER:
            raise NoPermissionError("Only the workspace owner can transfer ownership.")
        owner = self._accounts.get(context.account_id)
        if owner is None:
            raise AccountNotFoundError()
        return owner

    def send_code(self, context: RequestContext, *, ip_address: str, language: str | None) -> str:
        if self._challenges.is_ip_limited(ip_address):
            raise OwnerTransferSendIPLimitedError()
        owner = self._owner(context)
        workspace = self._workspaces.get(context.active_workspace_id)
        if workspace is None:
            raise WorkspaceNotFoundError()
        return self._challenges.send_confirmation(
            owner, workspace.name, "zh-Hans" if language == "zh-Hans" else "en-US"
        )

    def verify_code(self, context: RequestContext, *, token: str, code: str) -> tuple[str, str]:
        owner = self._owner(context)
        if self._challenges.is_verification_limited(owner.email):
            raise OwnerTransferVerificationLimitError()
        challenge = self._challenge(token, owner.email)
        if challenge.code != code:
            self._challenges.record_verification_failure(owner.email)
            raise InvalidOwnerTransferCodeError()
        self._challenges.revoke_token(token)
        new_token = self._challenges.issue_token(OwnerTransferToken(owner.email, code))
        self._challenges.reset_verification_failures(owner.email)
        return owner.email, new_token

    def _challenge(self, token: str, email: str) -> OwnerTransferToken:
        challenge = self._challenges.read_token(token)
        if challenge is None:
            raise InvalidOwnerTransferTokenError()
        if challenge.email != email:
            raise InvalidOwnerTransferEmailError()
        return challenge

    def transfer(self, context: RequestContext, *, member_id: str, token: str) -> None:
        owner = self._owner(context)
        if owner.id == member_id:
            raise CannotOperateSelfError("Cannot transfer ownership to self.")
        self._challenge(token, owner.email)
        self._challenges.revoke_token(token)
        member = self._accounts.get(member_id)
        if member is None:
            raise AccountNotFoundError()
        if self._members.get_role(context.active_workspace_id, member_id) is None:
            raise MemberNotInTenantError("The new owner is not a workspace member.")
        workspace = self._workspaces.get(context.active_workspace_id)
        if workspace is None:
            raise WorkspaceNotFoundError()
        self._members.update_role(workspace.id, member.id, "owner", owner.id)
        self._challenges.notify(old_owner=owner, new_owner=member, workspace_name=workspace.name)
