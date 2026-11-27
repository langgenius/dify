"""Real SQLite proofs for owner-scoped, complete logical execution usage."""

import hashlib
import json
from dataclasses import replace
from datetime import timedelta

import pytest
from pydantic import TypeAdapter
from sqlalchemy import delete, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from models.external_agent import ExternalAgentInvocation
from models.external_agent_trace import ExternalAgentDataTombstone, ExternalAgentTraceUsageSummary
from repositories.external_agents.observability_repository import ExternalObservabilityRepository
from services.external_agents.contracts import ExternalOrigin
from services.external_agents.execution_usage import ExternalExecutionUsageQuery
from services.external_agents.io_contracts import ExternalActorRole
from services.external_agents.runtime_contracts import (
    ExecutionIdentity,
    Invocation,
    LocalState,
    RuntimeScope,
    SubmissionState,
    WaitPolicy,
)
from services.external_agents.traceability import ReportedCallUsage, TraceLimits
from tests.unit_tests.repositories.external_agents.test_observability_repository import (
    ACTOR,
    AGENT,
    APP,
    APP2,
    DBNOW,
    EDITOR,
    NOW,
    OTHER,
    REVISION,
    TENANT,
    model_table,
    sessions,
    uid,
)

__all__ = ["sessions"]


@pytest.fixture
def repository(sessions: sessionmaker[Session]) -> ExternalObservabilityRepository:
    return ExternalObservabilityRepository(sessions=sessions, limits=TraceLimits())


@pytest.fixture
def first() -> Invocation:
    return Invocation(
        id=uid(),
        scope=RuntimeScope(
            tenant_id=TENANT,
            app_id=APP,
            initiator_id=ACTOR,
            origin=ExternalOrigin.NODE_DEBUG,
        ),
        agent_id=AGENT,
        identity=ExecutionIdentity(
            execution_id=uid(),
            node_id="external-node",
            frame_id="root",
            binding_epoch="frozen-binding",
            workflow_revision="frozen-revision",
        ),
        message_id=uid(),
        parts=({"text": "Frozen task"},),
        policy=WaitPolicy(additional_retries=2),
        declared_outputs=(),
        started_at=NOW,
        logical_deadline=NOW + timedelta(hours=1),
        caller_execution_id=uid(),
        connection_revision_id=REVISION,
        dispatched_at=NOW,
        local_wait_ended_at=NOW + timedelta(seconds=2),
        submission_state=SubmissionState.ACCEPTED,
        local_state=LocalState.SUCCEEDED,
    )


def persist(
    sessions: sessionmaker[Session],
    repository: ExternalObservabilityRepository,
    value: Invocation,
    tokens: int | None,
) -> None:
    """Persist real owner facts and optionally record a proven call-total summary."""
    identity = value.identity
    execution_key = hashlib.sha256(
        json.dumps((identity.execution_id, identity.frame_id), separators=(",", ":")).encode()
    ).hexdigest()
    with sessions.begin() as session:
        session.add(
            ExternalAgentInvocation(
                id=value.id,
                tenant_id=value.scope.tenant_id,
                agent_id=value.agent_id,
                request_key=value.id,
                execution_key=execution_key,
                origin=value.scope.origin,
                initiator_id=value.scope.initiator_id,
                app_id=value.scope.app_id,
                workflow_run_id=identity.workflow_run_id,
                node_execution_id=value.caller_execution_id,
                node_id=identity.node_id,
                frame_id=identity.frame_id,
                binding_epoch=identity.binding_epoch,
                connection_revision_id=value.connection_revision_id,
                sequence=value.sequence,
                retry_of=value.retry_of,
                test_generation=value.test_generation,
                runtime_snapshot=TypeAdapter(Invocation).dump_python(value, mode="json"),
                dispatched_at=value.dispatched_at.replace(tzinfo=None) if value.dispatched_at is not None else None,
                local_state=value.local_state,
                tracing_enabled=False,
            )
        )
    if tokens is not None:
        report(repository, value, tokens)


def report(repository: ExternalObservabilityRepository, value: Invocation, tokens: int) -> None:
    """Use the production usage writer, including its ownership and replay fences."""
    repository.record_usage(
        owner=repository.owner(tenant_id=value.scope.tenant_id, invocation_id=value.id, now=NOW),
        usage=ReportedCallUsage(tokens, "metadata.usage.totalTokens", "dify.metadata-usage-total-tokens.v1"),
        revision=1,
        now=NOW,
    )


@pytest.mark.parametrize("tokens", [None, 0, 17])
def test_single_attempt_preserves_reported_zero_and_unknown(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation, tokens: int | None
) -> None:
    persist(sessions, repository, first, tokens)
    query: ExternalExecutionUsageQuery = repository
    assert query.total_tokens(first.scope, first.id, now=NOW) == tokens


@pytest.mark.parametrize(
    "origin", [ExternalOrigin.PRODUCTION, ExternalOrigin.WORKFLOW_DEBUG, ExternalOrigin.NODE_DEBUG]
)
@pytest.mark.parametrize(("first_tokens", "second_tokens"), [(0, 21), (9, 12)])
def test_retry_total_is_complete_pinned_and_replay_safe_across_connection_revisions(
    sessions: sessionmaker[Session],
    repository: ExternalObservabilityRepository,
    first: Invocation,
    origin: ExternalOrigin,
    first_tokens: int,
    second_tokens: int,
) -> None:
    first = replace(first, scope=replace(first.scope, origin=origin))
    second = replace(first, id=uid(), sequence=1, retry_of=first.id, connection_revision_id=uid())
    later = replace(second, id=uid(), sequence=2, retry_of=second.id)
    unrelated = replace(first, id=uid(), identity=replace(first.identity, execution_id=uid()))
    persist(sessions, repository, first, first_tokens)
    persist(sessions, repository, second, second_tokens)
    persist(sessions, repository, later, 100)
    persist(sessions, repository, unrelated, 1000)
    report(repository, first, first_tokens)
    report(repository, second, second_tokens)
    assert repository.total_tokens(first.scope, first.id, now=NOW) == first_tokens
    assert repository.total_tokens(second.scope, second.id, now=NOW) == 21
    assert repository.total_tokens(second.scope, second.id, now=NOW) == 21


def test_unknown_dispatched_attempt_cannot_be_replaced_by_a_partial_sum(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation
) -> None:
    second = replace(first, id=uid(), sequence=1, retry_of=first.id)
    persist(sessions, repository, first, None)
    persist(sessions, repository, second, 21)
    assert repository.total_tokens(second.scope, second.id, now=NOW) is None


def test_unsubmitted_retry_does_not_need_usage_but_zero_dispatches_remain_unknown(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation
) -> None:
    prepared = replace(first, dispatched_at=None, local_state=LocalState.FAILED)
    persist(sessions, repository, prepared, None)
    assert repository.total_tokens(prepared.scope, prepared.id, now=NOW) is None
    reportable = replace(first, id=uid(), identity=replace(first.identity, execution_id=uid()))
    persist(sessions, repository, reportable, 9)
    unsubmitted = replace(reportable, id=uid(), sequence=1, retry_of=reportable.id, dispatched_at=None)
    persist(sessions, repository, unsubmitted, None)
    assert repository.total_tokens(unsubmitted.scope, unsubmitted.id, now=NOW) == 9


@pytest.mark.parametrize("state", [LocalState.SUCCEEDED, LocalState.FAILED, LocalState.ENDED, LocalState.STOPPED])
def test_terminal_failures_keep_their_proven_usage(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation, state: LocalState
) -> None:
    value = replace(first, local_state=state)
    persist(sessions, repository, value, 5)
    assert repository.total_tokens(value.scope, value.id, now=NOW) == 5


@pytest.mark.parametrize("missing_sequence", [0, 1])
def test_missing_earlier_attempt_never_becomes_a_complete_total(
    sessions: sessionmaker[Session],
    repository: ExternalObservabilityRepository,
    first: Invocation,
    missing_sequence: int,
) -> None:
    second = replace(first, id=uid(), sequence=1, retry_of=first.id)
    selected = replace(second, id=uid(), sequence=2, retry_of=second.id)
    for value in (first, second, selected):
        persist(sessions, repository, value, 7)
    with sessions.begin() as session:
        session.execute(delete(ExternalAgentInvocation).where(ExternalAgentInvocation.sequence == missing_sequence))
    assert repository.total_tokens(selected.scope, selected.id, now=NOW) is None


def test_broken_retry_link_cannot_mix_attempts_from_the_same_execution(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation
) -> None:
    second = replace(first, id=uid(), sequence=1, retry_of=uid())
    persist(sessions, repository, first, 2)
    persist(sessions, repository, second, 1)
    assert repository.total_tokens(second.scope, second.id, now=NOW) is None


@pytest.mark.parametrize("column", ["deleted_at", "retention_expires_at", "test_expires_at"])
def test_revoked_or_expired_ancestor_invalidates_the_whole_prefix(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation, column: str
) -> None:
    second = replace(first, id=uid(), sequence=1, retry_of=first.id)
    persist(sessions, repository, first, 2)
    persist(sessions, repository, second, 1)
    with sessions.begin() as session:
        session.execute(
            update(ExternalAgentInvocation).where(ExternalAgentInvocation.id == first.id).values({column: DBNOW})
        )
    assert repository.total_tokens(second.scope, second.id, now=NOW) is None


def test_tombstoned_ancestor_cannot_be_silently_omitted(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation
) -> None:
    second = replace(first, id=uid(), sequence=1, retry_of=first.id)
    persist(sessions, repository, first, 2)
    persist(sessions, repository, second, 1)
    with sessions.begin() as session:
        session.add(
            ExternalAgentDataTombstone(
                id=uid(), tenant_id=TENANT, owner_kind="invocation", owner_id=first.id, deleted_at=DBNOW
            )
        )
    assert repository.total_tokens(second.scope, second.id, now=NOW) is None


@pytest.mark.parametrize("scope_index", range(5), ids=["tenant", "app", "initiator", "origin", "actor-role"])
def test_forged_caller_scope_never_reads_usage(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation, scope_index: int
) -> None:
    persist(sessions, repository, first, 9)
    scopes = (
        replace(first.scope, tenant_id=OTHER),
        replace(first.scope, app_id=APP2),
        replace(first.scope, initiator_id=EDITOR),
        replace(first.scope, origin=ExternalOrigin.PRODUCTION),
        replace(first.scope, actor_role=ExternalActorRole.END_USER),
    )
    assert repository.total_tokens(scopes[scope_index], first.id, now=NOW) is None


@pytest.mark.parametrize(
    "column",
    [
        "agent_id",
        "app_id",
        "initiator_id",
        "origin",
        "workflow_run_id",
        "node_execution_id",
        "node_id",
        "frame_id",
        "binding_epoch",
        "execution_key",
    ],
)
def test_forged_indexed_owner_or_identity_never_contributes_usage(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation, column: str
) -> None:
    second = replace(first, id=uid(), sequence=1, retry_of=first.id)
    persist(sessions, repository, first, 2)
    persist(sessions, repository, second, 1)
    replacement = APP2 if column == "app_id" else "production" if column == "origin" else uid()
    with sessions.begin() as session:
        session.execute(
            update(ExternalAgentInvocation).where(ExternalAgentInvocation.id == first.id).values({column: replacement})
        )
    assert repository.total_tokens(second.scope, second.id, now=NOW) is None


@pytest.mark.parametrize("change_revision", [True, False], ids=["workflow-revision", "actor-role"])
def test_snapshot_only_identity_cannot_change_between_attempts(
    sessions: sessionmaker[Session],
    repository: ExternalObservabilityRepository,
    first: Invocation,
    change_revision: bool,
) -> None:
    second = replace(first, id=uid(), sequence=1, retry_of=first.id)
    persist(sessions, repository, first, 2)
    persist(sessions, repository, second, 1)
    forged = (
        replace(first, identity=replace(first.identity, workflow_revision="other-revision"))
        if change_revision
        else replace(first, scope=replace(first.scope, actor_role=ExternalActorRole.END_USER))
    )
    with sessions.begin() as session:
        session.execute(
            update(ExternalAgentInvocation)
            .where(ExternalAgentInvocation.id == first.id)
            .values(runtime_snapshot=TypeAdapter(Invocation).dump_python(forged, mode="json"))
        )
    assert repository.total_tokens(second.scope, second.id, now=NOW) is None


def test_usage_summary_must_belong_to_the_same_tenant(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation
) -> None:
    persist(sessions, repository, first, 9)
    with sessions.begin() as session:
        session.execute(
            update(ExternalAgentTraceUsageSummary)
            .where(ExternalAgentTraceUsageSummary.invocation_id == first.id)
            .values(tenant_id=OTHER)
        )
    assert repository.total_tokens(first.scope, first.id, now=NOW) is None


def test_legacy_snapshot_without_optional_caller_id_preserves_indexed_owner(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation
) -> None:
    persist(sessions, repository, first, 9)
    with sessions.begin() as session:
        row = session.scalar(select(ExternalAgentInvocation).where(ExternalAgentInvocation.id == first.id))
        assert row is not None
        snapshot = dict(row.runtime_snapshot)
        snapshot.pop("caller_execution_id")
        row.runtime_snapshot = snapshot
    assert repository.total_tokens(first.scope, first.id, now=NOW) == 9


def test_missing_legacy_identity_is_unknown_instead_of_zero(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation
) -> None:
    persist(sessions, repository, first, 9)
    with sessions.begin() as session:
        session.execute(
            update(ExternalAgentInvocation).where(ExternalAgentInvocation.id == first.id).values(runtime_snapshot={})
        )
    assert repository.total_tokens(first.scope, first.id, now=NOW) is None


def test_storage_read_failure_is_never_converted_to_zero(
    sessions: sessionmaker[Session], repository: ExternalObservabilityRepository, first: Invocation
) -> None:
    persist(sessions, repository, first, 9)
    with sessions.begin() as session:
        model_table(ExternalAgentTraceUsageSummary).drop(session.connection())
    with pytest.raises(OperationalError):
        repository.total_tokens(first.scope, first.id, now=NOW)
