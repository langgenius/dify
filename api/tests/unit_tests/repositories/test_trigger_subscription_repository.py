"""Provider-scoped subscription reads use real rows and release their SQL sessions."""

from uuid import uuid4

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.plugin.entities.plugin_daemon import CredentialType
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository


@pytest.mark.parametrize("requested", [None, "", "target", "foreign", "other-provider", "missing"])
def test_provider_lookup_requires_tenant_provider_and_optional_subscription_id(
    sqlite_session_factory: sessionmaker[Session], requested: str | None
) -> None:
    tenant = str(uuid4())
    provider = TriggerProviderID("langgenius/github/github")
    rows = {
        name: TriggerSubscription(
            name=name,
            tenant_id=owner,
            user_id=str(uuid4()),
            provider_id=provider_id,
            endpoint_id=str(uuid4()),
            parameters={},
            properties={},
            credentials={"token": f"{name}-ciphertext"},
            credential_type=CredentialType.API_KEY,
        )
        for name, owner, provider_id in [
            ("foreign", str(uuid4()), str(provider)),
            ("other-provider", tenant, "langgenius/github/other"),
            ("target", tenant, str(provider)),
        ]
    }
    with sqlite_session_factory.begin() as session:
        session.add_all(rows.values())
    subscription_id = str(uuid4()) if requested == "missing" else rows[requested].id if requested else requested
    repository = TriggerSubscriptionRepository(session_factory=sqlite_session_factory)

    result = repository.get_for_provider(tenant_id=tenant, provider_id=provider, subscription_id=subscription_id)

    if requested in (None, "", "target"):
        assert result is not None
        assert (result.id, result.tenant_id, result.provider_id) == (rows["target"].id, tenant, str(provider))
        assert result.credentials == {"token": "target-ciphertext"}
    else:
        assert result is None


def test_provider_lookup_returns_detached_values_without_writes_or_held_connections(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
) -> None:
    tenant = str(uuid4())
    provider = TriggerProviderID("langgenius/github/github")
    row = TriggerSubscription(
        name="stored",
        tenant_id=tenant,
        user_id=str(uuid4()),
        provider_id=str(provider),
        endpoint_id=str(uuid4()),
        parameters={"events": ["push"]},
        properties={"remote_id": "remote"},
        credentials={"token": "ciphertext"},
        credential_type=CredentialType.OAUTH2,
    )
    with sqlite_session_factory.begin() as session:
        session.add(row)
    repository = TriggerSubscriptionRepository(session_factory=sqlite_session_factory)
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)

    result = repository.get_for_provider(tenant_id=tenant, provider_id=provider, subscription_id=row.id)

    assert pool.checkedout() == 0
    assert result is not None
    assert result.credential_type == CredentialType.OAUTH2
    assert result.credentials == {"token": "ciphertext"}
    result.parameters["events"].append("caller-only")
    with sqlite_session_factory() as session:
        stored = session.get(TriggerSubscription, row.id)
        assert stored is not None
        assert stored.parameters == {"events": ["push"]}
        assert stored.properties == {"remote_id": "remote"}
        assert stored.credentials == {"token": "ciphertext"}
    assert repository.get_for_provider(tenant_id=str(uuid4()), provider_id=provider, subscription_id=row.id) is None
    assert pool.checkedout() == 0
