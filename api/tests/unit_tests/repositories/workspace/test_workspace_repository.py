"""Real SQLite coverage for workspace ownership, persistence and Session lifetime."""

from collections.abc import Sequence
from datetime import datetime, timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.errors.workspace import WorkspaceNotFoundError, WorkspaceNotLinkedError
from services.workspace.contracts import EffectiveCreditPool, WorkspaceCustomConfig, WorkspaceFeatures
from services.workspace.service import (
    WorkspaceFeatureGateway,
    WorkspaceLogoGateway,
    WorkspaceQueryService,
    WorkspaceService,
)


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


def test_lists_preserve_visibility_order_and_archived_memberships(seeded: WorkspaceRepository) -> None:
    assert [row.id for row in seeded.list_for_account("a1")] == ["w1", "w2"]
    assert seeded.list_for_account("absent") == ()
    assert set(seeded.list_ids_for_account("a1")) == {"w1", "w2", "w3"}
    assert {row.id for row in seeded.list_account_access_workspaces("a1")} == {"w1", "w2", "w3"}
    assert seeded.has_active_membership("a1")
    assert not seeded.has_active_for_account("absent")
    page = seeded.list_all(page=1, limit=2)
    assert page.total == 3
    assert page.has_more
    assert seeded.list_all(page=3, limit=2).data == ()


def test_snapshot_role_is_scoped_to_both_account_and_workspace(seeded: WorkspaceRepository) -> None:
    snapshot = seeded.get_for_account("w2", "a1")
    assert snapshot is not None
    assert snapshot.role == "editor"
    assert snapshot.has_privileged_member
    with pytest.raises(WorkspaceNotFoundError):
        seeded.get_for_account("w1", "other")
    assert seeded.get_for_account("missing", "a1") is None


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
    features = Mock(spec=WorkspaceFeatureGateway)

    def get_features(workspace_id: str) -> WorkspaceFeatures:
        assert not checked_out
        with sqlite_session_factory() as session:
            tenant = session.get(Tenant, workspace_id)
            assert tenant is not None
            assert tenant.name == "Committed"
        return WorkspaceFeatures(False, EffectiveCreditPool())

    features.get_features.side_effect = get_features
    service = WorkspaceService(workspaces=seeded, features=features, logos=Mock(spec=WorkspaceLogoGateway))
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
