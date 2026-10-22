from dataclasses import replace
from uuid import uuid4

import pytest
from sqlalchemy import Engine, delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.plugin.entities.plugin_daemon import CredentialType
from models.enums import PermissionEnum
from models.trigger import TriggerSubscription, WorkflowPluginTrigger
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository
from services.trigger.subscription_service import (
    TriggerSubscriptionChangedError,
    TriggerSubscriptionLimitError,
    TriggerSubscriptionNameConflictError,
    TriggerSubscriptionSnapshot,
)


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> TriggerSubscriptionRepository:
    return TriggerSubscriptionRepository(session_factory=sqlite_session_factory)


def _snapshot() -> TriggerSubscriptionSnapshot:
    return TriggerSubscriptionSnapshot(
        id=str(uuid4()),
        name="GitHub events",
        tenant_id=str(uuid4()),
        user_id=str(uuid4()),
        provider_id="langgenius/github/github",
        endpoint_id=str(uuid4()),
        credential_type=CredentialType.API_KEY,
        parameters={"events": ["push"], "enabled": False},
        properties={"remote_id": "subscription-1"},
        credentials={"token": "encrypted-token"},
        credential_expires_at=0,
        expires_at=-1,
        visibility=PermissionEnum.ALL_TEAM,
    )


def _persist(session_factory: sessionmaker[Session], *snapshots: TriggerSubscriptionSnapshot) -> None:
    with session_factory.begin() as session:
        for snapshot in snapshots:
            row = TriggerSubscription(
                name=snapshot.name,
                tenant_id=snapshot.tenant_id,
                user_id=snapshot.user_id,
                provider_id=snapshot.provider_id,
                endpoint_id=snapshot.endpoint_id,
                credential_type=snapshot.credential_type,
                parameters=dict(snapshot.parameters),
                properties=dict(snapshot.properties),
                credentials=dict(snapshot.credentials),
                credential_expires_at=snapshot.credential_expires_at,
                expires_at=snapshot.expires_at,
                visibility=snapshot.visibility,
            )
            row.id = snapshot.id
            session.add(row)


def test_create_commits_all_subscription_fields_and_get_returns_detached_snapshot(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
) -> None:
    expected = _snapshot()
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)

    repository.create(subscription=expected, max_count=10)
    assert pool.checkedout() == 0
    snapshot = repository.get(tenant_id=expected.tenant_id, subscription_id=expected.id)
    assert pool.checkedout() == 0
    assert snapshot is not None
    assert snapshot == expected

    with sqlite_session_factory.begin() as session:
        session.execute(delete(TriggerSubscription).where(TriggerSubscription.id == expected.id))

    assert snapshot == expected
    assert snapshot.parameters == {"events": ["push"], "enabled": False}
    assert snapshot.credentials == {"token": "encrypted-token"}
    assert repository.get(tenant_id=expected.tenant_id, subscription_id=expected.id) is None
    assert pool.checkedout() == 0


@pytest.mark.parametrize("wrong_scope", ["tenant", "subscription"])
def test_get_requires_tenant_and_subscription_id_with_valid_decoys(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
    wrong_scope: str,
) -> None:
    stored = _snapshot()
    decoy = replace(_snapshot(), tenant_id=stored.tenant_id, provider_id="langgenius/other/other")
    _persist(sqlite_session_factory, stored, decoy)

    assert (
        repository.get(
            tenant_id=str(uuid4()) if wrong_scope == "tenant" else stored.tenant_id,
            subscription_id=str(uuid4()) if wrong_scope == "subscription" else stored.id,
        )
        is None
    )
    assert repository.get(tenant_id=stored.tenant_id, subscription_id=stored.id) == stored


def test_create_enforces_provider_limit_without_counting_other_tenants_or_providers(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    first = _snapshot()
    decoys = [
        replace(_snapshot(), provider_id=first.provider_id),
        replace(_snapshot(), tenant_id=first.tenant_id, provider_id="langgenius/other/other"),
    ]
    _persist(sqlite_session_factory, first, *decoys)
    second = replace(_snapshot(), tenant_id=first.tenant_id, name="Second")
    repository.create(subscription=second, max_count=2)
    third = replace(_snapshot(), tenant_id=first.tenant_id, name="Third")

    with pytest.raises(TriggerSubscriptionLimitError):
        repository.create(subscription=third, max_count=2)

    assert repository.get(tenant_id=first.tenant_id, subscription_id=second.id) == second
    assert repository.get(tenant_id=first.tenant_id, subscription_id=third.id) is None
    for decoy in decoys:
        assert repository.get(tenant_id=decoy.tenant_id, subscription_id=decoy.id) == decoy


def test_create_rejects_duplicate_name_only_in_same_tenant_and_provider(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    original = _snapshot()
    _persist(sqlite_session_factory, original)
    duplicate = replace(_snapshot(), tenant_id=original.tenant_id)

    with pytest.raises(TriggerSubscriptionNameConflictError):
        repository.create(subscription=duplicate, max_count=10)

    for allowed in (
        _snapshot(),
        replace(_snapshot(), tenant_id=original.tenant_id, provider_id="langgenius/other/other"),
    ):
        repository.create(subscription=allowed, max_count=10)
        assert repository.get(tenant_id=allowed.tenant_id, subscription_id=allowed.id) == allowed
    assert repository.get(tenant_id=duplicate.tenant_id, subscription_id=duplicate.id) is None


def test_create_does_not_mislabel_endpoint_constraint_as_name_conflict(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    original = _snapshot()
    _persist(sqlite_session_factory, original)
    conflicting = replace(_snapshot(), endpoint_id=original.endpoint_id)

    with pytest.raises(IntegrityError):
        repository.create(subscription=conflicting, max_count=10)

    assert repository.get(tenant_id=conflicting.tenant_id, subscription_id=conflicting.id) is None


def test_update_commits_only_target_and_returns_connection(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
) -> None:
    original = _snapshot()
    decoys = [_snapshot(), replace(_snapshot(), tenant_id=original.tenant_id, provider_id="langgenius/other/other")]
    _persist(sqlite_session_factory, original, *decoys)
    replacement = replace(
        original,
        name="Updated",
        parameters={},
        properties={"remote_id": "subscription-2"},
        credentials={"token": "rotated-token"},
        credential_expires_at=-1,
        expires_at=0,
    )

    repository.update(expected=original, replacement=replacement)

    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    assert pool.checkedout() == 0
    assert repository.get(tenant_id=original.tenant_id, subscription_id=original.id) == replacement
    for decoy in decoys:
        assert repository.get(tenant_id=decoy.tenant_id, subscription_id=decoy.id) == decoy


def test_update_duplicate_name_rolls_back_other_fields(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    original = _snapshot()
    other = replace(_snapshot(), tenant_id=original.tenant_id, name="Taken")
    _persist(sqlite_session_factory, original, other)

    with pytest.raises(TriggerSubscriptionNameConflictError):
        repository.update(expected=original, replacement=replace(original, name=other.name, credentials={}))

    assert repository.get(tenant_id=original.tenant_id, subscription_id=original.id) == original
    assert repository.get(tenant_id=other.tenant_id, subscription_id=other.id) == other


@pytest.mark.parametrize(
    ("field", "new_value"),
    [
        ("name", "Concurrent rename"),
        ("tenant_id", "a423cfd1-958f-4675-af10-154d3b59fddb"),
        ("user_id", "91924559-ddd1-471a-b208-3acc8126bc90"),
        ("provider_id", "langgenius/other/other"),
        ("endpoint_id", "replacement-endpoint"),
        ("credential_type", CredentialType.OAUTH2),
        ("parameters", {"events": ["issues"]}),
        ("properties", {"remote_id": "replacement"}),
        ("credentials", {"token": "replacement-ciphertext"}),
        ("credential_expires_at", 500),
        ("expires_at", 500),
        ("visibility", PermissionEnum.ONLY_ME),
    ],
)
@pytest.mark.parametrize("operation", ["update", "delete"])
def test_stale_snapshot_cannot_overwrite_or_delete_changed_subscription(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    field: str,
    new_value: object,
    operation: str,
) -> None:
    original = _snapshot()
    _persist(sqlite_session_factory, original)
    with sqlite_session_factory.begin() as session:
        session.execute(
            update(TriggerSubscription).where(TriggerSubscription.id == original.id).values({field: new_value})
        )

    if operation == "update":
        with pytest.raises(TriggerSubscriptionChangedError):
            repository.update(expected=original, replacement=replace(original, name="Stale write"))
    else:
        with pytest.raises(TriggerSubscriptionChangedError):
            repository.delete(expected=original)

    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    assert pool.checkedout() == 0
    with sqlite_session_factory() as session:
        row = session.get(TriggerSubscription, original.id)
        assert row is not None
        assert row.name == (new_value if field == "name" else original.name)
        assert row.credentials == (new_value if field == "credentials" else original.credentials)
        assert (
            session.scalar(select(TriggerSubscription.__table__.c[field]).where(TriggerSubscription.id == original.id))
            == new_value
        )


@pytest.mark.parametrize("operation", ["update", "delete"])
def test_removed_snapshot_cannot_be_recreated_by_a_stale_write(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
    operation: str,
) -> None:
    original = _snapshot()
    decoy = _snapshot()
    _persist(sqlite_session_factory, decoy)

    if operation == "update":
        with pytest.raises(TriggerSubscriptionChangedError):
            repository.update(expected=original, replacement=replace(original, name="Stale write"))
    else:
        with pytest.raises(TriggerSubscriptionChangedError):
            repository.delete(expected=original)

    assert repository.get(tenant_id=decoy.tenant_id, subscription_id=decoy.id) == decoy
    assert repository.get(tenant_id=original.tenant_id, subscription_id=original.id) is None


def test_delete_removes_every_matching_workflow_binding_and_preserves_other_scopes(
    repository: TriggerSubscriptionRepository,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
) -> None:
    original = _snapshot()
    other = replace(_snapshot(), tenant_id=original.tenant_id, name="Other")
    _persist(sqlite_session_factory, original, other)
    matching = [
        WorkflowPluginTrigger(
            app_id=str(uuid4()),
            node_id=f"node-{index}",
            tenant_id=original.tenant_id,
            provider_id=original.provider_id,
            event_name="push",
            subscription_id=original.id,
        )
        for index in range(2)
    ]
    decoys = [
        WorkflowPluginTrigger(
            app_id=str(uuid4()),
            node_id="node-decoy",
            tenant_id=tenant_id,
            provider_id=original.provider_id,
            event_name="push",
            subscription_id=subscription_id,
        )
        for tenant_id, subscription_id in [(str(uuid4()), original.id), (original.tenant_id, other.id)]
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all([*matching, *decoys])

    repository.delete(expected=original)

    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    assert pool.checkedout() == 0
    assert repository.get(tenant_id=original.tenant_id, subscription_id=original.id) is None
    assert repository.get(tenant_id=other.tenant_id, subscription_id=other.id) == other
    with sqlite_session_factory() as session:
        assert set(session.scalars(select(WorkflowPluginTrigger.id))) == {row.id for row in decoys}
