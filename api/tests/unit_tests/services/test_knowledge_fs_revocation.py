from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta
from operator import itemgetter
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityClaimsSummary,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSLifecycleOutbox,
    KnowledgeFSLifecycleOutboxStatus,
    KnowledgeFSRevokeCommandPayload,
)
from services.knowledge_fs.lifecycle_port import (
    KnowledgeFSCapabilityGrantRevokeAck,
    KnowledgeFSCapabilityGrantRevokeRequest,
    KnowledgeFSIntegratedDeletionRequest,
    KnowledgeFSIntegratedProvisionRequest,
    KnowledgeFSRemoteSpace,
)
from services.knowledge_fs.lifecycle_saga import KnowledgeFSLifecycleSagaRunner
from services.knowledge_fs.observability import KnowledgeFSLifecycleTaskMetric
from services.knowledge_fs.revocation_commands import (
    KnowledgeFSRevocationCommandError,
    KnowledgeFSRevocationCommandProducer,
)
from services.knowledge_fs.revocation_reconciler import KnowledgeFSRevocationReconciler

_SPACE_ID = "10000000-0000-4000-8000-000000000001"
_GRANT_A = "20000000-0000-4000-8000-000000000001"
_GRANT_B = "20000000-0000-4000-8000-000000000002"


class FakeRemote:
    def __init__(self) -> None:
        self.revoke_requests: list[KnowledgeFSCapabilityGrantRevokeRequest] = []
        self.revoke_acks: deque[KnowledgeFSCapabilityGrantRevokeAck] = deque()

    def revoke_capability_grant(
        self, request: KnowledgeFSCapabilityGrantRevokeRequest
    ) -> KnowledgeFSCapabilityGrantRevokeAck:
        self.revoke_requests.append(request)
        return self.revoke_acks.popleft()

    def provision_integrated_space(self, request: KnowledgeFSIntegratedProvisionRequest) -> KnowledgeFSRemoteSpace:
        raise AssertionError(request)

    def request_integrated_deletion(self, request: KnowledgeFSIntegratedDeletionRequest):
        raise AssertionError(request)

    def find_by_provisioning_key(self, *, provisioning_key: str, control_space_id: str):
        raise AssertionError((provisioning_key, control_space_id))

    def list_spaces(self, *, namespace_id: str, control_space_id: str):
        raise AssertionError((namespace_id, control_space_id))


def _maker(sqlite_session: Session) -> sessionmaker[Session]:
    return sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)


def _audit(
    *,
    control_space_id: str,
    grant_id: str,
    subject: str = "dify-account:member-1",
    caller_kind: str = "interactive",
    jti: str,
) -> KnowledgeFSCapabilityIssuanceAudit:
    return KnowledgeFSCapabilityIssuanceAudit(
        tenant_id="tenant-1",
        control_space_id=control_space_id,
        trace_id=f"trace-{jti}",
        jti_hash=f"sha256:{jti * 64}"[:71],
        claims_summary=cast(
            KnowledgeFSCapabilityClaimsSummary,
            {
                "caller_kind": caller_kind,
                "grant_id": grant_id,
                "subject": subject,
            },
        ),
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_producer_strictly_binds_and_deduplicates_grants_with_a_monotonic_space_sequence(
    sqlite_session: Session,
) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-1",
        knowledge_space_id=_SPACE_ID,
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add_all(
        [
            space,
            KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id),
            _audit(control_space_id=space.id, grant_id=_GRANT_A, jti="a"),
            _audit(control_space_id=space.id, grant_id=_GRANT_A, jti="b"),
            _audit(control_space_id=space.id, grant_id=_GRANT_B, jti="c"),
            _audit(
                control_space_id=space.id,
                grant_id="20000000-0000-4000-8000-000000000003",
                subject="dify-account:other",
                jti="d",
            ),
            _audit(
                control_space_id=space.id,
                grant_id="20000000-0000-4000-8000-000000000004",
                caller_kind="service",
                jti="e",
            ),
        ]
    )
    sqlite_session.commit()

    with _maker(sqlite_session).begin() as session:
        commands = KnowledgeFSRevocationCommandProducer().enqueue_principal_grants(
            session=session,
            tenant_id="tenant-1",
            control_space_id=space.id,
            subject="dify-account:member-1",
            reason_code="permission_revoked",
            caller_kinds=("interactive",),
        )

    with _maker(sqlite_session)() as session:
        revision = session.scalar(
            select(KnowledgeFSAuthorizationRevision).where(
                KnowledgeFSAuthorizationRevision.control_space_id == space.id
            )
        )
        persisted = tuple(session.scalars(select(KnowledgeFSLifecycleOutbox)))
    persisted_payloads = sorted(
        (cast(KnowledgeFSRevokeCommandPayload, command.command_payload) for command in persisted),
        key=itemgetter("revoke_sequence"),
    )
    assert revision is not None
    assert revision.revoke_sequence == 2
    assert len(commands) == len(persisted) == 2
    assert [payload["grant_id"] for payload in persisted_payloads] == [_GRANT_A, _GRANT_B]
    assert [payload["revoke_sequence"] for payload in persisted_payloads] == [1, 2]
    assert all(payload["knowledge_space_id"] == _SPACE_ID for payload in persisted_payloads)


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_revoke_consumer_accepts_idempotent_or_higher_watermark_and_reconciliation_replays(
    sqlite_session: Session,
) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-1",
        knowledge_space_id=_SPACE_ID,
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add_all(
        [
            space,
            KnowledgeFSAuthorizationRevision(tenant_id="tenant-1", control_space_id=space.id),
            _audit(control_space_id=space.id, grant_id=_GRANT_A, jti="f"),
        ]
    )
    sqlite_session.commit()
    maker = _maker(sqlite_session)
    with maker.begin() as session:
        (command,) = KnowledgeFSRevocationCommandProducer().enqueue_principal_grants(
            session=session,
            tenant_id="tenant-1",
            control_space_id=space.id,
            subject="dify-account:member-1",
            reason_code="permission_revoked",
            caller_kinds=("interactive",),
        )
        command.created_at = datetime(2026, 7, 21, 11, 59, 35)

    remote = FakeRemote()
    remote.revoke_acks.append(KnowledgeFSCapabilityGrantRevokeAck(False, 7, "revoked"))
    metrics = MagicMock()
    dispatched = KnowledgeFSLifecycleSagaRunner(maker, remote, metrics=metrics).dispatch_one(
        worker_id="worker-1",
        now=datetime(2026, 7, 21, 12, 0),
        lease_duration=timedelta(minutes=1),
        product_enabled=True,
    )

    with maker() as session:
        persisted = session.get(KnowledgeFSLifecycleOutbox, command.id)
    assert dispatched.completed is True
    assert persisted is not None
    assert persisted.status is KnowledgeFSLifecycleOutboxStatus.SUCCEEDED
    command_payload = cast(KnowledgeFSRevokeCommandPayload, command.command_payload)
    assert remote.revoke_requests[0].event_id == command_payload["event_id"]
    assert remote.revoke_requests[0].revoke_sequence == 1
    assert metrics.record_lifecycle_task.call_args_list[-1].args == (
        KnowledgeFSLifecycleTaskMetric(25.0, "revoke", "succeeded"),
    )
    assert "tenant-1" not in str(metrics.record_lifecycle_task.call_args_list)
    assert command.id not in str(metrics.record_lifecycle_task.call_args_list)

    remote.revoke_acks.append(KnowledgeFSCapabilityGrantRevokeAck(True, 1, "revoked"))
    repaired = KnowledgeFSRevocationReconciler(maker, remote).reconcile(
        tenant_id="tenant-1",
        control_space_id=space.id,
    )
    assert repaired.checked == 1
    assert repaired.repaired == 1
    assert repaired.issues == ()

    remote.revoke_acks.append(KnowledgeFSCapabilityGrantRevokeAck(False, 0, "active"))
    lag = KnowledgeFSRevocationReconciler(maker, remote).reconcile(
        tenant_id="tenant-1",
        control_space_id=space.id,
    )
    assert lag.checked == 1
    assert lag.repaired == 0
    assert lag.issues[0].error_code == "REMOTE_REVOKE_WATERMARK_LAG"


@pytest.mark.parametrize(
    ("subject", "reason", "message"),
    [
        ("  ", "permission_revoked", "subject"),
        ("dify-account:member-1", "INVALID REASON", "reason code"),
    ],
)
def test_principal_revocation_rejects_unbound_operator_input(subject: str, reason: str, message: str) -> None:
    with pytest.raises(KnowledgeFSRevocationCommandError, match=message):
        KnowledgeFSRevocationCommandProducer().enqueue_principal_grants(
            session=MagicMock(),
            tenant_id="tenant-1",
            control_space_id="control-1",
            subject=subject,
            reason_code=reason,
        )


def _principal_session(
    *,
    control_space: object | None = None,
    revision: object | None = None,
    audits: tuple[object, ...] = (),
    reservations: tuple[object, ...] = (),
) -> MagicMock:
    session = MagicMock()
    session.scalar.side_effect = (
        control_space if control_space is not None else None,
        revision if revision is not None else None,
    )
    session.scalars.side_effect = (audits, reservations)
    return session


def test_principal_revocation_requires_control_space_revision_and_registration() -> None:
    producer = KnowledgeFSRevocationCommandProducer()
    with pytest.raises(KnowledgeFSRevocationCommandError, match="control-space"):
        producer.enqueue_principal_grants(
            session=_principal_session(),
            tenant_id="tenant-1",
            control_space_id="control-1",
            subject="dify-account:member-1",
            reason_code="permission_revoked",
        )

    control_space = SimpleNamespace(knowledge_space_id="space-1")
    with pytest.raises(KnowledgeFSRevocationCommandError, match="revision"):
        producer.enqueue_principal_grants(
            session=_principal_session(control_space=control_space),
            tenant_id="tenant-1",
            control_space_id="control-1",
            subject="dify-account:member-1",
            reason_code="permission_revoked",
        )

    revision = SimpleNamespace(revoke_sequence=0)
    assert (
        producer.enqueue_principal_grants(
            session=_principal_session(control_space=control_space, revision=revision),
            tenant_id="tenant-1",
            control_space_id="control-1",
            subject="dify-account:member-1",
            reason_code="permission_revoked",
        )
        == ()
    )

    audit = SimpleNamespace(
        claims_summary={
            "subject": "dify-account:member-1",
            "caller_kind": "interactive",
            "grant_id": _GRANT_A,
        }
    )
    with pytest.raises(KnowledgeFSRevocationCommandError, match="registered"):
        producer.enqueue_principal_grants(
            session=_principal_session(
                control_space=SimpleNamespace(knowledge_space_id=None),
                revision=revision,
                audits=(audit,),
            ),
            tenant_id="tenant-1",
            control_space_id="control-1",
            subject="dify-account:member-1",
            reason_code="permission_revoked",
        )


@pytest.mark.parametrize(
    ("claims", "message"),
    [
        ({"subject": "other", "caller_kind": "interactive", "grant_id": _GRANT_A}, "subject binding"),
        ({"subject": "member", "caller_kind": "service", "grant_id": _GRANT_A}, "caller binding"),
        ({"subject": "member", "caller_kind": "interactive", "grant_id": 7}, "grant id is invalid"),
        ({"subject": "member", "caller_kind": "interactive", "grant_id": "not-a-uuid"}, "not a UUID"),
    ],
)
def test_principal_revocation_revalidates_persisted_audit_bindings(
    claims: dict[str, object],
    message: str,
) -> None:
    session = _principal_session(
        control_space=SimpleNamespace(knowledge_space_id="space-1"),
        revision=SimpleNamespace(revoke_sequence=0),
        audits=(SimpleNamespace(claims_summary=claims),),
    )

    with pytest.raises(KnowledgeFSRevocationCommandError, match=message):
        KnowledgeFSRevocationCommandProducer().enqueue_principal_grants(
            session=session,
            tenant_id="tenant-1",
            control_space_id="control-1",
            subject="member",
            reason_code="permission_revoked",
            caller_kinds=("interactive",),
        )


@pytest.mark.parametrize(
    ("summary", "subject", "caller_kind", "grant_id", "message"),
    [
        (
            {"subject": "other", "caller_kind": "interactive", "grant_id": _GRANT_A},
            "member",
            "interactive",
            _GRANT_A,
            "subject binding",
        ),
        (
            {"subject": "member", "caller_kind": "service", "grant_id": _GRANT_A},
            "member",
            "service",
            _GRANT_A,
            "caller binding",
        ),
        (
            {"subject": "member", "caller_kind": "interactive", "grant_id": _GRANT_B},
            "member",
            "interactive",
            _GRANT_A,
            "grant binding",
        ),
        (
            {"subject": "member", "caller_kind": "interactive", "grant_id": "not-a-uuid"},
            "member",
            "interactive",
            "not-a-uuid",
            "not a UUID",
        ),
    ],
)
def test_principal_revocation_revalidates_persisted_reservation_bindings(
    summary: dict[str, object],
    subject: str,
    caller_kind: str,
    grant_id: str,
    message: str,
) -> None:
    reservation = SimpleNamespace(
        request_summary=summary,
        subject=subject,
        caller_kind=caller_kind,
        grant_id=grant_id,
    )
    session = _principal_session(
        control_space=SimpleNamespace(knowledge_space_id="space-1"),
        revision=SimpleNamespace(revoke_sequence=0),
        reservations=(reservation,),
    )

    with pytest.raises(KnowledgeFSRevocationCommandError, match=message):
        KnowledgeFSRevocationCommandProducer().enqueue_principal_grants(
            session=session,
            tenant_id="tenant-1",
            control_space_id="control-1",
            subject="member",
            reason_code="permission_revoked",
            caller_kinds=("interactive",),
        )


def test_control_space_revocation_validates_callers_and_deduplicates_grants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    producer = KnowledgeFSRevocationCommandProducer()
    with pytest.raises(KnowledgeFSRevocationCommandError, match="caller kind"):
        producer.enqueue_control_space_grants(
            session=MagicMock(),
            tenant_id="tenant-1",
            control_space_id="control-1",
            reason_code="permission_revoked",
            caller_kinds=(),
        )
    with pytest.raises(KnowledgeFSRevocationCommandError, match="reason code"):
        producer.enqueue_control_space_grants(
            session=MagicMock(),
            tenant_id="tenant-1",
            control_space_id="control-1",
            reason_code="INVALID REASON",
            caller_kinds=("interactive",),
        )

    session = MagicMock()
    session.scalars.side_effect = (
        (
            SimpleNamespace(
                claims_summary={"subject": "member-b", "caller_kind": "interactive"},
            ),
            SimpleNamespace(
                claims_summary={"subject": "excluded", "caller_kind": "interactive"},
            ),
        ),
        (
            SimpleNamespace(
                request_summary={"subject": "member-a", "caller_kind": "interactive"},
                subject="member-a",
                caller_kind="interactive",
            ),
        ),
    )
    commands_by_subject = {
        "member-a": (SimpleNamespace(command_payload={"grant_id": _GRANT_A}),),
        "member-b": (SimpleNamespace(command_payload={"grant_id": _GRANT_B}),),
    }
    enqueue = MagicMock(side_effect=lambda **kwargs: commands_by_subject[kwargs["subject"]])
    monkeypatch.setattr(producer, "enqueue_principal_grants", enqueue)

    commands = producer.enqueue_control_space_grants(
        session=session,
        tenant_id="tenant-1",
        control_space_id="control-1",
        reason_code="permission_revoked",
        caller_kinds=("interactive", "interactive"),
        excluded_subjects=("excluded",),
    )

    assert [command.command_payload["grant_id"] for command in commands] == [_GRANT_A, _GRANT_B]
    assert [call.kwargs["subject"] for call in enqueue.call_args_list] == ["member-a", "member-b"]
