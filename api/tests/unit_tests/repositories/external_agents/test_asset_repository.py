"""Real transaction regression tests for verified immutable External Agent assets."""

from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.agent import Agent, WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.base import TypeBase
from models.external_agent import (
    ExternalAgentConnectionRevision,
    ExternalAgentContextSlot,
    ExternalAgentHead,
    ExternalAgentInvocation,
    ExternalAgentOperation,
    ExternalAgentVerification,
)
from models.external_agent_trace import ExternalAgentDataTombstone
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from repositories.external_agents.asset_repository import ExternalAssetRepository
from services.external_agents.contracts import (
    ExternalAgentConflictError,
    ExternalAgentForbiddenError,
    ExternalAgentIdempotencyConflictError,
    ExternalAgentInvalidInputError,
    ExternalAgentNotFoundError,
    ExternalAsset,
    OperationResult,
    VerificationEvidence,
)

type AssetDomain = tuple[ExternalAssetRepository, sessionmaker[Session], RequestContext]


def uid() -> str:
    return str(uuid4())


@pytest.fixture
def domain() -> Iterator[AssetDomain]:
    engine = create_engine("sqlite://")
    TypeBase.metadata.create_all(
        engine,
        tables=[
            TypeBase.metadata.tables[model.__tablename__]
            for model in (
                TenantAccountJoin,
                Tenant,
                Agent,
                ExternalAgentConnectionRevision,
                ExternalAgentHead,
                ExternalAgentOperation,
                ExternalAgentVerification,
                ExternalAgentDataTombstone,
                ExternalAgentInvocation,
                ExternalAgentContextSlot,
                App,
                Workflow,
                WorkflowAgentNodeBinding,
            )
        ],
    )
    sessions = sessionmaker(engine, expire_on_commit=False)
    context = RequestContext("test", None, uid(), uid())
    with sessions.begin() as session:
        tenant = Tenant(name="Asset control test")
        tenant.id = context.active_workspace_id
        session.add(tenant)
        session.add(
            TenantAccountJoin(
                tenant_id=context.active_workspace_id, account_id=context.account_id, role=TenantAccountRole.OWNER
            )
        )
    yield ExternalAssetRepository(session_factory=sessions), sessions, context
    engine.dispose()


def evidence(
    context: RequestContext,
    *,
    agent_id: str | None = None,
    expected_connection_revision_id: str | None = None,
    fingerprint: str = "a" * 64,
    card: dict[str, object] | None = None,
    expires_at: datetime | None = None,
) -> VerificationEvidence:
    now = datetime.now(UTC)
    return VerificationEvidence(
        id=uid(),
        tenant_id=context.active_workspace_id,
        actor_id=context.account_id,
        agent_id=agent_id,
        endpoint="https://agent.example",
        interface_url="https://agent.example",
        auth_type="none",
        credential_ciphertext=None,
        auth_check="not_exercised",
        card=card if card is not None else {"name": "Example", "description": "Remote"},
        capabilities={},
        fingerprint=fingerprint,
        expected_connection_revision_id=expected_connection_revision_id,
        created_at=now,
        expires_at=expires_at if expires_at is not None else now + timedelta(minutes=10),
    )


def create(
    repo: ExternalAssetRepository, context: RequestContext, proof: VerificationEvidence | None = None
) -> tuple[ExternalAsset, VerificationEvidence, OperationResult]:
    proof = proof or evidence(context)
    repo.save_verification(proof)
    result = repo.create_asset(
        context=context, evidence_id=proof.id, metadata={}, operation_key="create", fingerprint="fp"
    )
    return repo.get_asset(tenant_id=context.active_workspace_id, agent_id=result.resource_id), proof, result


def test_references_are_current_graphs_under_the_complete_readable_app_scope(domain: AssetDomain) -> None:
    """Delete impact includes unused drafts, not old releases or hidden/foreign Apps."""
    repo, sessions, context = domain
    asset, _, _ = create(repo, context)
    visible, hidden, foreign, old_only = (uid() for _ in range(4))
    current = uid()
    other_tenant = uid()
    with sessions.begin() as session:
        for app_id, tenant, name, published in (
            (visible, context.active_workspace_id, "Visible", current),
            (hidden, context.active_workspace_id, "Hidden", None),
            (foreign, other_tenant, "Foreign", None),
            (old_only, context.active_workspace_id, "Historical only", None),
        ):
            session.add(
                App(
                    id=app_id,
                    tenant_id=tenant,
                    name=name,
                    mode=AppMode.WORKFLOW,
                    enable_site=False,
                    enable_api=False,
                    workflow_id=published,
                )
            )
        for workflow_id, app_id, tenant, version, node_id in (
            (uid(), visible, context.active_workspace_id, Workflow.VERSION_DRAFT, "draft"),
            (current, visible, context.active_workspace_id, "current", "current"),
            (uid(), visible, context.active_workspace_id, "obsolete", "obsolete"),
            (uid(), hidden, context.active_workspace_id, Workflow.VERSION_DRAFT, "hidden"),
            (uid(), foreign, other_tenant, Workflow.VERSION_DRAFT, "foreign"),
            (uid(), old_only, context.active_workspace_id, "old-release", "historical"),
        ):
            session.add(
                Workflow(
                    id=workflow_id,
                    tenant_id=tenant,
                    app_id=app_id,
                    type=WorkflowType.WORKFLOW,
                    version=version,
                    graph="{}",
                    _features="{}",
                    created_by=context.account_id,
                )
            )
            session.add(
                WorkflowAgentNodeBinding(
                    tenant_id=tenant,
                    app_id=app_id,
                    workflow_id=workflow_id,
                    workflow_version=version,
                    node_id=node_id,
                    agent_id=asset.id,
                    binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                    node_job_config=WorkflowNodeJobConfig(),
                )
            )
    result = repo.references(tenant_id=context.active_workspace_id, agent_id=asset.id, app_ids=frozenset({visible}))
    assert len(result.apps) == 1
    assert result.apps[0].app_id == visible
    assert result.apps[0].name == "Visible"
    assert result.apps[0].node_ids == ("current", "draft")
    assert result.may_have_in_flight is False
    all_visible = repo.references(tenant_id=context.active_workspace_id, agent_id=asset.id, app_ids=None)
    assert {row.app_id for row in all_visible.apps} == {visible, hidden}
    empty = repo.references(tenant_id=context.active_workspace_id, agent_id=asset.id, app_ids=frozenset())
    assert empty.apps == ()
    with pytest.raises(ExternalAgentNotFoundError):
        repo.references(tenant_id=other_tenant, agent_id=asset.id, app_ids=None)


@pytest.mark.parametrize(
    ("remote", "submission", "local", "expected"),
    [
        ("completed", "accepted", "succeeded", False),
        ("canceled", "accepted", "ended", False),
        ("working", "accepted", "ended", True),
        (None, "submission_unknown", "failed", True),
        (None, "send_started", "waiting", True),
    ],
)
def test_reference_warning_does_not_confuse_local_end_with_remote_termination(
    domain: AssetDomain, remote: str | None, submission: str, local: str, expected: bool
) -> None:
    """An aggregate warning may see hidden work without exposing its App identity."""
    repo, sessions, context = domain
    asset, _, _ = create(repo, context)
    with sessions.begin() as session:
        session.add(
            ExternalAgentInvocation(
                id=uid(),
                tenant_id=context.active_workspace_id,
                agent_id=asset.id,
                request_key=uid(),
                execution_key=uid(),
                origin="production",
                app_id=uid(),
                remote_task_id=uid() if remote else None,
                remote_state=remote,
                submission_state=submission,
                local_state=local,
            )
        )
    result = repo.references(tenant_id=context.active_workspace_id, agent_id=asset.id, app_ids=frozenset())
    assert result.apps == ()
    assert result.may_have_in_flight is expected


def test_reference_warning_keeps_unresolved_context_after_invocation_body_expiry(domain: AssetDomain) -> None:
    """No Invocation body does not prove that the reserved remote context stopped."""
    repo, sessions, context = domain
    asset, _, _ = create(repo, context)
    with sessions.begin() as session:
        session.add(
            ExternalAgentContextSlot(
                key="slot",
                tenant_id=context.active_workspace_id,
                app_id=uid(),
                conversation_id=uid(),
                node_id="external",
                agent_id=asset.id,
                connection_revision_id=asset.active_connection_revision_id,
                binding_epoch=uid(),
                unresolved=True,
                reserved_invocation_id=uid(),
            )
        )
    result = repo.references(tenant_id=context.active_workspace_id, agent_id=asset.id, app_ids=frozenset())
    assert result.apps == ()
    assert result.may_have_in_flight is True


def test_verification_change_warnings_are_not_saved_as_current_connection_capabilities(domain: AssetDomain) -> None:
    """A warning compares one proposed edit; it cannot become a permanent service capability."""
    repo, _, context = domain
    proof = replace(
        evidence(context),
        capabilities={
            "streaming": True,
            "connection_change_warnings": {"technical": ["streaming_removed"], "business": []},
        },
    )
    asset, _, _ = create(repo, context, proof)
    revision = repo.get_connection(
        tenant_id=context.active_workspace_id, agent_id=asset.id, revision_id=asset.active_connection_revision_id
    )
    assert revision.capabilities == {"streaming": True}


def test_creation_consumes_proof_and_idempotency_is_atomic(domain: AssetDomain) -> None:
    repo, sessions, context = domain
    asset, proof, receipt = create(repo, context)
    repeated = repo.create_asset(
        context=context, evidence_id=proof.id, metadata={}, operation_key="create", fingerprint="fp"
    )
    assert repeated == receipt
    with sessions() as session:
        consumed = session.get(ExternalAgentVerification, proof.id)
        assert consumed is not None
        assert consumed.consumed_at is not None
        assert len(tuple(session.scalars(select(ExternalAgentHead)))) == 1
    with pytest.raises(ExternalAgentIdempotencyConflictError):
        repo.create_asset(
            context=context, evidence_id=proof.id, metadata={}, operation_key="create", fingerprint="different"
        )
    with pytest.raises(ExternalAgentInvalidInputError):
        repo.create_asset(context=context, evidence_id=proof.id, metadata={}, operation_key="another", fingerprint="fp")
    assert asset.name == "Example"
    assert asset.role == ""


def test_proofs_are_actor_tenant_scoped_expiring_and_role_is_rechecked(domain: AssetDomain) -> None:
    repo, sessions, context = domain
    proof = evidence(context, expires_at=datetime.now(UTC) - timedelta(seconds=1))
    repo.save_verification(proof)
    with pytest.raises(ExternalAgentInvalidInputError):
        repo.create_asset(context=context, evidence_id=proof.id, metadata={}, operation_key="expired", fingerprint="fp")
    proof = evidence(context)
    repo.save_verification(proof)
    with pytest.raises(ExternalAgentInvalidInputError):
        repo.get_verification(tenant_id=uid(), actor_id=context.account_id, evidence_id=proof.id)
    with sessions.begin() as session:
        membership = session.scalar(select(TenantAccountJoin))
        assert membership is not None
        membership.role = TenantAccountRole.EDITOR
    with pytest.raises(ExternalAgentForbiddenError):
        repo.create_asset(context=context, evidence_id=proof.id, metadata={}, operation_key="revoked", fingerprint="fp")


def test_info_noop_does_not_reset_and_clearing_becomes_local_override(domain: AssetDomain) -> None:
    repo, _, context = domain
    asset, _, _ = create(repo, context)
    unchanged = repo.update_info(context=context, agent_id=asset.id, expected_revision=1, changes={"name": "Example"})
    assert unchanged.metadata_revision == 1
    assert unchanged.test_display_generation == 1
    assert unchanged.overrides == ()
    changed = repo.update_info(context=context, agent_id=asset.id, expected_revision=1, changes={"description": ""})
    assert changed.description == ""
    assert changed.metadata_revision == 2
    assert changed.test_display_generation == 2
    assert changed.overrides == ("description",)
    assert changed.active_connection_revision_id == asset.active_connection_revision_id
    with pytest.raises(ExternalAgentConflictError):
        repo.update_info(context=context, agent_id=asset.id, expected_revision=1, changes={"role": "stale"})


def test_connection_noop_and_real_change_preserve_immutable_revisions(domain: AssetDomain) -> None:
    repo, _, context = domain
    asset, _, _ = create(repo, context)
    proof = evidence(context, agent_id=asset.id, expected_connection_revision_id=asset.active_connection_revision_id)
    repo.save_verification(proof)
    noop = repo.update_connection(
        context=context,
        agent_id=asset.id,
        evidence_id=proof.id,
        expected_revision_id=asset.active_connection_revision_id,
        operation_key="noop",
        fingerprint="noop",
    )
    assert noop.result["changed"] is False
    assert noop.result["test_display_generation"] == 1
    new = replace(proof, id=uid(), fingerprint="b" * 64, endpoint="https://changed.example")
    repo.save_verification(new)
    saved = repo.update_connection(
        context=context,
        agent_id=asset.id,
        evidence_id=new.id,
        expected_revision_id=asset.active_connection_revision_id,
        operation_key="new",
        fingerprint="new",
    )
    assert saved.result["connection_revision_id"] != asset.active_connection_revision_id
    assert saved.result["test_display_generation"] == 2
    old = repo.get_connection(
        tenant_id=context.active_workspace_id, agent_id=asset.id, revision_id=asset.active_connection_revision_id
    )
    assert old.endpoint == "https://agent.example"


def test_availability_and_archive_preserve_test_generation_and_history(domain: AssetDomain) -> None:
    repo, _, context = domain
    asset, _, _ = create(repo, context)
    disabled = repo.set_enabled(context=context, agent_id=asset.id, enabled=False)
    assert not disabled.enabled
    assert disabled.test_display_generation == 1
    with pytest.raises(ExternalAgentNotFoundError):
        repo.get_asset(tenant_id=uid(), agent_id=asset.id)
    repo.archive(context=context, agent_id=asset.id)
    with pytest.raises(ExternalAgentNotFoundError):
        repo.get_asset(tenant_id=context.active_workspace_id, agent_id=asset.id)
    assert repo.get_connection(
        tenant_id=context.active_workspace_id, agent_id=asset.id, revision_id=asset.active_connection_revision_id
    ).id


def test_card_seed_refresh_fences_stale_info_and_preserves_local_override(domain: AssetDomain) -> None:
    repo, _, context = domain
    asset, _, _ = create(repo, context)
    proof = evidence(
        context,
        agent_id=asset.id,
        expected_connection_revision_id=asset.active_connection_revision_id,
        fingerprint="c" * 64,
        card={"name": "Example", "description": "Refreshed remote description"},
    )
    repo.save_verification(proof)
    saved = repo.update_connection(
        context=context,
        agent_id=asset.id,
        evidence_id=proof.id,
        expected_revision_id=asset.active_connection_revision_id,
        operation_key="refresh",
        fingerprint="refresh",
    )
    assert saved.result["metadata_revision"] == 2
    with pytest.raises(ExternalAgentConflictError):
        repo.update_info(context=context, agent_id=asset.id, expected_revision=1, changes={"description": "stale"})
    local = repo.update_info(context=context, agent_id=asset.id, expected_revision=2, changes={"description": ""})
    next_proof = replace(
        proof,
        id=uid(),
        expected_connection_revision_id=local.active_connection_revision_id,
        fingerprint="d" * 64,
        card={"name": "Example", "description": "Another remote description"},
    )
    repo.save_verification(next_proof)
    repo.update_connection(
        context=context,
        agent_id=asset.id,
        evidence_id=next_proof.id,
        expected_revision_id=local.active_connection_revision_id,
        operation_key="refresh2",
        fingerprint="refresh2",
    )
    current = repo.get_asset(tenant_id=context.active_workspace_id, agent_id=asset.id)
    assert current.description == ""
    assert current.metadata_revision == local.metadata_revision


def test_tenant_fence_rejects_slow_verification_completion_and_control_writes(domain: AssetDomain) -> None:
    repo, sessions, context = domain
    asset, _, _ = create(repo, context)
    pending = evidence(context)
    with sessions.begin() as session:
        session.add(
            ExternalAgentDataTombstone(
                id=uid(),
                tenant_id=context.active_workspace_id,
                owner_kind="tenant",
                owner_id=context.active_workspace_id,
                deleted_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
    with pytest.raises(ExternalAgentForbiddenError):
        repo.save_verification(pending)
    with pytest.raises(ExternalAgentForbiddenError):
        repo.update_info(context=context, agent_id=asset.id, expected_revision=1, changes={"description": "late"})
    with sessions() as session:
        assert session.get(ExternalAgentVerification, pending.id) is None
