"""Workspace persistence shared by account queries and workspace use cases."""

from collections.abc import Callable, Sequence
from dataclasses import replace
from typing import override

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from libs.pagination import paginate_query
from models import TenantCreditPool
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
from services.account.contracts import AccountCreation
from services.account.login_service import ConsoleAuthWorkspaceQuery
from services.account_ports import AccountWorkspaceMembershipQuery, AccountWorkspaceSnapshotQuery
from services.entities.account_access_entities import AccountWorkspaceSnapshot
from services.errors.workspace import (
    MemberNotInTenantError,
    WorkspaceNotFoundError,
    WorkspaceNotLinkedError,
    WorkspaceOwnerNotFoundError,
)
from services.oauth_device_application_service import DeviceWorkspaceQuery
from services.oauth_device_contracts import DeviceWorkspace
from services.workspace.contracts import (
    CreatedWorkspace,
    WorkspaceCreation,
    WorkspaceCustomConfig,
    WorkspaceMemberRecord,
    WorkspaceMemberRemoval,
    WorkspaceMemberWrite,
    WorkspacePage,
    WorkspaceRecord,
    WorkspaceSnapshot,
)
from services.workspace.member_service import WorkspaceMemberQuery
from services.workspace.service import WorkspaceQuery, WorkspaceStore


class WorkspaceRepository(
    WorkspaceStore,
    WorkspaceQuery,
    AccountWorkspaceMembershipQuery,
    AccountWorkspaceSnapshotQuery,
    ConsoleAuthWorkspaceQuery,
    DeviceWorkspaceQuery,
    WorkspaceMemberQuery,
):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def provision(
        self,
        prepare: Callable[[], WorkspaceCreation],
        *,
        owner_id: str | None,
        account: AccountCreation | None = None,
        only_if_no_active_workspace: bool = False,
    ) -> CreatedWorkspace | None:
        """Commit the account, workspace, membership and defaults as one aggregate.

        Initial-workspace creation holds the owner's row lock from the existence
        check through preparation and commit. Preparation deliberately runs inside
        this transaction: private-key writes and RBAC bindings cannot be rolled
        back locally, so a competing sign-in must skip before creating either.
        The application supplies these external actions; this repository only
        controls when they can run. Notifications run after this method commits.
        """
        with self._session_factory.begin() as session:
            if account is not None:
                owner_id = SQLAlchemyAccountRepository.add(account, session=session).id
            elif owner_id is not None:
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
                return None
            creation = prepare()
            tenant = Tenant(name=creation.name, encrypt_public_key=creation.encrypt_public_key)
            tenant.id = creation.id
            session.add(tenant)
            if owner_id is not None:
                session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=owner_id, role=TenantAccountRole.OWNER))
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
            return CreatedWorkspace(
                tenant.id,
                tenant.name,
                tenant.plan,
                tenant.status.value,
                tenant.created_at,
                tenant.updated_at,
                tenant.encrypt_public_key,
                dict(tenant.custom_config_dict),
            )

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

    @override
    def list_for_workspace(
        self, workspace_id: str, *, role: TenantAccountRole | None = None
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
            return session.scalar(
                select(TenantAccountJoin.account_id)
                .where(TenantAccountJoin.tenant_id == workspace_id, TenantAccountJoin.role == TenantAccountRole.OWNER)
                .limit(1)
            )

    def upsert_member(self, *, workspace_id: str, account_id: str, role: TenantAccountRole) -> WorkspaceMemberWrite:
        with self._session_factory.begin() as session:
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
                session.add(TenantAccountJoin(tenant_id=workspace_id, account_id=account_id, role=role))
            else:
                membership.role = role
            return WorkspaceMemberWrite(workspace_id, account_id, role.value, account.status.value, created)

    def remove_member(self, *, workspace_id: str, account_id: str, owner_id: str) -> WorkspaceMemberRemoval:
        with self._session_factory.begin() as session:
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

    def update_member_role(self, *, workspace_id: str, account_id: str, role: TenantAccountRole) -> None:
        with self._session_factory.begin() as session:
            membership = session.scalar(
                select(TenantAccountJoin)
                .where(TenantAccountJoin.tenant_id == workspace_id, TenantAccountJoin.account_id == account_id)
                .limit(1)
            )
            if membership is None:
                raise MemberNotInTenantError("Member not in tenant.")
            if role == TenantAccountRole.OWNER:
                owner = session.scalar(
                    select(TenantAccountJoin)
                    .where(
                        TenantAccountJoin.tenant_id == workspace_id, TenantAccountJoin.role == TenantAccountRole.OWNER
                    )
                    .limit(1)
                )
                if owner:
                    owner.role = TenantAccountRole.NORMAL
            membership.role = role

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
