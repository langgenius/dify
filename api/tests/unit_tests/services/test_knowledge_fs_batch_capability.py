from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
)
from services.knowledge_fs.batch_capability import (
    KnowledgeFSBatchCapabilityBroker,
    KnowledgeFSBatchSpaceBinding,
)
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError
from services.knowledge_fs_capability import CapabilityIssueRequest


class FakeIssuer:
    def __init__(self) -> None:
        self.requests: list[CapabilityIssueRequest] = []

    def issue(self, request: CapabilityIssueRequest):
        self.requests.append(request)
        return SimpleNamespace(token="batch-token", claims=SimpleNamespace(exp=2_000_000_000))


class FakeCutoverGate:
    def __init__(self, *, enabled: bool = True) -> None:
        self.enabled = enabled

    def require_product_routes(self, *, tenant_id: str) -> None:
        _ = tenant_id

    def require_capability_v2(self, *, tenant_id: str) -> None:
        _ = tenant_id
        if not self.enabled:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS Workspace is not cut over for product traffic")


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSAuthorizationRevision)],
    indirect=True,
)
def test_batch_capability_binds_exact_tenant_spaces_and_aggregates_revisions(sqlite_session: Session) -> None:
    first = _space("first", "space-1")
    second = _space("second", "space-2")
    sqlite_session.add_all([first, second])
    sqlite_session.flush()
    sqlite_session.add_all(
        [
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=first.id,
                membership_epoch=2,
                space_acl_epoch=7,
                external_access_epoch=3,
                content_policy_revision=5,
            ),
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=second.id,
                membership_epoch=11,
                space_acl_epoch=4,
                external_access_epoch=9,
                content_policy_revision=6,
            ),
        ]
    )
    sqlite_session.commit()
    issuer = FakeIssuer()
    broker = KnowledgeFSBatchCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        issuer=issuer,  # type: ignore[arg-type]
    )

    result = broker.issue_interactive(
        tenant_id="tenant-1",
        account_id="account-1",
        bindings=(
            KnowledgeFSBatchSpaceBinding(first.id, "space-1"),
            KnowledgeFSBatchSpaceBinding(second.id, "space-2"),
        ),
        trace_id="trace-1",
    )

    assert result.token == "batch-token"
    request = issuer.requests[0]
    assert request.operation_id == "batchKnowledgeSpaceProductSummaries"
    assert request.resource.type == "namespace"
    assert request.resource.id == "tenant-1"
    assert request.content_scope_ids == ("space-1", "space-2")
    assert request.control_space_id == first.id
    assert request.authz_revision.membership_epoch == 11
    assert request.authz_revision.space_acl_epoch == 7
    assert request.authz_revision.external_access_epoch == 9
    assert request.content_policy_revision == 6


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSAuthorizationRevision)],
    indirect=True,
)
def test_batch_capability_fails_closed_for_cross_tenant_or_changed_registration(
    sqlite_session: Session,
) -> None:
    space = _space("cross", "space-real", tenant_id="tenant-2")
    sqlite_session.add(space)
    sqlite_session.flush()
    sqlite_session.add(KnowledgeFSAuthorizationRevision(tenant_id="tenant-2", control_space_id=space.id))
    sqlite_session.commit()
    issuer = FakeIssuer()
    broker = KnowledgeFSBatchCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(),
        issuer=issuer,  # type: ignore[arg-type]
    )

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="snapshot"):
        broker.issue_interactive(
            tenant_id="tenant-1",
            account_id="account-1",
            bindings=(KnowledgeFSBatchSpaceBinding(space.id, "space-real"),),
            trace_id="trace-1",
        )
    with pytest.raises(KnowledgeFSOperationUnavailableError, match="between 1 and 100"):
        broker.issue_interactive(
            tenant_id="tenant-1",
            account_id="account-1",
            bindings=(),
            trace_id="trace-2",
        )
    assert issuer.requests == []


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSAuthorizationRevision)],
    indirect=True,
)
def test_batch_capability_rejects_an_uncutover_workspace_before_database_or_issuance(
    sqlite_session: Session,
) -> None:
    issuer = FakeIssuer()
    broker = KnowledgeFSBatchCapabilityBroker(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        cutover_gate=FakeCutoverGate(enabled=False),
        issuer=issuer,  # type: ignore[arg-type]
    )

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
        broker.issue_interactive(
            tenant_id="tenant-1",
            account_id="account-1",
            bindings=(KnowledgeFSBatchSpaceBinding("control-1", "space-1"),),
            trace_id="trace-1",
        )

    assert issuer.requests == []


def _space(key: str, remote_id: str, *, tenant_id: str = "tenant-1") -> KnowledgeFSControlSpace:
    return KnowledgeFSControlSpace(
        tenant_id=tenant_id,
        owner_account_id="account-1",
        provisioning_key=key,
        knowledge_space_id=remote_id,
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
