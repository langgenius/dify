"""Real SQL transactions for dispatch fencing, recovery and durable command admission."""

from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Unpack, override
from uuid import uuid4

import pytest
from sqlalchemy import Engine, create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from typing_extensions import TypedDict

from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.graph import Graph
from graphon.runtime import RuntimeState
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.agent import Agent, AgentKind, AgentScope, AgentSource, WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.base import TypeBase
from models.enums import ConversationFromSource, CreatorUserRole, WorkflowRunTriggeredFrom
from models.external_agent import (
    ExternalAgentCommand,
    ExternalAgentConnectionRevision,
    ExternalAgentContextSlot,
    ExternalAgentFileLease,
    ExternalAgentHead,
    ExternalAgentInvocation,
    ExternalWorkflowBudget,
)
from models.external_agent_trace import ExternalAgentDataTombstone
from models.model import App, AppMode, Conversation, EndUser
from models.workflow import (
    Workflow,
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowPause,
    WorkflowRun,
    WorkflowType,
)
from repositories.external_agents.runtime_repository import ExternalRuntimeRepository
from services.external_agents.invocation_agg import ExternalInvocationAgg
from services.external_agents.invocation_service import ExternalInvocationService
from services.external_agents.io_contracts import FileScope, JsonObject, OutputField
from services.external_agents.output_mapping import map_output
from services.external_agents.protocol import (
    ConnectionSpec,
    GatewayError,
    GatewayPort,
    GatewayReceipt,
    SendRequest,
    VerificationResult,
)
from services.external_agents.runtime_contracts import (
    CommandDraft,
    CommandKind,
    ContextBusyError,
    ContextKey,
    ExecutionIdentity,
    Invocation,
    InvocationDraft,
    LocalState,
    RuntimeError,
    RuntimeScope,
    RuntimeSettings,
    SubmissionState,
    TimeoutPolicy,
    WaitPolicy,
)
from services.external_agents.workflow_runtime import ExternalNodeJob

type Domain = tuple[ExternalRuntimeRepository, sessionmaker[Session], RuntimeScope, str, str]
type WorkflowDomain = tuple[Domain, ExecutionIdentity, str, ExternalNodeJob]


def present[T](value: T | None) -> T:
    assert value is not None
    return value


def stored[T](session: Session, model: type[T], key: object) -> T:
    value = session.get(model, key)
    assert value is not None
    return value


def required_id(value: str | None) -> str:
    assert value is not None
    return value


def bound_engine(sessions: sessionmaker[Session]) -> Engine:
    engine = sessions.kw["bind"]
    assert isinstance(engine, Engine)
    return engine


class DraftChanges(TypedDict, total=False, closed=True):
    identity: ExecutionIdentity
    parts: tuple[JsonObject, ...]
    policy: WaitPolicy
    declared_outputs: tuple[OutputField, ...]
    logical_deadline: datetime | None
    job: JsonObject


NOW = datetime(2026, 11, 9, tzinfo=UTC)


def uid() -> str:
    return str(uuid4())


@pytest.fixture
def domain() -> Iterator[Domain]:
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    models = (
        Account,
        App,
        EndUser,
        Tenant,
        TenantAccountJoin,
        Agent,
        ExternalAgentHead,
        ExternalAgentConnectionRevision,
        ExternalAgentCommand,
        ExternalAgentContextSlot,
        ExternalAgentFileLease,
        ExternalAgentInvocation,
        ExternalWorkflowBudget,
        ExternalAgentDataTombstone,
    )
    TypeBase.metadata.create_all(engine, tables=[TypeBase.metadata.tables[model.__tablename__] for model in models])
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions.begin() as session:
        tenant, account = Tenant(name="workspace"), Account(name="owner", email="runtime@example.com")
        session.add_all((tenant, account))
        session.flush()
        scope = RuntimeScope(tenant_id=tenant.id, initiator_id=account.id, app_id=None, origin="overview_test")
        session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER))
        agent = Agent(
            tenant_id=tenant.id,
            name="External",
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
            agent_kind=AgentKind.EXTERNAL_A2A,
        )
        session.add(agent)
        session.flush()
        revision = ExternalAgentConnectionRevision(
            id=uid(),
            tenant_id=tenant.id,
            agent_id=agent.id,
            endpoint="https://example.com/a2a",
            interface_url="https://example.com/a2a",
            auth_type="none",
            credential_ciphertext=None,
            agent_card={"defaultInputModes": ["text/plain"]},
            capabilities={},
            fingerprint="a" * 64,
            auth_check="not_exercised",
            created_by=account.id,
            verified_at=NOW.replace(tzinfo=None),
        )
        session.add(revision)
        session.add(
            ExternalAgentHead(agent_id=agent.id, tenant_id=tenant.id, active_connection_revision_id=revision.id)
        )
    yield ExternalRuntimeRepository(sessions, RuntimeSettings()), sessions, scope, agent.id, revision.id
    engine.dispose()


def draft(agent_id: str, **changes: Unpack[DraftChanges]) -> InvocationDraft:
    return replace(
        InvocationDraft(
            invocation_id=uid(),
            agent_id=agent_id,
            message_id=uid(),
            identity=ExecutionIdentity(execution_id=uid(), node_id="test", frame_id="root"),
            parts=({"text": "task"},),
            test_generation=1,
            job={"page_session_id": "page", "input_lease_ids": []},
        ),
        **changes,
    )


def test_intent_idempotency_and_snapshot_does_not_contain_wire_bytes(domain: Domain) -> None:
    repo, sessions, scope, agent, _ = domain
    request = draft(agent)
    first = repo.create(scope, request, now=NOW)
    second = repo.create(scope, replace(request, invocation_id=uid(), message_id=uid()), now=NOW)
    assert first == second
    assert first.connection_revision_id is not None  # Overview freezes saved config at explicit Run.
    with sessions() as session:
        assert len(session.scalars(select(ExternalAgentInvocation)).all()) == 1
        assert len(session.scalars(select(ExternalAgentCommand)).all()) == 2
    with pytest.raises(RuntimeError, match="Only text"):
        repo.create(scope, draft(agent, parts=({"raw": "secret"},)), now=NOW)
    with pytest.raises(RuntimeError):
        repo.get(replace(scope, tenant_id=uid()), first.id)


def test_permit_freezes_latest_revision_once_and_queue_does_not_start_node_wait(domain: Domain) -> None:
    repo, sessions, scope, agent, revision = domain
    value = repo.create(scope, draft(agent), now=NOW)
    admitted = present(repo.acquire_dispatch(scope, value.id, now=NOW + timedelta(minutes=3)))
    assert admitted.connection_revision_id == revision
    assert admitted.started_at == NOW + timedelta(minutes=3)
    assert admitted.wait_deadline == NOW + timedelta(minutes=13)
    assert admitted.dispatched_at is None
    sent = present(repo.begin_send(scope, admitted, now=NOW + timedelta(minutes=3, seconds=2)))
    assert sent.dispatched_at == NOW + timedelta(minutes=3, seconds=2)
    assert sent.started_at == sent.dispatched_at
    assert repo.begin_send(scope, admitted, now=NOW + timedelta(minutes=3, seconds=3)) is None
    with sessions.begin() as session:
        stored(session, ExternalAgentHead, agent).active_connection_revision_id = uid()
    assert repo.acquire_dispatch(scope, value.id, now=NOW + timedelta(minutes=4)) is None
    assert repo.get(scope, value.id).connection_revision_id == revision


def test_queued_overview_keeps_original_saved_configuration_after_edit(domain: Domain) -> None:
    repo, sessions, scope, agent, revision = domain
    value = repo.create(scope, draft(agent), now=NOW)
    with sessions.begin() as session:
        head = stored(session, ExternalAgentHead, agent)
        head.active_connection_revision_id = uid()
        head.test_display_generation += 1
        head.tracing_enabled = True
    admitted = present(repo.acquire_dispatch(scope, value.id, now=NOW + timedelta(seconds=10)))
    assert admitted.connection_revision_id == revision
    assert not admitted.tracing_enabled
    with pytest.raises(RuntimeError, match="configuration"):
        repo.create(scope, draft(agent), now=NOW + timedelta(seconds=11))


def test_local_display_snapshot_is_frozen_and_never_contains_connection_or_card(domain: Domain) -> None:
    repo, sessions, scope, agent, _ = domain
    value = repo.create(scope, draft(agent), now=NOW)
    with sessions.begin() as session:
        stored(session, Agent, agent).name = "Edited after explicit Test Run"
        stored(session, Agent, agent).role = "Changed local role"
        stored(session, ExternalAgentHead, agent).metadata_revision += 1
    admitted = present(repo.acquire_dispatch(scope, value.id, now=NOW + timedelta(seconds=1)))
    sent = present(repo.begin_send(scope, admitted, now=NOW + timedelta(seconds=2)))
    with sessions.begin() as session:
        stored(session, Agent, agent).name = "Edited again after actual dispatch boundary"
    assert repo.get(scope, value.id).asset_snapshot == sent.asset_snapshot
    assert admitted.asset_snapshot["name"] == "External"
    assert admitted.asset_snapshot["metadata_revision"] == 1
    assert set(admitted.asset_snapshot) == {
        "id",
        "name",
        "description",
        "role",
        "icon_type",
        "icon",
        "icon_background",
        "metadata_revision",
    }
    with sessions() as session:
        assert stored(session, ExternalAgentInvocation, value.id).asset_snapshot == admitted.asset_snapshot


@pytest.mark.parametrize("entered_post", [False, True])
def test_orphan_send_phase_is_rejected_before_post_and_unknown_after_boundary(
    domain: Domain, entered_post: bool
) -> None:
    repo, sessions, scope, agent, _ = domain
    value = repo.create(scope, draft(agent), now=NOW)
    command_id = next(identifier for owner, identifier in repo.due_commands(now=NOW) if owner == scope)
    lease = present(repo.lease_command(scope, command_id, now=NOW, lease_seconds=120))
    permit = present(repo.acquire_dispatch(scope, value.id, now=NOW))
    if entered_post:
        present(repo.begin_send(scope, permit, now=NOW))
    assert repo.reconcile(scope, now=NOW + timedelta(seconds=119)) == 0
    assert repo.recovery_scopes(now=NOW + timedelta(seconds=121)) == (scope,)
    assert repo.reconcile(scope, now=NOW + timedelta(seconds=121)) == 1
    recovered = repo.get(scope, value.id)
    assert recovered.submission_state == (SubmissionState.UNKNOWN if entered_post else SubmissionState.REJECTED)
    assert recovered.error_code == ("submission_unknown" if entered_post else "preparation_interrupted")
    assert recovered.local_state == LocalState.FAILED
    assert repo.acquire_dispatch(scope, value.id, now=NOW + timedelta(seconds=122)) is None
    assert repo.reconcile(scope, now=NOW + timedelta(seconds=122)) == 0
    repo.complete_command(lease)
    with sessions() as session:
        assert len(session.scalars(select(ExternalAgentInvocation)).all()) == 1


def test_save_cas_rejects_stale_updates_and_output_resurrection(domain: Domain) -> None:
    repo, _, scope, agent, _ = domain
    queued = repo.create(scope, draft(agent), now=NOW)
    value = present(repo.acquire_dispatch(scope, queued.id, now=NOW))
    changed = ExternalInvocationAgg(value, RuntimeSettings()).submission_failed(
        NOW, code="unknown", message="safe", unknown=True
    )
    assert repo.save(scope, value, changed.invocation, commands=changed.commands)
    assert not repo.save(scope, value, changed.invocation, commands=changed.commands)
    with pytest.raises(RuntimeError):
        repo.save(
            scope,
            changed.invocation,
            replace(
                changed.invocation,
                version=changed.invocation.version + 1,
                local_state=LocalState.SUCCEEDED,
                outputs={"text": "late"},
            ),
        )


def test_full_context_slot_is_busy_until_authoritative_terminal_and_keeps_context(domain: Domain) -> None:
    repo, sessions, scope, agent, revision = domain
    key = ContextKey(
        tenant_id=scope.tenant_id,
        app_id=uid(),
        conversation_id=uid(),
        node_id="logical-node",
        agent_id=agent,
        connection_revision_id=revision,
        binding_epoch=uid(),
    )
    # The SQL internal reservation primitive runs inside the dispatch owner transaction.
    with sessions.begin() as session:
        slot = repo._reserve(session, key, "first")
        repo._settle_slot(slot, "remote-context", terminal=False, unresolved=True)
        assert repo._reserve(session, key, "first").server_context_id == "remote-context"
        with pytest.raises(ContextBusyError):
            repo._reserve(session, key, "second")
        repo._settle_slot(slot, "remote-context", terminal=True, unresolved=False)
        assert repo._reserve(session, key, "second").server_context_id == "remote-context"
        assert repo._reserve(session, replace(key, binding_epoch=uid()), "other").server_context_id is None
        assert (
            repo._reserve(session, replace(key, frame_scope="iteration-unique"), "parallel").server_context_id is None
        )


def test_query_lease_fences_one_invocation_and_expired_completion_cannot_finish_new_lease(domain: Domain) -> None:
    repo, sessions, scope, agent, _ = domain
    value = present(repo.acquire_dispatch(scope, repo.create(scope, draft(agent), now=NOW).id, now=NOW))
    observed = replace(
        value,
        version=value.version + 1,
        submission_state=SubmissionState.ACCEPTED,
        remote_task_id="remote",
        remote_state="working",
    )
    commands = tuple(
        CommandDraft(kind=kind, not_before=NOW, dedupe_key=f"query-{kind.value}")
        for kind in (CommandKind.POLL, CommandKind.CANCEL)
    )
    assert repo.save(scope, value, observed, commands=commands)
    with sessions() as session:
        ids = session.scalars(
            select(ExternalAgentCommand.id)
            .where(ExternalAgentCommand.kind.in_(("poll", "cancel")))
            .order_by(ExternalAgentCommand.kind.desc())
        ).all()
    first = present(repo.lease_command(scope, ids[0], now=NOW, lease_seconds=120))
    assert first is not None
    assert repo.lease_command(scope, ids[1], now=NOW, lease_seconds=120) is None
    newer = present(repo.lease_command(scope, ids[0], now=NOW + timedelta(seconds=121), lease_seconds=120))
    assert newer.fence != first.fence
    repo.complete_command(first)
    with sessions() as session:
        assert stored(session, ExternalAgentCommand, ids[0]).state == "leased"
    repo.complete_command(newer)
    with sessions() as session:
        assert stored(session, ExternalAgentCommand, ids[0]).state == "done"


def test_broker_publication_claim_deduplicates_until_its_separate_lease_expires(domain: Domain) -> None:
    repo, _, scope, agent, _ = domain
    value = repo.create(scope, draft(agent), now=NOW)
    first = repo.claim_publishable_commands(now=NOW)
    assert len(first) == 1
    assert first[0][0] == scope
    assert not repo.claim_publishable_commands(now=NOW + timedelta(seconds=119))
    assert repo.due_commands(now=NOW) == first  # Read-only due view has no publication mutation.
    assert repo.claim_publishable_commands(now=NOW + timedelta(seconds=120)) == first
    lease = present(repo.lease_command(scope, first[0][1], now=NOW + timedelta(seconds=121), lease_seconds=120))
    assert lease.invocation_id == value.id
    assert not repo.claim_publishable_commands(now=NOW + timedelta(seconds=240))


class Clock:
    value = NOW

    def now(self) -> datetime:
        return self.value


class Ids:
    def new_id(self) -> str:
        return uid()


class RemoteAgent:
    """A deterministic stateful port, exercising the real orchestration and SQL adapters."""

    def __init__(self, *, direct: bool = False, unknown: bool = False) -> None:
        self.direct, self.unknown = direct, unknown
        self.sent = []
        self.reads = 0
        self.cancels = 0
        self.state = "working"

    def verify(self, connection: ConnectionSpec, *, timeout_seconds: float = 30) -> VerificationResult:
        assert timeout_seconds > 0
        return VerificationResult(
            card={"defaultInputModes": ["text/plain"]},
            interface_url=connection.endpoint,
            remote_tenant=None,
            auth_check="not_exercised",
            card_fingerprint="a" * 64,
            streaming=False,
            required_extensions=(),
        )

    def receipt(self) -> GatewayReceipt:
        if self.direct:
            return GatewayReceipt(kind="message", context_id="context", payload={"parts": [{"text": "result"}]})
        return GatewayReceipt(
            kind="task",
            task_id="task",
            context_id="context",
            state="TASK_STATE_" + self.state.upper(),
            payload={
                "id": "task",
                "contextId": "context",
                "status": {"state": "TASK_STATE_" + self.state.upper()},
                "artifacts": [{"artifactId": "final", "parts": [{"text": "result"}]}],
            },
        )

    def send(
        self, connection: ConnectionSpec, request: SendRequest, *, streaming: bool = False, timeout_seconds: float = 30
    ) -> GatewayReceipt:
        assert timeout_seconds > 0
        self.streaming = streaming
        self.last_connection = connection
        self.sent.append(request)
        if self.unknown:
            raise GatewayError("submission_unknown", "Unknown acceptance", submission_unknown=True)
        return self.receipt()

    def get_task(self, connection: ConnectionSpec, task_id: str, *, timeout_seconds: float = 30) -> GatewayReceipt:
        assert task_id
        assert timeout_seconds > 0
        self.last_connection = connection
        self.reads += 1
        return self.receipt()

    def cancel_task(self, connection: ConnectionSpec, task_id: str, *, timeout_seconds: float = 30) -> GatewayReceipt:
        assert task_id
        assert timeout_seconds > 0
        self.last_connection = connection
        self.cancels += 1
        return self.receipt()


class Inputs:
    def build(self, invocation: Invocation) -> SendRequest:
        return SendRequest(
            message_id=invocation.message_id, parts=invocation.parts, context_id=invocation.carried_context_id
        )


class Outputs:
    def normalize(self, invocation: Invocation, receipt: GatewayReceipt) -> JsonObject:
        scope = FileScope(
            tenant_id=invocation.scope.tenant_id,
            app_id=invocation.scope.app_id,
            actor_id=invocation.scope.initiator_id,
            invocation_id=invocation.id,
            actor_role=invocation.scope.actor_role,
        )
        return map_output(receipt, invocation.declared_outputs, scope=scope, materializer=None).values


class Observer:
    def __init__(self) -> None:
        self.states = []
        self.invocations = []

    def observe(self, invocation: Invocation, receipt: GatewayReceipt) -> None:
        self.invocations.append(invocation.id)
        self.states.append(receipt.state)


class Wake:
    ready = False

    def wake(self, scope: RuntimeScope, invocation: Invocation) -> bool:
        assert invocation.scope == scope
        return self.ready


def service(domain: Domain, gateway: GatewayPort) -> tuple[ExternalInvocationService, Clock, Wake, Observer]:
    repo, sessions, scope, agent, _ = domain
    clock, wake, observer = Clock(), Wake(), Observer()
    runtime = ExternalInvocationService(
        store=repo,
        connections=repo,
        gateway=gateway,
        inputs=Inputs(),
        outputs=Outputs(),
        observer=observer,
        wake=wake,
        clock=clock,
        ids=Ids(),
        settings=RuntimeSettings(),
    )
    return runtime, clock, wake, observer


def command(domain: Domain, runtime: ExternalInvocationService, clock: Clock, kind: str) -> str:
    repo, sessions, scope, *_ = domain
    with sessions() as session:
        identifier = session.scalars(
            select(ExternalAgentCommand.id)
            .where(
                ExternalAgentCommand.kind == kind,
                ExternalAgentCommand.state == "ready",
                ExternalAgentCommand.next_run_at <= clock.value.replace(tzinfo=None),
            )
            .order_by(ExternalAgentCommand.next_run_at)
        ).first()
    assert identifier is not None, kind
    runtime.run_command(scope, identifier)
    return identifier


def test_real_runtime_send_once_result_reads_do_not_consume_and_early_wake_retries(domain: Domain) -> None:
    repo, _, scope, agent, _ = domain
    gateway = RemoteAgent(direct=True)
    runtime, clock, wake, _ = service(domain, gateway)
    value = runtime.start(scope, draft(agent, declared_outputs=(OutputField(name="text", kind="string"),)))
    sent_command = command(domain, runtime, clock, "dispatch")
    runtime.run_command(scope, sent_command)
    assert len(gateway.sent) == 1
    assert runtime.result(scope, value.id).outputs == {"text": "result"}
    assert runtime.result(scope, value.id) == runtime.result(scope, value.id)
    command(domain, runtime, clock, "wake")  # arrived before checkpoint; retained as another durable command
    clock.value += timedelta(seconds=5)
    wake.ready = True
    command(domain, runtime, clock, "wake")
    assert repo.get(scope, value.id).local_state == LocalState.SUCCEEDED


def test_unknown_send_does_not_retry_and_output_failure_does_not_replay(domain: Domain) -> None:
    repo, _, scope, agent, _ = domain
    gateway = RemoteAgent(unknown=True)
    runtime, clock, *_ = service(domain, gateway)
    value = runtime.start(scope, draft(agent))
    identifier = command(domain, runtime, clock, "dispatch")
    runtime.run_command(scope, identifier)
    assert len(gateway.sent) == 1
    assert repo.get(scope, value.id).submission_state == SubmissionState.UNKNOWN
    assert repo.get(scope, value.id).dispatched_at is not None
    gateway.unknown, gateway.direct = False, True
    bad = runtime.start(scope, draft(agent, declared_outputs=(OutputField(name="required_number", kind="number"),)))
    command(domain, runtime, clock, "dispatch")
    assert repo.get(scope, bad.id).local_state == LocalState.FAILED
    assert len(gateway.sent) == 2


def test_tracing_connection_negotiation_uses_frozen_invocation_flag(domain: Domain) -> None:
    from services.external_agents.protocol import TRACEABILITY_URI

    repo, sessions, scope, agent, _ = domain
    with sessions.begin() as session:
        stored(session, ExternalAgentHead, agent).tracing_enabled = True
    gateway = RemoteAgent(direct=True)
    runtime, clock, *_ = service(domain, gateway)
    runtime.start(scope, draft(agent, declared_outputs=(OutputField(name="text", kind="string"),)))
    with sessions.begin() as session:
        stored(session, ExternalAgentHead, agent).tracing_enabled = False
    command(domain, runtime, clock, "dispatch")
    assert gateway.last_connection.enabled_extensions == (TRACEABILITY_URI,)


def test_input_failure_does_not_count_actual_business_dispatch(domain: Domain) -> None:
    from services.external_agents.io_contracts import ExternalIOError

    class MissingFile:
        def build(self, invocation: Invocation) -> SendRequest:
            assert invocation.id
            raise ExternalIOError("file_unavailable", "The admitted input file is no longer available.")

    repo, sessions, scope, agent, _ = domain
    gateway = RemoteAgent()
    clock = Clock()
    runtime = ExternalInvocationService(
        store=repo,
        connections=repo,
        gateway=gateway,
        inputs=MissingFile(),
        outputs=Outputs(),
        observer=Observer(),
        wake=Wake(),
        clock=clock,
        ids=Ids(),
        settings=RuntimeSettings(),
    )
    value = runtime.start(scope, draft(agent))
    command(domain, runtime, clock, "dispatch")
    assert not gateway.sent
    assert repo.get(scope, value.id).submission_state == SubmissionState.REJECTED
    with sessions() as session:
        assert stored(session, ExternalAgentInvocation, value.id).dispatched_at is None
        assert stored(session, ExternalAgentInvocation, value.id).started_at is None


def test_admission_flag_rejects_new_business_but_keeps_accepted_task_observation(domain: Domain) -> None:
    repo, _, scope, agent, _ = domain
    gateway = RemoteAgent()
    runtime, clock, *_ = service(domain, gateway)
    old = runtime.start(scope, draft(agent, declared_outputs=(OutputField(name="text", kind="string"),)))
    command(domain, runtime, clock, "dispatch")
    queued = runtime.start(scope, draft(agent))
    disabled = ExternalInvocationService(
        store=repo,
        connections=repo,
        gateway=gateway,
        inputs=Inputs(),
        outputs=Outputs(),
        observer=Observer(),
        wake=Wake(),
        clock=clock,
        ids=Ids(),
        settings=RuntimeSettings(admission_enabled=False),
    )
    with pytest.raises(RuntimeError, match="disabled"):
        disabled.start(scope, draft(agent))
    command(domain, disabled, clock, "dispatch")
    assert repo.get(scope, queued.id).submission_state == SubmissionState.REJECTED
    gateway.state = "completed"
    clock.value += timedelta(seconds=6)
    command(domain, disabled, clock, "poll")
    observed = repo.get(scope, old.id)
    assert observed.local_state == LocalState.SUCCEEDED, (observed.error_code, observed.error_message)
    assert len(gateway.sent) == 1


def test_system_closure_ends_revoked_overview_without_io_and_starts_fixed_ttl(domain: Domain) -> None:
    repo, sessions, scope, agent, _ = domain
    value = repo.create(scope, draft(agent), now=NOW)
    with sessions.begin() as session:
        session.delete(session.scalars(select(TenantAccountJoin)).one())
    assert repo.close_unavailable_executions(now=NOW + timedelta(seconds=5)) == 1
    assert repo.close_unavailable_executions(now=NOW + timedelta(seconds=6)) == 0
    with sessions() as session:
        row = stored(session, ExternalAgentInvocation, value.id)
        assert row.local_state == "stopped"
        assert row.submission_state == "rejected"
        assert row.test_expires_at == (NOW + timedelta(seconds=5, hours=24)).replace(tzinfo=None)
        assert row.dispatched_at is None
        assert all(item.state == "closed" for item in session.scalars(select(ExternalAgentCommand)))


def test_cancel_retry_creates_new_business_invocation_only_after_confirmed_canceled(domain: Domain) -> None:
    repo, sessions, scope, agent, _ = domain
    gateway = RemoteAgent()
    runtime, clock, _, observer = service(domain, gateway)
    value = runtime.start(
        scope,
        draft(
            agent,
            policy=WaitPolicy(wait_seconds=60, on_timeout=TimeoutPolicy.CANCEL_AND_RETRY),
            declared_outputs=(OutputField(name="text", kind="string"),),
        ),
    )
    command(domain, runtime, clock, "dispatch")
    clock.value += timedelta(seconds=60)
    command(domain, runtime, clock, "deadline")
    command(domain, runtime, clock, "cancel")
    assert gateway.cancels == 1
    assert len(gateway.sent) == 1
    assert repo.get(scope, value.id).local_state == LocalState.WAITING
    gateway.state = "canceled"
    clock.value += timedelta(seconds=6)
    command(domain, runtime, clock, "poll")
    assert repo.get(scope, value.id).local_state == LocalState.RETRY_PENDING
    clock.value += timedelta(seconds=5)
    with sessions.begin() as session:
        head = stored(session, ExternalAgentHead, agent)
        head.test_display_generation += 1
        head.active_connection_revision_id = uid()
    command(domain, runtime, clock, "retry")
    child = present(repo.for_execution(scope, value.identity))
    assert runtime.logical_result(scope, value.id).invocation_id == child.id
    assert runtime.result(scope, value.id).invocation_id == value.id
    runtime.cancel(scope, value.id)  # Exact old ID must not cancel a child already created.
    assert repo.get(scope, child.id).local_state == LocalState.WAITING
    with sessions() as session:
        calls = session.scalars(select(ExternalAgentInvocation).order_by(ExternalAgentInvocation.sequence)).all()
        assert len(calls) == 2
        assert calls[1].retry_of == calls[0].id
        assert calls[1].message_id != calls[0].message_id
        assert calls[1].logical_deadline == calls[0].logical_deadline
        assert calls[1].connection_revision_id == calls[0].connection_revision_id
        assert calls[1].asset_snapshot == calls[0].asset_snapshot
    command(domain, runtime, clock, "dispatch")
    assert len(gateway.sent) == 2
    assert "TASK_STATE_CANCELED" in observer.states


@pytest.mark.parametrize("stage", ["cancellation_requested", "retry_pending"])
def test_explicit_cancel_prevents_timeout_retry_without_changing_exact_target(domain: Domain, stage: str) -> None:
    repo, sessions, scope, agent, _ = domain
    gateway = RemoteAgent()
    runtime, clock, *_ = service(domain, gateway)
    value = runtime.start(
        scope,
        draft(
            agent,
            policy=WaitPolicy(wait_seconds=60, on_timeout=TimeoutPolicy.CANCEL_AND_RETRY),
            declared_outputs=(OutputField(name="text", kind="string"),),
        ),
    )
    command(domain, runtime, clock, "dispatch")
    clock.value += timedelta(seconds=60)
    command(domain, runtime, clock, "deadline")
    deadline = repo.get(scope, value.id).cancellation_deadline
    if stage == "retry_pending":
        gateway.state = "canceled"
        command(domain, runtime, clock, "cancel")
        assert repo.get(scope, value.id).local_state == LocalState.RETRY_PENDING
    changed = runtime.cancel(scope, value.id)
    if stage == "cancellation_requested":
        assert changed.cancel_trigger == "user"
        assert changed.cancellation_deadline == deadline
        gateway.state = "canceled"
        command(domain, runtime, clock, "cancel")
        assert repo.get(scope, value.id).local_state == LocalState.ENDED
    else:
        assert changed.local_state == LocalState.STOPPED
        clock.value += timedelta(seconds=5)
        command(domain, runtime, clock, "retry")
    with sessions() as session:
        assert len(session.scalars(select(ExternalAgentInvocation)).all()) == 1
    assert len(gateway.sent) == 1


def test_uncertain_cancel_only_queries_within_original_confirmation_window(domain: Domain) -> None:
    class UncertainCancel(RemoteAgent):
        @override
        def cancel_task(
            self, connection: ConnectionSpec, task_id: str, *, timeout_seconds: float = 30
        ) -> GatewayReceipt:
            assert task_id
            assert timeout_seconds > 0
            self.last_connection = connection
            self.cancels += 1
            self.state = "canceled"
            raise GatewayError("network_failure", "Cancellation response was lost.")

    repo, _, scope, agent, _ = domain
    gateway = UncertainCancel()
    runtime, clock, *_ = service(domain, gateway)
    value = runtime.start(
        scope,
        draft(
            agent,
            policy=WaitPolicy(wait_seconds=60, on_timeout=TimeoutPolicy.CANCEL_AND_RETRY),
            declared_outputs=(OutputField(name="text", kind="string"),),
        ),
    )
    command(domain, runtime, clock, "dispatch")
    clock.value += timedelta(seconds=60)
    command(domain, runtime, clock, "deadline")
    before = repo.get(scope, value.id).cancellation_deadline
    command(domain, runtime, clock, "cancel")
    assert repo.get(scope, value.id).local_state == LocalState.WAITING
    assert repo.get(scope, value.id).cancellation_deadline == before
    clock.value += timedelta(seconds=6)
    command(domain, runtime, clock, "poll")
    assert repo.get(scope, value.id).local_state == LocalState.RETRY_PENDING
    assert gateway.cancels == 1
    assert len(gateway.sent) == 1


def test_confirmed_cancel_retry_handoff_keeps_input_lease_until_child_is_atomic(domain: Domain) -> None:
    from repositories.external_agents.file_lifecycle_repository import ExternalFileLifecycleRepository
    from repositories.external_agents.observability_repository import ExternalObservabilityRepository
    from services.external_agents.io_contracts import FileReference, FileScope
    from services.external_agents.traceability import TraceLimits

    repo, sessions, scope, agent, _ = domain
    lease_id, file_id = uid(), uid()
    with sessions.begin() as session:
        session.add(
            ExternalAgentFileLease(
                id=lease_id,
                tenant_id=scope.tenant_id,
                owner_id=scope.initiator_id,
                agent_id=agent,
                page_session_id="page",
                file_id=file_id,
                purpose="input",
                temporary_copy=True,
                storage_key="owned-test-input.txt",
                content_hash="a" * 64,
                size=3,
                media_type="text/plain",
                expires_at=(NOW + timedelta(hours=1)).replace(tzinfo=None),
                created_at=NOW.replace(tzinfo=None),
            )
        )
    request = draft(
        agent,
        parts=({"text": "task"}, {"fileRef": {"file_id": file_id, "kind": "upload"}}),
        job={"page_session_id": "page", "input_lease_ids": [lease_id]},
        policy=WaitPolicy(wait_seconds=60, on_timeout=TimeoutPolicy.CANCEL_AND_RETRY),
    )
    value = present(repo.acquire_dispatch(scope, repo.create(scope, request, now=NOW).id, now=NOW))
    value = present(repo.begin_send(scope, value, now=NOW))
    accepted = replace(
        value,
        version=value.version + 1,
        submission_state=SubmissionState.ACCEPTED,
        remote_task_id="remote-task",
        remote_state="working",
    )
    assert repo.save(scope, value, accepted)
    expired = ExternalInvocationAgg(accepted, RuntimeSettings()).expire(NOW + timedelta(seconds=60))
    assert repo.save(scope, accepted, expired.invocation, commands=expired.commands)
    canceled = ExternalInvocationAgg(expired.invocation, RuntimeSettings()).receive(
        GatewayReceipt(kind="task", task_id="remote-task", state="TASK_STATE_CANCELED", payload={}),
        NOW + timedelta(seconds=61),
    )
    assert repo.save(scope, expired.invocation, canceled.invocation, commands=canceled.commands)
    gc = ExternalObservabilityRepository(sessions=sessions, limits=TraceLimits())
    assert not gc.file_cleanup_candidates(now=NOW + timedelta(seconds=62), limit=10)
    next_request = replace(
        request,
        invocation_id=uid(),
        message_id=uid(),
        sequence=1,
        retry_of=value.id,
        logical_deadline=canceled.invocation.logical_deadline,
    )
    child = repo.create_retry(scope, canceled.invocation, next_request, now=NOW + timedelta(seconds=66))
    with sessions() as session:
        old_lease = stored(session, ExternalAgentFileLease, lease_id)
        child_ids = child.job["input_lease_ids"]
        assert isinstance(child_ids, list)
        child_id = child_ids[0]
        assert isinstance(child_id, str)
        child_lease = stored(session, ExternalAgentFileLease, child_id)
        assert old_lease.released_at is None
        assert child_lease.released_at is None
        assert child_lease.id != lease_id
        assert child_lease.file_id == file_id
        assert child_lease.created_at == old_lease.created_at
        assert child_lease.expires_at == old_lease.expires_at
        assert stored(session, ExternalAgentInvocation, value.id).local_state == "ended"
        assert (
            stored(session, ExternalAgentInvocation, child.id).job_config["input_lease_ids"]
            == child.job["input_lease_ids"]
        )
    source_gate = ExternalFileLifecycleRepository(sessions=sessions)
    child_scope = FileScope(tenant_id=scope.tenant_id, app_id=None, actor_id=scope.initiator_id, invocation_id=child.id)
    source_gate.ensure_input_access(child_scope, FileReference(file_id=file_id))
    candidates = gc.file_cleanup_candidates(now=NOW + timedelta(seconds=67), limit=10)
    assert len(candidates) == 1
    assert candidates[0].lease_id == lease_id
    assert not candidates[0].temporary_copy  # The active child owns the shared copy now.
    source_gate.ensure_input_access(child_scope, FileReference(file_id=file_id))


def test_explicit_cancel_reapplies_after_a_real_concurrent_state_cas(domain: Domain) -> None:
    repo, _, scope, agent, _ = domain
    runtime, *_ = service(domain, RemoteAgent())
    prepared = repo.create(scope, draft(agent), now=NOW)
    permit = present(repo.acquire_dispatch(scope, prepared.id, now=NOW))
    sent = present(repo.begin_send(scope, permit, now=NOW))
    stopped = runtime._cancel_exact(permit, attempts=3)  # begin_send won after the caller's earlier read.
    assert stopped.local_state == LocalState.STOPPED
    assert stopped.submission_state == SubmissionState.UNKNOWN  # Acceptance remains unknown, never rejected.
    assert stopped.dispatched_at == sent.dispatched_at
    other = repo.create(scope, draft(agent), now=NOW)
    other_permit = present(repo.acquire_dispatch(scope, other.id, now=NOW))
    canceled_before_post = runtime.cancel(scope, other.id)
    assert canceled_before_post.submission_state == SubmissionState.REJECTED
    assert repo.begin_send(scope, other_permit, now=NOW) is None


@pytest.fixture
def workflow_domain(domain: Domain) -> WorkflowDomain:
    repo, sessions, scope, agent, revision = domain
    TypeBase.metadata.create_all(
        bound_engine(sessions),
        tables=[
            TypeBase.metadata.tables[model.__tablename__]
            for model in (
                App,
                Workflow,
                WorkflowRun,
                WorkflowNodeExecutionModel,
                WorkflowPause,
                Conversation,
                WorkflowAgentNodeBinding,
            )
        ],
    )
    app_id, workflow_id, run_id, execution_id = uid(), uid(), uid(), uid()
    from services.external_agents.workflow_runtime import ExternalNodeJob

    job = ExternalNodeJob(agent_task="Please do the task")
    with sessions.begin() as session:
        session.add(
            App(
                id=app_id,
                tenant_id=scope.tenant_id,
                name="App",
                mode=AppMode.WORKFLOW,
                enable_site=True,
                enable_api=True,
            )
        )
        session.add(
            Workflow(
                id=workflow_id,
                tenant_id=scope.tenant_id,
                app_id=app_id,
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph='{"nodes":[],"edges":[]}',
                _features="{}",
                created_by=scope.initiator_id,
            )
        )
        run = WorkflowRun(
            id=run_id,
            tenant_id=scope.tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            type=WorkflowType.WORKFLOW,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="draft",
            status=WorkflowExecutionStatus.RUNNING,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=scope.initiator_id,
        )
        run.created_at = NOW.replace(tzinfo=None)
        session.add(run)
        session.add(
            WorkflowNodeExecutionModel(
                id=execution_id,
                tenant_id=scope.tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                workflow_run_id=run_id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                index=1,
                node_id="external",
                node_type="agent",
                title="External",
                status=WorkflowNodeExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=scope.initiator_id,
            )
        )
        session.add(
            WorkflowAgentNodeBinding(
                tenant_id=scope.tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                workflow_version="draft",
                node_id="external",
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                agent_id=agent,
                node_job_config={},
                binding_epoch="epoch",
                external_job_config=job.model_dump(mode="json", exclude_unset=True),
            )
        )
    new_scope = replace(scope, app_id=app_id, origin="production")
    identity = ExecutionIdentity(execution_id=execution_id, node_id="external", frame_id="root", workflow_run_id=run_id)
    return (repo, sessions, new_scope, agent, revision), identity, workflow_id, job


def test_run_budget_is_persistent_and_excludes_only_explicit_human_pause(workflow_domain: WorkflowDomain) -> None:
    domain, identity, _, _ = workflow_domain
    repo, sessions, scope, *_ = domain
    original = repo.budget_deadline(scope, identity, now=NOW)
    assert original == NOW + timedelta(hours=1)
    repo.pause_budget(scope, identity, human_only=False, now=NOW + timedelta(minutes=5))
    assert repo.budget_deadline(scope, identity, now=NOW + timedelta(minutes=15)) == original
    repo.pause_budget(scope, identity, human_only=True, now=NOW + timedelta(minutes=20))
    shifted = repo.budget_deadline(scope, identity, now=NOW + timedelta(hours=2))
    assert shifted == original + timedelta(minutes=100)
    assert repo.budget_deadline(scope, identity, now=NOW + timedelta(hours=2, minutes=1)) == shifted
    with sessions() as session:
        assert stored(session, ExternalWorkflowBudget, identity.workflow_run_id).human_pause_started_at is None


def test_production_display_is_frozen_at_permit_and_preserved_after_metadata_edit(
    workflow_domain: WorkflowDomain,
) -> None:
    domain, identity, _, _ = workflow_domain
    repo, sessions, scope, agent, _ = domain
    value = repo.create(scope, draft(agent, identity=identity, job={}), now=NOW)
    assert not value.asset_snapshot
    with sessions.begin() as session:
        stored(session, Agent, agent).name = "Latest local metadata at permit"
    permitted = present(repo.acquire_dispatch(scope, value.id, now=NOW + timedelta(seconds=1)))
    sent = present(repo.begin_send(scope, permitted, now=NOW + timedelta(seconds=2)))
    with sessions.begin() as session:
        stored(session, Agent, agent).name = "Later edit"
    assert repo.get(scope, value.id).asset_snapshot["name"] == "Latest local metadata at permit"
    assert repo.get(scope, value.id).asset_snapshot == sent.asset_snapshot


@pytest.mark.parametrize("entered_post", [False, True])
@pytest.mark.parametrize("closure", ["reconcile", "stop", "access_revoked"])
def test_send_phase_closure_releases_only_proven_no_post_and_preserves_server_context(
    workflow_domain: WorkflowDomain,
    entered_post: bool,
    closure: str,
) -> None:
    domain, identity, _, _ = workflow_domain
    repo, sessions, scope, agent, revision = domain
    conversation = Conversation(
        app_id=required_id(scope.app_id),
        mode=AppMode.ADVANCED_CHAT,
        name="chat",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=scope.initiator_id,
    )
    with sessions.begin() as session:
        session.add(conversation)
    identity = replace(identity, conversation_id=conversation.id, binding_epoch="stable-epoch")
    key = ContextKey(
        tenant_id=scope.tenant_id,
        app_id=required_id(scope.app_id),
        conversation_id=conversation.id,
        node_id=identity.node_id,
        agent_id=agent,
        connection_revision_id=revision,
        binding_epoch=identity.binding_epoch,
    )
    with sessions.begin() as session:
        slot = repo._reserve(session, key, "prior-call")
        repo._settle_slot(slot, "existing-server-context", terminal=True, unresolved=False)
    value = repo.create(scope, draft(agent, identity=identity, job={}), now=NOW)
    with sessions() as session:
        command_id = session.scalars(
            select(ExternalAgentCommand.id).where(
                ExternalAgentCommand.invocation_id == value.id, ExternalAgentCommand.kind == "dispatch"
            )
        ).one()
    assert repo.lease_command(scope, command_id, now=NOW, lease_seconds=120) is not None
    permit = present(repo.acquire_dispatch(scope, value.id, now=NOW))
    assert permit.carried_context_id == "existing-server-context"
    if entered_post:
        present(repo.begin_send(scope, permit, now=NOW))
    if closure == "reconcile":
        assert repo.reconcile(scope, now=NOW + timedelta(seconds=121)) == 1
    elif closure == "stop":
        runtime, *_ = service(domain, RemoteAgent())
        runtime.stop(scope, value.id)
    else:
        with sessions.begin() as session:
            session.delete(session.scalars(select(TenantAccountJoin)).one())
        assert repo.close_unavailable_executions(now=NOW + timedelta(seconds=1)) == 1
    with sessions() as session:
        row = stored(session, ExternalAgentInvocation, value.id)
        slot = stored(session, ExternalAgentContextSlot, row.context_slot_key)
        assert row.submission_state == ("submission_unknown" if entered_post else "rejected")
        assert (row.dispatched_at is not None) == entered_post
        assert slot.server_context_id == "existing-server-context"
        assert slot.reserved_invocation_id == (value.id if entered_post else None)
        assert slot.unresolved == entered_post
        if not entered_post:
            assert row.error_code == "preparation_interrupted"
        assert len(session.scalars(select(ExternalAgentInvocation)).all()) == 1
    if closure != "access_revoked":
        assert repo.acquire_dispatch(scope, value.id, now=NOW + timedelta(seconds=122)) is None


def test_system_access_revocation_stops_caller_without_releasing_unresolved_context(
    workflow_domain: WorkflowDomain,
) -> None:
    domain, identity, _, _ = workflow_domain
    repo, sessions, scope, agent, _ = domain
    conversation = Conversation(
        app_id=required_id(scope.app_id),
        mode=AppMode.ADVANCED_CHAT,
        name="chat",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=scope.initiator_id,
    )
    with sessions.begin() as session:
        session.add(conversation)
    identity = replace(identity, conversation_id=conversation.id, binding_epoch="epoch")
    gateway = RemoteAgent()
    runtime, clock, *_ = service(domain, gateway)
    value = runtime.start(scope, draft(agent, identity=identity, job={}))
    command(domain, runtime, clock, "dispatch")
    with sessions.begin() as session:
        session.delete(session.scalars(select(TenantAccountJoin)).one())
    assert repo.close_unavailable_executions(now=NOW + timedelta(seconds=10)) == 1
    with sessions() as session:
        row = stored(session, ExternalAgentInvocation, value.id)
        slot = stored(session, ExternalAgentContextSlot, row.context_slot_key)
        assert row.local_state == "stopped"
        assert row.error_code == "execution_access_revoked"
        assert slot.unresolved
        assert slot.reserved_invocation_id == value.id
        assert stored(session, WorkflowRun, identity.workflow_run_id).status == "failed"
        assert stored(session, WorkflowNodeExecutionModel, identity.execution_id).status == "failed"
    assert len(gateway.sent) == 1
    assert gateway.reads == 0


def test_external_result_consumption_mirrors_exact_caller_before_async_history_append(
    workflow_domain: WorkflowDomain,
) -> None:
    from core.app.app_config.entities import WorkflowUIBasedAppConfig
    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, WorkflowAppGenerateEntity
    from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
    from core.repositories.sqlalchemy_workflow_node_execution_repository import (
        SQLAlchemyWorkflowNodeExecutionRepository,
    )
    from graphon.entities import WorkflowNodeExecution
    from graphon.enums import (
        WorkflowNodeExecutionMetadataKey,
        WorkflowNodeExecutionStatus,
    )
    from graphon.enums import (
        WorkflowType as GraphonWorkflowType,
    )
    from graphon.node_events import NodeRunResult
    from services.workflow_persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer

    domain, identity, workflow_id, _ = workflow_domain
    _, sessions, scope, *_ = domain
    TypeBase.metadata.create_all(
        bound_engine(sessions), tables=[TypeBase.metadata.tables[WorkflowNodeExecutionOffload.__tablename__]]
    )
    with sessions() as session:
        account = stored(session, Account, scope.initiator_id)

    class AppendOnlyHistory(SQLAlchemyWorkflowNodeExecutionRepository):
        appended: list[str] = []

        @override
        def save_synchronously(self, execution: WorkflowNodeExecution) -> None:
            super().save(execution)

        @override
        def save(self, execution: WorkflowNodeExecution) -> None:
            self.appended.append(execution.id)

    history = AppendOnlyHistory(
        session_factory=sessions,
        tenant_id=scope.tenant_id,
        user=account,
        app_id=required_id(scope.app_id),
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    entity = WorkflowAppGenerateEntity(
        task_id=uid(),
        app_config=WorkflowUIBasedAppConfig(
            tenant_id=scope.tenant_id,
            app_id=required_id(scope.app_id),
            app_mode=AppMode.WORKFLOW,
            workflow_id=workflow_id,
        ),
        inputs={},
        files=[],
        user_id=scope.initiator_id,
        user_from=UserFrom.ACCOUNT,
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_execution_id=required_id(identity.workflow_run_id),
    )
    layer = WorkflowPersistenceLayer(
        application_generate_entity=entity,
        workflow_info=PersistenceWorkflowInfo(
            workflow_id=workflow_id, workflow_type=GraphonWorkflowType.WORKFLOW, version="draft", graph_data={}
        ),
        workflow_execution_repository=SQLAlchemyWorkflowExecutionRepository(
            session_factory=sessions,
            tenant_id=scope.tenant_id,
            user=account,
            app_id=scope.app_id,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        ),
        workflow_node_execution_repository=history,
        trace_scope=None,
    )
    domain_execution = WorkflowNodeExecution(
        id=identity.execution_id,
        node_execution_id="different-logical-id",
        workflow_id=workflow_id,
        workflow_execution_id=identity.workflow_run_id,
        index=1,
        node_id="external",
        node_type="agent",
        title="External",
        created_at=NOW.replace(tzinfo=None),
    )
    layer._update_node_execution(
        domain_execution,
        NodeRunResult(
            outputs={"text": "ok"},
            metadata={WorkflowNodeExecutionMetadataKey.AGENT_LOG: {"invocation_id": "external-call"}},
        ),
        WorkflowNodeExecutionStatus.SUCCEEDED,
        finished_at=(NOW + timedelta(seconds=1)).replace(tzinfo=None),
    )
    with sessions() as session:
        caller = stored(session, WorkflowNodeExecutionModel, identity.execution_id)
        assert caller.status == "succeeded"
        assert caller.node_execution_id == "different-logical-id"
        assert len(session.scalars(select(WorkflowNodeExecutionModel)).all()) == 1
    assert history.appended == [identity.execution_id]


def test_graphon_external_checkpoint_restores_same_execution_and_reads_fixed_result(
    workflow_domain: WorkflowDomain,
) -> None:
    from core.app.entities.app_invoke_entities import InvokeFrom
    from graphon.engine import Engine
    from graphon.engine_events import GraphRunPausedEvent, NodeRunSucceededEvent
    from graphon.runtime import RuntimeState, VariablePool
    from providers.a2a.workflow_node import DifyExternalWorkflowWake, ExternalAgentNode, ExternalAgentNodeData
    from tests.workflow_test_utils import build_test_graph_init_params

    domain, identity, workflow_id, job = workflow_domain
    repo, sessions, scope, agent, _ = domain
    gateway = RemoteAgent(direct=True)
    runtime, clock, *_ = service(domain, gateway)
    pool = VariablePool()
    pool.add(("sys", "workflow_run_id"), identity.workflow_run_id)
    state = RuntimeState(variable_pool=pool, start_at=0, workflow_id=workflow_id)
    state.graph_execution.get_or_create_node_execution(
        frame_id="root", node_id="external"
    ).execution_id = identity.execution_id
    params = build_test_graph_init_params(
        workflow_id=workflow_id,
        tenant_id=scope.tenant_id,
        app_id=required_id(scope.app_id),
        user_id=scope.initiator_id,
        invoke_from=InvokeFrom.SERVICE_API,
    )
    data = {"type": "agent", "version": "2", "agent_node_kind": "external_a2a", **job.model_dump(exclude_unset=True)}

    def graph(runtime_state: RuntimeState) -> Graph:
        node = ExternalAgentNode(
            "external",
            ExternalAgentNodeData.model_validate(data),
            init_params=params,
            runtime_state=runtime_state,
            service=runtime,
            store=repo,
            bindings=repo,
            enqueue=lambda: None,
            enabled=True,
        )
        return Graph(nodes={"external": node}, root_node=node)

    events = list(Engine(graph=graph(state), runtime_state=state, workers=1).run())
    assert isinstance(events[-1], GraphRunPausedEvent)
    from graphon.entities.pause_reason import ExternalWaitReason

    assert isinstance(events[-1].reasons[0], ExternalWaitReason)
    assert events[-1].reasons[0].execution_id == identity.execution_id
    snapshot = state.dumps()
    value = present(repo.for_execution(scope, identity))
    assert value is not None
    resumed_ids = []
    wake = DifyExternalWorkflowWake(sessions=sessions, enqueue_resume=resumed_ids.append, now=clock.now)
    assert not wake.wake(scope, value)  # response can beat checkpoint publication
    command(domain, runtime, clock, "dispatch")
    with sessions.begin() as session:
        stored(session, WorkflowRun, identity.workflow_run_id).status = WorkflowExecutionStatus.PAUSED
        session.add(
            WorkflowPause(
                workflow_id=workflow_id,
                workflow_run_id=required_id(identity.workflow_run_id),
                state_object_key="checkpoint",
            )
        )
    assert not wake.wake(scope, repo.get(scope, value.id))
    assert resumed_ids == [identity.workflow_run_id]
    restored = RuntimeState.from_snapshot(snapshot)
    results = list(Engine(graph=graph(restored), runtime_state=restored, workers=1).run())
    success = next(event for event in results if isinstance(event, NodeRunSucceededEvent))
    assert success.id == identity.execution_id
    assert success.node_run_result.outputs == {"text": "result"}
    assert len(gateway.sent) == 1
    assert present(repo.for_execution(scope, identity)).id == value.id
    with sessions.begin() as session:
        stored(
            session, WorkflowNodeExecutionModel, identity.execution_id
        ).status = WorkflowNodeExecutionStatus.SUCCEEDED
    assert wake.wake(scope, repo.get(scope, value.id))


def test_wake_delivery_is_not_consumption_and_claimed_resume_crash_fails_at_persistent_budget(
    workflow_domain: WorkflowDomain,
) -> None:
    from providers.a2a.workflow_node import DifyExternalWorkflowWake

    domain, identity, workflow_id, _ = workflow_domain
    repo, sessions, scope, agent, _ = domain
    gateway = RemoteAgent(direct=True)
    runtime, clock, *_ = service(domain, gateway)
    value = runtime.start(
        scope, draft(agent, identity=identity, declared_outputs=(OutputField(name="text", kind="string"),), job={})
    )
    command(domain, runtime, clock, "dispatch")
    value = repo.get(scope, value.id)
    with sessions.begin() as session:
        stored(session, WorkflowRun, identity.workflow_run_id).status = WorkflowExecutionStatus.PAUSED
        stored(session, WorkflowNodeExecutionModel, identity.execution_id).status = WorkflowNodeExecutionStatus.PAUSED
        session.add(
            WorkflowPause(
                workflow_id=workflow_id,
                workflow_run_id=required_id(identity.workflow_run_id),
                state_object_key="checkpoint",
            )
        )
    attempts = []

    def publish(identifier: str) -> None:
        attempts.append(identifier)
        if len(attempts) == 1:
            raise ConnectionError("Controlled broker loss before publish.")

    wake = DifyExternalWorkflowWake(sessions=sessions, enqueue_resume=publish, now=clock.now)
    with pytest.raises(ConnectionError):
        wake.wake(scope, value)
    clock.value += timedelta(seconds=119)
    assert not wake.wake(scope, value)
    assert len(attempts) == 1
    clock.value += timedelta(seconds=1)
    assert not wake.wake(scope, value)
    assert len(attempts) == 2
    clock.value += timedelta(seconds=120)  # Published message was lost before the existing resume CAS.
    assert not wake.wake(scope, value)
    assert len(attempts) == 3
    with sessions.begin() as session:
        stored(session, WorkflowRun, identity.workflow_run_id).status = WorkflowExecutionStatus.RUNNING
        session.scalars(select(WorkflowPause)).one().resumed_at = clock.value.replace(tzinfo=None)
    clock.value += timedelta(seconds=120)  # Claimed resume died: never replay an active graph checkpoint.
    assert not wake.wake(scope, value)
    assert len(attempts) == 3
    clock.value = value.logical_deadline
    assert wake.wake(scope, value)
    with sessions() as session:
        run = stored(session, WorkflowRun, identity.workflow_run_id)
        assert run.status == "failed"
        assert run.stop_requested_at is not None
        assert stored(session, WorkflowNodeExecutionModel, identity.execution_id).status == "failed"
    assert repo.get(scope, value.id).outputs == {"text": "result"}
    assert len(gateway.sent) == 1


@pytest.mark.parametrize("distinct_caller_pk", [False, True])
def test_node_debug_returns_pause_then_writes_terminal_last_run_and_draft_variables(
    workflow_domain: WorkflowDomain, distinct_caller_pk: bool
) -> None:
    from graphon.runtime import VariablePool
    from providers.a2a.workflow_node import DifyExternalWorkflowWake, ExternalAgentNode, ExternalAgentNodeData
    from services.workflow_service import WorkflowService
    from tests.workflow_test_utils import build_test_graph_init_params

    domain, identity, workflow_id, job = workflow_domain
    repo, sessions, scope, agent, _ = domain
    TypeBase.metadata.create_all(
        bound_engine(sessions),
        tables=[
            TypeBase.metadata.tables[model.__tablename__]
            for model in (
                WorkflowDraftVariable,
                WorkflowDraftVariableFile,
                WorkflowNodeExecutionOffload,
            )
        ],
    )
    scope = replace(scope, origin="node_debug")
    caller_pk = uid() if distinct_caller_pk else identity.execution_id
    with sessions.begin() as session:
        caller = stored(session, WorkflowNodeExecutionModel, identity.execution_id)
        caller.workflow_run_id = None
        caller.triggered_from = WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP
        caller.node_execution_id = identity.execution_id
        caller.id = caller_pk
    gateway = RemoteAgent(direct=True)
    new_domain = (repo, sessions, scope, agent, domain[4])
    runtime, clock, *_ = service(new_domain, gateway)
    state = RuntimeState(variable_pool=VariablePool(), start_at=0, workflow_id=workflow_id)
    params = build_test_graph_init_params(
        workflow_id=workflow_id, tenant_id=scope.tenant_id, app_id=required_id(scope.app_id), user_id=scope.initiator_id
    )
    node = ExternalAgentNode(
        "external",
        ExternalAgentNodeData.model_validate(
            {"type": "agent", "agent_node_kind": "external_a2a", "version": "2", **job.model_dump(exclude_unset=True)}
        ),
        init_params=params,
        runtime_state=state,
        service=runtime,
        store=repo,
        bindings=repo,
        enqueue=lambda: None,
        enabled=True,
    )
    node.bind_execution_id(identity.execution_id)
    result = WorkflowService(session_maker=sessions)._handle_single_step_result(
        invoke_node_fn=lambda: (node, node.run()),
        start_at=0,
        node_id="external",
    )
    assert result.status == "paused"
    assert result.finished_at is None
    value = present(repo.for_execution(scope, replace(identity, workflow_run_id=None)))
    assert value.scope.origin == "node_debug"
    assert value.identity.workflow_run_id is None
    assert value.caller_execution_id == caller_pk
    command(new_domain, runtime, clock, "dispatch")
    wake = DifyExternalWorkflowWake(sessions=sessions, enqueue_resume=lambda _run_id: None)
    assert not wake.wake(scope, repo.get(scope, value.id))
    with sessions.begin() as session:
        stored(session, WorkflowNodeExecutionModel, caller_pk).status = WorkflowNodeExecutionStatus.PAUSED
    assert wake.wake(scope, repo.get(scope, value.id))
    assert wake.wake(scope, repo.get(scope, value.id))  # duplicate terminal projection is safe
    with sessions() as session:
        row = stored(session, WorkflowNodeExecutionModel, caller_pk)
        assert row.status == "succeeded"
        assert row.outputs_dict == {"text": "result"}
        variable = session.scalars(select(WorkflowDraftVariable).where(WorkflowDraftVariable.name == "text")).one()
        assert variable.node_execution_id == caller_pk
        assert len(session.scalars(select(WorkflowNodeExecutionModel)).all()) == 1
    assert len(gateway.sent) == 1
