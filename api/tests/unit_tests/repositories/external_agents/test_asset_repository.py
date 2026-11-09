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
from models.agent import Agent
from models.base import TypeBase
from models.external_agent import (
    ExternalAgentConnectionRevision,
    ExternalAgentHead,
    ExternalAgentOperation,
    ExternalAgentVerification,
)
from models.external_agent_trace import ExternalAgentDataTombstone
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
