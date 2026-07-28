from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.base import TypeBase
from services.knowledge_fs.cutover import KnowledgeFSCutoverGateBlockedError
from services.knowledge_fs.greenfield_initializer import KnowledgeFSWorkspaceGreenfieldInitializer


@pytest.fixture
def greenfield_session_maker(sqlite_engine: Engine) -> sessionmaker[Session]:
    tables = [
        Tenant.metadata.tables[Tenant.__tablename__],
        TenantAccountJoin.metadata.tables[TenantAccountJoin.__tablename__],
    ]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    return sessionmaker(bind=sqlite_engine, expire_on_commit=False)


def test_greenfield_initializer_uses_the_unique_workspace_owner(
    greenfield_session_maker: sessionmaker[Session],
) -> None:
    tenant = Tenant(name="Greenfield")
    owner_account_id = str(uuid4())
    with greenfield_session_maker.begin() as session:
        session.add(tenant)
        session.flush()
        tenant_id = tenant.id
        session.add(
            TenantAccountJoin(
                tenant_id=tenant_id,
                account_id=owner_account_id,
                role=TenantAccountRole.OWNER,
            )
        )
    cutover = MagicMock()
    initializer = KnowledgeFSWorkspaceGreenfieldInitializer(greenfield_session_maker, cutover=cutover)

    initializer.ensure_initialized(tenant_id=tenant_id)

    cutover.initialize_greenfield.assert_called_once_with(
        tenant_id=tenant_id,
        owner_account_id=owner_account_id,
    )


def test_greenfield_initializer_rejects_a_workspace_without_one_owner(
    greenfield_session_maker: sessionmaker[Session],
) -> None:
    tenant = Tenant(name="No owner")
    with greenfield_session_maker.begin() as session:
        session.add(tenant)
        session.flush()
        tenant_id = tenant.id
    initializer = KnowledgeFSWorkspaceGreenfieldInitializer(greenfield_session_maker, cutover=MagicMock())

    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="exactly one Workspace owner"):
        initializer.ensure_initialized(tenant_id=tenant_id)
