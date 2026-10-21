"""Workspace persistence shared by account queries and workspace use cases."""

from collections.abc import Sequence
from dataclasses import replace
from datetime import timedelta
from typing import Literal, cast, override
from uuid import uuid4

from sqlalchemy import Select, case, delete, func, or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from libs.pagination import paginate_query
from models import (
    TenantCreditPool,
    WorkspaceOwnerTransferOperation,
    WorkspaceProvisioningOperation,
)
from models import (
    WorkspaceOwnerTransferNotification as WorkspaceOwnerTransferNotificationModel,
)
from models.account import (
    Account,
    AccountStatus,
    Tenant,
    TenantAccountJoin,
    TenantAccountRole,
    TenantPluginAutoUpgradeCategory,
    TenantPluginAutoUpgradeMode,
    TenantPluginAutoUpgradeStrategy,
    TenantPluginAutoUpgradeStrategySetting,
    TenantStatus,
)
from models.dataset import Dataset
from models.enums import ProviderQuotaType
from models.model import App
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.workspace.deployment_quota_repository import lock_deployment_quota
from repositories.workspace.member_quota_repository import lock_workspace_membership
from services.account.contracts import AccountCreation
from services.account.login_service import ConsoleAuthWorkspaceQuery
from services.account_ports import AccountWorkspaceMembershipQuery, AccountWorkspaceSnapshotQuery
from services.app.query_service import DiscoveryWorkspaces
from services.entities.account_access_entities import AccountWorkspaceSnapshot
from services.errors.base import NoPermissionError
from services.errors.workspace import (
    MemberNotInTenantError,
    WorkspaceAlreadyHasOwnerError,
    WorkspaceNotFoundError,
    WorkspaceNotLinkedError,
    WorkspaceOwnerNotFoundError,
)
from services.oauth_device_application_service import DeviceWorkspaceQuery
from services.oauth_device_contracts import DeviceWorkspace
from services.workspace.contracts import (
    CreatedWorkspace,
    WorkspaceCancellationResult,
    WorkspaceCompensation,
    WorkspaceCreation,
    WorkspaceCustomConfig,
    WorkspaceMemberRecord,
    WorkspaceMemberRemoval,
    WorkspaceMemberWrite,
    WorkspaceOwnerTransfer,
    WorkspaceOwnerTransferNotification,
    WorkspaceOwnerTransferNotificationDetails,
    WorkspacePage,
    WorkspacePreparation,
    WorkspaceProvisioningCommitOutcome,
    WorkspaceProvisioningResult,
    WorkspaceRecord,
    WorkspaceSnapshot,
)
from services.workspace.member_service import WorkspaceMemberQuery
from services.workspace.quota import DeploymentQuotaSnapshot, WorkspaceMemberQuotaSnapshot
from services.workspace.service import WorkspaceQuery, WorkspaceStore

_PREPARATION_LEASE = timedelta(minutes=5)
_COMPENSATION_WATCH_INTERVAL = timedelta(minutes=5)
_OWNER_TRANSFER_EXECUTION_LEASE = timedelta(minutes=5)
_OWNER_TRANSFER_WATCH_INTERVAL = timedelta(minutes=5)
_OWNER_TRANSFER_PENDING = "pending"
_OWNER_TRANSFER_WATCH = "watch"
_OWNER_TRANSFER_NOTIFICATION_WAITING = "waiting"
_OWNER_TRANSFER_NOTIFICATION_PENDING = "pending"
_OWNER_TRANSFER_NOTIFICATION_SENT = "sent"
_OWNER_TRANSFER_NOTIFICATION_LEASE = timedelta(minutes=5)
_OWNER_TRANSFER_NOTIFICATION_RETRY_DELAY = timedelta(minutes=1)


class WorkspaceRepository(
    WorkspaceStore,
    WorkspaceQuery,
    AccountWorkspaceMembershipQuery,
    AccountWorkspaceSnapshotQuery,
    ConsoleAuthWorkspaceQuery,
    DeviceWorkspaceQuery,
    WorkspaceMemberQuery,
    DiscoveryWorkspaces,
):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def names_by_ids(self, workspace_ids: Sequence[str]) -> dict[str, str]:
        if not workspace_ids:
            return {}
        with self._session_factory() as session:
            rows = session.execute(select(Tenant.id, Tenant.name).where(Tenant.id.in_(workspace_ids)))
            return dict(rows.tuples().all())

    def get_account_role(self, *, account_id: str, tenant_id: str) -> str | None:
        """Read the current membership role without loading or mutating an Account."""
        return self.get_legacy_role(workspace_id=tenant_id, account_id=account_id)

    def start_preparation(self, *, owner_id: str | None) -> WorkspacePreparation:
        """Persist the workspace identity before any external resource is created."""
        now = naive_utc_now()
        preparation = WorkspacePreparation(workspace_id=str(uuid4()), lease_id=str(uuid4()))
        with self._session_factory.begin() as session:
            session.add(
                WorkspaceProvisioningOperation(
                    workspace_id=preparation.workspace_id,
                    owner_account_id=owner_id,
                    lease_id=preparation.lease_id,
                    lease_expires_at=now + _PREPARATION_LEASE,
                )
            )
        return preparation

    def checkpoint_preparation(
        self,
        preparation: WorkspacePreparation,
        *,
        key_prepared: bool = False,
        rbac_prepared: bool = False,
        ready: bool = False,
    ) -> bool:
        """Renew a live preparation, refusing a lease isolated by recovery."""
        with self._session_factory.begin() as session:
            operation = session.get(
                WorkspaceProvisioningOperation,
                preparation.workspace_id,
                with_for_update=True,
            )
            if (
                operation is None
                or operation.lease_id != preparation.lease_id
                or operation.status not in {"preparing", "prepared"}
            ):
                return False
            operation.key_prepared = operation.key_prepared or key_prepared
            operation.rbac_prepared = operation.rbac_prepared or rbac_prepared
            operation.status = "prepared" if ready else operation.status
            operation.lease_expires_at = naive_utc_now() + _PREPARATION_LEASE
            operation.last_error = None
            return True

    def request_compensation(
        self,
        preparation: WorkspacePreparation,
        *,
        error: str | None,
    ) -> bool:
        """Fence the request before external compensation can start."""
        with self._session_factory.begin() as session:
            operation = session.get(
                WorkspaceProvisioningOperation,
                preparation.workspace_id,
                with_for_update=True,
            )
            if operation is None or operation.status == "committed":
                return False
            # A successful cleanup remains a durable tombstone because an
            # already-started provider call can finish after the prior delete.
            # Reopening it lets the live caller remove that late side effect.
            if session.get(Tenant, preparation.workspace_id) is not None:
                operation.status = "committed"
                operation.lease_id = None
                operation.lease_expires_at = None
                operation.last_error = None
                operation.finished_at = naive_utc_now()
                return False
            if operation.lease_id not in {None, preparation.lease_id}:
                return False
            operation.status = "compensation_pending"
            operation.lease_id = None
            operation.lease_expires_at = None
            operation.last_error = error
            operation.finished_at = None
            return True

    def record_commit_unknown(self, preparation: WorkspacePreparation, *, error: str) -> None:
        """Persist ambiguity without regressing a commit that actually succeeded."""
        with self._session_factory.begin() as session:
            operation = session.get(
                WorkspaceProvisioningOperation,
                preparation.workspace_id,
                with_for_update=True,
            )
            if operation is None or operation.status == "committed":
                return
            operation.status = "commit_unknown"
            operation.lease_id = None
            operation.lease_expires_at = None
            operation.last_error = error

    def finish_compensation(self, workspace_id: str, *, error: str | None) -> None:
        with self._session_factory.begin() as session:
            operation = session.get(WorkspaceProvisioningOperation, workspace_id, with_for_update=True)
            if operation is None or operation.status == "committed":
                return
            operation.compensation_attempts += 1
            operation.last_error = error
            if error is None:
                # This is deliberately not a terminal state. Periodic
                # reconciliation repeats the idempotent cleanup so a provider
                # operation that outlives its lease cannot leak a late key or
                # RBAC binding after this delete returns.
                operation.status = "compensation_watch"
                operation.finished_at = naive_utc_now()
            else:
                operation.status = "compensation_failed"
                operation.finished_at = None

    def list_recoverable_preparations(self, *, limit: int = 100) -> tuple[str, ...]:
        """List durable candidates; each candidate is rechecked under its row lock."""
        now = naive_utc_now()
        with self._session_factory() as session:
            return tuple(
                session.scalars(
                    select(WorkspaceProvisioningOperation.workspace_id)
                    .where(
                        (
                            WorkspaceProvisioningOperation.status.in_(
                                ("commit_unknown", "compensation_pending", "compensation_failed")
                            )
                        )
                        | (
                            WorkspaceProvisioningOperation.status.in_(("preparing", "prepared"))
                            & (WorkspaceProvisioningOperation.lease_expires_at < now)
                        )
                        | (
                            WorkspaceProvisioningOperation.status.in_(("compensation_watch", "compensated"))
                            & (WorkspaceProvisioningOperation.updated_at < now - _COMPENSATION_WATCH_INTERVAL)
                        )
                    )
                    .order_by(
                        case(
                            (WorkspaceProvisioningOperation.status.in_(("compensation_watch", "compensated")), 1),
                            else_=0,
                        ),
                        WorkspaceProvisioningOperation.updated_at,
                        WorkspaceProvisioningOperation.workspace_id,
                    )
                    .limit(limit)
                )
            )

    def resolve_preparation(self, workspace_id: str) -> WorkspaceCompensation | None:
        """Resolve a candidate behind the same transaction-end barrier as provision."""
        now = naive_utc_now()
        with self._session_factory.begin() as session:
            # Keep this as the first statement. It waits for the original
            # aggregate transaction before the primary/current Tenant read.
            operation = session.get(WorkspaceProvisioningOperation, workspace_id, with_for_update=True)
            if operation is None or operation.status == "committed":
                return None
            if session.get(Tenant, workspace_id) is not None:
                operation.status = "committed"
                operation.lease_id = None
                operation.lease_expires_at = None
                operation.last_error = None
                operation.finished_at = now
                return None
            if operation.status in {"preparing", "prepared"}:
                if operation.lease_expires_at is None or operation.lease_expires_at >= now:
                    return None
            # Invalidating the lease while holding the mutex isolates any old
            # preparer before its external resources are reclaimed.
            operation.status = "compensation_pending"
            operation.lease_id = None
            operation.lease_expires_at = None
            operation.finished_at = None
            return WorkspaceCompensation(workspace_id=workspace_id, owner_id=operation.owner_account_id)

    def cancel_setup_workspace(self, *, workspace_id: str, owner_id: str) -> WorkspaceCancellationResult:
        """Delete only the fresh aggregate created by a failed setup attempt."""
        session = self._session_factory()
        try:
            try:
                operation = session.get(WorkspaceProvisioningOperation, workspace_id, with_for_update=True)
                if operation is None or operation.status != "committed" or operation.owner_account_id != owner_id:
                    raise RuntimeError("setup workspace is not owned by this provisioning operation")
                tenant = session.get(Tenant, workspace_id, with_for_update=True)
                if tenant is None:
                    operation.status = "compensation_pending"
                else:
                    memberships = tuple(
                        session.scalars(
                            select(TenantAccountJoin)
                            .where(TenantAccountJoin.tenant_id == workspace_id)
                            .with_for_update()
                        )
                    )
                    if len(memberships) != 1 or memberships[0].account_id != owner_id:
                        raise RuntimeError("setup workspace membership changed before cleanup")
                    session.execute(delete(TenantCreditPool).where(TenantCreditPool.tenant_id == workspace_id))
                    session.execute(
                        delete(TenantPluginAutoUpgradeStrategy).where(
                            TenantPluginAutoUpgradeStrategy.tenant_id == workspace_id
                        )
                    )
                    session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == workspace_id))
                    session.delete(tenant)
                    operation.status = "compensation_pending"
                operation.finished_at = None
                operation.last_error = "setup initialization failed after workspace commit"
                session.flush()
            except Exception as error:
                session.rollback()
                return WorkspaceCancellationResult(
                    WorkspaceProvisioningCommitOutcome.ROLLED_BACK_BEFORE_COMMIT,
                    error=error,
                )
            try:
                session.commit()
            except Exception as error:
                return WorkspaceCancellationResult(
                    WorkspaceProvisioningCommitOutcome.COMMIT_UNKNOWN,
                    error=error,
                )
            return WorkspaceCancellationResult(WorkspaceProvisioningCommitOutcome.COMMITTED)
        finally:
            session.close()

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
        """Commit the account, workspace, membership and defaults as one aggregate.

        The application prepares external state before entering this method. This
        transaction keeps the deployment quota mutex and owner/account recheck
        limited to local aggregate writes. Notifications and compensating remote
        cleanup run after the transaction closes.
        """
        if creation.id != preparation.workspace_id:
            return WorkspaceProvisioningResult(
                WorkspaceProvisioningCommitOutcome.ROLLED_BACK_BEFORE_COMMIT,
                error=ValueError("workspace preparation identity changed"),
            )

        session = self._session_factory(expire_on_commit=False)
        workspace: CreatedWorkspace | None = None
        skipped = False
        try:
            try:
                # The stable operation mutex must be the first SQL even when
                # quotas are unlimited or setup has no DifySetup marker yet.
                operation = session.get(
                    WorkspaceProvisioningOperation,
                    preparation.workspace_id,
                    with_for_update=True,
                )
                if operation is None or operation.lease_id != preparation.lease_id or operation.status != "prepared":
                    raise RuntimeError("workspace preparation is no longer active")
                quota_guard = lock_deployment_quota(
                    session,
                    quota,
                    seats_delta=int(account is not None),
                    workspaces_delta=1,
                )
                if account is None and owner_id is not None:
                    owner = session.get(Account, owner_id, with_for_update=only_if_no_active_workspace)
                    if owner is None:
                        raise WorkspaceOwnerNotFoundError()
                if (
                    only_if_no_active_workspace
                    and session.scalar(
                        select(Tenant.id)
                        .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
                        .where(TenantAccountJoin.account_id == owner_id, Tenant.status == TenantStatus.NORMAL)
                        .limit(1)
                    )
                    is not None
                ):
                    skipped = True
                    operation.status = "compensation_pending"
                    operation.lease_id = None
                    operation.lease_expires_at = None
                else:
                    quota_guard.check()
                    if account is not None:
                        owner_id = SQLAlchemyAccountRepository.add(account, session=session).id
                    tenant = Tenant(name=creation.name, encrypt_public_key=creation.encrypt_public_key)
                    tenant.id = creation.id
                    session.add(tenant)
                    if owner_id is not None:
                        session.add(
                            TenantAccountJoin(
                                tenant_id=tenant.id,
                                account_id=owner_id,
                                role=TenantAccountRole.OWNER,
                            )
                        )
                    for category, setting in creation.plugin_upgrade_settings.items():
                        session.add(
                            TenantPluginAutoUpgradeStrategy(
                                tenant_id=tenant.id,
                                category=TenantPluginAutoUpgradeCategory(category),
                                strategy_setting=TenantPluginAutoUpgradeStrategySetting(setting),
                                upgrade_time_of_day=creation.plugin_upgrade_time,
                                upgrade_mode=TenantPluginAutoUpgradeMode.EXCLUDE,
                                exclude_plugins=[],
                                include_plugins=[],
                            )
                        )
                    session.add(
                        TenantCreditPool(
                            tenant_id=tenant.id,
                            quota_limit=creation.trial_credits,
                            quota_used=0,
                            pool_type=ProviderQuotaType.TRIAL,
                        )
                    )
                    session.flush()
                    operation.status = "committed"
                    operation.lease_id = None
                    operation.lease_expires_at = None
                    operation.finished_at = naive_utc_now()
                    workspace = CreatedWorkspace(
                        tenant.id,
                        tenant.name,
                        tenant.plan,
                        tenant.status.value,
                        tenant.created_at,
                        tenant.updated_at,
                        tenant.encrypt_public_key,
                        dict(tenant.custom_config_dict),
                    )
                # Flush every aggregate and operation-row mutation before the
                # commit attempt so validation/SQL failures remain a definite
                # ROLLED_BACK_BEFORE_COMMIT outcome.
                session.flush()
            except Exception as error:
                session.rollback()
                return WorkspaceProvisioningResult(
                    WorkspaceProvisioningCommitOutcome.ROLLED_BACK_BEFORE_COMMIT,
                    error=error,
                )

            try:
                session.commit()
            except Exception as error:
                return WorkspaceProvisioningResult(
                    WorkspaceProvisioningCommitOutcome.COMMIT_UNKNOWN,
                    error=error,
                )
            if skipped:
                return WorkspaceProvisioningResult(WorkspaceProvisioningCommitOutcome.ROLLED_BACK_BEFORE_COMMIT)
            return WorkspaceProvisioningResult(
                WorkspaceProvisioningCommitOutcome.COMMITTED,
                workspace=workspace,
            )
        finally:
            session.close()

    @override
    def list_for_account(self, account_id: str) -> tuple[WorkspaceRecord, ...]:
        stmt = (
            select(
                Tenant.id,
                Tenant.name,
                Tenant.status,
                Tenant.created_at,
                TenantAccountJoin.last_opened_at,
            )
            .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
            .where(
                TenantAccountJoin.account_id == account_id,
                Tenant.status == TenantStatus.NORMAL,
            )
            .order_by(Tenant.created_at.asc())
        )

        with self._session_factory() as session:
            rows = session.execute(stmt).all()
            return tuple(
                WorkspaceRecord(
                    id=workspace_id,
                    name=name,
                    status=status.value,
                    created_at=created_at,
                    last_opened_at=last_opened_at,
                )
                for workspace_id, name, status, created_at, last_opened_at in rows
            )

    @override
    def list_ids_for_account(self, account_id: str) -> tuple[str, ...]:
        stmt = select(TenantAccountJoin.tenant_id).where(TenantAccountJoin.account_id == account_id)
        with self._session_factory() as session:
            return tuple(session.scalars(stmt).all())

    @override
    def list_account_access_workspaces(self, account_id: str) -> tuple[AccountWorkspaceSnapshot, ...]:
        """List every membership for the OpenAPI account identity response.

        Unlike the Console workspace picker, the identity response preserves
        its existing behavior of including archived memberships.
        """
        stmt = (
            select(
                Tenant.id,
                Tenant.name,
                TenantAccountJoin.role,
                TenantAccountJoin.current,
            )
            .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
            .where(TenantAccountJoin.account_id == account_id)
            .order_by(Tenant.created_at.asc(), Tenant.id.asc())
        )
        with self._session_factory() as session:
            return tuple(
                AccountWorkspaceSnapshot(
                    id=workspace_id,
                    name=name,
                    role=role.value,
                    current=current,
                )
                for workspace_id, name, role, current in session.execute(stmt).all()
            )

    @override
    def list_for_device_flow(self, account_id: str) -> tuple[DeviceWorkspace, ...]:
        return tuple(
            DeviceWorkspace(
                id=workspace.id,
                name=workspace.name,
                role=workspace.role,
                current=workspace.current,
            )
            for workspace in self.list_account_access_workspaces(account_id)
        )

    @override
    def has_active_for_account(self, account_id: str) -> bool:
        stmt = (
            select(Tenant.id)
            .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
            .where(
                TenantAccountJoin.account_id == account_id,
                Tenant.status == TenantStatus.NORMAL,
            )
            .limit(1)
        )
        with self._session_factory() as session:
            return session.scalar(stmt) is not None

    @override
    def has_active_membership(self, account_id: str) -> bool:
        return self.has_active_for_account(account_id)

    @override
    def list_all(self, *, page: int, limit: int) -> WorkspacePage:
        with self._session_factory() as session:
            result = paginate_query(
                select(Tenant).order_by(Tenant.created_at.desc()), session=session, page=page, per_page=limit
            )
            return WorkspacePage(
                data=tuple(self._snapshot(tenant) for tenant in result.items),
                total=result.total,
                page=result.page,
                limit=result.per_page,
                has_more=result.has_next,
            )

    @staticmethod
    def _snapshot(
        tenant: Tenant, role: TenantAccountRole | None = None, *, has_privileged_member: bool = False
    ) -> WorkspaceSnapshot:
        config = tenant.custom_config_dict
        return WorkspaceSnapshot(
            id=tenant.id,
            name=tenant.name,
            status=tenant.status.value,
            created_at=tenant.created_at,
            role=role.value if role is not None else None,
            custom_config=WorkspaceCustomConfig(
                remove_webapp_brand=config.get("remove_webapp_brand", False),
                replace_webapp_logo=config.get("replace_webapp_logo"),
            ),
            has_privileged_member=has_privileged_member,
        )

    @classmethod
    def _account_snapshot(cls, session: Session, tenant: Tenant, account_id: str) -> WorkspaceSnapshot:
        role = session.scalar(
            select(TenantAccountJoin.role).where(
                TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == account_id
            )
        )
        if role is None:
            raise WorkspaceNotFoundError()
        return cls._snapshot(
            tenant,
            role,
            has_privileged_member=session.scalar(
                select(TenantAccountJoin.id)
                .where(
                    TenantAccountJoin.tenant_id == tenant.id,
                    TenantAccountJoin.role.in_([TenantAccountRole.OWNER, TenantAccountRole.ADMIN]),
                )
                .limit(1)
            )
            is not None,
        )

    @override
    def get_for_account(self, workspace_id: str, account_id: str) -> WorkspaceSnapshot | None:
        with self._session_factory() as session:
            tenant = session.get(Tenant, workspace_id)
            return self._account_snapshot(session, tenant, account_id) if tenant is not None else None

    @override
    def switch(self, *, account_id: str, workspace_id: str) -> WorkspaceSnapshot:
        with self._session_factory(expire_on_commit=False) as session:
            account = session.get(Account, account_id)
            if account is None:
                raise WorkspaceNotLinkedError()
            membership = session.scalar(
                select(TenantAccountJoin)
                .join(Tenant, Tenant.id == TenantAccountJoin.tenant_id)
                .where(
                    TenantAccountJoin.account_id == account_id,
                    TenantAccountJoin.tenant_id == workspace_id,
                    Tenant.status == TenantStatus.NORMAL,
                )
                .limit(1)
            )
            if membership is None:
                raise WorkspaceNotLinkedError()
            session.execute(
                update(TenantAccountJoin)
                .where(TenantAccountJoin.account_id == account_id, TenantAccountJoin.tenant_id != workspace_id)
                .values(current=False)
            )
            membership.current = True
            membership.last_opened_at = naive_utc_now()
            session.commit()
            tenant = session.get(Tenant, workspace_id)
            if tenant is None:
                raise WorkspaceNotFoundError()
            return replace(self._account_snapshot(session, tenant, account_id), current=True)

    def get(self, workspace_id: str) -> WorkspaceSnapshot | None:
        with self._session_factory() as session:
            tenant = session.get(Tenant, workspace_id)
            return self._snapshot(tenant) if tenant else None

    def get_model(self, workspace_id: str) -> Tenant | None:
        """Materialize a workspace identity for admission adapters."""
        with self._session_factory() as session:
            return session.get(Tenant, workspace_id)

    def get_many(self, workspace_ids: Sequence[str]) -> tuple[WorkspaceSnapshot, ...]:
        if not workspace_ids:
            return ()
        with self._session_factory() as session:
            return tuple(
                self._snapshot(tenant) for tenant in session.scalars(select(Tenant).where(Tenant.id.in_(workspace_ids)))
            )

    def list_memberships(self, account_id: str) -> tuple[WorkspaceSnapshot, ...]:
        with self._session_factory() as session:
            rows = session.execute(
                select(Tenant, TenantAccountJoin)
                .join(TenantAccountJoin, Tenant.id == TenantAccountJoin.tenant_id)
                .where(TenantAccountJoin.account_id == account_id)
                .order_by(Tenant.created_at.asc())
            )
            return tuple(replace(self._snapshot(tenant, join.role), current=join.current) for tenant, join in rows)

    def find_membership(self, account_id: str, workspace_id: str) -> WorkspaceSnapshot | None:
        with self._session_factory() as session:
            row = session.execute(
                select(Tenant, TenantAccountJoin)
                .join(TenantAccountJoin, Tenant.id == TenantAccountJoin.tenant_id)
                .where(Tenant.id == workspace_id, TenantAccountJoin.account_id == account_id)
            ).first()
            return replace(self._snapshot(row[0], row[1].role), current=row[1].current) if row else None

    def member_role(self, workspace_id: str, account_id: str | None) -> TenantAccountRole | None:
        if not account_id:
            return None
        with self._session_factory() as session:
            return session.execute(
                select(TenantAccountJoin.role).where(
                    TenantAccountJoin.tenant_id == workspace_id, TenantAccountJoin.account_id == account_id
                )
            ).scalar_one_or_none()

    def get_legacy_role(self, *, workspace_id: str, account_id: str) -> str | None:
        """Return one member's role without loading the whole workspace roster."""
        role = self.member_role(workspace_id, account_id)
        return role.value if role is not None else None

    @override
    def list_for_workspace(
        self, workspace_id: str, *, role: TenantAccountRole | None = None, account_ids: Sequence[str] | None = None
    ) -> tuple[WorkspaceMemberRecord, ...]:
        """Read membership snapshots without retaining a Session during role resolution."""
        stmt = (
            select(
                Account.id,
                Account.name,
                Account.email,
                Account.avatar,
                Account.last_login_at,
                Account.last_active_at,
                Account.created_at,
                Account.status,
                TenantAccountJoin.role,
            )
            .select_from(Account)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(TenantAccountJoin.tenant_id == workspace_id)
        )
        if role is not None:
            stmt = stmt.where(TenantAccountJoin.role == role)
        if account_ids is not None:
            if not account_ids:
                return ()
            stmt = stmt.where(Account.id.in_(account_ids))

        with self._session_factory() as session:
            return tuple(
                WorkspaceMemberRecord(
                    id=account_id,
                    name=name,
                    email=email,
                    avatar=avatar,
                    last_login_at=last_login_at,
                    last_active_at=last_active_at,
                    created_at=created_at,
                    status=status.value,
                    legacy_role=member_role.value,
                )
                for (
                    account_id,
                    name,
                    email,
                    avatar,
                    last_login_at,
                    last_active_at,
                    created_at,
                    status,
                    member_role,
                ) in session.execute(stmt).all()
            )

    def owner_id(self, workspace_id: str) -> str | None:
        with self._session_factory() as session:
            return session.scalar(self._owner_id_query(workspace_id))

    def active_owner_id(self, workspace_id: str) -> str | None:
        with self._session_factory() as session:
            return session.scalar(
                self._owner_id_query(workspace_id)
                .join(Tenant, Tenant.id == TenantAccountJoin.tenant_id)
                .where(Tenant.status == TenantStatus.NORMAL)
            )

    @staticmethod
    def _owner_id_query(workspace_id: str) -> Select[tuple[str]]:
        return (
            select(TenantAccountJoin.account_id)
            .where(TenantAccountJoin.tenant_id == workspace_id, TenantAccountJoin.role == TenantAccountRole.OWNER)
            .limit(1)
        )

    def upsert_member(
        self,
        *,
        workspace_id: str,
        account_id: str,
        role: TenantAccountRole,
        quota: WorkspaceMemberQuotaSnapshot,
    ) -> WorkspaceMemberWrite:
        with self._session_factory.begin() as session:
            guard = lock_workspace_membership(session, workspace_id=workspace_id, quota=quota)
            account = session.get(Account, account_id)
            if account is None:
                raise MemberNotInTenantError("Member not in tenant.")
            membership = session.scalar(
                select(TenantAccountJoin)
                .where(TenantAccountJoin.tenant_id == workspace_id, TenantAccountJoin.account_id == account_id)
                .limit(1)
            )
            created = membership is None
            if membership is None:
                guard.check_delta(1)
                session.add(TenantAccountJoin(tenant_id=workspace_id, account_id=account_id, role=role))
            else:
                membership.role = role
            if role == TenantAccountRole.OWNER:
                owner_id = session.scalar(
                    select(TenantAccountJoin.account_id)
                    .where(
                        TenantAccountJoin.tenant_id == workspace_id,
                        TenantAccountJoin.role == TenantAccountRole.OWNER,
                        TenantAccountJoin.account_id != account_id,
                    )
                    .limit(1)
                )
                if owner_id is not None:
                    raise WorkspaceAlreadyHasOwnerError("Tenant already has an owner.")
            return WorkspaceMemberWrite(workspace_id, account_id, role.value, account.status.value, created)

    def remove_member(self, *, workspace_id: str, account_id: str, owner_id: str) -> WorkspaceMemberRemoval:
        with self._session_factory.begin() as session:
            workspace = session.scalar(
                select(Tenant)
                .where(Tenant.id == workspace_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if workspace is None:
                raise WorkspaceNotFoundError()
            account = session.get(Account, account_id)
            membership = session.scalar(
                select(TenantAccountJoin)
                .where(TenantAccountJoin.tenant_id == workspace_id, TenantAccountJoin.account_id == account_id)
                .limit(1)
            )
            if account is None or membership is None:
                raise MemberNotInTenantError("Member not in tenant.")
            session.execute(
                update(App)
                .where(App.tenant_id == workspace_id, App.maintainer == account_id)
                .values(maintainer=owner_id)
            )
            session.execute(
                update(Dataset)
                .where(Dataset.tenant_id == workspace_id, Dataset.maintainer == account_id)
                .values(maintainer=owner_id)
            )
            session.delete(membership)
            delete_account = account.status == AccountStatus.PENDING and not session.scalar(
                select(func.count(TenantAccountJoin.id)).where(TenantAccountJoin.account_id == account_id)
            )
            email = account.email
            if delete_account:
                session.delete(account)
            return WorkspaceMemberRemoval(account_id, email, delete_account)

    def update_member_role(
        self,
        *,
        workspace_id: str,
        actor_account_id: str,
        account_id: str,
        role: TenantAccountRole,
    ) -> None:
        with self._session_factory.begin() as session:
            workspace = session.scalar(
                select(Tenant)
                .where(Tenant.id == workspace_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if workspace is None:
                raise WorkspaceNotFoundError()

            memberships = tuple(
                session.scalars(
                    select(TenantAccountJoin)
                    .where(
                        TenantAccountJoin.tenant_id == workspace_id,
                        TenantAccountJoin.account_id.in_(tuple(sorted({actor_account_id, account_id}))),
                    )
                    .order_by(TenantAccountJoin.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            membership_by_account = {membership.account_id: membership for membership in memberships}
            membership = membership_by_account.get(account_id)
            if membership is None:
                raise MemberNotInTenantError("Member not in tenant.")
            if role == TenantAccountRole.OWNER:
                actor_membership = membership_by_account.get(actor_account_id)
                if actor_membership is None or actor_membership.role != TenantAccountRole.OWNER:
                    raise NoPermissionError("Only the current workspace owner can transfer ownership.")
                owners = tuple(
                    session.scalars(
                        select(TenantAccountJoin)
                        .where(
                            TenantAccountJoin.tenant_id == workspace_id,
                            TenantAccountJoin.role == TenantAccountRole.OWNER,
                        )
                        .order_by(TenantAccountJoin.id)
                        .with_for_update()
                        .execution_options(populate_existing=True)
                    )
                )
                if len(owners) != 1 or owners[0].account_id != actor_account_id:
                    raise NoPermissionError("Workspace ownership changed before the transfer completed.")
                actor_membership.role = TenantAccountRole.NORMAL
            membership.role = role

    def get_pending_owner_transfer(self, workspace_id: str) -> WorkspaceOwnerTransfer | None:
        with self._session_factory() as session:
            operation = session.get(WorkspaceOwnerTransferOperation, workspace_id)
            if operation is None or operation.status != _OWNER_TRANSFER_PENDING:
                return None
            return self._owner_transfer_snapshot(operation)

    def prepare_owner_transfer(
        self,
        *,
        workspace_id: str,
        actor_account_id: str,
        account_id: str,
        notification: WorkspaceOwnerTransferNotificationDetails | None = None,
    ) -> WorkspaceOwnerTransfer:
        """Persist transfer intent after rechecking local ownership under locks."""
        with self._session_factory.begin() as session:
            operation = session.get(WorkspaceOwnerTransferOperation, workspace_id, with_for_update=True)
            if operation is not None and operation.status == _OWNER_TRANSFER_PENDING:
                if operation.old_owner_account_id != actor_account_id or operation.new_owner_account_id != account_id:
                    raise NoPermissionError("Another ownership transfer is already in progress.")
                self._ensure_owner_transfer_notifications(session, operation, notification)
                return self._owner_transfer_snapshot(operation)
            workspace = session.scalar(
                select(Tenant)
                .where(Tenant.id == workspace_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if workspace is None:
                raise WorkspaceNotFoundError()
            # A first-time preparer cannot lock a row that does not exist, so
            # recheck after acquiring the workspace mutex that serializes creation.
            operation = session.get(WorkspaceOwnerTransferOperation, workspace_id, with_for_update=True)
            if operation is not None and operation.status == _OWNER_TRANSFER_PENDING:
                if operation.old_owner_account_id != actor_account_id or operation.new_owner_account_id != account_id:
                    raise NoPermissionError("Another ownership transfer is already in progress.")
                self._ensure_owner_transfer_notifications(session, operation, notification)
                return self._owner_transfer_snapshot(operation)

            memberships = tuple(
                session.scalars(
                    select(TenantAccountJoin)
                    .where(
                        TenantAccountJoin.tenant_id == workspace_id,
                        TenantAccountJoin.account_id.in_(tuple(sorted({actor_account_id, account_id}))),
                    )
                    .order_by(TenantAccountJoin.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            membership_by_account = {membership.account_id: membership for membership in memberships}
            actor_membership = membership_by_account.get(actor_account_id)
            target_membership = membership_by_account.get(account_id)
            if actor_membership is None or actor_membership.role != TenantAccountRole.OWNER:
                raise NoPermissionError("Only the current workspace owner can transfer ownership.")
            if target_membership is None:
                raise MemberNotInTenantError("Member not in tenant.")
            if target_membership.role == TenantAccountRole.OWNER:
                raise NoPermissionError("The target account already owns the workspace.")
            now = naive_utc_now()
            possible_owner_ids = tuple(
                sorted(
                    {
                        actor_account_id,
                        account_id,
                        *(operation.possible_owner_account_ids if operation is not None else ()),
                    }
                )
            )
            if operation is None:
                operation = WorkspaceOwnerTransferOperation(
                    workspace_id=workspace_id,
                    old_owner_account_id=actor_account_id,
                    new_owner_account_id=account_id,
                    possible_owner_account_ids=list(possible_owner_ids),
                    next_reconcile_at=now,
                )
                session.add(operation)
            else:
                operation.operation_id = str(uuid4())
                operation.old_owner_account_id = actor_account_id
                operation.new_owner_account_id = account_id
                operation.possible_owner_account_ids = list(possible_owner_ids)
                operation.status = _OWNER_TRANSFER_PENDING
                operation.execution_id = None
                operation.lease_expires_at = None
                operation.next_reconcile_at = now
                operation.attempts = 0
                operation.last_error = None
            session.flush()
            self._ensure_owner_transfer_notifications(session, operation, notification)
            return self._owner_transfer_snapshot(operation)

    def claim_owner_transfer_execution(self, transfer: WorkspaceOwnerTransfer) -> WorkspaceOwnerTransfer | None:
        """Acquire a durable lease before one bounded external RBAC attempt."""
        now = naive_utc_now()
        with self._session_factory.begin() as session:
            operation = session.get(
                WorkspaceOwnerTransferOperation,
                transfer.workspace_id,
                with_for_update=True,
            )
            if operation is None or operation.operation_id != transfer.operation_id:
                return None
            workspace_id = session.scalar(
                select(Tenant.id).where(Tenant.id == operation.workspace_id).with_for_update()
            )
            if workspace_id is None:
                self._discard_waiting_owner_transfer_notifications(session, operation.operation_id)
                session.delete(operation)
                return None
            if (
                operation.execution_id is not None
                and operation.lease_expires_at is not None
                and operation.lease_expires_at > now
            ):
                return None
            if operation.status == _OWNER_TRANSFER_WATCH:
                local_owner_ids = tuple(
                    session.scalars(
                        select(TenantAccountJoin.account_id)
                        .where(
                            TenantAccountJoin.tenant_id == operation.workspace_id,
                            TenantAccountJoin.role == TenantAccountRole.OWNER,
                        )
                        .order_by(TenantAccountJoin.id)
                        .with_for_update()
                    )
                )
                if len(local_owner_ids) != 1:
                    operation.execution_id = None
                    operation.lease_expires_at = None
                    operation.next_reconcile_at = now + _OWNER_TRANSFER_WATCH_INTERVAL
                    operation.last_error = "Workspace no longer has exactly one local owner."
                    return None
                local_owner_id = local_owner_ids[0]
                if local_owner_id != operation.new_owner_account_id:
                    operation.operation_id = str(uuid4())
                    operation.old_owner_account_id = operation.new_owner_account_id
                    operation.new_owner_account_id = local_owner_id
                    operation.possible_owner_account_ids = sorted(
                        {*operation.possible_owner_account_ids, local_owner_id}
                    )
            else:
                memberships = tuple(
                    session.scalars(
                        select(TenantAccountJoin)
                        .where(
                            TenantAccountJoin.tenant_id == operation.workspace_id,
                            or_(
                                TenantAccountJoin.role == TenantAccountRole.OWNER,
                                TenantAccountJoin.account_id.in_(
                                    (operation.old_owner_account_id, operation.new_owner_account_id)
                                ),
                            ),
                        )
                        .order_by(TenantAccountJoin.id)
                        .with_for_update()
                    )
                )
                membership_by_account = {membership.account_id: membership for membership in memberships}
                old_owner = membership_by_account.get(operation.old_owner_account_id)
                new_owner = membership_by_account.get(operation.new_owner_account_id)
                local_owner_ids = tuple(
                    membership.account_id for membership in memberships if membership.role == TenantAccountRole.OWNER
                )
                if old_owner is None or old_owner.role != TenantAccountRole.OWNER or new_owner is None:
                    # A leased external call can still finish after the local
                    # transfer becomes invalid. Keep the candidate set as a
                    # watch so that such a late write is repaired to the
                    # current local owner instead of losing the only recovery
                    # record.
                    self._discard_waiting_owner_transfer_notifications(session, operation.operation_id)
                    operation.operation_id = str(uuid4())
                    operation.status = _OWNER_TRANSFER_WATCH
                    operation.execution_id = None
                    operation.lease_expires_at = None
                    operation.possible_owner_account_ids = sorted(
                        {
                            *operation.possible_owner_account_ids,
                            operation.old_owner_account_id,
                            operation.new_owner_account_id,
                            *local_owner_ids,
                        }
                    )
                    if len(local_owner_ids) != 1:
                        operation.next_reconcile_at = now + _OWNER_TRANSFER_WATCH_INTERVAL
                        operation.last_error = "Workspace no longer has exactly one local owner."
                        return None
                    local_owner_id = local_owner_ids[0]
                    operation.old_owner_account_id = operation.new_owner_account_id
                    operation.new_owner_account_id = local_owner_id
            operation.execution_id = str(uuid4())
            operation.lease_expires_at = now + _OWNER_TRANSFER_EXECUTION_LEASE
            operation.attempts += 1
            operation.last_error = None
            return self._owner_transfer_snapshot(operation)

    def complete_owner_transfer(self, transfer: WorkspaceOwnerTransfer) -> bool:
        """Commit local ownership and retain the matching intent as a repair watch."""
        with self._session_factory.begin() as session:
            operation = session.get(
                WorkspaceOwnerTransferOperation,
                transfer.workspace_id,
                with_for_update=True,
            )
            if operation is None:
                return False
            if (
                operation.operation_id != transfer.operation_id
                or operation.old_owner_account_id != transfer.old_owner_account_id
                or operation.new_owner_account_id != transfer.new_owner_account_id
                or transfer.execution_id is None
                or operation.execution_id != transfer.execution_id
            ):
                return False
            workspace = session.scalar(
                select(Tenant)
                .where(Tenant.id == transfer.workspace_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if workspace is None:
                session.delete(operation)
                return False
            memberships = tuple(
                session.scalars(
                    select(TenantAccountJoin)
                    .where(
                        TenantAccountJoin.tenant_id == transfer.workspace_id,
                        TenantAccountJoin.account_id.in_(
                            tuple(sorted({transfer.old_owner_account_id, transfer.new_owner_account_id}))
                        ),
                    )
                    .order_by(TenantAccountJoin.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            membership_by_account = {membership.account_id: membership for membership in memberships}
            old_owner = membership_by_account.get(transfer.old_owner_account_id)
            new_owner = membership_by_account.get(transfer.new_owner_account_id)
            if new_owner is None:
                raise MemberNotInTenantError("Ownership transfer member disappeared.")
            if operation.status == _OWNER_TRANSFER_PENDING:
                if old_owner is None:
                    raise MemberNotInTenantError("Ownership transfer member disappeared.")
                if new_owner.role != TenantAccountRole.OWNER:
                    if old_owner.role != TenantAccountRole.OWNER:
                        raise NoPermissionError("Workspace ownership changed before the transfer completed.")
                    old_owner.role = TenantAccountRole.NORMAL
                    new_owner.role = TenantAccountRole.OWNER
            elif new_owner.role != TenantAccountRole.OWNER:
                operation.execution_id = None
                operation.lease_expires_at = None
                operation.next_reconcile_at = naive_utc_now()
                operation.last_error = "Local owner changed while the RBAC watch was executing."
                return False
            operation.status = _OWNER_TRANSFER_WATCH
            operation.execution_id = None
            operation.lease_expires_at = None
            operation.next_reconcile_at = naive_utc_now() + _OWNER_TRANSFER_WATCH_INTERVAL
            operation.last_error = None
            session.execute(
                update(WorkspaceOwnerTransferNotificationModel)
                .where(
                    WorkspaceOwnerTransferNotificationModel.operation_id == operation.operation_id,
                    WorkspaceOwnerTransferNotificationModel.status == _OWNER_TRANSFER_NOTIFICATION_WAITING,
                )
                .values(
                    status=_OWNER_TRANSFER_NOTIFICATION_PENDING,
                    next_attempt_at=naive_utc_now(),
                    last_error=None,
                )
            )
            return True

    def record_owner_transfer_error(self, transfer: WorkspaceOwnerTransfer, *, error: str) -> None:
        with self._session_factory.begin() as session:
            operation = session.get(
                WorkspaceOwnerTransferOperation,
                transfer.workspace_id,
                with_for_update=True,
            )
            if operation is None or (
                operation.operation_id != transfer.operation_id
                or operation.old_owner_account_id != transfer.old_owner_account_id
                or operation.new_owner_account_id != transfer.new_owner_account_id
                or operation.execution_id != transfer.execution_id
            ):
                return
            operation.last_error = error[:4000]
            operation.execution_id = None
            operation.lease_expires_at = None
            operation.next_reconcile_at = naive_utc_now()

    def list_pending_owner_transfers(self, *, limit: int = 100) -> tuple[WorkspaceOwnerTransfer, ...]:
        now = naive_utc_now()
        with self._session_factory() as session:
            operations = session.scalars(
                select(WorkspaceOwnerTransferOperation)
                .where(
                    WorkspaceOwnerTransferOperation.status.in_((_OWNER_TRANSFER_PENDING, _OWNER_TRANSFER_WATCH)),
                    WorkspaceOwnerTransferOperation.next_reconcile_at <= now,
                    (WorkspaceOwnerTransferOperation.execution_id.is_(None))
                    | (WorkspaceOwnerTransferOperation.lease_expires_at.is_(None))
                    | (WorkspaceOwnerTransferOperation.lease_expires_at <= now),
                )
                .order_by(
                    WorkspaceOwnerTransferOperation.next_reconcile_at,
                    WorkspaceOwnerTransferOperation.updated_at,
                    WorkspaceOwnerTransferOperation.workspace_id,
                )
                .limit(limit)
            )
            return tuple(self._owner_transfer_snapshot(operation) for operation in operations)

    def list_pending_owner_transfer_notifications(
        self,
        *,
        operation_id: str | None = None,
        limit: int = 100,
    ) -> tuple[WorkspaceOwnerTransferNotification, ...]:
        """List due notification recipients whose delivery lease is available."""
        now = naive_utc_now()
        filters = [
            WorkspaceOwnerTransferNotificationModel.status == _OWNER_TRANSFER_NOTIFICATION_PENDING,
            WorkspaceOwnerTransferNotificationModel.next_attempt_at <= now,
            (WorkspaceOwnerTransferNotificationModel.claim_id.is_(None))
            | (WorkspaceOwnerTransferNotificationModel.lease_expires_at.is_(None))
            | (WorkspaceOwnerTransferNotificationModel.lease_expires_at <= now),
        ]
        if operation_id is not None:
            filters.append(WorkspaceOwnerTransferNotificationModel.operation_id == operation_id)
        with self._session_factory() as session:
            notifications = session.scalars(
                select(WorkspaceOwnerTransferNotificationModel)
                .where(*filters)
                .order_by(
                    WorkspaceOwnerTransferNotificationModel.next_attempt_at,
                    WorkspaceOwnerTransferNotificationModel.created_at,
                    WorkspaceOwnerTransferNotificationModel.notification_id,
                )
                .limit(limit)
            )
            return tuple(self._owner_transfer_notification_snapshot(notification) for notification in notifications)

    def claim_owner_transfer_notification(
        self,
        notification: WorkspaceOwnerTransferNotification,
    ) -> WorkspaceOwnerTransferNotification | None:
        """Lease one recipient so concurrent sync and recovery dispatchers cannot both enqueue it."""
        now = naive_utc_now()
        with self._session_factory.begin() as session:
            row = session.get(
                WorkspaceOwnerTransferNotificationModel,
                notification.notification_id,
                with_for_update=True,
            )
            if row is None or not self._same_owner_transfer_notification(row, notification):
                return None
            if row.status != _OWNER_TRANSFER_NOTIFICATION_PENDING or row.next_attempt_at > now:
                return None
            if row.claim_id is not None and row.lease_expires_at is not None and row.lease_expires_at > now:
                return None
            row.claim_id = str(uuid4())
            row.lease_expires_at = now + _OWNER_TRANSFER_NOTIFICATION_LEASE
            row.attempts += 1
            row.last_error = None
            return self._owner_transfer_notification_snapshot(row)

    def complete_owner_transfer_notification(self, notification: WorkspaceOwnerTransferNotification) -> bool:
        """Mark a recipient sent only for the exact active delivery claim."""
        if notification.claim_id is None:
            return False
        with self._session_factory.begin() as session:
            row = session.get(
                WorkspaceOwnerTransferNotificationModel,
                notification.notification_id,
                with_for_update=True,
            )
            if (
                row is None
                or not self._same_owner_transfer_notification(row, notification)
                or row.status != _OWNER_TRANSFER_NOTIFICATION_PENDING
                or row.claim_id != notification.claim_id
            ):
                return False
            row.status = _OWNER_TRANSFER_NOTIFICATION_SENT
            row.claim_id = None
            row.lease_expires_at = None
            row.sent_at = naive_utc_now()
            row.last_error = None
            return True

    def record_owner_transfer_notification_error(
        self,
        notification: WorkspaceOwnerTransferNotification,
        *,
        error: str,
    ) -> None:
        """Release the exact failed claim for a later recovery pass."""
        if notification.claim_id is None:
            return
        with self._session_factory.begin() as session:
            row = session.get(
                WorkspaceOwnerTransferNotificationModel,
                notification.notification_id,
                with_for_update=True,
            )
            if (
                row is None
                or not self._same_owner_transfer_notification(row, notification)
                or row.status != _OWNER_TRANSFER_NOTIFICATION_PENDING
                or row.claim_id != notification.claim_id
            ):
                return
            row.claim_id = None
            row.lease_expires_at = None
            row.next_attempt_at = naive_utc_now() + _OWNER_TRANSFER_NOTIFICATION_RETRY_DELAY
            row.last_error = error[:4000]

    @staticmethod
    def _ensure_owner_transfer_notifications(
        session: Session,
        operation: WorkspaceOwnerTransferOperation,
        details: WorkspaceOwnerTransferNotificationDetails | None,
    ) -> None:
        if details is None:
            return
        existing_recipient_types = set(
            session.scalars(
                select(WorkspaceOwnerTransferNotificationModel.recipient_type).where(
                    WorkspaceOwnerTransferNotificationModel.operation_id == operation.operation_id
                )
            )
        )
        recipients = (
            ("old_owner", details.old_owner_email, details.old_owner_language),
            ("new_owner", details.new_owner_email, details.new_owner_language),
        )
        for recipient_type, recipient_email, recipient_language in recipients:
            if recipient_type in existing_recipient_types:
                continue
            session.add(
                WorkspaceOwnerTransferNotificationModel(
                    operation_id=operation.operation_id,
                    workspace_id=operation.workspace_id,
                    old_owner_account_id=operation.old_owner_account_id,
                    new_owner_account_id=operation.new_owner_account_id,
                    recipient_type=recipient_type,
                    recipient_email=recipient_email,
                    recipient_language=recipient_language,
                    workspace_name=details.workspace_name,
                    new_owner_email=details.new_owner_email,
                )
            )

    @staticmethod
    def _discard_waiting_owner_transfer_notifications(session: Session, operation_id: str) -> None:
        session.execute(
            delete(WorkspaceOwnerTransferNotificationModel).where(
                WorkspaceOwnerTransferNotificationModel.operation_id == operation_id,
                WorkspaceOwnerTransferNotificationModel.status == _OWNER_TRANSFER_NOTIFICATION_WAITING,
            )
        )

    @staticmethod
    def _same_owner_transfer_notification(
        row: WorkspaceOwnerTransferNotificationModel,
        notification: WorkspaceOwnerTransferNotification,
    ) -> bool:
        return (
            row.operation_id == notification.operation_id
            and row.workspace_id == notification.workspace_id
            and row.old_owner_account_id == notification.old_owner_account_id
            and row.new_owner_account_id == notification.new_owner_account_id
            and row.recipient_type == notification.recipient_type
        )

    @staticmethod
    def _owner_transfer_notification_snapshot(
        notification: WorkspaceOwnerTransferNotificationModel,
    ) -> WorkspaceOwnerTransferNotification:
        if notification.recipient_type not in {"old_owner", "new_owner"}:
            raise ValueError(f"Unknown owner-transfer notification recipient: {notification.recipient_type}")
        return WorkspaceOwnerTransferNotification(
            notification_id=notification.notification_id,
            operation_id=notification.operation_id,
            workspace_id=notification.workspace_id,
            old_owner_account_id=notification.old_owner_account_id,
            new_owner_account_id=notification.new_owner_account_id,
            recipient_type=cast(Literal["old_owner", "new_owner"], notification.recipient_type),
            recipient_email=notification.recipient_email,
            recipient_language=notification.recipient_language,
            workspace_name=notification.workspace_name,
            new_owner_email=notification.new_owner_email,
            claim_id=notification.claim_id,
        )

    @staticmethod
    def _owner_transfer_snapshot(operation: WorkspaceOwnerTransferOperation) -> WorkspaceOwnerTransfer:
        return WorkspaceOwnerTransfer(
            workspace_id=operation.workspace_id,
            old_owner_account_id=operation.old_owner_account_id,
            new_owner_account_id=operation.new_owner_account_id,
            operation_id=operation.operation_id,
            status=operation.status,
            possible_owner_account_ids=tuple(operation.possible_owner_account_ids),
            execution_id=operation.execution_id,
        )

    def list_member_ids(self, workspace_id: str, *, offset: int, limit: int) -> tuple[str, ...]:
        with self._session_factory() as session:
            return tuple(
                session.scalars(
                    select(TenantAccountJoin.account_id)
                    .where(TenantAccountJoin.tenant_id == workspace_id)
                    .order_by(TenantAccountJoin.id)
                    .offset(offset)
                    .limit(limit)
                )
            )

    def count_members(self, workspace_id: str) -> int:
        with self._session_factory() as session:
            return (
                session.scalar(
                    select(func.count(TenantAccountJoin.id)).where(TenantAccountJoin.tenant_id == workspace_id)
                )
                or 0
            )

    @override
    def rename(self, *, workspace_id: str, account_id: str, name: str) -> WorkspaceSnapshot:
        with self._session_factory.begin() as session:
            tenant = session.get(Tenant, workspace_id)
            if tenant is None:
                raise WorkspaceNotFoundError()
            snapshot = self._account_snapshot(session, tenant, account_id)
            tenant.name = name
            return replace(snapshot, name=name)

    @override
    def update_custom_config(
        self, *, workspace_id: str, account_id: str, changes: WorkspaceCustomConfig
    ) -> WorkspaceSnapshot:
        with self._session_factory.begin() as session:
            tenant = session.get(Tenant, workspace_id)
            if tenant is None:
                raise WorkspaceNotFoundError()
            snapshot = self._account_snapshot(session, tenant, account_id)
            tenant.custom_config_dict = {
                "remove_webapp_brand": changes.remove_webapp_brand,
                "replace_webapp_logo": changes.replace_webapp_logo,
            }
            return replace(snapshot, custom_config=changes)
