"""Durable SQLAlchemy sink for sanitized KnowledgeFS capability issuance audits."""

from __future__ import annotations

from typing import cast, override

from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import KnowledgeFSCapabilityClaimsSummary, KnowledgeFSCapabilityIssuanceAudit
from services.knowledge_fs_capability import CapabilityIssuanceAuditEvent, CapabilityIssuanceAuditor


class SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor(CapabilityIssuanceAuditor):
    """Commit the audit independently so token issuance fails closed on audit failure."""

    def __init__(self, session_maker: sessionmaker[Session]):
        self._session_maker = session_maker

    @override
    def record(self, event: CapabilityIssuanceAuditEvent) -> None:
        serialized = event.model_dump(mode="json")
        trace_id = cast(str, serialized.pop("trace_id"))
        jti_hash = cast(str, serialized.pop("jti_hash"))
        audit = KnowledgeFSCapabilityIssuanceAudit(
            tenant_id=event.namespace_id,
            control_space_id=event.control_space_id,
            trace_id=trace_id,
            jti_hash=jti_hash,
            claims_summary=cast(KnowledgeFSCapabilityClaimsSummary, serialized),
        )
        with self._session_maker.begin() as session:
            session.add(audit)


__all__ = ["SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor"]
