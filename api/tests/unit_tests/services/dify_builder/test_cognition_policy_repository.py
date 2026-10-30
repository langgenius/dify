"""Policy CAS, membership and tenant isolation through real SQL sessions."""

from collections.abc import Iterator
from typing import cast

import pytest
from sqlalchemy import Table, create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.dify_builder_cognition_policy import DifyBuilderCognitionPolicy
from services.dify_builder.application.cognition_policy import (
    CognitionModel,
    CognitionPolicy,
    CognitionPolicyDeniedError,
)
from services.dify_builder.repository import SqlDifyBuilderRepository

ACTOR = Actor(tenant_id="11111111-1111-1111-1111-111111111111", account_id="22222222-2222-2222-2222-222222222222")
POLICY = CognitionPolicy(True, (CognitionModel("one", "openai", "gpt", "chat", {}),), "one", (), 0, "explicit")


type SqlContext = tuple[SqlDifyBuilderRepository, sessionmaker[Session]]


@pytest.fixture
def sql() -> Iterator[SqlContext]:
    engine = create_engine("sqlite://")
    for table in (Tenant.__table__, TenantAccountJoin.__table__, DifyBuilderCognitionPolicy.__table__):
        cast(Table, table).create(engine)
    factory = sessionmaker(bind=engine)
    with factory() as session, session.begin():
        tenant = Tenant(name="test", custom_config='{"branding":"preserved"}')
        tenant.id = ACTOR.tenant_id
        session.add(tenant)
        session.add(
            TenantAccountJoin(tenant_id=ACTOR.tenant_id, account_id=ACTOR.account_id, role=TenantAccountRole.ADMIN)
        )
    yield SqlDifyBuilderRepository(factory), factory
    engine.dispose()


def test_first_write_then_stale_revision_and_branding(sql: SqlContext) -> None:
    repo, factory = sql
    assert repo.get_policy(ACTOR) is None
    assert repo.put_policy(ACTOR, POLICY, 0).revision == 1
    with pytest.raises(CognitionPolicyDeniedError, match="policy_revision_conflict"):
        repo.put_policy(ACTOR, POLICY, 0)
    assert repo.put_policy(ACTOR, POLICY, 1).revision == 2
    with factory() as session:
        tenant = session.get(Tenant, ACTOR.tenant_id)
        assert tenant is not None
        assert tenant.custom_config == '{"branding":"preserved"}'


def test_write_rechecks_fresh_membership_and_scopes_read(sql: SqlContext) -> None:
    repo, factory = sql
    repo.put_policy(ACTOR, POLICY, 0)
    with factory() as session, session.begin():
        member = session.query(TenantAccountJoin).one()
        member.role = TenantAccountRole.NORMAL
    with pytest.raises(CognitionPolicyDeniedError, match="policy_permission_denied"):
        repo.put_policy(ACTOR, POLICY, 1)
    assert repo.get_policy(Actor(tenant_id="33333333-3333-3333-3333-333333333333", account_id=ACTOR.account_id)) is None
    with pytest.raises(CognitionPolicyDeniedError, match="policy_permission_denied"):
        repo.require_member(
            Actor(tenant_id=ACTOR.tenant_id, account_id="44444444-4444-4444-4444-444444444444"), admin=False
        )
