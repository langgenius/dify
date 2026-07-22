"""Replay successful grant revokes and compare KnowledgeFS monotonic acknowledgments."""

from __future__ import annotations

from typing import NamedTuple, cast

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    KnowledgeFSLifecycleOperation,
    KnowledgeFSLifecycleOutbox,
    KnowledgeFSLifecycleOutboxStatus,
    KnowledgeFSRevokeCommandPayload,
)
from repositories.sqlalchemy_knowledge_fs_lifecycle_outbox_repository import (
    SQLAlchemyKnowledgeFSLifecycleOutboxRepository,
)
from services.knowledge_fs.lifecycle_port import (
    KnowledgeFSCapabilityGrantRevokeRequest,
    KnowledgeFSLifecycleRemoteError,
    KnowledgeFSLifecycleRemotePort,
)


class KnowledgeFSRevokeReconciliationIssue(NamedTuple):
    grant_id: str
    expected_revoke_sequence: int
    observed_revoke_sequence: int | None
    error_code: str


class KnowledgeFSRevokeReconciliationResult(NamedTuple):
    checked: int
    repaired: int
    issues: tuple[KnowledgeFSRevokeReconciliationIssue, ...]


class KnowledgeFSRevocationReconciler:
    def __init__(self, session_maker: sessionmaker[Session], remote: KnowledgeFSLifecycleRemotePort) -> None:
        self._session_maker = session_maker
        self._remote = remote

    def reconcile(
        self,
        *,
        tenant_id: str,
        control_space_id: str,
    ) -> KnowledgeFSRevokeReconciliationResult:
        with self._session_maker() as session:
            commands = tuple(
                session.scalars(
                    sa.select(KnowledgeFSLifecycleOutbox)
                    .where(
                        KnowledgeFSLifecycleOutbox.tenant_id == tenant_id,
                        KnowledgeFSLifecycleOutbox.control_space_id == control_space_id,
                        KnowledgeFSLifecycleOutbox.operation == KnowledgeFSLifecycleOperation.REVOKE,
                        KnowledgeFSLifecycleOutbox.status == KnowledgeFSLifecycleOutboxStatus.SUCCEEDED,
                    )
                    .order_by(KnowledgeFSLifecycleOutbox.created_at, KnowledgeFSLifecycleOutbox.id)
                )
            )
        latest_by_grant: dict[str, tuple[KnowledgeFSLifecycleOutbox, KnowledgeFSRevokeCommandPayload]] = {}
        for command in commands:
            payload = cast(KnowledgeFSRevokeCommandPayload, command.command_payload)
            grant_id = payload["grant_id"]
            current = latest_by_grant.get(grant_id)
            if current is None or payload["revoke_sequence"] > current[1]["revoke_sequence"]:
                latest_by_grant[grant_id] = (command, payload)

        repaired = 0
        issues: list[KnowledgeFSRevokeReconciliationIssue] = []
        for command, payload in latest_by_grant.values():
            try:
                acknowledgment = self._remote.revoke_capability_grant(_revoke_request(command, payload))
            except KnowledgeFSLifecycleRemoteError as exc:
                issues.append(
                    KnowledgeFSRevokeReconciliationIssue(
                        grant_id=payload["grant_id"],
                        expected_revoke_sequence=payload["revoke_sequence"],
                        observed_revoke_sequence=None,
                        error_code=exc.code,
                    )
                )
                continue
            if acknowledgment.state != "revoked" or acknowledgment.highest_revoke_sequence < payload["revoke_sequence"]:
                issues.append(
                    KnowledgeFSRevokeReconciliationIssue(
                        grant_id=payload["grant_id"],
                        expected_revoke_sequence=payload["revoke_sequence"],
                        observed_revoke_sequence=acknowledgment.highest_revoke_sequence,
                        error_code="REMOTE_REVOKE_WATERMARK_LAG",
                    )
                )
                continue
            if acknowledgment.applied:
                repaired += 1
        return KnowledgeFSRevokeReconciliationResult(
            checked=len(latest_by_grant),
            repaired=repaired,
            issues=tuple(issues),
        )

    def replay_dead_letter(
        self,
        *,
        tenant_id: str,
        control_space_id: str,
        outbox_id: str,
    ) -> bool:
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session)
            command = repository.get(outbox_id=outbox_id)
            if (
                command is None
                or command.tenant_id != tenant_id
                or command.control_space_id != control_space_id
                or command.operation is not KnowledgeFSLifecycleOperation.REVOKE
            ):
                return False
            return repository.reactivate_dead_letter(outbox_id=outbox_id)


def _revoke_request(
    command: KnowledgeFSLifecycleOutbox,
    payload: KnowledgeFSRevokeCommandPayload,
) -> KnowledgeFSCapabilityGrantRevokeRequest:
    return KnowledgeFSCapabilityGrantRevokeRequest(
        namespace_id=command.tenant_id,
        control_space_id=command.control_space_id,
        operation_id=command.operation_id,
        idempotency_key=command.idempotency_key,
        knowledge_space_id=payload["knowledge_space_id"],
        grant_id=payload["grant_id"],
        event_id=payload["event_id"],
        reason_code=payload["reason_code"],
        revoke_sequence=payload["revoke_sequence"],
        expected_revision=payload["expected_revision"],
    )


__all__ = [
    "KnowledgeFSRevocationReconciler",
    "KnowledgeFSRevokeReconciliationIssue",
    "KnowledgeFSRevokeReconciliationResult",
]
