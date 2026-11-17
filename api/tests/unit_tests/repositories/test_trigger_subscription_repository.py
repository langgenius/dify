"""Scoped subscription reads and renewal writes use real rows and bounded SQL sessions."""

from dataclasses import replace
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Engine, delete, update
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.plugin.entities.plugin_daemon import CredentialType
from models.enums import PermissionEnum
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository
from services.trigger.subscription_service import TriggerSubscriptionChangedError, TriggerSubscriptionSnapshot


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


@pytest.fixture
def renewal_subscription(sqlite_session_factory: sessionmaker[Session]) -> TriggerSubscriptionSnapshot:
    row = TriggerSubscription(
        name="original",
        tenant_id=str(uuid4()),
        user_id=str(uuid4()),
        provider_id="langgenius/github/github",
        endpoint_id=str(uuid4()),
        parameters={"events": ["push"]},
        properties={"remote_id": "original"},
        credentials={"token": "original-ciphertext"},
        credential_type=CredentialType.OAUTH2,
        credential_expires_at=100,
        expires_at=200,
    )
    with sqlite_session_factory.begin() as session:
        session.add(row)
    snapshot = TriggerSubscriptionRepository(session_factory=sqlite_session_factory).get(
        tenant_id=row.tenant_id, subscription_id=row.id
    )
    assert snapshot is not None
    return snapshot


def _renew(
    repository: TriggerSubscriptionRepository,
    expected: TriggerSubscriptionSnapshot,
    stage: Literal["oauth", "subscription"],
) -> None:
    if stage == "oauth":
        repository.update_renewed_credentials(
            expected=expected, credentials={"token": "renewed-ciphertext"}, credential_expires_at=300
        )
    else:
        repository.update_renewed_subscription(expected=expected, properties={"remote_id": "renewed"}, expires_at=400)


@pytest.mark.parametrize("stage", ["oauth", "subscription"])
def test_renewal_merges_concurrent_name_visibility_and_unrelated_changes(
    sqlite_session_factory: sessionmaker[Session],
    renewal_subscription: TriggerSubscriptionSnapshot,
    stage: Literal["oauth", "subscription"],
) -> None:
    repository = TriggerSubscriptionRepository(session_factory=sqlite_session_factory)
    changes: dict[str, object] = {"name": "renamed", "visibility": PermissionEnum.ONLY_ME}
    if stage == "oauth":
        changes.update(
            endpoint_id=str(uuid4()),
            parameters={"events": ["pull_request"]},
            properties={"remote_id": "concurrent"},
            expires_at=500,
        )
    else:
        changes["credential_expires_at"] = 500
    with sqlite_session_factory.begin() as session:
        session.execute(
            update(TriggerSubscription).where(TriggerSubscription.id == renewal_subscription.id).values(changes)
        )
    concurrent = repository.get(tenant_id=renewal_subscription.tenant_id, subscription_id=renewal_subscription.id)
    assert concurrent is not None

    _renew(repository, renewal_subscription, stage)

    expected = (
        replace(concurrent, credentials={"token": "renewed-ciphertext"}, credential_expires_at=300)
        if stage == "oauth"
        else replace(concurrent, properties={"remote_id": "renewed"}, expires_at=400)
    )
    assert repository.get(tenant_id=expected.tenant_id, subscription_id=expected.id) == expected


@pytest.mark.parametrize(
    ("stage", "changes"),
    [
        pytest.param("oauth", {"credentials": {"token": "rotated"}}, id="oauth-credentials"),
        pytest.param("oauth", {"credential_expires_at": 500}, id="oauth-expiry"),
        pytest.param("subscription", {"credentials": {"token": "rotated"}}, id="subscription-credentials"),
        pytest.param("subscription", {"endpoint_id": "replaced-endpoint"}, id="subscription-endpoint"),
        pytest.param("subscription", {"parameters": {"events": ["pull_request"]}}, id="subscription-parameters"),
        pytest.param("subscription", {"properties": {"remote_id": "concurrent"}}, id="subscription-properties"),
        pytest.param("subscription", {"expires_at": 500}, id="subscription-expiry"),
    ],
)
def test_renewal_rejects_changed_provider_inputs_without_writes(
    sqlite_session_factory: sessionmaker[Session],
    renewal_subscription: TriggerSubscriptionSnapshot,
    stage: Literal["oauth", "subscription"],
    changes: dict[str, object],
) -> None:
    repository = TriggerSubscriptionRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.execute(
            update(TriggerSubscription).where(TriggerSubscription.id == renewal_subscription.id).values(changes)
        )
    concurrent = repository.get(tenant_id=renewal_subscription.tenant_id, subscription_id=renewal_subscription.id)
    assert concurrent is not None

    with pytest.raises(TriggerSubscriptionChangedError):
        _renew(repository, renewal_subscription, stage)

    assert repository.get(tenant_id=concurrent.tenant_id, subscription_id=concurrent.id) == concurrent


@pytest.mark.parametrize("stage", ["oauth", "subscription"])
@pytest.mark.parametrize("changed_scope", ["tenant", "user", "provider", "credential_type", "deleted"])
def test_renewal_rejects_changed_owner_or_deleted_subscription(
    sqlite_session_factory: sessionmaker[Session],
    renewal_subscription: TriggerSubscriptionSnapshot,
    stage: Literal["oauth", "subscription"],
    changed_scope: str,
) -> None:
    repository = TriggerSubscriptionRepository(session_factory=sqlite_session_factory)
    if changed_scope == "deleted":
        with sqlite_session_factory.begin() as session:
            session.execute(delete(TriggerSubscription).where(TriggerSubscription.id == renewal_subscription.id))
        expected = renewal_subscription
    else:
        expected = {
            "tenant": replace(renewal_subscription, tenant_id=str(uuid4())),
            "user": replace(renewal_subscription, user_id=str(uuid4())),
            "provider": replace(renewal_subscription, provider_id="langgenius/github/other"),
            "credential_type": replace(renewal_subscription, credential_type=CredentialType.API_KEY),
        }[changed_scope]

    with pytest.raises(TriggerSubscriptionChangedError):
        _renew(repository, expected, stage)

    assert repository.get(tenant_id=renewal_subscription.tenant_id, subscription_id=renewal_subscription.id) == (
        None if changed_scope == "deleted" else renewal_subscription
    )
