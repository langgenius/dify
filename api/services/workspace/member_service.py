"""Workspace membership, invitation and ownership use cases with application-owned ports."""

from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager
from typing import Protocol

from enums.account import TenantAccountRole
from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError
from services.account_ports import AccountSnapshotQuery
from services.entities.account_activation_entities import InvitationToken
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
    RoleAlreadyAssignedError,
    WorkspaceNotFoundError,
)
from services.workspace.contracts import (
    OwnerTransferToken,
    WorkspaceInvitationResult,
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

    def list_current(self, context: RequestContext) -> tuple[WorkspaceMemberSummary, ...]:
        workspace_id = context.active_workspace_id

        records = tuple(self._members.list_for_workspace(workspace_id))
        role_subjects = tuple(
            WorkspaceMemberRoleSubject(account_id=record.id, legacy_role=record.legacy_role) for record in records
        )

        # The repository closes its read Session before role resolution
        # performs enterprise I/O.
        roles_by_member = self._roles.resolve_many(workspace_id, context.account_id, role_subjects)

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

    def upsert_member(self, *, workspace_id: str, account_id: str, role: TenantAccountRole) -> WorkspaceMemberWrite: ...

    def remove_member(self, *, workspace_id: str, account_id: str, owner_id: str) -> WorkspaceMemberRemoval: ...

    def update_member_role(self, *, workspace_id: str, account_id: str, role: TenantAccountRole) -> None: ...


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


class WorkspaceMemberService:
    def __init__(
        self, *, workspaces: WorkspaceMemberStore, accounts: AccountSnapshotQuery, access: WorkspaceMemberAccessGateway
    ) -> None:
        self._workspaces = workspaces
        self._accounts = accounts
        self._access = access

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
        workspace = self._workspaces.get(workspace_id)
        if workspace is None or workspace.status != "normal":
            raise WorkspaceNotFoundError()
        account = self._accounts.get(account_id)
        if account is None or account.email != email:
            raise AccountNotFoundError()
        if role == TenantAccountRole.OWNER and self._workspaces.owner_id(workspace_id) is not None:
            raise ValueError("Tenant already has an owner.")
        membership = self._workspaces.upsert_member(workspace_id=workspace_id, account_id=account_id, role=role)
        self._access.membership_changed(membership, operator_account_id)
        return WorkspaceMembership(workspace_id, account_id, role.value)

    def assign_role(self, workspace_id: str, operator_id: str, member_id: str, role_id: str) -> None:
        self._access.assign_role(workspace_id, operator_id, member_id, role_id)

    def remove(self, workspace_id: str, account_id: str, operator_id: str) -> None:
        if self._accounts.get(account_id) is None:
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
        removal = self._workspaces.remove_member(workspace_id=workspace_id, account_id=account_id, owner_id=owner_id)
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
        if self._access.rbac_enabled:
            if role == TenantAccountRole.OWNER:
                self._access.transfer_owner(workspace_id, operator_id, member_id)
            else:
                self._access.change_role(workspace_id, operator_id, member_id, role)
        self._workspaces.update_member_role(workspace_id=workspace_id, account_id=member_id, role=role)


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


class WorkspaceInvitationDelivery(Protocol):
    @property
    def requires_capacity_check(self) -> bool: ...

    def acquire(self, workspace_id: str) -> AbstractContextManager[object]: ...

    def ensure_role_enabled(self, role: str) -> None: ...

    def check_capacity(
        self, workspace_id: str, *, current_members: int, new_members: int, new_accounts: int
    ) -> None: ...

    def ensure_allowed(self, workspace_id: str) -> None: ...

    def create(self, invitation: InvitationToken) -> str: ...

    def send(self, *, language: str, email: str, token: str, inviter_name: str, workspace_name: str) -> None: ...


class WorkspaceInvitationService:
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

    def invite_many(
        self, context: RequestContext, *, emails: Sequence[str], language: str | None, role: str
    ) -> tuple[WorkspaceInvitationResult, ...]:
        if not self._members.rbac_enabled and (not TenantAccountRole.is_valid_role(role) or role == "owner"):
            raise InvalidWorkspaceMemberRoleError()
        self._invitations.ensure_role_enabled(role)
        workspace_id = context.active_workspace_id
        self._invitations.ensure_allowed(workspace_id)
        results: list[WorkspaceInvitationResult] = []
        with self._invitations.acquire(workspace_id):
            if self._invitations.requires_capacity_check:
                new_members, new_accounts = 0, 0
                for email in emails:
                    account = self._accounts.get_account_by_email_with_case_fallback(email)
                    if account is None:
                        new_accounts += 1
                        new_members += 1
                    elif self._members.get_role(workspace_id, account.id) is None:
                        new_members += 1
                if new_members:
                    self._invitations.check_capacity(
                        workspace_id,
                        current_members=self._workspaces.count_members(workspace_id),
                        new_members=new_members,
                        new_accounts=new_accounts,
                    )
            for email in emails:
                try:
                    token = self.invite(workspace_id, email, language, role, inviter_id=context.account_id)
                    results.append(WorkspaceInvitationResult(email, "success", token=token))
                except AccountAlreadyInTenantError:
                    results.append(
                        WorkspaceInvitationResult(email, "already_member", message="Account already in workspace.")
                    )
                except Exception as error:
                    results.append(WorkspaceInvitationResult(email, "failed", message=str(error)))
        return tuple(results)

    def invite(
        self,
        workspace_id: str,
        email: str,
        language: str | None,
        role: str = "normal",
        *,
        inviter_id: str,
    ) -> str:
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
        requires_setup = False
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
            requires_setup = account.status == "pending"
            if previous_role is None and (requires_setup or self._members.rbac_enabled):
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
        if self._members.rbac_enabled:
            self._members.assign_role(workspace_id, inviter_id, account.id, role)
        token = self._invitations.create(InvitationToken(account.id, account.email, workspace_id, role, requires_setup))
        self._invitations.send(
            language=account.interface_language or "en-US",
            email=account.email,
            token=token,
            inviter_name=inviter.name,
            workspace_name=workspace.name,
        )
        return token


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
