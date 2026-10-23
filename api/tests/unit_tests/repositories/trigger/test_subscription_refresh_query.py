"""Due scans use real SQL and remain stable while workers renew earlier rows."""

from dataclasses import replace
from uuid import UUID

import pytest
from sqlalchemy import Engine, update
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from models.trigger import TriggerSubscription
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository
from services.trigger.subscription_refresh_service import TriggerSubscriptionRefreshRef
from tests.unit_tests.repositories.trigger.test_subscription_repository import _persist, _snapshot


@pytest.mark.parametrize(
    ("credential_expiry", "subscription_expiry", "due"),
    [
        (-1, -1, False),
        (110, -1, True),
        (111, -1, False),
        (-1, 120, True),
        (-1, 121, False),
        (111, 120, True),
        (0, -1, True),
        (-1, 0, True),
    ],
)
def test_due_thresholds_and_never_expiring_sentinels(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    credential_expiry: int,
    subscription_expiry: int,
    due: bool,
) -> None:
    snapshot = replace(_snapshot(), credential_expires_at=credential_expiry, expires_at=subscription_expiry)
    _persist(sqlite_session_factory, snapshot)
    repository = TriggerSubscriptionRepository(session_factory=sqlite_session_factory)

    result = repository.list_due_for_refresh(credential_due_at=110, subscription_due_at=120, after_id=None, limit=10)

    assert result == (
        (TriggerSubscriptionRefreshRef(tenant_id=snapshot.tenant_id, subscription_id=snapshot.id),) if due else ()
    )
    assert isinstance(sqlite_engine.pool, QueuePool)
    assert sqlite_engine.pool.checkedout() == 0


def test_cursor_keeps_later_candidates_when_earlier_rows_are_renewed(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    snapshots = [replace(_snapshot(), id=str(UUID(int=index)), credential_expires_at=10) for index in range(1, 6)]
    _persist(sqlite_session_factory, *reversed(snapshots))
    repository = TriggerSubscriptionRepository(session_factory=sqlite_session_factory)
    first = repository.list_due_for_refresh(credential_due_at=100, subscription_due_at=100, after_id=None, limit=2)
    assert [item.subscription_id for item in first] == [snapshot.id for snapshot in snapshots[:2]]
    with sqlite_session_factory.begin() as session:
        session.execute(
            update(TriggerSubscription)
            .where(TriggerSubscription.id.in_([snapshot.id for snapshot in snapshots[:2]]))
            .values(credential_expires_at=1000)
        )

    second = repository.list_due_for_refresh(
        credential_due_at=100, subscription_due_at=100, after_id=first[-1].subscription_id, limit=2
    )
    final = repository.list_due_for_refresh(
        credential_due_at=100, subscription_due_at=100, after_id=second[-1].subscription_id, limit=2
    )
    assert [item.subscription_id for item in (*first, *second, *final)] == [snapshot.id for snapshot in snapshots]
    assert [item.tenant_id for item in (*first, *second, *final)] == [snapshot.tenant_id for snapshot in snapshots]
    assert (
        repository.list_due_for_refresh(
            credential_due_at=100, subscription_due_at=100, after_id=final[-1].subscription_id, limit=2
        )
        == ()
    )
