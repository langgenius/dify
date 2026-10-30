"""Current-policy first-write CAS on the actual PostgreSQL transaction owner."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from services.dify_builder.application.cognition_policy import (
    CognitionModel,
    CognitionPolicy,
    CognitionPolicyDeniedError,
)
from services.dify_builder.repository import SqlDifyBuilderRepository


def test_concurrent_first_policy_writes_have_one_winner(db_session_with_containers: Session) -> None:
    tenant = Tenant(name="Builder policy transaction fixture", custom_config='{"branding":"unchanged"}')
    actor = Actor(tenant_id=tenant.id, account_id=str(uuid4()))
    db_session_with_containers.add_all(
        [tenant, TenantAccountJoin(tenant_id=tenant.id, account_id=actor.account_id, role=TenantAccountRole.ADMIN)]
    )
    db_session_with_containers.commit()
    factory = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    repository = SqlDifyBuilderRepository(factory)
    policy = CognitionPolicy(True, (CognitionModel("one", "openai", "gpt", "chat", {}),), "one", (), 0, "explicit")
    barrier = Barrier(2)

    def write() -> str:
        barrier.wait(timeout=10)
        try:
            return str(repository.put_policy(actor, policy, 0).revision)
        except CognitionPolicyDeniedError as error:
            return error.reason

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: write(), range(2)))
    assert sorted(results) == ["1", "policy_revision_conflict"]
    persisted_policy = repository.get_policy(actor)
    assert persisted_policy is not None
    assert persisted_policy.revision == 1
    with factory() as session:
        saved_tenant = session.get(Tenant, tenant.id)
        assert saved_tenant is not None
        assert saved_tenant.custom_config == '{"branding":"unchanged"}'
