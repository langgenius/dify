"""Internal workspace creation and membership use cases."""

import logging
from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Protocol

from enums.account import TenantAccountRole
from services.account.contracts import AccountCreation
from services.account_errors import AccountNormalizedEmailAlreadyInUseError, AccountNotFoundError
from services.entities.account_entities import AccountSnapshot
from services.errors.workspace import (
    InvalidWorkspaceMemberRoleError,
    WorkSpaceNotAllowedCreateError,
    WorkspaceOwnerNotFoundError,
    WorkspacePostCommitNotificationError,
    WorkspacesLimitExceededError,
)
from services.workspace.contracts import CreatedWorkspace, WorkspaceCreation, WorkspaceMembership

logger = logging.getLogger(__name__)


class WorkspaceOwnerQuery(Protocol):
    def find_first_by_email(self, email: str) -> AccountSnapshot | None: ...

    def get(self, account_id: str) -> AccountSnapshot | None: ...

    def normalized_email_exists(self, email: str) -> bool: ...


class WorkspaceCreationPolicy(Protocol):
    def is_workspace_creation_allowed(self) -> bool: ...

    def has_workspace_capacity(self) -> bool: ...


class WorkspaceQuotaGuard(Protocol):
    def acquire(self) -> AbstractContextManager[Callable[[], None]]: ...


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
        before_commit: Callable[[], None],
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
        quota_guard: WorkspaceQuotaGuard,
        memberships: WorkspaceMembershipQuery,
        members: WorkspaceMemberWriter,
    ) -> None:
        self._owners = owners
        self._provisioning = provisioning
        self._effects = effects
        self._policies = policies
        self._quota_guard = quota_guard
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
        workspace = self._create(name=name, owner_id=owner_id, enforce_capacity=owner_id is not None)
        assert workspace is not None
        return workspace

    def create_owner_workspace(
        self, account_id: str, *, name: str | None = None, is_setup: bool = False, if_missing: bool = False
    ) -> CreatedWorkspace | None:
        if if_missing and self._memberships.list_ids_for_account(account_id):
            return None
        if not is_setup and not self._policies.is_workspace_creation_allowed():
            raise WorkSpaceNotAllowedCreateError()
        if not self._policies.has_workspace_capacity():
            raise WorkspacesLimitExceededError()
        owner = self._owners.get(account_id)
        if owner is None:
            raise AccountNotFoundError()
        return self._create(name=name or f"{owner.name}'s Workspace", owner_id=owner.id, enforce_capacity=True)

    def _create(
        self,
        *,
        name: str,
        owner_id: str | None,
        enforce_capacity: bool,
        account: AccountCreation | None = None,
        only_if_no_active_workspace: bool = False,
    ) -> CreatedWorkspace | None:
        def prepare() -> WorkspaceCreation:
            creation = self._effects.prepare(name)
            if owner_id is not None:
                self._effects.bind_owner(creation.id, owner_id)
            return creation

        def provision(before_commit: Callable[[], None]) -> CreatedWorkspace | None:
            return self._provisioning.provision(
                prepare,
                owner_id=owner_id,
                account=account,
                only_if_no_active_workspace=only_if_no_active_workspace,
                before_commit=before_commit,
            )

        if enforce_capacity:
            # This global guard, unlike an owner-row lock, also serializes
            # creations for different accounts. The repository commits before
            # returning, so the next capacity read observes the completed write.
            with self._quota_guard.acquire() as assert_quota_guard_owned:
                if (
                    only_if_no_active_workspace
                    and owner_id is not None
                    and self._memberships.has_active_for_account(owner_id)
                ):
                    workspace = None
                elif not self._policies.has_workspace_capacity():
                    raise WorkspacesLimitExceededError()
                else:
                    assert_quota_guard_owned()
                    workspace = provision(assert_quota_guard_owned)
        else:
            workspace = provision(lambda: None)
        if workspace is not None:
            try:
                self._effects.created(workspace, owner_id=owner_id)
            except Exception as error:
                # Persistence has already committed. Preserve that identity so a
                # caller which owns compensation can remove precisely this aggregate.
                raise WorkspacePostCommitNotificationError(workspace.id, error) from error
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
        self._create(name=f"{name}'s Workspace", owner_id=account.id, enforce_capacity=True, account=account)
        self._effects.join_default_workspace(account.id)
        return account.id

    def create_registered_account_with_owner_workspace(self, creation: AccountCreation) -> str:
        """Persist registration's account, owner workspace and membership together."""
        if self._owners.normalized_email_exists(creation.email):
            raise AccountNormalizedEmailAlreadyInUseError
        try:
            self._create(
                name=f"{creation.name}'s Workspace",
                owner_id=creation.id,
                enforce_capacity=True,
                account=creation,
            )
        except WorkspacePostCommitNotificationError:
            # The account, owner workspace, and membership are already committed.
            # Registration must continue with that known identity instead of
            # presenting the completed write as a rollback-safe failure.
            logger.exception("Workspace creation notification failed after registration was committed")
        try:
            self._effects.join_default_workspace(creation.id)
        except Exception:
            # This is also a post-commit integration. It must not invalidate the
            # locally committed registration or make its verified token reusable.
            logger.exception("Failed to join the default workspace after registration was committed")
        return creation.id

    def ensure_owner_workspace(self, account_id: str) -> None:
        owner = self._owners.get(account_id)
        if owner is None:
            raise AccountNotFoundError
        if self._memberships.has_active_for_account(account_id):
            return
        self._create(
            name=f"{owner.name}'s Workspace",
            owner_id=account_id,
            enforce_capacity=True,
            only_if_no_active_workspace=True,
        )

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
