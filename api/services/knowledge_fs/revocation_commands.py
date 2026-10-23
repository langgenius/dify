"""Transactional producers for monotonic KnowledgeFS grant revocation commands."""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence
from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.orm import Session

from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSControlSpace,
    KnowledgeFSLifecycleOperation,
    KnowledgeFSLifecycleOutbox,
    KnowledgeFSRevokeCommandPayload,
)
from repositories.sqlalchemy_knowledge_fs_lifecycle_outbox_repository import (
    SQLAlchemyKnowledgeFSLifecycleOutboxRepository,
)

_REASON_CODE = re.compile(r"^[a-z0-9_.:-]{1,64}$")


class KnowledgeFSRevocationCommandError(RuntimeError):
    """A revoke command could not be bound to exact durable authorization state."""


class KnowledgeFSRevocationCommandPort(Protocol):
    def enqueue_principal_grants(
        self,
        *,
        session: Session,
        tenant_id: str,
        control_space_id: str,
        subject: str,
        reason_code: str,
        caller_kinds: Sequence[str] = (),
    ) -> tuple[KnowledgeFSLifecycleOutbox, ...]: ...

    def enqueue_control_space_grants(
        self,
        *,
        session: Session,
        tenant_id: str,
        control_space_id: str,
        reason_code: str,
        caller_kinds: Sequence[str],
        excluded_subjects: Sequence[str] = (),
    ) -> tuple[KnowledgeFSLifecycleOutbox, ...]: ...


class KnowledgeFSRevocationCommandProducer:
    """Lock one Space watermark and append exact grant revokes in the caller transaction."""

    def enqueue_principal_grants(
        self,
        *,
        session: Session,
        tenant_id: str,
        control_space_id: str,
        subject: str,
        reason_code: str,
        caller_kinds: Sequence[str] = (),
    ) -> tuple[KnowledgeFSLifecycleOutbox, ...]:
        normalized_subject = subject.strip()
        normalized_callers = tuple(dict.fromkeys(kind.strip() for kind in caller_kinds if kind.strip()))
        if not normalized_subject:
            raise KnowledgeFSRevocationCommandError("Revocation subject must not be blank")
        if not _REASON_CODE.fullmatch(reason_code):
            raise KnowledgeFSRevocationCommandError("Revocation reason code is invalid")

        control_space = session.scalar(
            sa.select(KnowledgeFSControlSpace)
            .where(
                KnowledgeFSControlSpace.tenant_id == tenant_id,
                KnowledgeFSControlSpace.id == control_space_id,
            )
            .with_for_update()
        )
        if control_space is None:
            raise KnowledgeFSRevocationCommandError("KnowledgeFS control-space was not found")
        revision = session.scalar(
            sa.select(KnowledgeFSAuthorizationRevision)
            .where(
                KnowledgeFSAuthorizationRevision.tenant_id == tenant_id,
                KnowledgeFSAuthorizationRevision.control_space_id == control_space_id,
            )
            .with_for_update()
        )
        if revision is None:
            raise KnowledgeFSRevocationCommandError("KnowledgeFS authorization revision is missing")

        claims_summary_column = KnowledgeFSCapabilityIssuanceAudit.claims_summary
        statement = (
            sa.select(KnowledgeFSCapabilityIssuanceAudit)
            .where(
                KnowledgeFSCapabilityIssuanceAudit.tenant_id == tenant_id,
                KnowledgeFSCapabilityIssuanceAudit.control_space_id == control_space_id,
                claims_summary_column["subject"].as_string() == normalized_subject,
            )
            .order_by(
                KnowledgeFSCapabilityIssuanceAudit.created_at,
                KnowledgeFSCapabilityIssuanceAudit.id,
            )
        )
        if normalized_callers:
            statement = statement.where(claims_summary_column["caller_kind"].as_string().in_(normalized_callers))
        audits = tuple(session.scalars(statement))
        reservation_statement = (
            sa.select(KnowledgeFSCapabilityIssuanceReservation)
            .where(
                KnowledgeFSCapabilityIssuanceReservation.tenant_id == tenant_id,
                KnowledgeFSCapabilityIssuanceReservation.control_space_id == control_space_id,
                KnowledgeFSCapabilityIssuanceReservation.subject == normalized_subject,
            )
            .order_by(
                KnowledgeFSCapabilityIssuanceReservation.created_at,
                KnowledgeFSCapabilityIssuanceReservation.id,
            )
        )
        if normalized_callers:
            reservation_statement = reservation_statement.where(
                KnowledgeFSCapabilityIssuanceReservation.caller_kind.in_(normalized_callers)
            )
        reservations = tuple(session.scalars(reservation_statement))

        grant_ids: list[str] = []
        seen: set[str] = set()
        for audit in audits:
            claims = audit.claims_summary
            if claims.get("subject") != normalized_subject:
                raise KnowledgeFSRevocationCommandError("Capability audit subject binding changed during revoke")
            if normalized_callers and claims.get("caller_kind") not in normalized_callers:
                raise KnowledgeFSRevocationCommandError("Capability audit caller binding changed during revoke")
            grant_id = claims.get("grant_id")
            if not isinstance(grant_id, str):
                raise KnowledgeFSRevocationCommandError("Capability audit grant id is invalid")
            try:
                normalized_grant_id = str(uuid.UUID(grant_id))
            except ValueError as exc:
                raise KnowledgeFSRevocationCommandError("Capability audit grant id is not a UUID") from exc
            if normalized_grant_id not in seen:
                seen.add(normalized_grant_id)
                grant_ids.append(normalized_grant_id)
        for reservation in reservations:
            reservation_summary = reservation.request_summary
            if reservation_summary.get("subject") != normalized_subject or reservation.subject != normalized_subject:
                raise KnowledgeFSRevocationCommandError("Capability reservation subject binding changed during revoke")
            if normalized_callers and (
                reservation_summary.get("caller_kind") not in normalized_callers
                or reservation.caller_kind not in normalized_callers
            ):
                raise KnowledgeFSRevocationCommandError("Capability reservation caller binding changed during revoke")
            if reservation_summary.get("grant_id") != reservation.grant_id:
                raise KnowledgeFSRevocationCommandError("Capability reservation grant binding changed during revoke")
            try:
                normalized_grant_id = str(uuid.UUID(reservation.grant_id))
            except ValueError as exc:
                raise KnowledgeFSRevocationCommandError("Capability reservation grant id is not a UUID") from exc
            if normalized_grant_id not in seen:
                seen.add(normalized_grant_id)
                grant_ids.append(normalized_grant_id)

        if not grant_ids:
            return ()
        if control_space.knowledge_space_id is None:
            raise KnowledgeFSRevocationCommandError("Revocation requires a registered KnowledgeFS Space")

        outbox_repository = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session)
        commands: list[KnowledgeFSLifecycleOutbox] = []
        for grant_id in grant_ids:
            revision.revoke_sequence += 1
            sequence = revision.revoke_sequence
            event_id = str(
                uuid.uuid5(
                    uuid.NAMESPACE_URL,
                    f"dify-kfs-revoke:{tenant_id}:{control_space_id}:{grant_id}:{sequence}",
                )
            )
            idempotency_key = f"kfs-revoke:{control_space_id}:{sequence}:{grant_id}"
            payload = KnowledgeFSRevokeCommandPayload(
                schema_version=1,
                idempotency_key=idempotency_key,
                expected_revision=control_space.knowledge_space_revision,
                event_id=event_id,
                grant_id=grant_id,
                knowledge_space_id=control_space.knowledge_space_id,
                principal=normalized_subject,
                reason_code=reason_code,
                revoke_sequence=sequence,
            )
            commands.append(
                outbox_repository.add(
                    KnowledgeFSLifecycleOutbox(
                        tenant_id=tenant_id,
                        control_space_id=control_space_id,
                        operation_id=event_id,
                        idempotency_key=idempotency_key,
                        operation=KnowledgeFSLifecycleOperation.REVOKE,
                        command_payload=payload,
                        expected_control_space_version=control_space.resource_version,
                        expected_knowledge_space_revision=control_space.knowledge_space_revision,
                    )
                )
            )
        return tuple(commands)

    def enqueue_control_space_grants(
        self,
        *,
        session: Session,
        tenant_id: str,
        control_space_id: str,
        reason_code: str,
        caller_kinds: Sequence[str],
        excluded_subjects: Sequence[str] = (),
    ) -> tuple[KnowledgeFSLifecycleOutbox, ...]:
        normalized_callers = tuple(dict.fromkeys(kind.strip() for kind in caller_kinds if kind.strip()))
        excluded = frozenset(subject.strip() for subject in excluded_subjects if subject.strip())
        if not normalized_callers:
            raise KnowledgeFSRevocationCommandError("Control-space revocation requires a caller kind")
        if not _REASON_CODE.fullmatch(reason_code):
            raise KnowledgeFSRevocationCommandError("Revocation reason code is invalid")
        claims_summary_column = KnowledgeFSCapabilityIssuanceAudit.claims_summary
        statement = (
            sa.select(KnowledgeFSCapabilityIssuanceAudit)
            .where(
                KnowledgeFSCapabilityIssuanceAudit.tenant_id == tenant_id,
                KnowledgeFSCapabilityIssuanceAudit.control_space_id == control_space_id,
                claims_summary_column["caller_kind"].as_string().in_(normalized_callers),
            )
            .order_by(
                KnowledgeFSCapabilityIssuanceAudit.created_at,
                KnowledgeFSCapabilityIssuanceAudit.id,
            )
        )
        if excluded:
            statement = statement.where(claims_summary_column["subject"].as_string().not_in(excluded))
        audits = tuple(session.scalars(statement))
        reservation_statement = sa.select(KnowledgeFSCapabilityIssuanceReservation).where(
            KnowledgeFSCapabilityIssuanceReservation.tenant_id == tenant_id,
            KnowledgeFSCapabilityIssuanceReservation.control_space_id == control_space_id,
            KnowledgeFSCapabilityIssuanceReservation.caller_kind.in_(normalized_callers),
        )
        if excluded:
            reservation_statement = reservation_statement.where(
                KnowledgeFSCapabilityIssuanceReservation.subject.not_in(excluded)
            )
        reservations = tuple(session.scalars(reservation_statement))
        subjects: set[str] = set()
        for audit in audits:
            claims = audit.claims_summary
            subject = claims.get("subject")
            caller_kind = claims.get("caller_kind")
            if not isinstance(subject, str) or not subject.strip():
                raise KnowledgeFSRevocationCommandError("Capability audit subject binding is invalid")
            if caller_kind not in normalized_callers:
                raise KnowledgeFSRevocationCommandError("Capability audit caller binding changed during revoke")
            if subject not in excluded:
                subjects.add(subject)
        for reservation in reservations:
            reservation_summary = reservation.request_summary
            subject = reservation_summary.get("subject")
            caller_kind = reservation_summary.get("caller_kind")
            if not isinstance(subject, str) or not subject.strip() or reservation.subject != subject:
                raise KnowledgeFSRevocationCommandError("Capability reservation subject binding is invalid")
            if caller_kind not in normalized_callers or reservation.caller_kind != caller_kind:
                raise KnowledgeFSRevocationCommandError("Capability reservation caller binding changed during revoke")
            if subject not in excluded:
                subjects.add(subject)
        commands: list[KnowledgeFSLifecycleOutbox] = []
        seen_grants: set[str] = set()
        for subject in sorted(subjects):
            subject_commands = self.enqueue_principal_grants(
                session=session,
                tenant_id=tenant_id,
                control_space_id=control_space_id,
                subject=subject,
                reason_code=reason_code,
                caller_kinds=normalized_callers,
            )
            for command in subject_commands:
                grant_id = command.command_payload.get("grant_id")
                if not isinstance(grant_id, str) or grant_id in seen_grants:
                    raise KnowledgeFSRevocationCommandError(
                        "Capability audit grant id is invalid or bound to multiple subjects"
                    )
                seen_grants.add(grant_id)
            commands.extend(subject_commands)
        return tuple(commands)


__all__ = [
    "KnowledgeFSRevocationCommandError",
    "KnowledgeFSRevocationCommandPort",
    "KnowledgeFSRevocationCommandProducer",
]
