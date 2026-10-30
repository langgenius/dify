"""Workspace persistence shared by account queries and workspace use cases."""

from collections.abc import Callable, Sequence
from dataclasses import replace
from typing import override

from sqlalchemy import Select, func, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.shared import AccountId
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
from repositories.file.upload_file_repository import lock_and_validate_owned_upload_files_in_session
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from services.account.contracts import AccountCreation
from services.account.login_service import ConsoleAuthWorkspaceQuery
from services.account_ports import AccountWorkspaceMembershipQuery, AccountWorkspaceSnapshotQuery
from services.app.query_service import DiscoveryWorkspaces
from services.entities.account_access_entities import AccountWorkspaceSnapshot
from services.errors.base import NoPermissionError, PersistenceCommitOutcomeUnknownError
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

    def provision(
        self,
        prepare: Callable[[], WorkspaceCreation],
        *,
        owner_id: str | None,
        account: AccountCreation | None = None,
        only_if_no_active_workspace: bool = False,
        before_commit: Callable[[], None],
    ) -> CreatedWorkspace | None:
        """Commit the account, workspace, membership and defaults as one aggregate.

        Initial-workspace creation holds the owner's row lock from the existence
        check through preparation and commit. Preparation deliberately runs inside
        this transaction: private-key writes and RBAC bindings cannot be rolled
        back locally, so a competing sign-in must skip before creating either.
        The application supplies these external actions; this repository only
        controls when they can run. ``before_commit`` verifies any admission
        lease after the aggregate flushes and immediately before commit.
        Notifications run after this method commits.
        """
        with self._session_factory() as session:
            try:
                result = self._prepare_provisioning(
                    session,
                    prepare,
                    owner_id=owner_id,
                    account=account,
                    only_if_no_active_workspace=only_if_no_active_workspace,
                    before_commit=before_commit,
                )
            except BaseException:
                session.rollback()
                raise
            if result is None:
                session.rollback()
                return None
            try:
                session.commit()
            except DBAPIError as error:
                if error.connection_invalidated:
                    raise PersistenceCommitOutcomeUnknownError from error
                session.rollback()
                raise
            except BaseException as error:
                # SQLAlchemy invokes after_commit listeners inside commit(). A
                # plain RuntimeError here can therefore mean the aggregate is
                # already durable. Only pre-commit failures and database errors
                # with a live connection have a known rollback outcome.
                raise PersistenceCommitOutcomeUnknownError from error
            return result

    @staticmethod
    def _prepare_provisioning(
        session: Session,
        prepare: Callable[[], WorkspaceCreation],
        *,
        owner_id: str | None,
        account: AccountCreation | None,
        only_if_no_active_workspace: bool,
        before_commit: Callable[[], None],
    ) -> CreatedWorkspace | None:
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
            if account is None:
                SQLAlchemyContactRepository(session).provision_account_backed_contact(AccountId(owner_id))
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
        before_commit()
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
        actor_account_id: str | None = None,
    ) -> WorkspaceMemberWrite:
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
            previous_role = None if membership is None else TenantAccountRole(membership.role)
            if membership is None:
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
            # Membership writes repair missing Contact identities for existing accounts.
            SQLAlchemyContactRepository(session).provision_account_backed_contact(AccountId(account_id))
            if previous_role != role:
                from services.knowledge_fs.membership_changes import (
                    KnowledgeFSWorkspaceMembershipChange,
                    apply_workspace_membership_change,
                )

                apply_workspace_membership_change(
                    session=session,
                    tenant_id=workspace_id,
                    actor_account_id=actor_account_id or account_id,
                    account_ids=(account_id,),
                    change=(
                        KnowledgeFSWorkspaceMembershipChange.MEMBER_ADDED
                        if created
                        else KnowledgeFSWorkspaceMembershipChange.ROLE_CHANGED
                    ),
                )
            return WorkspaceMemberWrite(workspace_id, account_id, role.value, account.status.value, created)

    def remove_member(
        self,
        *,
        workspace_id: str,
        account_id: str,
        operator_account_id: str,
        require_privileged_operator: bool,
    ) -> WorkspaceMemberRemoval:
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
            memberships = tuple(
                session.scalars(
                    select(TenantAccountJoin)
                    .where(
                        TenantAccountJoin.tenant_id == workspace_id,
                        TenantAccountJoin.account_id.in_(tuple(sorted({operator_account_id, account_id}))),
                    )
                    .order_by(TenantAccountJoin.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            membership_by_account = {membership.account_id: membership for membership in memberships}
            membership = membership_by_account.get(account_id)
            if account is None or membership is None:
                raise MemberNotInTenantError("Member not in tenant.")
            operator_membership = membership_by_account.get(operator_account_id)
            if operator_membership is None:
                raise NoPermissionError("Operator is no longer a workspace member.")
            if require_privileged_operator and operator_membership.role not in {
                TenantAccountRole.OWNER,
                TenantAccountRole.ADMIN,
            }:
                raise NoPermissionError("Operator no longer has permission to remove members.")
            if membership.role == TenantAccountRole.OWNER:
                raise NoPermissionError("The workspace owner cannot be removed.")

            owner_ids = tuple(
                session.scalars(
                    select(TenantAccountJoin.account_id)
                    .where(
                        TenantAccountJoin.tenant_id == workspace_id,
                        TenantAccountJoin.role == TenantAccountRole.OWNER,
                    )
                    .order_by(TenantAccountJoin.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            if len(owner_ids) != 1:
                raise ValueError(f"Workspace owner not found for tenant {workspace_id}.")
            owner_id = owner_ids[0]
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
            from services.knowledge_fs.membership_changes import (
                KnowledgeFSWorkspaceMembershipChange,
                apply_workspace_membership_change,
            )

            apply_workspace_membership_change(
                session=session,
                tenant_id=workspace_id,
                actor_account_id=operator_account_id,
                account_ids=(account_id,),
                change=KnowledgeFSWorkspaceMembershipChange.MEMBER_REMOVED,
                removed_account_id=account_id,
                replacement_owner_account_id=owner_id,
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
        previous_owner_account_ids: Sequence[str] = (),
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
            affected_account_ids = [account_id, *previous_owner_account_ids]
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
                affected_account_ids.append(actor_account_id)
            membership.role = role
            from services.knowledge_fs.membership_changes import (
                KnowledgeFSWorkspaceMembershipChange,
                apply_workspace_membership_change,
            )

            apply_workspace_membership_change(
                session=session,
                tenant_id=workspace_id,
                actor_account_id=actor_account_id,
                account_ids=tuple(affected_account_ids),
                change=KnowledgeFSWorkspaceMembershipChange.ROLE_CHANGED,
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
            tenant = session.scalar(select(Tenant).where(Tenant.id == workspace_id).with_for_update())
            if tenant is None:
                raise WorkspaceNotFoundError()
            snapshot = self._account_snapshot(session, tenant, account_id)
            previous_logo_id = snapshot.custom_config.replace_webapp_logo
            if changes.replace_webapp_logo and changes.replace_webapp_logo != previous_logo_id:
                lock_and_validate_owned_upload_files_in_session(
                    session,
                    tenant_id=workspace_id,
                    upload_file_ids=(changes.replace_webapp_logo,),
                )
            tenant.custom_config_dict = {
                "remove_webapp_brand": changes.remove_webapp_brand,
                "replace_webapp_logo": changes.replace_webapp_logo,
            }
            return replace(snapshot, custom_config=changes)
