"""Workspace membership, invitation and ownership use cases with application-owned ports."""

import logging
from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager
from typing import Protocol

from enums.account import TenantAccountRole
from machinery.context import RequestContext
from services.account_email import normalize_email
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
    WorkspaceAlreadyHasOwnerError,
    WorkspaceNotFoundError,
    WorkspaceOwnerTransferInProgressError,
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
    WorkspaceOwnerTransfer,
    WorkspaceOwnerTransferNotification,
    WorkspaceOwnerTransferNotificationDetails,
    WorkspaceSnapshot,
)
from services.workspace.quota import WorkspaceMemberQuotaGateway, WorkspaceMemberQuotaSnapshot

logger = logging.getLogger(__name__)


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
        quota: WorkspaceMemberQuotaSnapshot,
    ) -> WorkspaceMemberWrite: ...

    def remove_member(self, *, workspace_id: str, account_id: str, owner_id: str) -> WorkspaceMemberRemoval: ...

    def update_member_role(
        self,
        *,
        workspace_id: str,
        actor_account_id: str,
        account_id: str,
        role: TenantAccountRole,
    ) -> None: ...

    def get_pending_owner_transfer(self, workspace_id: str) -> WorkspaceOwnerTransfer | None: ...

    def prepare_owner_transfer(
        self,
        *,
        workspace_id: str,
        actor_account_id: str,
        account_id: str,
        notification: WorkspaceOwnerTransferNotificationDetails | None = None,
    ) -> WorkspaceOwnerTransfer: ...

    def complete_owner_transfer(self, transfer: WorkspaceOwnerTransfer) -> bool: ...

    def claim_owner_transfer_execution(self, transfer: WorkspaceOwnerTransfer) -> WorkspaceOwnerTransfer | None: ...

    def record_owner_transfer_error(self, transfer: WorkspaceOwnerTransfer, *, error: str) -> None: ...

    def list_pending_owner_transfers(self, *, limit: int = 100) -> tuple[WorkspaceOwnerTransfer, ...]: ...

    def list_pending_owner_transfer_notifications(
        self,
        *,
        operation_id: str | None = None,
        limit: int = 100,
    ) -> tuple[WorkspaceOwnerTransferNotification, ...]: ...

    def claim_owner_transfer_notification(
        self,
        notification: WorkspaceOwnerTransferNotification,
    ) -> WorkspaceOwnerTransferNotification | None: ...

    def complete_owner_transfer_notification(self, notification: WorkspaceOwnerTransferNotification) -> bool: ...

    def record_owner_transfer_notification_error(
        self,
        notification: WorkspaceOwnerTransferNotification,
        *,
        error: str,
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

    def reconcile_owner(
        self,
        workspace_id: str,
        old_owner_id: str,
        new_owner_id: str,
        *,
        actor_id: str | None,
    ) -> None: ...

    def membership_changed(self, membership: WorkspaceMemberWrite, operator_account_id: str | None) -> None: ...

    def member_removed(self, workspace_id: str, removal: WorkspaceMemberRemoval) -> None: ...


class WorkspaceMemberService:
    def __init__(
        self,
        *,
        workspaces: WorkspaceMemberStore,
        accounts: AccountSnapshotQuery,
        access: WorkspaceMemberAccessGateway,
        quotas: WorkspaceMemberQuotaGateway,
    ) -> None:
        self._workspaces = workspaces
        self._accounts = accounts
        self._access = access
        self._quotas = quotas

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
        quota = self.quota_snapshot(workspace_id)
        membership = self._workspaces.upsert_member(
            workspace_id=workspace_id,
            account_id=account_id,
            role=role,
            quota=quota,
        )
        self.membership_changed(membership, operator_account_id=operator_account_id)
        return WorkspaceMembership(workspace_id, account_id, role.value)

    def quota_snapshot(self, workspace_id: str) -> WorkspaceMemberQuotaSnapshot:
        return self._quotas.snapshot(workspace_id)

    def membership_changed(
        self,
        membership: WorkspaceMemberWrite,
        *,
        operator_account_id: str | None,
    ) -> None:
        """Publish post-commit access changes for a persisted membership."""
        self._access.membership_changed(membership, operator_account_id)

    def assign_role(self, workspace_id: str, operator_id: str, member_id: str, role_id: str) -> None:
        self._access.assign_role(workspace_id, operator_id, member_id, role_id)

    def remove(self, workspace_id: str, account_id: str, operator_id: str) -> None:
        """Remove a member and transfer their resources to the workspace owner.

        Raises:
            AccountNotFoundError: The member account does not exist.
            CannotOperateSelfError: The operator tries to remove themselves.
            NoPermissionError: The operator cannot remove the member.
            MemberNotInTenantError: The account is not a member of the workspace.
            ValueError: The workspace has no owner to receive the member's resources.
        """
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
        self._update_role(
            workspace_id,
            member_id,
            new_role,
            operator_id,
            notification=None,
        )

    def transfer_owner(
        self,
        workspace_id: str,
        member_id: str,
        operator_id: str,
        *,
        notification: WorkspaceOwnerTransferNotificationDetails,
    ) -> WorkspaceOwnerTransfer:
        """Transfer ownership while durably binding the later notifications."""
        transfer = self._update_role(
            workspace_id,
            member_id,
            TenantAccountRole.OWNER.value,
            operator_id,
            notification=notification,
        )
        if transfer is None:
            raise RuntimeError("Owner transfer did not create a durable operation.")
        return transfer

    def _update_role(
        self,
        workspace_id: str,
        member_id: str,
        new_role: str,
        operator_id: str,
        *,
        notification: WorkspaceOwnerTransferNotificationDetails | None,
    ) -> WorkspaceOwnerTransfer | None:
        if not TenantAccountRole.is_valid_role(new_role):
            raise InvalidWorkspaceMemberRoleError()
        self._access.ensure_role_enabled(new_role)
        if self._accounts.get(member_id) is None:
            raise AccountNotFoundError()
        role = TenantAccountRole(new_role)
        durable_owner_transfer = role == TenantAccountRole.OWNER and (
            self._access.rbac_enabled or notification is not None
        )
        if durable_owner_transfer:
            pending = self._workspaces.get_pending_owner_transfer(workspace_id)
            if pending is not None:
                if pending.old_owner_account_id != operator_id or pending.new_owner_account_id != member_id:
                    raise NoPermissionError("Another ownership transfer is already in progress.")
                if notification is not None:
                    pending = self._workspaces.prepare_owner_transfer(
                        workspace_id=workspace_id,
                        actor_account_id=operator_id,
                        account_id=member_id,
                        notification=notification,
                    )
                self._finish_owner_transfer(pending, actor_id=None)
                return pending
        self.check_permission(workspace_id, operator_id, member_id, "update")
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
        if durable_owner_transfer:
            transfer = self._workspaces.prepare_owner_transfer(
                workspace_id=workspace_id,
                actor_account_id=operator_id,
                account_id=member_id,
                notification=notification,
            )
            self._finish_owner_transfer(transfer, actor_id=operator_id)
            return transfer
        if self._access.rbac_enabled:
            self._access.change_role(workspace_id, operator_id, member_id, role)
        self._workspaces.update_member_role(
            workspace_id=workspace_id,
            actor_account_id=operator_id,
            account_id=member_id,
            role=role,
        )
        return None

    def _finish_owner_transfer(self, transfer: WorkspaceOwnerTransfer, *, actor_id: str | None) -> None:
        claimed = self._workspaces.claim_owner_transfer_execution(transfer)
        if claimed is None:
            raise WorkspaceOwnerTransferInProgressError("Workspace ownership transfer is already in progress.")
        try:
            if self._access.rbac_enabled:
                self._reconcile_owner_candidates(claimed, actor_id=actor_id)
            if not self._workspaces.complete_owner_transfer(claimed):
                raise RuntimeError("Workspace ownership transfer operation is no longer pending.")
        except Exception as error:
            self._record_owner_transfer_error(claimed, error)
            raise

    def _reconcile_owner_candidates(self, transfer: WorkspaceOwnerTransfer, *, actor_id: str | None) -> None:
        possible_owner_ids = transfer.possible_owner_account_ids or (transfer.old_owner_account_id,)
        for old_owner_id in sorted(set(possible_owner_ids) - {transfer.new_owner_account_id}):
            self._access.reconcile_owner(
                transfer.workspace_id,
                old_owner_id,
                transfer.new_owner_account_id,
                actor_id=actor_id,
            )

    def _record_owner_transfer_error(self, transfer: WorkspaceOwnerTransfer, error: Exception) -> None:
        try:
            self._workspaces.record_owner_transfer_error(transfer, error=str(error))
        except Exception:
            logger.exception(
                "Failed to record workspace ownership transfer error: workspace_id=%s",
                transfer.workspace_id,
            )


class OwnerTransferNotificationGateway(Protocol):
    def notify(self, notification: WorkspaceOwnerTransferNotification) -> None: ...


class WorkspaceOwnerTransferNotificationService:
    """Dispatch durable per-recipient notifications outside database transactions."""

    def __init__(self, *, workspaces: WorkspaceMemberStore, gateway: OwnerTransferNotificationGateway) -> None:
        self._workspaces = workspaces
        self._gateway = gateway

    def deliver_operation(self, operation_id: str) -> int:
        return self._deliver(operation_id=operation_id, limit=2, raise_on_error=True)

    def recover(self, *, limit: int = 100) -> int:
        return self._deliver(operation_id=None, limit=limit, raise_on_error=False)

    def _deliver(self, *, operation_id: str | None, limit: int, raise_on_error: bool) -> int:
        delivered = 0
        first_error: Exception | None = None
        notifications = self._workspaces.list_pending_owner_transfer_notifications(
            operation_id=operation_id,
            limit=limit,
        )
        for notification in notifications:
            claimed = self._workspaces.claim_owner_transfer_notification(notification)
            if claimed is None:
                continue
            try:
                self._gateway.notify(claimed)
            except Exception as error:
                try:
                    self._workspaces.record_owner_transfer_notification_error(claimed, error=str(error))
                except Exception:
                    logger.exception(
                        "Failed to persist workspace ownership notification error: notification_id=%s",
                        claimed.notification_id,
                    )
                if raise_on_error:
                    first_error = first_error or error
                else:
                    logger.warning(
                        "Workspace ownership notification delivery failed: notification_id=%s",
                        claimed.notification_id,
                        exc_info=True,
                    )
                continue
            if self._workspaces.complete_owner_transfer_notification(claimed):
                delivered += 1
        if first_error is not None:
            raise first_error
        return delivered


class WorkspaceOwnerTransferRecoveryService:
    """Converge external RBAC and local membership for durable transfers."""

    def __init__(
        self,
        *,
        workspaces: WorkspaceMemberStore,
        access: WorkspaceMemberAccessGateway,
        notifications: WorkspaceOwnerTransferNotificationService,
    ) -> None:
        self._workspaces = workspaces
        self._access = access
        self._notifications = notifications

    def recover(self, *, limit: int = 100) -> int:
        recovered = 0
        for transfer in self._workspaces.list_pending_owner_transfers(limit=limit):
            if not self._access.rbac_enabled and transfer.status == "watch":
                continue
            claimed = self._workspaces.claim_owner_transfer_execution(transfer)
            if claimed is None:
                continue
            try:
                if self._access.rbac_enabled:
                    self._reconcile_owner_candidates(claimed)
                if self._workspaces.complete_owner_transfer(claimed):
                    recovered += 1
            except Exception as error:
                logger.warning(
                    "Workspace ownership transfer recovery failed: workspace_id=%s",
                    claimed.workspace_id,
                    exc_info=True,
                )
                try:
                    self._workspaces.record_owner_transfer_error(claimed, error=str(error))
                except Exception:
                    logger.exception(
                        "Failed to persist workspace ownership transfer recovery error: workspace_id=%s",
                        claimed.workspace_id,
                    )
        self._notifications.recover(limit=limit)
        return recovered

    def _reconcile_owner_candidates(self, transfer: WorkspaceOwnerTransfer) -> None:
        possible_owner_ids = transfer.possible_owner_account_ids or (transfer.old_owner_account_id,)
        for old_owner_id in sorted(set(possible_owner_ids) - {transfer.new_owner_account_id}):
            self._access.reconcile_owner(
                transfer.workspace_id,
                old_owner_id,
                transfer.new_owner_account_id,
                actor_id=None,
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
        create_workspace_required: bool,
    ) -> AccountSnapshot: ...

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
    ) -> tuple[AccountSnapshot, WorkspaceMemberWrite]: ...


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

    def check_invitation_quota(self, workspace_id: str) -> None: ...

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

    def check_invitation_quota(self, context: RequestContext) -> None:
        self._invitations.check_invitation_quota(context.active_workspace_id)

    def invite_many(
        self, context: RequestContext, *, emails: Sequence[str], language: str | None, role: str
    ) -> tuple[WorkspaceInvitationResult, ...]:
        if not self._members.rbac_enabled and (not TenantAccountRole.is_valid_role(role) or role == "owner"):
            raise InvalidWorkspaceMemberRoleError()
        self._invitations.ensure_role_enabled(role)
        workspace_id = context.active_workspace_id
        self._invitations.ensure_allowed(workspace_id)
        emails_by_identity: dict[str, str] = {}
        for email in emails:
            lowered_email = email.lower()
            emails_by_identity.setdefault(normalize_email(lowered_email), lowered_email)
        emails = tuple(emails_by_identity.values())
        results: list[WorkspaceInvitationResult] = []
        with self._invitations.acquire(workspace_id):
            new_accounts = 0
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
                    invitation = self.invite(context, email, language, role)
                    results.append(WorkspaceInvitationResult(email, "success", token=invitation.token))
                except AccountAlreadyInTenantError:
                    results.append(
                        WorkspaceInvitationResult(email, "already_member", message="Account already in workspace.")
                    )
                except Exception as error:
                    # Each invitation commits independently. A quota race must
                    # retain the results of invitations already delivered.
                    results.append(WorkspaceInvitationResult(email, "failed", message=str(error)))
        return tuple(results)

    def invite(
        self,
        context: RequestContext,
        email: str,
        language: str | None,
        role: str = "normal",
    ) -> WorkspaceInvitation:
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
        requires_setup = False
        if account is None:
            self._members.check_permission(workspace_id, inviter_id, None, "add")
            account, membership = self._accounts.register_workspace_member(
                email=normalized_email,
                name=normalized_email.split("@")[0],
                language=language,
                status="pending",
                is_setup=True,
                check_normalized_email=True,
                workspace_id=workspace_id,
                role=join_role,
                member_quota=self._members.quota_snapshot(workspace_id),
            )
            self._members.membership_changed(membership, operator_account_id=inviter_id)
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
        return WorkspaceInvitation(workspace_id, account.id, normalized_email, role, token)


class OwnerTransferGateway(OwnerTransferNotificationGateway, Protocol):
    def is_ip_limited(self, ip_address: str) -> bool: ...

    def is_verification_limited(self, email: str) -> bool: ...

    def record_verification_failure(self, email: str) -> None: ...

    def reset_verification_failures(self, email: str) -> None: ...

    def send_confirmation(self, account: AccountSnapshot, workspace_name: str, language: str) -> str: ...

    def read_token(self, token: str) -> OwnerTransferToken | None: ...

    def issue_token(self, token: OwnerTransferToken) -> str: ...

    def revoke_token(self, token: str) -> None: ...


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
        self._notifications = WorkspaceOwnerTransferNotificationService(
            workspaces=workspaces,
            gateway=challenges,
        )

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
        transfer = self._members.transfer_owner(
            workspace.id,
            member.id,
            owner.id,
            notification=WorkspaceOwnerTransferNotificationDetails(
                old_owner_email=owner.email,
                old_owner_language=owner.interface_language or "en-US",
                new_owner_email=member.email,
                new_owner_language=member.interface_language or "en-US",
                workspace_name=workspace.name,
            ),
        )
        self._notifications.deliver_operation(transfer.operation_id)
