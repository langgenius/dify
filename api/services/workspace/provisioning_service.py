"""Internal workspace creation and membership use cases."""

from collections.abc import Callable
from typing import Protocol

from enums.account import TenantAccountRole
from services.account.contracts import AccountCreation
from services.account_errors import AccountNormalizedEmailAlreadyInUseError, AccountNotFoundError
from services.entities.account_entities import AccountSnapshot
from services.errors.workspace import (
    InvalidWorkspaceMemberRoleError,
    WorkSpaceNotAllowedCreateError,
    WorkspaceOwnerNotFoundError,
    WorkspacesLimitExceededError,
)
from services.workspace.contracts import CreatedWorkspace, WorkspaceCreation, WorkspaceMembership


class WorkspaceOwnerQuery(Protocol):
    def find_first_by_email(self, email: str) -> AccountSnapshot | None: ...

    def get(self, account_id: str) -> AccountSnapshot | None: ...

    def normalized_email_exists(self, email: str) -> bool: ...


class WorkspaceCreationPolicy(Protocol):
    def is_workspace_creation_allowed(self) -> bool: ...

    def has_workspace_capacity(self) -> bool: ...


class WorkspaceMembershipQuery(Protocol):
    def list_ids_for_account(self, account_id: str) -> tuple[str, ...]: ...

    def has_active_for_account(self, account_id: str) -> bool: ...


class WorkspaceProvisioningStore(Protocol):
    def provision(
        self,
        prepare: Callable[[], WorkspaceCreation],
        *,
        owner_id: str | None,
        account: AccountCreation | None = None,
        only_if_no_active_workspace: bool = False,
    ) -> CreatedWorkspace | None:
        """Run preparation after eligibility checks, holding any required owner lock through commit."""
        ...


class WorkspaceProvisioningEffects(Protocol):
    def prepare(self, name: str) -> WorkspaceCreation: ...

    def bind_owner(self, workspace_id: str, account_id: str) -> None: ...

    def created(self, workspace: CreatedWorkspace, *, owner_id: str | None) -> None: ...

    def join_default_workspace(self, account_id: str) -> None: ...


class WorkspaceMemberWriter(Protocol):
    def join_member(
        self,
        *,
        workspace_id: str,
        account_id: str,
        email: str,
        role: TenantAccountRole,
        operator_account_id: str | None,
    ) -> WorkspaceMembership: ...


class WorkspaceProvisioningService:
    def __init__(
        self,
        *,
        owners: WorkspaceOwnerQuery,
        provisioning: WorkspaceProvisioningStore,
        effects: WorkspaceProvisioningEffects,
        policies: WorkspaceCreationPolicy,
        memberships: WorkspaceMembershipQuery,
        members: WorkspaceMemberWriter,
    ) -> None:
        self._owners = owners
        self._provisioning = provisioning
        self._effects = effects
        self._policies = policies
        self._memberships = memberships
        self._members = members

    def create(self, *, name: str, owner_email: str | None = None) -> CreatedWorkspace:
        owner_id = None
        if owner_email is not None:
            owner = self._owners.find_first_by_email(owner_email)
            if owner is None:
                raise WorkspaceOwnerNotFoundError()
            owner_id = owner.id
            if not self._policies.has_workspace_capacity():
                raise WorkspacesLimitExceededError()
        workspace = self._create(name=name, owner_id=owner_id)
        assert workspace is not None
        return workspace

    def create_owner_workspace(
        self, account_id: str, *, name: str | None = None, is_setup: bool = False, if_missing: bool = False
    ) -> None:
        if if_missing and self._memberships.list_ids_for_account(account_id):
            return
        if not is_setup and not self._policies.is_workspace_creation_allowed():
            raise WorkSpaceNotAllowedCreateError()
        if not self._policies.has_workspace_capacity():
            raise WorkspacesLimitExceededError()
        owner = self._owners.get(account_id)
        if owner is None:
            raise AccountNotFoundError()
        self._create(name=name or f"{owner.name}'s Workspace", owner_id=owner.id)

    def _create(
        self,
        *,
        name: str,
        owner_id: str | None,
        account: AccountCreation | None = None,
        only_if_no_active_workspace: bool = False,
    ) -> CreatedWorkspace | None:
        def prepare() -> WorkspaceCreation:
            creation = self._effects.prepare(name)
            if owner_id is not None:
                self._effects.bind_owner(creation.id, owner_id)
            return creation

        workspace = self._provisioning.provision(
            prepare,
            owner_id=owner_id,
            account=account,
            only_if_no_active_workspace=only_if_no_active_workspace,
        )
        if workspace is not None:
            self._effects.created(workspace, owner_id=owner_id)
        return workspace

    def create_with_owner_workspace(
        self,
        *,
        email: str,
        name: str,
        interface_language: str,
        timezone: str,
        ip_address: str,
    ) -> str:
        if self._owners.normalized_email_exists(email):
            raise AccountNormalizedEmailAlreadyInUseError
        account = AccountCreation(
            email=email,
            name=name,
            interface_language=interface_language,
            interface_theme="light",
            timezone=timezone,
            ip_address=ip_address,
            check_normalized_email=True,
        )
        self._create(name=f"{name}'s Workspace", owner_id=account.id, account=account)
        self._effects.join_default_workspace(account.id)
        return account.id

    def ensure_owner_workspace(self, account_id: str) -> None:
        owner = self._owners.get(account_id)
        if owner is None:
            raise AccountNotFoundError
        if self._memberships.has_active_for_account(account_id):
            return
        self._create(name=f"{owner.name}'s Workspace", owner_id=account_id, only_if_no_active_workspace=True)

    def join_member(
        self,
        *,
        workspace_id: str,
        account_id: str,
        email: str,
        role: str,
        operator_account_id: str | None,
    ) -> WorkspaceMembership:
        try:
            member_role = TenantAccountRole(role)
        except ValueError as exc:
            raise InvalidWorkspaceMemberRoleError("invalid workspace member role.") from exc
        if member_role == TenantAccountRole.OWNER:
            raise InvalidWorkspaceMemberRoleError("cannot join workspace as owner.")
        return self._members.join_member(
            workspace_id=workspace_id,
            account_id=account_id,
            email=email,
            role=member_role,
            operator_account_id=operator_account_id,
        )
