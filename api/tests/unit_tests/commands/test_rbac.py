from collections.abc import Generator
from contextlib import contextmanager

import pytest
from sqlalchemy.orm import Session, sessionmaker

from commands import rbac as rbac_module
from models.account import TenantAccountJoin, TenantAccountRole


def test_member_role_batches_close_database_sessions_before_yield(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_ids = [
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
    ]
    account_ids = [
        "00000000-0000-0000-0000-000000000011",
        "00000000-0000-0000-0000-000000000012",
        "00000000-0000-0000-0000-000000000013",
        "00000000-0000-0000-0000-000000000014",
    ]
    joins = [
        TenantAccountJoin(tenant_id=tenant_ids[0], account_id=account_ids[0], role=TenantAccountRole.NORMAL),
        TenantAccountJoin(tenant_id=tenant_ids[0], account_id=account_ids[1], role=TenantAccountRole.OWNER),
        TenantAccountJoin(tenant_id=tenant_ids[0], account_id=account_ids[2], role=TenantAccountRole.EDITOR),
        TenantAccountJoin(tenant_id=tenant_ids[1], account_id=account_ids[3], role=TenantAccountRole.OWNER),
    ]
    for index, join in enumerate(joins, start=21):
        join.id = f"00000000-0000-0000-0000-{index:012d}"
    with sqlite_session_factory.begin() as session:
        session.add_all(joins)

    active_sessions = 0

    @contextmanager
    def tracked_session() -> Generator[Session]:
        nonlocal active_sessions
        active_sessions += 1
        try:
            with sqlite_session_factory() as session:
                yield session
        finally:
            active_sessions -= 1

    monkeypatch.setattr(rbac_module.session_factory, "create_session", tracked_session)

    batches = []
    for item in rbac_module._iter_tenant_member_batches(None, db_batch_size=2, api_batch_size=2):
        assert active_sessions == 0
        batches.append(item)

    assert batches == [
        (
            tenant_ids[0],
            account_ids[1],
            [
                (account_ids[0], TenantAccountRole.NORMAL.value),
                (account_ids[1], TenantAccountRole.OWNER.value),
            ],
        ),
        (tenant_ids[0], account_ids[1], [(account_ids[2], TenantAccountRole.EDITOR.value)]),
        (tenant_ids[1], account_ids[3], [(account_ids[3], TenantAccountRole.OWNER.value)]),
    ]
