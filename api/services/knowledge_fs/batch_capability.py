"""Issue one namespace Capability over an exact, already-authorized Space batch."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import NamedTuple, Protocol

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
)
from services.knowledge_fs.cutover_runtime_gate import KnowledgeFSWorkspaceRuntimeGatePort
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError
from services.knowledge_fs_capability import (
    CapabilityAuthzRevision,
    CapabilityIssueRequest,
    CapabilityResource,
    IssuedKnowledgeFSCapability,
)

MAX_BATCH_SPACE_SUMMARIES = 100


class KnowledgeFSBatchSpaceBinding(NamedTuple):
    control_space_id: str
    knowledge_space_id: str


class KnowledgeFSIssuedBatchCapability(NamedTuple):
    token: str
    expires_at: datetime
    knowledge_space_ids: tuple[str, ...]
    trace_id: str


class KnowledgeFSBatchCapabilityIssuerPort(Protocol):
    def issue_interactive(
        self,
        *,
        tenant_id: str,
        account_id: str,
        bindings: tuple[KnowledgeFSBatchSpaceBinding, ...],
        trace_id: str,
    ) -> KnowledgeFSIssuedBatchCapability: ...


class KnowledgeFSCapabilityIssuerPort(Protocol):
    def issue(self, request: CapabilityIssueRequest) -> IssuedKnowledgeFSCapability: ...


class KnowledgeFSBatchCapabilityBroker:
    """Revalidates exact tenant/registration bindings before signing the scoped ID set."""

    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        cutover_gate: KnowledgeFSWorkspaceRuntimeGatePort,
        issuer: KnowledgeFSCapabilityIssuerPort | None,
    ) -> None:
        self._session_maker = session_maker
        self._cutover_gate = cutover_gate
        self._issuer = issuer

    def issue_interactive(
        self,
        *,
        tenant_id: str,
        account_id: str,
        bindings: tuple[KnowledgeFSBatchSpaceBinding, ...],
        trace_id: str,
    ) -> KnowledgeFSIssuedBatchCapability:
        self._cutover_gate.require_capability_v2(tenant_id=tenant_id)
        if self._issuer is None:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS Capability v2 is disabled")
        _validate_bindings(bindings)
        control_space_ids = tuple(binding.control_space_id for binding in bindings)
        with self._session_maker() as session:
            rows = session.execute(
                sa.select(KnowledgeFSControlSpace, KnowledgeFSAuthorizationRevision)
                .join(
                    KnowledgeFSAuthorizationRevision,
                    sa.and_(
                        KnowledgeFSAuthorizationRevision.tenant_id == KnowledgeFSControlSpace.tenant_id,
                        KnowledgeFSAuthorizationRevision.control_space_id == KnowledgeFSControlSpace.id,
                    ),
                )
                .where(
                    KnowledgeFSControlSpace.tenant_id == tenant_id,
                    KnowledgeFSControlSpace.id.in_(control_space_ids),
                    KnowledgeFSControlSpace.state == KnowledgeFSControlSpaceState.ACTIVE,
                )
            ).all()

        rows_by_control_id = {space.id: (space, revision) for space, revision in rows}
        if len(rows_by_control_id) != len(bindings):
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS batch authorization snapshot is incomplete")
        ordered_revisions: list[KnowledgeFSAuthorizationRevision] = []
        for binding in bindings:
            space, revision = rows_by_control_id[binding.control_space_id]
            if space.knowledge_space_id != binding.knowledge_space_id:
                raise KnowledgeFSOperationUnavailableError("KnowledgeFS batch registration changed")
            ordered_revisions.append(revision)

        knowledge_space_ids = tuple(binding.knowledge_space_id for binding in bindings)
        digest = hashlib.sha256("\0".join((*control_space_ids, *knowledge_space_ids)).encode()).hexdigest()[:24]
        issued = self._issuer.issue(
            CapabilityIssueRequest(
                actor=f"dify-account:{account_id}",
                authz_revision=CapabilityAuthzRevision(
                    membership_epoch=max(revision.membership_epoch for revision in ordered_revisions),
                    space_acl_epoch=max(revision.space_acl_epoch for revision in ordered_revisions),
                    external_access_epoch=max(revision.external_access_epoch for revision in ordered_revisions),
                    credential_revision=None,
                ),
                caller_kind="interactive",
                content_policy_revision=max(revision.content_policy_revision for revision in ordered_revisions),
                content_scope_ids=knowledge_space_ids,
                control_space_id=bindings[0].control_space_id,
                grant_id=f"account:{account_id}:batch:{digest}",
                namespace_id=tenant_id,
                operation_id="batchKnowledgeSpaceProductSummaries",
                principal_id=account_id,
                resource=CapabilityResource(type="namespace", id=tenant_id),
                trace_id=trace_id,
            )
        )
        return KnowledgeFSIssuedBatchCapability(
            token=issued.token,
            expires_at=datetime.fromtimestamp(issued.claims.exp, tz=UTC),
            knowledge_space_ids=knowledge_space_ids,
            trace_id=trace_id,
        )


def _validate_bindings(bindings: tuple[KnowledgeFSBatchSpaceBinding, ...]) -> None:
    if not bindings or len(bindings) > MAX_BATCH_SPACE_SUMMARIES:
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS batch size must be between 1 and 100")
    control_ids = tuple(binding.control_space_id.strip() for binding in bindings)
    space_ids = tuple(binding.knowledge_space_id.strip() for binding in bindings)
    if (
        any(not identifier for identifier in (*control_ids, *space_ids))
        or len(set(control_ids)) != len(control_ids)
        or len(set(space_ids)) != len(space_ids)
    ):
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS batch bindings must be unique and non-empty")


__all__ = [
    "MAX_BATCH_SPACE_SUMMARIES",
    "KnowledgeFSBatchCapabilityBroker",
    "KnowledgeFSBatchCapabilityIssuerPort",
    "KnowledgeFSBatchSpaceBinding",
    "KnowledgeFSIssuedBatchCapability",
]
