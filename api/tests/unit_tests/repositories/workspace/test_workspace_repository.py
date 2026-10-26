from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from unittest.mock import Mock, create_autospec

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.errors.workspace import WorkspaceNotFoundError, WorkspaceNotLinkedError
from services.workspace.contracts import (
    EffectiveCreditPool,
    WorkspaceCustomConfig,
    WorkspaceFeatures,
    WorkspaceMemberRecord,
    WorkspaceMemberRole,
    WorkspaceMemberRoleSubject,
)
from services.workspace.member_service import WorkspaceMemberQueryService
from services.workspace.service import (
    WorkspaceFeatureGateway,
    WorkspaceLogoGateway,
    WorkspaceQueryService,
    WorkspaceService,
)


def make_account(
    account_id: str,
    *,
    status: AccountStatus,
    created_at: datetime,
) -> Account:
    account = Account(
        name=f"Member {account_id}",
        email=f"{account_id}@example.com",
        avatar=f"{account_id}.png",
        status=status,
    )
    account.id = account_id
    account.last_login_at = created_at
    account.last_active_at = created_at
    account.created_at = created_at
    return account


def make_tenant(tenant_id: str) -> Tenant:
    tenant = Tenant(name=f"Workspace {tenant_id}")
    tenant.id = tenant_id
    return tenant


class TestWorkspaceMembersCases:
    @staticmethod
    def test_rbac_profile_batch_filters_requested_ids_and_workspace(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add_all([make_tenant("workspace"), make_tenant("other")])
            for account_id, workspace in [("member", "workspace"), ("unrequested", "workspace"), ("foreign", "other")]:
                session.add(make_account(account_id, status=AccountStatus.ACTIVE, created_at=datetime(2026, 1, 1)))
                session.add(
                    TenantAccountJoin(tenant_id=workspace, account_id=account_id, role=TenantAccountRole.NORMAL)
                )

        repository = WorkspaceRepository(sqlite_session_factory)
        members = repository.list_for_workspace("workspace", account_ids=["member", "foreign", "missing"])
        assert [member.id for member in members] == ["member"]
        assert members[0].email == "member@example.com"
        assert repository.list_for_workspace("workspace", account_ids=[]) == ()

    @staticmethod
    def test_list_for_workspace_uses_join_membership_and_preserves_account_lifecycle(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        created_at = datetime(2026, 1, 1)
        active = make_account("active", status=AccountStatus.ACTIVE, created_at=created_at)
        uninitialized = make_account("uninitialized", status=AccountStatus.UNINITIALIZED, created_at=created_at)
        pending = make_account("pending", status=AccountStatus.PENDING, created_at=created_at)
        banned = make_account("banned", status=AccountStatus.BANNED, created_at=created_at)
        closed = make_account("closed", status=AccountStatus.CLOSED, created_at=created_at)
        other_workspace_member = make_account("other", status=AccountStatus.ACTIVE, created_at=created_at)
        unjoined = make_account("unjoined", status=AccountStatus.ACTIVE, created_at=created_at)
        workspace = make_tenant("workspace-1")
        other_workspace = make_tenant("workspace-2")

        with sqlite_session_factory() as session:
            session.add_all(
                [
                    workspace,
                    other_workspace,
                    active,
                    uninitialized,
                    pending,
                    banned,
                    closed,
                    other_workspace_member,
                    unjoined,
                    TenantAccountJoin(
                        tenant_id=workspace.id,
                        account_id=active.id,
                        role=TenantAccountRole.OWNER,
                    ),
                    TenantAccountJoin(
                        tenant_id=workspace.id,
                        account_id=uninitialized.id,
                        role=TenantAccountRole.NORMAL,
                    ),
                    TenantAccountJoin(
                        tenant_id=workspace.id,
                        account_id=pending.id,
                        role=TenantAccountRole.NORMAL,
                    ),
                    TenantAccountJoin(
                        tenant_id=workspace.id,
                        account_id=banned.id,
                        role=TenantAccountRole.ADMIN,
                    ),
                    TenantAccountJoin(
                        tenant_id=workspace.id,
                        account_id=closed.id,
                        role=TenantAccountRole.EDITOR,
                    ),
                    TenantAccountJoin(
                        tenant_id=other_workspace.id,
                        account_id=other_workspace_member.id,
                        role=TenantAccountRole.ADMIN,
                    ),
                ]
            )
            session.commit()

        result = WorkspaceRepository(sqlite_session_factory).list_for_workspace(workspace.id)

        by_id = {member.id: member for member in result}
        assert set(by_id) == {"active", "uninitialized", "pending", "banned", "closed"}
        assert by_id["active"] == WorkspaceMemberRecord(
            id=active.id,
            name=active.name,
            email=active.email,
            avatar=active.avatar,
            last_login_at=created_at,
            last_active_at=created_at,
            created_at=created_at,
            status=AccountStatus.ACTIVE.value,
            legacy_role=TenantAccountRole.OWNER.value,
        )
        assert by_id["uninitialized"].status == AccountStatus.UNINITIALIZED.value
        assert by_id["pending"].status == AccountStatus.PENDING.value
        assert by_id["pending"].legacy_role == TenantAccountRole.NORMAL.value
        assert by_id["banned"].status == AccountStatus.BANNED.value
        assert by_id["closed"].status == AccountStatus.CLOSED.value

    @staticmethod
    def test_list_for_workspace_returns_empty_tuple_without_membership(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        with sqlite_session_factory() as session:
            session.add(make_tenant("workspace-1"))
            session.commit()

        result = WorkspaceRepository(sqlite_session_factory).list_for_workspace("workspace-1")

        assert result == ()

    @staticmethod
    def test_dataset_operators_are_filtered_by_sql_within_workspace(
        sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
    ) -> None:
        workspace = make_tenant("workspace-1")
        other = make_tenant("workspace-2")
        created_at = datetime(2026, 1, 1)
        with sqlite_session_factory.begin() as session:
            session.add_all([workspace, other])
            for account_id, tenant_id, role in [
                ("operator", workspace.id, TenantAccountRole.DATASET_OPERATOR),
                ("editor", workspace.id, TenantAccountRole.EDITOR),
                ("foreign-operator", other.id, TenantAccountRole.DATASET_OPERATOR),
            ]:
                session.add(make_account(account_id, status=AccountStatus.ACTIVE, created_at=created_at))
                session.add(TenantAccountJoin(account_id=account_id, tenant_id=tenant_id, role=role))

        queries: list[str] = []

        def capture_sql(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
            queries.append(statement)

        event.listen(sqlite_engine, "before_cursor_execute", capture_sql)
        try:
            records = WorkspaceRepository(sqlite_session_factory).list_for_workspace(
                workspace.id, role=TenantAccountRole.DATASET_OPERATOR
            )
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", capture_sql)

        assert [record.id for record in records] == ["operator"]
        assert len(queries) == 1
        assert "tenant_account_joins.role =" in queries[0].partition("WHERE")[2]

    @staticmethod
    def test_member_queries_observe_committed_roles_and_release_session_before_role_resolution(
        sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add(make_tenant("workspace"))
            session.add(make_account("member", status=AccountStatus.ACTIVE, created_at=datetime(2026, 1, 1)))
            session.add(TenantAccountJoin(tenant_id="workspace", account_id="member", role=TenantAccountRole.NORMAL))

        checked_out: set[int] = set()

        def checkout(connection: object, _record: object, _proxy: object) -> None:
            checked_out.add(id(connection))

        def checkin(connection: object, _record: object) -> None:
            checked_out.discard(id(connection))

        class RoleResolver:
            def resolve_many(
                self,
                workspace_id: str,
                actor_account_id: str,
                subjects: Sequence[WorkspaceMemberRoleSubject],
                *,
                language: str | None = None,
            ) -> Mapping[str, Sequence[WorkspaceMemberRole]]:
                assert not checked_out
                assert language is None
                assert (workspace_id, actor_account_id) == ("workspace", "actor")
                assert subjects == (WorkspaceMemberRoleSubject("member", "editor"),)
                return {"member": (WorkspaceMemberRole("editor", "Editor"),)}

        event.listen(sqlite_engine, "checkout", checkout)
        event.listen(sqlite_engine, "checkin", checkin)
        try:
            repository = WorkspaceRepository(sqlite_session_factory)
            repository.update_member_role(
                workspace_id="workspace", account_id="member", role=TenantAccountRole.EDITOR, actor_account_id="owner"
            )
            service = WorkspaceMemberQueryService(members=repository, roles=RoleResolver())
            result = service.list_current(RequestContext("request", None, "actor", "workspace"))
            assert result[0].role == "editor"
            assert result[0].roles == (WorkspaceMemberRole("editor", "Editor"),)
            assert not checked_out
        finally:
            event.remove(sqlite_engine, "checkout", checkout)
            event.remove(sqlite_engine, "checkin", checkin)

    @staticmethod
    def test_get_legacy_role_is_scoped_to_workspace_and_account(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        created_at = datetime(2026, 1, 1)
        account = make_account("member", status=AccountStatus.ACTIVE, created_at=created_at)
        workspace = make_tenant("workspace-1")
        other_workspace = make_tenant("workspace-2")
        with sqlite_session_factory.begin() as session:
            session.add_all(
                [
                    account,
                    workspace,
                    other_workspace,
                    TenantAccountJoin(
                        tenant_id=workspace.id,
                        account_id=account.id,
                        role=TenantAccountRole.DATASET_OPERATOR,
                    ),
                ]
            )

        repository = WorkspaceRepository(sqlite_session_factory)

        assert (
            repository.get_legacy_role(workspace_id=workspace.id, account_id=account.id)
            == TenantAccountRole.DATASET_OPERATOR.value
        )
        assert repository.get_legacy_role(workspace_id=other_workspace.id, account_id=account.id) is None
        assert repository.get_legacy_role(workspace_id=workspace.id, account_id="other-account") is None


"""Real SQLite coverage for workspace ownership, persistence and Session lifetime."""


class TestWorkspaceRepositoryCases:
    @staticmethod
    @pytest.fixture
    def seeded(sqlite_session_factory: sessionmaker[Session]) -> WorkspaceRepository:
        with sqlite_session_factory() as session:
            now = datetime(2026, 1, 1)
            account = Account(name="Member", email="member@example.com")
            account.id = "a1"
            first = Tenant(name="First", status=TenantStatus.NORMAL)
            first.id, first.created_at = ("w1", now - timedelta(days=1))
            second = Tenant(name="Second", status=TenantStatus.NORMAL)
            second.id, second.created_at = ("w2", now)
            archived = Tenant(name="Archived", status=TenantStatus.ARCHIVE)
            archived.id, archived.created_at = ("w3", now)
            session.add_all(
                [
                    account,
                    first,
                    second,
                    archived,
                    TenantAccountJoin(tenant_id="w1", account_id="a1", role=TenantAccountRole.NORMAL, current=True),
                    TenantAccountJoin(tenant_id="w2", account_id="a1", role=TenantAccountRole.EDITOR),
                    TenantAccountJoin(tenant_id="w3", account_id="a1", role=TenantAccountRole.NORMAL),
                    TenantAccountJoin(tenant_id="w2", account_id="other", role=TenantAccountRole.OWNER),
                ]
            )
            session.commit()
        return WorkspaceRepository(sqlite_session_factory)

    @staticmethod
    def test_names_by_ids_returns_only_existing_requested_workspaces(seeded: WorkspaceRepository) -> None:
        assert seeded.names_by_ids(["w1", "w3", "missing", "w1"]) == {"w1": "First", "w3": "Archived"}
        assert seeded.names_by_ids(["missing"]) == {}

    @staticmethod
    def test_names_by_ids_short_circuits_empty_input(unbound_session_factory: sessionmaker[Session]) -> None:
        repository = WorkspaceRepository(unbound_session_factory)
        assert repository.names_by_ids([]) == {}

    @staticmethod
    def test_lists_preserve_visibility_order_and_archived_memberships(seeded: WorkspaceRepository) -> None:
        assert [row.id for row in seeded.list_for_account("a1")] == ["w1", "w2"]
        assert seeded.list_for_account("absent") == ()
        assert set(seeded.list_ids_for_account("a1")) == {"w1", "w2", "w3"}
        assert {row.id for row in seeded.list_account_access_workspaces("a1")} == {"w1", "w2", "w3"}
        assert [(row.id, row.name, row.role, row.current) for row in seeded.list_for_device_flow("a1")] == [
            ("w1", "First", "normal", True),
            ("w2", "Second", "editor", False),
            ("w3", "Archived", "normal", False),
        ]
        assert seeded.get_many(()) == ()
        assert seeded.has_active_membership("a1")
        assert not seeded.has_active_for_account("absent")
        page = seeded.list_all(page=1, limit=2)
        assert page.total == 3
        assert page.has_more
        assert seeded.list_all(page=3, limit=2).data == ()

    @staticmethod
    def test_snapshot_role_is_scoped_to_both_account_and_workspace(seeded: WorkspaceRepository) -> None:
        snapshot = seeded.get_for_account("w2", "a1")
        assert snapshot is not None
        assert snapshot.role == "editor"
        assert snapshot.has_privileged_member
        with pytest.raises(WorkspaceNotFoundError):
            seeded.get_for_account("w1", "other")
        assert seeded.get_for_account("missing", "a1") is None

    @staticmethod
    def test_membership_role_is_scoped_to_both_account_and_workspace(seeded: WorkspaceRepository) -> None:
        assert seeded.get_account_role(tenant_id="w1", account_id="a1") == "normal"
        assert seeded.get_account_role(tenant_id="w2", account_id="a1") == "editor"
        assert seeded.get_account_role(tenant_id="w2", account_id="other") == "owner"
        assert seeded.get_account_role(tenant_id="w1", account_id="other") is None
        assert seeded.get_account_role(tenant_id="w2", account_id="missing") is None

    @staticmethod
    def test_switch_updates_only_the_requesting_account(
        seeded: WorkspaceRepository, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        seeded.switch(account_id="a1", workspace_id="w2")
        with sqlite_session_factory() as session:
            memberships = session.scalars(select(TenantAccountJoin).where(TenantAccountJoin.account_id == "a1")).all()
            assert [row.tenant_id for row in memberships if row.current] == ["w2"]
            assert next(row for row in memberships if row.tenant_id == "w2").last_opened_at is not None
            other = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == "other"))
            assert other is not None
            assert not other.current

    @staticmethod
    @pytest.mark.parametrize("workspace", ["w3", "missing"])
    def test_switch_rejects_archived_and_unlinked_without_changing_current(
        seeded: WorkspaceRepository, sqlite_session_factory: sessionmaker[Session], workspace: str
    ) -> None:
        with pytest.raises(WorkspaceNotLinkedError):
            seeded.switch(account_id="a1", workspace_id=workspace)
        with sqlite_session_factory() as session:
            current = session.scalar(
                select(TenantAccountJoin.tenant_id).where(
                    TenantAccountJoin.account_id == "a1", TenantAccountJoin.current.is_(True)
                )
            )
            assert current == "w1"

    @staticmethod
    def test_writes_commit_and_other_accounts_cannot_mutate(
        seeded: WorkspaceRepository, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        assert seeded.rename(workspace_id="w1", account_id="a1", name="New").name == "New"
        config = WorkspaceCustomConfig(False, "logo")
        seeded.update_custom_config(workspace_id="w1", account_id="a1", changes=config)
        with pytest.raises(WorkspaceNotFoundError):
            seeded.rename(workspace_id="w1", account_id="other", name="Unauthorized")
        with sqlite_session_factory() as session:
            tenant = session.get(Tenant, "w1")
            assert tenant is not None
            assert tenant.name == "New"
            assert tenant.custom_config_dict == {"remove_webapp_brand": False, "replace_webapp_logo": "logo"}

    @staticmethod
    def test_write_rolls_back_on_commit_failure(
        seeded: WorkspaceRepository, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        def fail_flush(_session: Session, _flush_context: object, _instances: object) -> None:
            raise RuntimeError("write failed")

        event.listen(sqlite_session_factory, "before_flush", fail_flush)
        try:
            with pytest.raises(RuntimeError, match="write failed"):
                seeded.rename(workspace_id="w1", account_id="a1", name="Failed")
        finally:
            event.remove(sqlite_session_factory, "before_flush", fail_flush)
        snapshot = seeded.get_for_account("w1", "a1")
        assert snapshot is not None
        assert snapshot.name == "First"

    @staticmethod
    def test_sessions_are_closed_before_feature_and_plan_io(
        seeded: WorkspaceRepository, sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
    ) -> None:
        checked_out = set()

        def checkout(connection: object, _record: object, _proxy: object) -> None:
            checked_out.add(id(connection))

        def checkin(connection: object, _record: object) -> None:
            checked_out.discard(id(connection))

        event.listen(sqlite_engine, "checkout", checkout)
        event.listen(sqlite_engine, "checkin", checkin)
        features = create_autospec(WorkspaceFeatureGateway, instance=True)

        def get_features(workspace_id: str) -> WorkspaceFeatures:
            assert not checked_out
            with sqlite_session_factory() as session:
                tenant = session.get(Tenant, workspace_id)
                assert tenant is not None
                assert tenant.name == "Committed"
            return WorkspaceFeatures(False, EffectiveCreditPool())

        features.get_features.side_effect = get_features
        service = WorkspaceService(
            workspaces=seeded, features=features, logos=create_autospec(WorkspaceLogoGateway, instance=True)
        )
        context = RequestContext("request", None, "a1", "w1")
        try:
            service.rename(context, "Committed")
            plans = Mock()

            def resolve_many(_ids: Sequence[str]) -> dict[str, str]:
                assert not checked_out
                return {"w1": "team"}

            plans.resolve_many.side_effect = resolve_many
            result = WorkspaceQueryService(workspaces=seeded, plans=plans).list_for_account(context)
            assert result[0].current
            assert result[0].plan == "team"
            assert result[1].plan == "sandbox"
            assert not checked_out
        finally:
            event.remove(sqlite_engine, "checkout", checkout)
            event.remove(sqlite_engine, "checkin", checkin)
