"""Cross-database row-lock coverage for concurrent workspace writes."""

from __future__ import annotations

from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Lock, current_thread
from typing import cast

import pytest
import sqlalchemy as sa
from sqlalchemy import event, func, select
from sqlalchemy.engine import Connection, Engine, ExecutionContext
from sqlalchemy.orm import sessionmaker

from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import DifySetup
from repositories.workspace.deployment_quota_repository import check_deployment_quota
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account_errors import SeatsLimitExceededError
from services.errors.base import NoPermissionError
from services.errors.workspace import WorkspaceInvitationQuotaError, WorkspacesLimitExceededError
from services.workspace.quota import DeploymentQuotaSnapshot, WorkspaceMemberQuotaSnapshot

_ACCOUNT_TABLE = cast(sa.Table, Account.__table__)
_TENANT_TABLE = cast(sa.Table, Tenant.__table__)
_MEMBERSHIP_TABLE = cast(sa.Table, TenantAccountJoin.__table__)
_SETUP_TABLE = cast(sa.Table, DifySetup.__table__)


@pytest.fixture(params=("postgresql", "mysql"), scope="module")
def workspace_engine(request: pytest.FixtureRequest) -> Generator[Engine]:
    if request.param == "postgresql":
        testcontainers_postgres = pytest.importorskip("testcontainers.postgres")
        container = testcontainers_postgres.PostgresContainer("postgres:15-alpine")
    else:
        testcontainers_mysql = pytest.importorskip("testcontainers.mysql")
        container = testcontainers_mysql.MySqlContainer("mysql:8.0")
    container.start()
    engine = sa.create_engine(container.get_connection_url().replace("mysql://", "mysql+pymysql://", 1))
    Account.metadata.create_all(
        engine,
        tables=[_ACCOUNT_TABLE, _TENANT_TABLE, _MEMBERSHIP_TABLE, _SETUP_TABLE],
    )
    try:
        yield engine
    finally:
        engine.dispose()
        container.stop()


def test_only_one_concurrent_owner_transfer_commits(workspace_engine: Engine) -> None:
    with workspace_engine.begin() as connection:
        connection.execute(_MEMBERSHIP_TABLE.delete())
        connection.execute(_TENANT_TABLE.delete())
        connection.execute(_ACCOUNT_TABLE.delete())

    workspace_id = "00000000-0000-0000-0000-000000000001"
    workspace = Tenant(name="Workspace")
    workspace.id = workspace_id
    accounts = []
    account_ids = []
    for suffix, name in ((2, "Owner"), (3, "First"), (4, "Second")):
        account_id = f"00000000-0000-0000-0000-{suffix:012d}"
        account = Account(name=name, email=f"{name.lower()}@example.com")
        account.id = account_id
        accounts.append(account)
        account_ids.append(account_id)
    with sessionmaker(bind=workspace_engine).begin() as session:
        session.add_all([workspace, *accounts])
        session.add_all(
            [
                TenantAccountJoin(
                    tenant_id=workspace_id,
                    account_id=account_id,
                    role=TenantAccountRole.OWNER if index == 0 else TenantAccountRole.NORMAL,
                )
                for index, account_id in enumerate(account_ids)
            ]
        )
    ready = Barrier(2)
    seen_threads: set[int] = set()
    seen_lock = Lock()

    def align_workspace_locks(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        normalized = " ".join(statement.lower().split())
        thread_id = current_thread().ident
        if (
            thread_id is not None
            and current_thread().name.startswith("owner-transfer")
            and "from tenants" in normalized
            and "for update" in normalized
        ):
            with seen_lock:
                first_visit = thread_id not in seen_threads
                seen_threads.add(thread_id)
            if first_visit:
                ready.wait(timeout=20)

    sessions = sessionmaker(bind=workspace_engine, expire_on_commit=False)
    repository = WorkspaceRepository(sessions)

    def transfer(target_id: str) -> bool:
        try:
            repository.update_member_role(
                workspace_id=workspace_id,
                actor_account_id=account_ids[0],
                account_id=target_id,
                role=TenantAccountRole.OWNER,
            )
        except NoPermissionError:
            return False
        return True

    event.listen(workspace_engine, "before_cursor_execute", align_workspace_locks)
    try:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="owner-transfer") as executor:
            futures = [executor.submit(transfer, account_id) for account_id in account_ids[1:]]
            outcomes = [future.result(timeout=30) for future in futures]
    finally:
        event.remove(workspace_engine, "before_cursor_execute", align_workspace_locks)

    assert sorted(outcomes) == [False, True]
    assert len(seen_threads) == 2
    with workspace_engine.connect() as connection:
        assert (
            connection.scalar(
                select(func.count())
                .select_from(TenantAccountJoin)
                .where(
                    TenantAccountJoin.tenant_id == workspace_id,
                    TenantAccountJoin.role == TenantAccountRole.OWNER,
                )
            )
            == 1
        )


def test_only_one_concurrent_member_join_claims_the_last_workspace_slot(workspace_engine: Engine) -> None:
    with workspace_engine.begin() as connection:
        connection.execute(_MEMBERSHIP_TABLE.delete())
        connection.execute(_TENANT_TABLE.delete())
        connection.execute(_ACCOUNT_TABLE.delete())

    workspace_id = "00000000-0000-0000-0000-000000000011"
    workspace = Tenant(name="Workspace")
    workspace.id = workspace_id
    accounts = []
    account_ids = []
    for suffix, name in ((12, "Owner"), (13, "First"), (14, "Second")):
        account_id = f"00000000-0000-0000-0000-{suffix:012d}"
        account = Account(name=name, email=f"member-{suffix}@example.com")
        account.id = account_id
        accounts.append(account)
        account_ids.append(account_id)
    with sessionmaker(bind=workspace_engine).begin() as session:
        session.add_all([workspace, *accounts])
        session.add(
            TenantAccountJoin(
                tenant_id=workspace_id,
                account_id=account_ids[0],
                role=TenantAccountRole.OWNER,
            )
        )

    ready = Barrier(2)
    seen_threads: set[int] = set()
    seen_lock = Lock()

    def align_workspace_locks(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        normalized = " ".join(statement.lower().split())
        thread_id = current_thread().ident
        if (
            thread_id is not None
            and current_thread().name.startswith("member-join")
            and "from tenants" in normalized
            and "for update" in normalized
        ):
            with seen_lock:
                first_visit = thread_id not in seen_threads
                seen_threads.add(thread_id)
            if first_visit:
                ready.wait(timeout=20)

    sessions = sessionmaker(bind=workspace_engine, expire_on_commit=False)
    repository = WorkspaceRepository(sessions)
    quota = WorkspaceMemberQuotaSnapshot(plan_limit=2, plan_usage=1, license_limit=None, license_usage=0)

    def join(account_id: str) -> bool:
        try:
            repository.upsert_member(
                workspace_id=workspace_id,
                account_id=account_id,
                role=TenantAccountRole.NORMAL,
                quota=quota,
            )
        except WorkspaceInvitationQuotaError:
            return False
        return True

    event.listen(workspace_engine, "before_cursor_execute", align_workspace_locks)
    try:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="member-join") as executor:
            futures = [executor.submit(join, account_id) for account_id in account_ids[1:]]
            outcomes = [future.result(timeout=30) for future in futures]
    finally:
        event.remove(workspace_engine, "before_cursor_execute", align_workspace_locks)

    assert sorted(outcomes) == [False, True]
    assert len(seen_threads) == 2
    with workspace_engine.connect() as connection:
        assert (
            connection.scalar(
                select(func.count()).select_from(TenantAccountJoin).where(TenantAccountJoin.tenant_id == workspace_id)
            )
            == 2
        )


@pytest.mark.parametrize("resource", ["seat", "workspace"])
def test_deployment_quota_serializes_current_usage_check_and_insert(workspace_engine: Engine, resource: str) -> None:
    with workspace_engine.begin() as connection:
        connection.execute(_MEMBERSHIP_TABLE.delete())
        connection.execute(_TENANT_TABLE.delete())
        connection.execute(_ACCOUNT_TABLE.delete())
        connection.execute(_SETUP_TABLE.delete())
        connection.execute(_SETUP_TABLE.insert().values(version="1"))

    ready = Barrier(2)
    seen_threads: set[int] = set()
    seen_lock = Lock()

    def align_quota_locks(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        normalized = " ".join(statement.lower().split())
        thread_id = current_thread().ident
        if (
            thread_id is not None
            and current_thread().name.startswith("quota-writer")
            and "from dify_setups" in normalized
            and "for update" in normalized
        ):
            with seen_lock:
                first_visit = thread_id not in seen_threads
                seen_threads.add(thread_id)
            if first_visit:
                ready.wait(timeout=20)

    sessions = sessionmaker(bind=workspace_engine, expire_on_commit=False)
    snapshot = DeploymentQuotaSnapshot(
        seat_limit=1 if resource == "seat" else None,
        seat_usage=0,
        workspace_limit=1 if resource == "workspace" else None,
        workspace_usage=0,
    )

    def create_resource(index: int) -> bool:
        try:
            with sessions.begin() as session:
                check_deployment_quota(
                    session,
                    snapshot,
                    seats_delta=int(resource == "seat"),
                    workspaces_delta=int(resource == "workspace"),
                )
                if resource == "seat":
                    account = Account(name=f"Account {index}", email=f"account-{index}@example.com")
                    account.id = f"00000000-0000-0000-0000-{index:012d}"
                    session.add(account)
                else:
                    workspace = Tenant(name=f"Workspace {index}")
                    workspace.id = f"00000000-0000-0000-0001-{index:012d}"
                    session.add(workspace)
        except (SeatsLimitExceededError, WorkspacesLimitExceededError):
            return False
        return True

    event.listen(workspace_engine, "before_cursor_execute", align_quota_locks)
    try:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="quota-writer") as executor:
            futures = [executor.submit(create_resource, index) for index in (1, 2)]
            outcomes = [future.result(timeout=30) for future in futures]
    finally:
        event.remove(workspace_engine, "before_cursor_execute", align_quota_locks)

    assert sorted(outcomes) == [False, True]
    assert len(seen_threads) == 2
    table = _ACCOUNT_TABLE if resource == "seat" else _TENANT_TABLE
    with workspace_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(table)) == 1
