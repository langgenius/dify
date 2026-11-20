"""Internal workspace creation and membership use cases."""

from collections.abc import Callable
from contextlib import suppress
from typing import Protocol

from enums.account import TenantAccountRole
from services.account.contracts import AccountCreation
from services.account_errors import AccountNormalizedEmailAlreadyInUseError, AccountNotFoundError
from services.entities.account_entities import AccountSnapshot
from services.errors.workspace import (
    InvalidWorkspaceMemberRoleError,
    WorkSpaceNotAllowedCreateError,
    WorkspaceNotFoundError,
    WorkspaceOwnerNotFoundError,
    WorkspacesLimitExceededError,
)
from services.workspace.contracts import CreatedWorkspace, WorkspaceActivation, WorkspaceCreation, WorkspaceMembership


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
    def get_activation(self, account_id: str) -> WorkspaceActivation: ...

    def provision(
        self,
        prepare: Callable[[], WorkspaceCreation],
        *,
        owner_id: str | None,
        account: AccountCreation | None = None,
        only_if_no_active_workspace: bool = False,
        first_workspace_after_joining: str | None = None,
    ) -> CreatedWorkspace | None:
        """Hold the owner lock from eligibility checks through commit.

        If a joined workspace ID is supplied, create only for an existing active
        account with no recorded creation and no active membership other than
        that workspace. Ineligible calls skip preparation and return None.
        """
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

    def activate(self, account_id: str, *, name: str | None = None) -> WorkspaceActivation:
        """Create a workspace only if the admitted Account has no usable membership.

        A supplied name is already validated by the caller. Automatic Console
        provisioning omits the name and uses the Account's default workspace name;
        a closed Account cannot provision automatically. The store locks the
        Account through the existence check, preparation and commit. Retries reuse
        membership and preserve the first creation time. A missing Account or denied
        creation leaves workspace rows unchanged.
        """
        if name is None:
            name = self._default_workspace_name(account_id)
        self._provision_activation_workspace(account_id, name=name, only_if_no_active_workspace=True)
        activation = self._provisioning.get_activation(account_id)
        if activation.workspace_id is None:
            raise WorkspaceNotFoundError()
        return activation

    def provision_first_workspace_after_invitation(self, account_id: str, *, joined_workspace_id: str) -> None:
        """After a verified acceptance, try to create the invitee's first owned workspace.

        The joined team must be the account's only active workspace. Preserve its
        selection and respect the workspace creation policy. The shared creation
        path checks license capacity, but only Enterprise enforces a workspace
        count limit. Publish the workspace-created effect only after creation commits.
        """
        with suppress(WorkSpaceNotAllowedCreateError, WorkspacesLimitExceededError):
            self._provision_activation_workspace(
                account_id,
                name=self._default_workspace_name(account_id),
                first_workspace_after_joining=joined_workspace_id,
            )

    def _default_workspace_name(self, account_id: str) -> str:
        """Name a workspace for an existing account that can provision automatically."""
        owner = self._owners.get(account_id)
        if owner is None:
            raise WorkspaceOwnerNotFoundError()
        if owner.status == "closed":
            raise WorkSpaceNotAllowedCreateError()
        suffix = "'s Workspace"
        return f"{owner.name[: 255 - len(suffix)]}{suffix}"

    def _provision_activation_workspace(
        self,
        account_id: str,
        *,
        name: str,
        only_if_no_active_workspace: bool = False,
        first_workspace_after_joining: str | None = None,
    ) -> None:
        """Prepare an eligible account's workspace and notify only after the store commits."""

        def prepare() -> WorkspaceCreation:
            if not self._policies.is_workspace_creation_allowed():
                raise WorkSpaceNotAllowedCreateError()
            if not self._policies.has_workspace_capacity():
                raise WorkspacesLimitExceededError()
            creation = self._effects.prepare(name)
            self._effects.bind_owner(creation.id, account_id)
            return creation

        workspace = self._provisioning.provision(
            prepare,
            owner_id=account_id,
            only_if_no_active_workspace=only_if_no_active_workspace,
            first_workspace_after_joining=first_workspace_after_joining,
        )
        if workspace is not None:
            self._effects.created(workspace, owner_id=account_id)

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
