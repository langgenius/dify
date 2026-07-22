from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta
from unittest.mock import MagicMock, call

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpaceState,
    KnowledgeFSLifecycleOutbox,
    KnowledgeFSLifecycleOutboxStatus,
)
from services.knowledge_fs.control_space_commands import (
    KnowledgeFSControlSpaceCommandService,
    KnowledgeFSProvisionIntent,
)
from services.knowledge_fs.lifecycle_port import (
    KnowledgeFSCapabilityGrantRevokeAck,
    KnowledgeFSCapabilityGrantRevokeRequest,
    KnowledgeFSDeletionPhase,
    KnowledgeFSDeletionProgress,
    KnowledgeFSIntegratedDeletionRequest,
    KnowledgeFSIntegratedProvisionRequest,
    KnowledgeFSRemoteSpace,
)
from services.knowledge_fs.lifecycle_saga import KnowledgeFSLifecycleSagaRunner
from services.knowledge_fs.observability import KnowledgeFSLifecycleTaskMetric


class FakeKnowledgeFSLifecycleRemote:
    def __init__(self) -> None:
        self.provision_requests: list[KnowledgeFSIntegratedProvisionRequest] = []
        self.deletion_requests: list[KnowledgeFSIntegratedDeletionRequest] = []
        self.deletion_progress: deque[KnowledgeFSDeletionProgress] = deque()
        self.spaces: dict[str, KnowledgeFSRemoteSpace] = {}
        self.find_requests: list[tuple[str, str]] = []

    def provision_integrated_space(self, request: KnowledgeFSIntegratedProvisionRequest) -> KnowledgeFSRemoteSpace:
        self.provision_requests.append(request)
        return self.spaces.setdefault(
            request.provisioning_key,
            KnowledgeFSRemoteSpace(request.namespace_id, "space-1", request.provisioning_key, 1),
        )

    def request_integrated_deletion(self, request: KnowledgeFSIntegratedDeletionRequest) -> KnowledgeFSDeletionProgress:
        self.deletion_requests.append(request)
        return self.deletion_progress.popleft()

    def revoke_capability_grant(
        self, request: KnowledgeFSCapabilityGrantRevokeRequest
    ) -> KnowledgeFSCapabilityGrantRevokeAck:
        raise AssertionError(request)

    def find_by_provisioning_key(
        self,
        *,
        provisioning_key: str,
        control_space_id: str,
    ) -> KnowledgeFSRemoteSpace | None:
        self.find_requests.append((provisioning_key, control_space_id))
        return self.spaces.get(provisioning_key)

    def list_spaces(
        self,
        *,
        namespace_id: str,
        control_space_id: str,
    ) -> tuple[KnowledgeFSRemoteSpace, ...]:
        del control_space_id
        return tuple(space for space in self.spaces.values() if namespace_id in {None, space.namespace_id})


def _session_maker(sqlite_session: Session) -> sessionmaker[Session]:
    return sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)


def _provision_intent() -> KnowledgeFSProvisionIntent:
    return KnowledgeFSProvisionIntent(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
        operation_id="operation-1",
        idempotency_key="provision-idempotency-1",
        name="Technical space",
        slug="technical-space",
        icon=None,
        description=None,
        model_intent={"pluginId": "langgenius/openai", "provider": "openai", "model": "text-embedding-3-small"},
        profile_intent={
            "defaultMode": "fast",
            "reasoningModel": {"pluginId": "langgenius/openai", "provider": "openai", "model": "gpt-4.1-mini"},
            "rerank": {"enabled": False},
            "scoreThreshold": {"enabled": False, "stage": "mode-final"},
            "topK": 10,
        },
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_integrated_provision_saga_registers_remote_space_and_acks(sqlite_session: Session) -> None:
    session_maker = _session_maker(sqlite_session)
    intent = KnowledgeFSControlSpaceCommandService(session_maker).create_provision_intent(_provision_intent())
    remote = FakeKnowledgeFSLifecycleRemote()
    now = datetime(2026, 7, 21, 12, 0)
    with session_maker.begin() as session:
        command = session.get(KnowledgeFSLifecycleOutbox, intent.outbox.id)
        assert command is not None
        command.created_at = now - timedelta(seconds=12)
    metrics = MagicMock()
    runner = KnowledgeFSLifecycleSagaRunner(session_maker, remote, metrics=metrics)

    result = runner.dispatch_one(
        worker_id="worker-1",
        now=now,
        lease_duration=timedelta(minutes=1),
        product_enabled=True,
    )

    with session_maker() as session:
        control_space = session.get(KnowledgeFSControlSpace, intent.control_space.id)
        command = session.get(KnowledgeFSLifecycleOutbox, intent.outbox.id)
    assert result.completed is True
    assert control_space is not None
    assert control_space.state is KnowledgeFSControlSpaceState.ACTIVE
    assert control_space.knowledge_space_id == "space-1"
    assert control_space.knowledge_space_revision == 1
    assert command is not None
    assert command.status is KnowledgeFSLifecycleOutboxStatus.SUCCEEDED
    assert remote.provision_requests[0].model_intent["pluginId"] == "langgenius/openai"
    assert remote.provision_requests[0].profile_intent["defaultMode"] == "fast"
    assert metrics.record_lifecycle_task.call_args_list == [
        call(KnowledgeFSLifecycleTaskMetric(None, "provision", "running")),
        call(KnowledgeFSLifecycleTaskMetric(12.0, "provision", "succeeded")),
    ]
    assert "tenant-1" not in str(metrics.record_lifecycle_task.call_args_list)
    assert intent.control_space.id not in str(metrics.record_lifecycle_task.call_args_list)


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_provision_replay_ack_does_not_overwrite_a_higher_remote_revision(sqlite_session: Session) -> None:
    session_maker = _session_maker(sqlite_session)
    intent = KnowledgeFSControlSpaceCommandService(session_maker).create_provision_intent(_provision_intent())
    with session_maker.begin() as session:
        control_space = session.get(KnowledgeFSControlSpace, intent.control_space.id)
        assert control_space is not None
        control_space.state = KnowledgeFSControlSpaceState.ACTIVE
        control_space.knowledge_space_id = "space-1"
        control_space.knowledge_space_revision = 9
        control_space.resource_version = 1
    remote = FakeKnowledgeFSLifecycleRemote()

    result = KnowledgeFSLifecycleSagaRunner(session_maker, remote).dispatch_one(
        worker_id="worker-1",
        now=datetime(2026, 7, 21, 12, 0),
        lease_duration=timedelta(minutes=1),
        product_enabled=True,
    )

    with session_maker() as session:
        persisted = session.get(KnowledgeFSControlSpace, intent.control_space.id)
    assert result.completed is True
    assert persisted is not None
    assert persisted.knowledge_space_revision == 9


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSLifecycleOutbox)],
    indirect=True,
)
def test_deletion_saga_crosses_irreversible_point_and_remains_retryable_when_product_off(
    sqlite_session: Session,
) -> None:
    session_maker = _session_maker(sqlite_session)
    control_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
        knowledge_space_id="space-1",
        knowledge_space_revision=2,
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add(control_space)
    sqlite_session.commit()
    deletion = KnowledgeFSControlSpaceCommandService(session_maker).request_deletion(
        tenant_id="tenant-1",
        control_space_id=control_space.id,
        operation_id="delete-1",
        idempotency_key="delete-idempotency-1",
    )
    irreversible_at = datetime(2026, 7, 21, 12, 0)
    remote = FakeKnowledgeFSLifecycleRemote()
    remote.deletion_progress.extend(
        (
            KnowledgeFSDeletionProgress(KnowledgeFSDeletionPhase.IRREVERSIBLE, 3, irreversible_at),
            KnowledgeFSDeletionProgress(KnowledgeFSDeletionPhase.COMPLETED, 4, irreversible_at),
        )
    )
    metrics = MagicMock()
    runner = KnowledgeFSLifecycleSagaRunner(session_maker, remote, metrics=metrics)

    first = runner.dispatch_one(
        worker_id="worker-1",
        now=irreversible_at,
        lease_duration=timedelta(minutes=1),
        product_enabled=False,
    )
    second = runner.dispatch_one(
        worker_id="worker-1",
        now=irreversible_at + timedelta(seconds=3),
        lease_duration=timedelta(minutes=1),
        product_enabled=False,
    )

    with session_maker() as session:
        persisted = session.get(KnowledgeFSControlSpace, control_space.id)
        command = session.get(KnowledgeFSLifecycleOutbox, deletion.outbox.id if deletion.outbox else "")
    assert first.completed is False
    assert second.completed is True
    assert persisted is not None
    assert persisted.state is KnowledgeFSControlSpaceState.DELETED
    assert persisted.deletion_irreversible_at == irreversible_at
    assert persisted.knowledge_space_revision == 4
    assert command is not None
    assert command.status is KnowledgeFSLifecycleOutboxStatus.SUCCEEDED
    assert len(remote.deletion_requests) == 2
    assert [metric.status for ((metric,), _) in metrics.record_lifecycle_task.call_args_list] == [
        "running",
        "retry",
        "running",
        "succeeded",
    ]


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_lost_ack_deletion_persists_remote_identity_and_uses_remote_revision(sqlite_session: Session) -> None:
    session_maker = _session_maker(sqlite_session)
    provision = KnowledgeFSControlSpaceCommandService(session_maker).create_provision_intent(_provision_intent())
    with session_maker.begin() as session:
        command = session.get(KnowledgeFSLifecycleOutbox, provision.outbox.id)
        assert command is not None
        command.status = KnowledgeFSLifecycleOutboxStatus.RETRY
        command.attempt_count = 1
    deletion = KnowledgeFSControlSpaceCommandService(session_maker).request_deletion(
        tenant_id="tenant-1",
        control_space_id=provision.control_space.id,
        operation_id="delete-lost-ack",
        idempotency_key="delete-lost-ack-once",
    )
    remote = FakeKnowledgeFSLifecycleRemote()
    remote.spaces["provision-1"] = KnowledgeFSRemoteSpace("tenant-1", "space-lost-ack", "provision-1", 6)
    remote.deletion_progress.append(
        KnowledgeFSDeletionProgress(KnowledgeFSDeletionPhase.COMPLETED, 7, datetime(2026, 7, 21, 12, 0))
    )

    result = KnowledgeFSLifecycleSagaRunner(session_maker, remote).dispatch_one(
        worker_id="worker-1",
        now=datetime(2026, 7, 21, 12, 0),
        lease_duration=timedelta(minutes=1),
        product_enabled=False,
    )

    with session_maker() as session:
        control_space = session.get(KnowledgeFSControlSpace, provision.control_space.id)
        command = session.get(KnowledgeFSLifecycleOutbox, deletion.outbox.id if deletion.outbox else "")
    assert result.completed is True
    assert remote.find_requests == [("provision-1", provision.control_space.id)]
    assert remote.deletion_requests[0].knowledge_space_id == "space-lost-ack"
    assert remote.deletion_requests[0].expected_revision == 6
    assert control_space is not None
    assert control_space.knowledge_space_id == "space-lost-ack"
    assert control_space.knowledge_space_revision == 7
    assert control_space.state is KnowledgeFSControlSpaceState.DELETED
    assert command is not None
    assert command.status is KnowledgeFSLifecycleOutboxStatus.SUCCEEDED


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_feature_off_deletion_terminally_cleans_never_dispatched_provision(sqlite_session: Session) -> None:
    session_maker = _session_maker(sqlite_session)
    provision = KnowledgeFSControlSpaceCommandService(session_maker).create_provision_intent(_provision_intent())
    deletion = KnowledgeFSControlSpaceCommandService(session_maker).request_deletion(
        tenant_id="tenant-1",
        control_space_id=provision.control_space.id,
        operation_id="delete-before-provision",
        idempotency_key="delete-before-provision-once",
    )
    remote = FakeKnowledgeFSLifecycleRemote()
    runner = KnowledgeFSLifecycleSagaRunner(session_maker, remote)
    now = datetime(2026, 7, 21, 12, 0)

    first = runner.dispatch_one(
        worker_id="worker-1",
        now=now,
        lease_duration=timedelta(minutes=1),
        product_enabled=False,
    )
    replay = runner.dispatch_one(
        worker_id="worker-1",
        now=now + timedelta(seconds=1),
        lease_duration=timedelta(minutes=1),
        product_enabled=False,
    )

    with session_maker() as session:
        control_space = session.get(KnowledgeFSControlSpace, provision.control_space.id)
        provision_command = session.get(KnowledgeFSLifecycleOutbox, provision.outbox.id)
        deletion_command = session.get(KnowledgeFSLifecycleOutbox, deletion.outbox.id if deletion.outbox else "")
    assert first.completed is True
    assert replay.claimed is False
    assert control_space is not None
    assert control_space.state is KnowledgeFSControlSpaceState.DELETED
    assert provision_command is not None
    assert provision_command.status is KnowledgeFSLifecycleOutboxStatus.DEAD_LETTER
    assert deletion_command is not None
    assert deletion_command.status is KnowledgeFSLifecycleOutboxStatus.SUCCEEDED
    assert remote.find_requests == []
    assert remote.deletion_requests == []


@pytest.mark.parametrize(
    ("provision_status", "completed_at"),
    [
        (KnowledgeFSLifecycleOutboxStatus.RETRY, None),
        (KnowledgeFSLifecycleOutboxStatus.DEAD_LETTER, datetime(2026, 7, 21, 11, 0)),
    ],
)
@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_feature_off_cleanup_finishes_after_authoritative_absence_for_unleased_provision(
    sqlite_session: Session,
    provision_status: KnowledgeFSLifecycleOutboxStatus,
    completed_at: datetime | None,
) -> None:
    session_maker = _session_maker(sqlite_session)
    provision = KnowledgeFSControlSpaceCommandService(session_maker).create_provision_intent(_provision_intent())
    with session_maker.begin() as session:
        command = session.get(KnowledgeFSLifecycleOutbox, provision.outbox.id)
        assert command is not None
        command.status = provision_status
        command.attempt_count = 1
        command.completed_at = completed_at
    deletion = KnowledgeFSControlSpaceCommandService(session_maker).request_deletion(
        tenant_id="tenant-1",
        control_space_id=provision.control_space.id,
        operation_id=f"delete-absent-{provision_status}",
        idempotency_key=f"delete-absent-{provision_status}",
    )
    remote = FakeKnowledgeFSLifecycleRemote()
    now = datetime(2026, 7, 21, 12, 0)

    result = KnowledgeFSLifecycleSagaRunner(session_maker, remote).dispatch_one(
        worker_id="worker-1",
        now=now,
        lease_duration=timedelta(minutes=1),
        product_enabled=False,
    )

    with session_maker() as session:
        control_space = session.get(KnowledgeFSControlSpace, provision.control_space.id)
        provision_command = session.get(KnowledgeFSLifecycleOutbox, provision.outbox.id)
        deletion_command = session.get(KnowledgeFSLifecycleOutbox, deletion.outbox.id if deletion.outbox else "")
    assert result.completed is True
    assert remote.find_requests == [("provision-1", provision.control_space.id)]
    assert remote.deletion_requests == []
    assert control_space is not None
    assert control_space.state is KnowledgeFSControlSpaceState.DELETED
    assert provision_command is not None
    assert provision_command.status is KnowledgeFSLifecycleOutboxStatus.DEAD_LETTER
    assert provision_command.last_error_code == "SUPERSEDED_BY_DELETE"
    assert deletion_command is not None
    assert deletion_command.status is KnowledgeFSLifecycleOutboxStatus.SUCCEEDED


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_feature_off_cleanup_does_not_supersede_in_flight_provision(sqlite_session: Session) -> None:
    session_maker = _session_maker(sqlite_session)
    provision = KnowledgeFSControlSpaceCommandService(session_maker).create_provision_intent(_provision_intent())
    now = datetime(2026, 7, 21, 12, 0)
    with session_maker.begin() as session:
        command = session.get(KnowledgeFSLifecycleOutbox, provision.outbox.id)
        assert command is not None
        command.status = KnowledgeFSLifecycleOutboxStatus.PROCESSING
        command.attempt_count = 1
        command.lease_owner = "provision-worker"
        command.lease_expires_at = now + timedelta(minutes=1)
    deletion = KnowledgeFSControlSpaceCommandService(session_maker).request_deletion(
        tenant_id="tenant-1",
        control_space_id=provision.control_space.id,
        operation_id="delete-in-flight",
        idempotency_key="delete-in-flight",
    )
    remote = FakeKnowledgeFSLifecycleRemote()

    result = KnowledgeFSLifecycleSagaRunner(session_maker, remote).dispatch_one(
        worker_id="delete-worker",
        now=now,
        lease_duration=timedelta(minutes=1),
        product_enabled=False,
    )

    with session_maker() as session:
        control_space = session.get(KnowledgeFSControlSpace, provision.control_space.id)
        provision_command = session.get(KnowledgeFSLifecycleOutbox, provision.outbox.id)
        deletion_command = session.get(KnowledgeFSLifecycleOutbox, deletion.outbox.id if deletion.outbox else "")
    assert result.completed is False
    assert control_space is not None
    assert control_space.state is KnowledgeFSControlSpaceState.DELETING
    assert provision_command is not None
    assert provision_command.status is KnowledgeFSLifecycleOutboxStatus.PROCESSING
    assert deletion_command is not None
    assert deletion_command.status is KnowledgeFSLifecycleOutboxStatus.RETRY


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_feature_off_cleanup_supersedes_expired_provision_lease_after_remote_absence(
    sqlite_session: Session,
) -> None:
    session_maker = _session_maker(sqlite_session)
    provision = KnowledgeFSControlSpaceCommandService(session_maker).create_provision_intent(_provision_intent())
    now = datetime(2026, 7, 21, 12, 0)
    with session_maker.begin() as session:
        command = session.get(KnowledgeFSLifecycleOutbox, provision.outbox.id)
        assert command is not None
        command.status = KnowledgeFSLifecycleOutboxStatus.PROCESSING
        command.attempt_count = 1
        command.lease_owner = "expired-provision-worker"
        command.lease_expires_at = now - timedelta(seconds=1)
    KnowledgeFSControlSpaceCommandService(session_maker).request_deletion(
        tenant_id="tenant-1",
        control_space_id=provision.control_space.id,
        operation_id="delete-expired-provision",
        idempotency_key="delete-expired-provision",
    )
    remote = FakeKnowledgeFSLifecycleRemote()

    result = KnowledgeFSLifecycleSagaRunner(session_maker, remote).dispatch_one(
        worker_id="delete-worker",
        now=now,
        lease_duration=timedelta(minutes=1),
        product_enabled=False,
    )

    with session_maker() as session:
        control_space = session.get(KnowledgeFSControlSpace, provision.control_space.id)
        provision_command = session.get(KnowledgeFSLifecycleOutbox, provision.outbox.id)
    assert result.completed is True
    assert control_space is not None
    assert control_space.state is KnowledgeFSControlSpaceState.DELETED
    assert provision_command is not None
    assert provision_command.status is KnowledgeFSLifecycleOutboxStatus.DEAD_LETTER
    assert provision_command.lease_owner is None
    assert provision_command.lease_expires_at is None
