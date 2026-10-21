"""Internal workspace creation and membership use cases."""

import logging
from typing import Protocol

from enums.account import TenantAccountRole
from services.account.contracts import AccountCreation
from services.account_errors import (
    AccountNormalizedEmailAlreadyInUseError,
    AccountNotFoundError,
)
from services.entities.account_entities import AccountSnapshot
from services.errors.workspace import (
    InvalidWorkspaceMemberRoleError,
    WorkSpaceNotAllowedCreateError,
    WorkspaceOwnerNotFoundError,
)
from services.workspace.contracts import (
    CreatedWorkspace,
    WorkspaceCancellationResult,
    WorkspaceCompensation,
    WorkspaceCreation,
    WorkspaceMembership,
    WorkspacePreparation,
    WorkspaceProvisioningCommitOutcome,
    WorkspaceProvisioningResult,
)
from services.workspace.quota import DeploymentQuotaSnapshot

logger = logging.getLogger(__name__)


class WorkspaceOwnerQuery(Protocol):
    def find_first_by_email(self, email: str) -> AccountSnapshot | None: ...

    def get(self, account_id: str) -> AccountSnapshot | None: ...

    def normalized_email_exists(self, email: str) -> bool: ...


class WorkspaceCreationPolicy(Protocol):
    def is_workspace_creation_allowed(self) -> bool: ...

    def quota_snapshot(self) -> DeploymentQuotaSnapshot: ...


class WorkspaceMembershipQuery(Protocol):
    def list_ids_for_account(self, account_id: str) -> tuple[str, ...]: ...

    def has_active_for_account(self, account_id: str) -> bool: ...


class WorkspaceProvisioningStore(Protocol):
    def start_preparation(self, *, owner_id: str | None) -> WorkspacePreparation: ...

    def checkpoint_preparation(
        self,
        preparation: WorkspacePreparation,
        *,
        key_prepared: bool = False,
        rbac_prepared: bool = False,
        ready: bool = False,
    ) -> bool: ...

    def request_compensation(
        self,
        preparation: WorkspacePreparation,
        *,
        error: str | None,
    ) -> bool: ...

    def record_commit_unknown(self, preparation: WorkspacePreparation, *, error: str) -> None: ...

    def finish_compensation(self, workspace_id: str, *, error: str | None) -> None: ...

    def cancel_setup_workspace(self, *, workspace_id: str, owner_id: str) -> WorkspaceCancellationResult: ...

    def provision(
        self,
        creation: WorkspaceCreation,
        *,
        preparation: WorkspacePreparation,
        owner_id: str | None,
        account: AccountCreation | None = None,
        only_if_no_active_workspace: bool = False,
        quota: DeploymentQuotaSnapshot,
    ) -> WorkspaceProvisioningResult:
        """Recheck eligibility and commit a prepared aggregate under the required database locks."""
        ...


class WorkspaceProvisioningEffects(Protocol):
    def prepare(self, workspace_id: str, name: str) -> WorkspaceCreation: ...

    def discard_key(self, workspace_id: str) -> None: ...

    def bind_owner(self, workspace_id: str, account_id: str) -> None: ...

    def unbind_owner(self, workspace_id: str, account_id: str) -> None: ...

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


class WorkspacePreparationRecoveryStore(Protocol):
    def list_recoverable_preparations(self, *, limit: int = 100) -> tuple[str, ...]: ...

    def resolve_preparation(self, workspace_id: str) -> WorkspaceCompensation | None: ...

    def finish_compensation(self, workspace_id: str, *, error: str | None) -> None: ...


class WorkspacePreparationCancelledError(RuntimeError):
    """Raised when recovery isolated an expired provisioning lease."""


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
        workspace = self._create(name=name, owner_id=owner_id)
        assert workspace is not None
        return workspace

    def create_owner_workspace(
        self, account_id: str, *, name: str | None = None, is_setup: bool = False, if_missing: bool = False
    ) -> CreatedWorkspace | None:
        if if_missing and self._memberships.list_ids_for_account(account_id):
            return
        if not is_setup and not self._policies.is_workspace_creation_allowed():
            raise WorkSpaceNotAllowedCreateError()
        owner = self._owners.get(account_id)
        if owner is None:
            raise AccountNotFoundError()
        return self._create(name=name or f"{owner.name}'s Workspace", owner_id=owner.id)

    def create_account_with_owner_workspace(self, account: AccountCreation) -> AccountSnapshot:
        if not self._policies.is_workspace_creation_allowed():
            raise WorkSpaceNotAllowedCreateError()
        self._create(name=f"{account.name}'s Workspace", owner_id=account.id, account=account)
        created = self._owners.get(account.id)
        if created is None:
            raise AccountNotFoundError()
        return created

    def _create(
        self,
        *,
        name: str,
        owner_id: str | None,
        account: AccountCreation | None = None,
        only_if_no_active_workspace: bool = False,
    ) -> CreatedWorkspace | None:
        quota = self._policies.quota_snapshot()
        preparation = self._provisioning.start_preparation(owner_id=owner_id)
        try:
            creation = self._effects.prepare(preparation.workspace_id, name)
            if not self._provisioning.checkpoint_preparation(preparation, key_prepared=True):
                raise WorkspacePreparationCancelledError("workspace preparation lease expired during key creation")
            if owner_id is not None:
                self._effects.bind_owner(creation.id, owner_id)
                if not self._provisioning.checkpoint_preparation(preparation, rbac_prepared=True, ready=True):
                    raise WorkspacePreparationCancelledError("workspace preparation lease expired during owner binding")
            elif not self._provisioning.checkpoint_preparation(preparation, ready=True):
                raise WorkspacePreparationCancelledError("workspace preparation lease expired")
        except Exception as error:
            # Remote calls may have succeeded before their response was lost.
            # Fence the durable operation before issuing idempotent cleanup.
            try:
                self._request_and_compensate(preparation, owner_id, error=str(error))
            except Exception:
                logger.exception(
                    "Failed to persist or finish workspace preparation compensation: workspace_id=%s",
                    preparation.workspace_id,
                )
            raise

        result = self._provisioning.provision(
            creation,
            preparation=preparation,
            owner_id=owner_id,
            account=account,
            only_if_no_active_workspace=only_if_no_active_workspace,
            quota=quota,
        )
        if result.outcome == WorkspaceProvisioningCommitOutcome.COMMITTED:
            if result.workspace is None:
                raise RuntimeError("workspace repository returned a committed result without a workspace")
            self._effects.created(result.workspace, owner_id=owner_id)
            return result.workspace
        if result.outcome == WorkspaceProvisioningCommitOutcome.COMMIT_UNKNOWN:
            error = result.error or RuntimeError("workspace commit result is unknown")
            try:
                self._provisioning.record_commit_unknown(preparation, error=str(error))
            except Exception:
                # The committed preparation row and its expiring lease remain a
                # durable recovery path even when this status update is unavailable.
                logger.exception(
                    "Failed to persist workspace commit-unknown status; preserving external resources: workspace_id=%s",
                    preparation.workspace_id,
                )
            logger.error(
                "Workspace commit result is unknown; preserving prepared key/RBAC for durable resolution: "
                "workspace_id=%s owner_id=%s",
                preparation.workspace_id,
                owner_id,
            )
            raise error

        try:
            self._request_and_compensate(preparation, owner_id, error=str(result.error) if result.error else None)
        except Exception:
            logger.exception(
                "Failed to persist or finish rolled-back workspace compensation: workspace_id=%s",
                preparation.workspace_id,
            )
        if result.error is not None:
            raise result.error
        return None

    def _request_and_compensate(
        self,
        preparation: WorkspacePreparation,
        owner_id: str | None,
        *,
        error: str | None,
    ) -> None:
        if not self._provisioning.request_compensation(preparation, error=error):
            return
        self._compensate_preparation(preparation.workspace_id, owner_id)

    def _compensate_preparation(self, workspace_id: str, owner_id: str | None) -> None:
        errors: list[str] = []
        if owner_id is not None:
            owner_error = self._compensate_owner_binding(workspace_id, owner_id)
            if owner_error is not None:
                errors.append(owner_error)
        try:
            self._effects.discard_key(workspace_id)
        except Exception as error:
            errors.append(str(error))
            logger.exception("Failed to compensate prepared workspace key: workspace_id=%s", workspace_id)
        try:
            self._provisioning.finish_compensation(workspace_id, error="; ".join(errors) or None)
        except Exception:
            logger.exception("Failed to persist workspace compensation result: workspace_id=%s", workspace_id)

    def _compensate_owner_binding(self, workspace_id: str, owner_id: str) -> str | None:
        try:
            self._effects.unbind_owner(workspace_id, owner_id)
            return None
        except Exception as error:
            # Preserve the primary failure/no-op result after the gateway has
            # exhausted its bounded retry policy, while retaining identifiers
            # needed to reconcile the idempotent delete.
            logger.exception(
                "Failed to compensate workspace owner RBAC binding: workspace_id=%s owner_id=%s",
                workspace_id,
                owner_id,
            )
            return str(error)

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
        self.create_account_with_owner_workspace(account)
        self._effects.join_default_workspace(account.id)
        return account.id

    def cancel_setup_workspace(self, *, workspace_id: str, owner_id: str) -> None:
        """Clean a setup-created aggregate without touching unrelated installation data."""
        result = self._provisioning.cancel_setup_workspace(workspace_id=workspace_id, owner_id=owner_id)
        if result.outcome == WorkspaceProvisioningCommitOutcome.COMMITTED:
            self._compensate_preparation(workspace_id, owner_id)
            return
        if result.outcome == WorkspaceProvisioningCommitOutcome.COMMIT_UNKNOWN:
            logger.error(
                "Setup workspace cleanup commit is unknown; preserving key/RBAC for recovery: workspace_id=%s",
                workspace_id,
            )
            return
        logger.error(
            "Setup workspace cleanup rolled back; preserving key/RBAC: workspace_id=%s error=%s",
            workspace_id,
            result.error,
        )

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


class WorkspaceProvisioningRecoveryService:
    """Resolve durable commit ambiguity and retry idempotent compensation."""

    def __init__(
        self,
        *,
        preparations: WorkspacePreparationRecoveryStore,
        effects: WorkspaceProvisioningEffects,
    ) -> None:
        self._preparations = preparations
        self._effects = effects

    def recover(self, *, limit: int = 100) -> int:
        recovered = 0
        for workspace_id in self._preparations.list_recoverable_preparations(limit=limit):
            compensation = self._preparations.resolve_preparation(workspace_id)
            if compensation is None:
                continue
            errors: list[str] = []
            if compensation.owner_id is not None:
                try:
                    self._effects.unbind_owner(compensation.workspace_id, compensation.owner_id)
                except Exception as error:
                    logger.exception(
                        "Failed to recover workspace RBAC compensation: workspace_id=%s owner_id=%s",
                        compensation.workspace_id,
                        compensation.owner_id,
                    )
                    errors.append(str(error))
            try:
                self._effects.discard_key(compensation.workspace_id)
            except Exception as error:
                logger.exception(
                    "Failed to recover workspace key compensation: workspace_id=%s",
                    compensation.workspace_id,
                )
                errors.append(str(error))
            self._preparations.finish_compensation(
                compensation.workspace_id,
                error="; ".join(errors) or None,
            )
            if not errors:
                recovered += 1
        return recovered
