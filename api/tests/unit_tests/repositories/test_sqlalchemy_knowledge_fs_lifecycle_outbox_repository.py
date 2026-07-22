from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.knowledge_fs import (
    KnowledgeFSControlSpace,
    KnowledgeFSLifecycleOperation,
    KnowledgeFSLifecycleOutbox,
    KnowledgeFSLifecycleOutboxStatus,
)
from repositories.sqlalchemy_knowledge_fs_lifecycle_outbox_repository import (
    SQLAlchemyKnowledgeFSLifecycleOutboxRepository,
)
from services.knowledge_fs.observability import KnowledgeFSLifecycleTaskMetric


def _outbox(control_space: KnowledgeFSControlSpace) -> KnowledgeFSLifecycleOutbox:
    return KnowledgeFSLifecycleOutbox(
        tenant_id=control_space.tenant_id,
        control_space_id=control_space.id,
        operation_id="00000000-0000-0000-0000-000000000010",
        idempotency_key="provision:one",
        operation=KnowledgeFSLifecycleOperation.PROVISION,
        command_payload={
            "description": None,
            "expected_revision": 0,
            "icon": None,
            "idempotency_key": "provision:one",
            "model_intent": {},
            "name": "One",
            "profile_intent": {},
            "schema_version": 1,
            "slug": "one",
        },
        expected_control_space_version=0,
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSLifecycleOutbox)],
    indirect=True,
)
def test_add_records_only_a_low_cardinality_queued_observation(sqlite_session: Session) -> None:
    control_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
    )
    sqlite_session.add(control_space)
    sqlite_session.flush()
    metrics = MagicMock()
    repository = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(sqlite_session, metrics=metrics)

    command = repository.add(_outbox(control_space))

    metrics.record_lifecycle_task.assert_called_once_with(KnowledgeFSLifecycleTaskMetric(None, "provision", "queued"))
    assert command.id not in str(metrics.record_lifecycle_task.call_args_list)
    assert control_space.id not in str(metrics.record_lifecycle_task.call_args_list)
    assert control_space.tenant_id not in str(metrics.record_lifecycle_task.call_args_list)


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSLifecycleOutbox)],
    indirect=True,
)
def test_claim_uses_owner_and_expiry_cas_and_reclaims_only_expired_leases(sqlite_session: Session) -> None:
    now = naive_utc_now()
    control_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
    )
    command = _outbox(control_space)
    sqlite_session.add_all([control_space, command])
    sqlite_session.commit()
    repository = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(sqlite_session)

    first_claim = repository.claim_next(
        lease_owner="worker-1",
        now=now,
        lease_duration=timedelta(minutes=1),
        allowed_operations=(KnowledgeFSLifecycleOperation.PROVISION,),
    )
    assert first_claim is not None
    assert first_claim.status is KnowledgeFSLifecycleOutboxStatus.PROCESSING
    assert first_claim.lease_owner == "worker-1"
    assert first_claim.attempt_count == 1

    assert (
        repository.claim_next(
            lease_owner="worker-2",
            now=now + timedelta(seconds=30),
            lease_duration=timedelta(minutes=1),
            allowed_operations=(KnowledgeFSLifecycleOperation.PROVISION,),
        )
        is None
    )
    reclaimed = repository.claim_next(
        lease_owner="worker-2",
        now=now + timedelta(minutes=2),
        lease_duration=timedelta(minutes=1),
        allowed_operations=(KnowledgeFSLifecycleOperation.PROVISION,),
    )
    assert reclaimed is not None
    assert reclaimed.lease_owner == "worker-2"
    assert reclaimed.attempt_count == 2


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSLifecycleOutbox)],
    indirect=True,
)
def test_ack_and_retry_require_the_exact_live_lease(sqlite_session: Session) -> None:
    now = naive_utc_now()
    control_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
    )
    command = _outbox(control_space)
    sqlite_session.add_all([control_space, command])
    sqlite_session.commit()
    repository = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(sqlite_session)
    claimed = repository.claim_next(
        lease_owner="worker-1",
        now=now,
        lease_duration=timedelta(minutes=1),
        allowed_operations=(KnowledgeFSLifecycleOperation.PROVISION,),
    )
    assert claimed is not None
    assert claimed.lease_expires_at is not None

    assert not repository.acknowledge(
        outbox_id=claimed.id,
        lease_owner="worker-2",
        expected_lease_expires_at=claimed.lease_expires_at,
        completed_at=now,
    )
    assert repository.schedule_retry(
        outbox_id=claimed.id,
        lease_owner="worker-1",
        expected_lease_expires_at=claimed.lease_expires_at,
        next_attempt_at=now + timedelta(seconds=10),
        error_code="timeout",
        error_message="retry later",
    )
    retried = repository.get(outbox_id=claimed.id)
    assert retried is not None
    assert retried.status is KnowledgeFSLifecycleOutboxStatus.RETRY
    assert retried.lease_owner is None
    assert retried.lease_expires_at is None

    claimed_again = repository.claim_next(
        lease_owner="worker-1",
        now=now + timedelta(seconds=11),
        lease_duration=timedelta(minutes=1),
        allowed_operations=(KnowledgeFSLifecycleOperation.PROVISION,),
    )
    assert claimed_again is not None
    assert claimed_again.lease_expires_at is not None
    assert repository.acknowledge(
        outbox_id=claimed_again.id,
        lease_owner="worker-1",
        expected_lease_expires_at=claimed_again.lease_expires_at,
        completed_at=now + timedelta(seconds=12),
    )
    acknowledged = repository.get(outbox_id=claimed.id)
    assert acknowledged is not None
    assert acknowledged.status is KnowledgeFSLifecycleOutboxStatus.SUCCEEDED
    assert acknowledged.completed_at is not None
