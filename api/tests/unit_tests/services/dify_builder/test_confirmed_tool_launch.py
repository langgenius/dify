"""Confirmed Tool launch through the existing dispatch, worker, Run and sealing owners.

Real SQLite owner rows, real consent reservation, real execution sidecar and
real native Run/node rows. Only external collaborators are spies: the Redis
advance lease, the Celery enqueue, the agent, the progress bus and the native
generator stream. The qualification values come from the shared consent
fixture and are SYNTHETIC test-only data; real qualification stays ``None``
and the rollout flag stays off outside these tests. SQLite proves transaction
contents only; PostgreSQL locking and actual native allocated IDs are CI-owned.
"""

import json
import logging
from collections.abc import Callable, Iterator, Mapping
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from types import ModuleType
from typing import TYPE_CHECKING, Literal, NoReturn, cast, override
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from core.dify_builder.contract import TestResultCard
from core.dify_builder.errors import BadRequestError, BusyError
from core.dify_builder.models import (
    Action,
    Actor,
    Diagnosis,
    Graph,
    Inputs,
    NodeEvent,
    NodeOutput,
    PublicationDecision,
    Run,
    RunVerification,
    StartSchema,
)
from core.dify_builder.real_call_consent import ConfirmedToolBinding, ConsentReceipt
from core.dify_builder.state import PcState
from libs.datetime_utils import naive_utc_now
from models.dify_builder import DifyBuilderExecutionRequest
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
from services.dify_builder.application.execution_policy import (
    BuilderExecutionObservation,
    BuilderExecutionPolicyError,
    BuilderExecutionRefusal,
    ConfirmedToolExecutionContext,
    ExecutionEvidenceSummary,
    TrustedExecutionCompletion,
    validate_execution_context,
)
from services.dify_builder.application.ports import DifyBuilderAgent, DifyPort, Repository
from services.dify_builder.application.runner import Env, Handler, Runner
from services.dify_builder.application.verification import publication_decision, result_card
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import DifyBuilderService
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, StubAgent
from tests.unit_tests.services.dify_builder.test_execution_policy_service import (
    owned as owned,  # noqa: PLC0414 - shared pytest fixture
)
from tests.unit_tests.services.dify_builder.test_real_call_consent_service import (
    APPROVED,
    SECRET_SENTINELS,
    Owner,
    confirm,
    consent_model,
    prepare,
    reserve,
    shift_clock,
    simulate_task6_launch,
)
from tests.unit_tests.services.dify_builder.test_real_call_consent_service import (
    consent_owner as consent_owner,  # noqa: PLC0414 - shared pytest fixture
)

if TYPE_CHECKING:
    from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
    from services.dify_builder.application.execution_policy import BuilderExecutionContext
    from services.dify_builder.dify_port import ConfirmedLaunchRecorder
    from services.dify_builder.real_call_consent_service import (
        BuilderRealCallConsentService,
        ServiceConfirmedToolGuard,
    )
    from tests.unit_tests.core.dify_builder.fakes import InMemoryRepository


def as_env_collaborators(
    port: FakeDifyPort, agent: StubAgent, repo: "Repository | InMemoryRepository"
) -> tuple[DifyPort, DifyBuilderAgent, Repository]:
    """The shared fakes (``fakes.py``, not a Task 6 owner) name parameters with a leading
    underscore, so they are not structurally assignable to the Protocols; they implement
    every member the engine calls. One explicit, local conversion instead of Any."""
    return cast(DifyPort, port), cast(DifyBuilderAgent, agent), cast(Repository, repo)


# The internal reserved-command action kind; a literal here so this module never
# depends on a product constant at collection time (pinned to the product constant below).
CONFIRMED_TOOL_ACTION = "run_confirmed_tool"


def test_internal_action_literal_matches_the_product_constant() -> None:
    from core.dify_builder import models

    assert models.CONFIRMED_TOOL_ACTION == CONFIRMED_TOOL_ACTION


BODY_SENTINEL = "BODY-SENTINEL-message-text"
TOKEN_SENTINEL = "ya29.TOKEN-SENTINEL"
PROVIDER_ERROR_SENTINEL = "PROVIDER-ERROR-SENTINEL invalid_grant"
SENTINELS = (BODY_SENTINEL, TOKEN_SENTINEL, PROVIDER_ERROR_SENTINEL, *SECRET_SENTINELS)


# --- spies for the external collaborators -------------------------------------------------


class SpyLease:
    """In-memory stand-in for the Redis advance lease with compare-delete release."""

    def __init__(self, on_acquire: Callable[[], None] | None = None) -> None:
        self.holder: dict[str, str] = {}
        self.log: list[tuple[str, str]] = []
        self._on_acquire = on_acquire

    def acquire(self, session_id: str) -> str | None:
        if self._on_acquire is not None:
            self._on_acquire()
        if session_id in self.holder:
            self.log.append(("busy", session_id))
            return None
        token = str(uuid4())
        self.holder[session_id] = token
        self.log.append(("acquire", token))
        return token

    def release(self, session_id: str, token: str) -> None:
        self.log.append(("release", token))
        if self.holder.get(session_id) == token:
            del self.holder[session_id]

    def exists(self, session_id: str) -> bool:
        return session_id in self.holder


class SpyEnqueue:
    def __init__(self, error: BaseException | None = None) -> None:
        self.calls: list[tuple[str, Action, Actor, str]] = []
        self._error = error

    def __call__(self, session_id: str, action: Action, actor: Actor, token: str) -> None:
        self.calls.append((session_id, action, actor, token))
        if self._error is not None:
            raise self._error


def builder(owner: Owner, lease: SpyLease, enqueue: SpyEnqueue) -> DifyBuilderService:
    return DifyBuilderService(
        SqlDifyBuilderRepository(owner.factory),
        lease,
        enqueue,
        real_call_consent=owner.service(),
    )


def confirmed(owner: Owner) -> ConsentReceipt:
    return confirm(owner, prepare(owner))


def execute(
    service: DifyBuilderService,
    owner: Owner,
    receipt: ConsentReceipt,
    *,
    key: str = "execute-1",
    scope_digest: str | None = None,
) -> ConsentReceipt:
    return service.execute_confirmed_tool(
        owner.session_id,
        owner.actor,
        consent_id=receipt.consent_id,
        scope_digest=receipt.scope_digest if scope_digest is None else scope_digest,
        at_version=receipt.at_version,
        idempotency_key=key,
    )


def reserve_directly(owner: Owner) -> tuple[ConsentReceipt, Action, str]:
    """Reserve through the EXISTING consent owner and build the reserved command's action.

    Mirrors what the single dispatch winner enqueues: the reserved command ID,
    the reserved session version and only the consent reference as payload.
    """
    reserved, won = reserve(owner, confirmed(owner))
    assert won is True
    assert reserved.command_id is not None
    action = Action(
        kind=CONFIRMED_TOOL_ACTION,
        payload={"consent_id": reserved.consent_id},
        base_version=reserved.at_version,
        command_id=reserved.command_id,
    )
    return reserved, action, str(uuid4())


class ServiceGuardRecorder:
    """Test-local recorder built only from existing consent APIs.

    It issues the guard exactly as the service owner does: ``claim_tool`` at the
    actual bound node execution ID, then ``ServiceConfirmedToolGuard``.
    """

    def __init__(
        self, consent: "BuilderRealCallConsentService", context: ConfirmedToolExecutionContext, native_run_id: str
    ) -> None:
        self.consent = consent
        self.context = context
        self.native_run_id = native_run_id
        self.bindings: list[ConfirmedToolBinding] = []

    @property
    def healthy(self) -> bool:
        return True

    def record(self, observation: BuilderExecutionObservation) -> None:
        raise AssertionError(f"a confirmed run records no restricted observations: {observation.kind}")

    def confirmed_guard(
        self, *, node_id: str, native_run_id: str, native_node_execution_id: str
    ) -> "ServiceConfirmedToolGuard":
        from services.dify_builder.real_call_consent_service import ServiceConfirmedToolGuard

        binding = self.consent.claim_tool(
            context=self.context,
            node_id=node_id,
            native_run_id=native_run_id,
            native_node_execution_id=native_node_execution_id,
        )
        self.bindings.append(binding)
        return ServiceConfirmedToolGuard(self.consent, binding)


def launched_with_existing_apis(owner: Owner) -> tuple[ConsentReceipt, ConfirmedToolExecutionContext, str]:
    """Real reservation, then the existing fixture stand-in for the launch-identity claim."""
    reserved, _action, _token = reserve_directly(owner)
    context, run_id = simulate_task6_launch(owner, reserved)
    return reserved, context, run_id


def requests(owner: Owner) -> int:
    return owner.count(DifyBuilderExecutionRequest)


def stored_context(owner: Owner, request_id: str | None) -> ConfirmedToolExecutionContext:
    with owner.factory() as db:
        row = db.get(DifyBuilderExecutionRequest, request_id)
        assert row is not None
        context = validate_execution_context(row.context)
    assert isinstance(context, ConfirmedToolExecutionContext)
    return context


# --- one dispatch owner: lease before reservation, same token to the sole winner ------------


def test_winner_acquires_lease_before_sql_reservation_and_enqueues_same_token_once(consent_owner: Owner) -> None:
    owner = consent_owner
    receipt = confirmed(owner)
    observed: list[int] = []
    lease = SpyLease(on_acquire=lambda: observed.append(requests(owner)))
    enqueue = SpyEnqueue()

    reserved = execute(builder(owner, lease, enqueue), owner, receipt)

    # The lease was taken while no sidecar/command existed yet.
    assert observed == [0]
    assert requests(owner) == 1
    assert reserved.command_id is not None
    assert reserved.state == "confirmed"
    [(session_id, action, actor, token)] = enqueue.calls
    assert lease.log == [("acquire", token)]  # the worker releases its own token, not the web process
    assert (session_id, actor) == (owner.session_id, owner.actor)
    assert action.kind == CONFIRMED_TOOL_ACTION
    assert action.command_id == reserved.command_id
    assert action.base_version == reserved.at_version
    assert action.payload == {"consent_id": reserved.consent_id}
    assert action.base_app_revision == ""


def test_matching_duplicate_while_original_lease_is_held_returns_current_receipt(consent_owner: Owner) -> None:
    owner = consent_owner
    receipt = confirmed(owner)
    lease, enqueue = SpyLease(), SpyEnqueue()
    first = execute(builder(owner, lease, enqueue), owner, receipt)
    assert lease.exists(owner.session_id)

    # A new web process, same body/key, while the original lease is still held.
    again = execute(builder(owner, lease, enqueue), owner, receipt)

    assert again.command_id == first.command_id
    assert again.execution_request_id == first.execution_request_id
    assert len(enqueue.calls) == 1
    assert requests(owner) == 1
    assert ("busy", owner.session_id) in lease.log


def test_held_lease_never_turns_a_different_body_or_fresh_grant_into_a_launch(consent_owner: Owner) -> None:
    owner = consent_owner
    receipt = confirmed(owner)
    lease, enqueue = SpyLease(), SpyEnqueue()
    service = builder(owner, lease, enqueue)
    execute(service, owner, receipt)
    with pytest.raises(BuilderExecutionPolicyError, match="idempotency_conflict"):
        execute(service, owner, receipt, key="execute-other")
    assert len(enqueue.calls) == 1


def test_lease_held_by_another_command_is_busy_and_reserves_nothing(consent_owner: Owner) -> None:
    owner = consent_owner
    receipt = confirmed(owner)
    lease, enqueue = SpyLease(), SpyEnqueue()
    lease.holder[owner.session_id] = "foreign-token"
    with pytest.raises(BusyError):
        execute(builder(owner, lease, enqueue), owner, receipt)
    assert enqueue.calls == []
    assert requests(owner) == 0
    assert lease.holder[owner.session_id] == "foreign-token"
    assert owner.consent_row(receipt.consent_id).command_id is None


def test_refusal_and_nonwinning_replay_release_only_their_own_token(consent_owner: Owner) -> None:
    owner = consent_owner
    receipt = confirmed(owner)
    lease, enqueue = SpyLease(), SpyEnqueue()
    service = builder(owner, lease, enqueue)

    with pytest.raises(BuilderExecutionPolicyError, match="consent_scope_mismatch"):
        execute(service, owner, receipt, scope_digest="0" * 64)
    assert not lease.exists(owner.session_id)
    assert [kind for kind, _ in lease.log] == ["acquire", "release"]
    assert enqueue.calls == []
    assert requests(owner) == 0

    won = execute(service, owner, receipt)
    # The worker finished and released its token; an identical replay now wins the
    # lease but not the reservation, so it releases and never enqueues.
    lease.release(owner.session_id, enqueue.calls[0][3])
    replay = execute(service, owner, receipt)
    assert replay.command_id == won.command_id
    assert len(enqueue.calls) == 1
    assert not lease.exists(owner.session_id)


def test_lost_enqueue_acknowledgement_never_enqueues_or_launches_twice(consent_owner: Owner) -> None:
    owner = consent_owner
    receipt = confirmed(owner)
    lease = SpyLease()
    enqueue = SpyEnqueue(error=TimeoutError("ack lost"))

    first = execute(builder(owner, lease, enqueue), owner, receipt)
    second = execute(builder(owner, lease, enqueue), owner, receipt)

    assert len(enqueue.calls) == 1
    assert first.command_id == second.command_id is not None
    assert requests(owner) == 1
    with owner.factory() as db:
        assert db.scalar(select(func.count()).select_from(consent_model())) == 1

    # Reconstructed services: once the original worker launched, the reserved
    # command can neither be reloaded for launch nor claim a second grant.
    context = stored_context(owner, first.execution_request_id)
    run_id = str(uuid4())
    BuilderExecutionPolicyService(owner.factory).claim_launch(context=context, native_run_id=run_id, task_id="t1")
    with pytest.raises(BuilderExecutionPolicyError, match="execution_already_launched"):
        owner.service().reserved_launch(
            actor=owner.actor, session_id=owner.session_id, consent_id=first.consent_id, command_id=first.command_id
        )
    with pytest.raises(BuilderExecutionPolicyError):
        BuilderExecutionPolicyService(owner.factory).claim_launch(
            context=context, native_run_id=str(uuid4()), task_id="t2"
        )


def test_generic_actions_cannot_carry_the_internal_confirmed_action(consent_owner: Owner) -> None:
    owner = consent_owner
    service = builder(owner, SpyLease(), SpyEnqueue())
    with pytest.raises(BadRequestError):
        service.submit_action(
            owner.session_id,
            owner.actor,
            Action(kind=CONFIRMED_TOOL_ACTION, payload={"consent_id": str(uuid4())}, base_version=1),
        )


# --- worker reload, duplicate delivery and recovery ------------------------------------------


SafetyOutcome = Literal["confirmed_tool_completed", "execution_evidence_unknown"]


class ConfirmedSpyPort(FakeDifyPort):
    """Records the shared port call; returns a sealed confirmed Run shape."""

    def __init__(
        self, outcome: SafetyOutcome = "confirmed_tool_completed", *, refusal: "BuilderExecutionRefusal | None" = None
    ) -> None:
        super().__init__()
        self.confirmed_calls: list[dict[str, object]] = []
        self.outcome: SafetyOutcome = outcome
        # Set: answer like a delivery whose launch was refused (e.g. lost to another delivery).
        self.refusal = refusal

    @override
    def run_draft(
        self,
        app_id: str,
        actor: Actor,
        inputs: Inputs,
        on_event: Callable[[NodeEvent], None],
        *,
        session_id: str,
        test_input_id: str,
        on_workflow_event: Callable[[Mapping[str, object]], None] | None = None,
        confirmed_consent_id: str | None = None,
        command_id: str | None = None,
        effect_confirmation: Mapping[str, str] | None = None,
    ) -> Run:
        _ = (session_id, on_workflow_event, effect_confirmation)  # the shared port signature; not inspected here
        self.confirmed_calls.append(
            {
                "inputs": dict(inputs),
                "test_input_id": test_input_id,
                "confirmed_consent_id": confirmed_consent_id,
                "command_id": command_id,
            }
        )
        if self.refusal is not None:
            return Run(status="failed", execution_refusal=self.refusal)
        on_event(NodeEvent(node_id="tool", status="succeeded"))
        summary = ExecutionEvidenceSummary(
            request_id="request-1",
            policy_version="builder-confirmed-gmail-read-v1",
            mode="confirmed_tool",
            sealed=True,
            safety_outcome=self.outcome,
            sandbox_profile="disabled",
            native_run_id="native-run-1",
            consent_id=confirmed_consent_id or "consent-1",
            action_state="completed" if self.outcome == "confirmed_tool_completed" else "unknown",
            action_reason_code="message_returned"
            if self.outcome == "confirmed_tool_completed"
            else "stream_incomplete",
        )
        return Run(
            dify_run_id="native-run-1",
            status="succeeded",
            per_node=[NodeOutput(node_id="tool", status="succeeded")],
            verification=RunVerification(
                execution_revision="",
                executed_graph_revision="",
                terminal_outputs=None,
                output_findings=[],
                executed_node_ids=["start", "tool", "end"],
                no_output_dead_branch=False,
                execution_evidence=summary,
            ),
        )


class NoModelAgent(StubAgent):
    """Every cognition/localization entry point fails the test if reached."""

    @override
    def diagnose(self, failed_run: Run, graph: Graph, node_outputs: list[NodeOutput]) -> NoReturn:
        raise AssertionError("confirmed outcome must not be diagnosed")

    @override
    def propose_repair(self, diagnosis: Diagnosis, graph: Graph) -> NoReturn:
        raise AssertionError(f"confirmed outcome must not be repaired: {diagnosis.root_cause}")

    @override
    def generate_mock_inputs(self, schema: StartSchema, prior_failed: Inputs) -> NoReturn:
        raise AssertionError("confirmed test must use the saved input")


def wire_worker(
    monkeypatch: pytest.MonkeyPatch, owner: Owner, port: ConfirmedSpyPort, order: list[str]
) -> tuple[ModuleType, SqlDifyBuilderRepository, list[dict[str, object]], list[str]]:
    import tasks.dify_builder_advance_task as mod

    repo = SqlDifyBuilderRepository(owner.factory)
    monkeypatch.setattr(mod, "_build_repo", lambda: repo)
    service = owner.service()
    real_reload = service.reserved_launch

    def reload(*, actor: Actor, session_id: str, consent_id: str, command_id: str) -> ConfirmedToolExecutionContext:
        order.append("reload")
        return real_reload(actor=actor, session_id=session_id, consent_id=consent_id, command_id=command_id)

    # Non-raising seams: the worker's consent-owner seam is a Task 6 addition (RED ran before it existed).
    monkeypatch.setattr(service, "reserved_launch", reload, raising=False)
    monkeypatch.setattr(mod, "_build_consent_service", lambda: service, raising=False)
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", lambda: port)

    def agent(**_kwargs: object) -> NoModelAgent:
        order.append("agent")
        return NoModelAgent()

    monkeypatch.setattr(mod, "build_dify_builder_agent", agent)
    events: list[dict[str, object]] = []
    released: list[str] = []
    monkeypatch.setattr(mod.progress_bus, "publish", lambda _sid, ev: events.append(ev))
    monkeypatch.setattr(mod.session_lock, "release", lambda _sid, tok: released.append(tok))
    monkeypatch.setattr(mod.session_lock, "activate", lambda _sid, tok: tok)
    monkeypatch.setattr(mod.session_lock, "exists", lambda _sid: False)
    return mod, repo, events, released


def reserve_through_dispatch(owner: Owner) -> tuple[ConsentReceipt, Action, str]:
    enqueue = SpyEnqueue()
    reserved = execute(builder(owner, SpyLease(), enqueue), owner, confirmed(owner))
    [(_sid, action, _actor, token)] = enqueue.calls
    return reserved, action, token


def test_worker_reloads_reserved_command_then_runs_saved_input_once_and_reviews(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = consent_owner
    reserved, action, token = reserve_directly(owner)
    port, order = ConfirmedSpyPort(), list[str]()
    mod, repo, events, released = wire_worker(monkeypatch, owner, port, order)

    mod.advance_session(owner.session_id, asdict(action), asdict(owner.actor), token)

    assert order[:2] == ["reload", "agent"]
    assert released == [token]
    [call] = port.confirmed_calls
    assert call == {
        "inputs": {"note": "hello"},
        "test_input_id": owner.test_input_id,
        "confirmed_consent_id": reserved.consent_id,
        "command_id": reserved.command_id,
    }
    session, fc = repo.get_session(owner.session_id)
    assert session.current_state == PcState.BUILD_REVIEW
    assert (fc.confirmed_consent_id, fc.confirmed_command_id) == ("", "")
    assert fc.last_command_id == reserved.command_id
    card = next(item for item in repo.list_conversation(owner.session_id) if item.kind == "test_result")
    assert card.payload["execution_mode"] == "confirmed_tool"
    assert card.payload["safety_outcome"] == "confirmed_tool_completed"
    assert card.payload["consent_id"] == reserved.consent_id
    assert card.payload["terminal_outputs"] is None
    assert events[-1]["kind"] == "command_finished"


@pytest.mark.parametrize("forgery", ["command", "consent", "payload_only"])
def test_worker_refuses_forged_or_serialized_confirmed_context_before_agent_setup(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch, forgery: str
) -> None:
    owner = consent_owner
    reserved, action, token = reserve_directly(owner)
    port, order = ConfirmedSpyPort(), list[str]()
    mod, repo, events, released = wire_worker(monkeypatch, owner, port, order)
    forged = asdict(action)
    if forgery == "command":
        forged["command_id"] = str(uuid4())
    elif forgery == "consent":
        forged["payload"] = {"consent_id": str(uuid4())}
    else:
        forged["payload"] = {"consent_id": reserved.consent_id, "context": {"policy_version": "x"}}
    before = repo.get_session(owner.session_id)

    mod.advance_session(owner.session_id, forged, asdict(owner.actor), token)

    assert "agent" not in order
    assert port.confirmed_calls == []
    assert repo.get_session(owner.session_id)[0].version == before[0].version
    assert events[-1]["kind"] == "error"
    assert released == [token]


def test_duplicate_celery_delivery_cannot_launch_the_old_grant_again(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = consent_owner
    reserved, action, token = reserve_directly(owner)
    # The first delivery already claimed the launch identity (existing fixture stand-in).
    simulate_task6_launch(owner, reserved)
    port, order = ConfirmedSpyPort(), list[str]()
    mod, repo, events, _released = wire_worker(monkeypatch, owner, port, order)

    mod.advance_session(owner.session_id, asdict(action), asdict(owner.actor), token)

    assert port.confirmed_calls == []
    assert "agent" not in order
    assert events[-1]["kind"] == "error"


def test_same_token_duplicate_delivery_cannot_release_or_settle_the_active_winner(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Real ``session_lock`` lease semantics at the Redis-client boundary (test-local substitute).

    Worker A runs the reserved command. While it is inside its native run, a second Celery
    delivery B of the same dispatch token arrives, then the sweeper runs. B must not take,
    release or settle anything; only A releases the lease when it finishes.
    """
    import schedule.dify_builder_reconcile_task as sweeper
    import tasks.dify_builder_advance_task as mod
    from services.dify_builder import session_lock
    from tests.unit_tests.services.dify_builder.test_session_lock import FakeRedis

    owner = consent_owner
    fake = FakeRedis()
    monkeypatch.setattr(session_lock, "redis_client", fake)
    enqueue = SpyEnqueue()
    dispatcher = DifyBuilderService(
        SqlDifyBuilderRepository(owner.factory), session_lock, enqueue, real_call_consent=owner.service()
    )
    reserved = execute(dispatcher, owner, confirmed(owner))
    [(_sid, action, _actor, token)] = enqueue.calls
    repo = SqlDifyBuilderRepository(owner.factory)
    monkeypatch.setattr(mod, "_build_repo", lambda: repo)
    monkeypatch.setattr(mod, "_build_consent_service", owner.service)
    monkeypatch.setattr(mod, "build_dify_builder_agent", lambda **_kwargs: NoModelAgent())
    events: list[dict[str, object]] = []
    monkeypatch.setattr(mod.progress_bus, "publish", lambda _sid, event: events.append(event))
    monkeypatch.setattr(sweeper, "_session_factory", lambda: owner.factory)
    stale_now = naive_utc_now() + timedelta(days=1)
    monkeypatch.setattr(sweeper, "naive_utc_now", lambda: stale_now)
    observed: dict[str, object] = {}

    class WinnerPort(ConfirmedSpyPort):
        @override
        def run_draft(
            self,
            app_id: str,
            actor: Actor,
            inputs: Inputs,
            on_event: Callable[[NodeEvent], None],
            *,
            session_id: str,
            test_input_id: str,
            on_workflow_event: Callable[[Mapping[str, object]], None] | None = None,
            confirmed_consent_id: str | None = None,
            command_id: str | None = None,
            effect_confirmation: Mapping[str, str] | None = None,
        ) -> Run:
            # A has launched: its sidecar launch identity is claimed (existing fixture stand-in).
            simulate_task6_launch(owner, reserved)
            mod.advance_session(owner.session_id, asdict(action), asdict(owner.actor), token)
            observed["lease_after_duplicate"] = session_lock.exists(owner.session_id)
            observed["swept"] = sweeper.reconcile_interrupted_sessions()
            observed["grant_during_run"] = owner.consent_row(reserved.consent_id).state
            return super().run_draft(
                app_id,
                actor,
                inputs,
                on_event,
                session_id=session_id,
                test_input_id=test_input_id,
                on_workflow_event=on_workflow_event,
                confirmed_consent_id=confirmed_consent_id,
                command_id=command_id,
                effect_confirmation=effect_confirmation,
            )

    port = WinnerPort()
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", lambda: port)

    mod.advance_session(owner.session_id, asdict(action), asdict(owner.actor), token)

    assert observed == {"lease_after_duplicate": True, "swept": 0, "grant_during_run": "confirmed"}
    assert len(port.confirmed_calls) == 1  # B never reached the port
    assert session_lock.exists(owner.session_id) is False  # A, the owner, released it
    assert repo.get_session(owner.session_id)[0].current_state == PcState.BUILD_REVIEW
    # B published no conflict/error frame; A's stream ends with its own command_finished.
    assert events[-1]["kind"] == "command_finished"
    assert all(event["kind"] != "error" for event in events)


def _fail_settlement_once(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """One transient settlement-write failure in the consent owner, then normal behavior."""
    from services.dify_builder.real_call_consent_service import BuilderRealCallConsentService

    failures: list[str] = []
    real_settle = BuilderRealCallConsentService.settle_launch

    def flaky_settle(self: BuilderRealCallConsentService, *, context: ConfirmedToolExecutionContext) -> ConsentReceipt:
        if not failures:
            failures.append(context.consent_id)
            raise RuntimeError("database write unavailable")
        return real_settle(self, context=context)

    monkeypatch.setattr(BuilderRealCallConsentService, "settle_launch", flaky_settle)
    return failures


def _sweep(monkeypatch: pytest.MonkeyPatch, owner: Owner, *, lease_held: bool = False) -> int:
    import schedule.dify_builder_reconcile_task as sweeper

    monkeypatch.setattr(sweeper, "_session_factory", lambda: owner.factory)
    stale_now = naive_utc_now() + timedelta(days=1)
    monkeypatch.setattr(sweeper, "naive_utc_now", lambda: stale_now)
    monkeypatch.setattr(sweeper.session_lock, "exists", lambda _sid: lease_held)
    monkeypatch.setattr(sweeper.progress_bus, "publish", lambda *_args: None)
    return sweeper.reconcile_interrupted_sessions()


@pytest.mark.parametrize("settlement", ["succeeds", "fails_once"])
def test_agent_setup_failure_clears_reference_and_settles_the_unclaimed_grant(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch, settlement: str
) -> None:
    owner = consent_owner
    reserved, action, token = reserve_directly(owner)
    port, order = ConfirmedSpyPort(), list[str]()
    mod, repo, _events, released = wire_worker(monkeypatch, owner, port, order)

    def broken_agent(**_kwargs: object) -> NoReturn:
        raise RuntimeError("model provider unavailable")

    monkeypatch.setattr(mod, "build_dify_builder_agent", broken_agent)
    failures: list[str] = _fail_settlement_once(monkeypatch) if settlement == "fails_once" else []

    mod.advance_session(owner.session_id, asdict(action), asdict(owner.actor), token)

    session, fc = repo.get_session(owner.session_id)
    assert session.current_state == PcState.FAILED
    assert (fc.confirmed_consent_id, fc.confirmed_command_id) == ("", "")
    assert port.confirmed_calls == []
    assert released == [token]
    row = owner.consent_row(reserved.consent_id)
    if settlement == "fails_once":
        assert failures == [reserved.consent_id]
        assert row.state == "confirmed"  # the transient write failed; nothing else touched it
        # Authoritative repair of the terminal FAILED session, without redispatch or head rewrite.
        before = repo.get_session(owner.session_id)[0].version
        assert _sweep(monkeypatch, owner) == 0  # not a stale working session
        assert repo.get_session(owner.session_id)[0].version == before
        row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.claimed_at, row.refresh_count, row.business_count) == ("failed", None, 0, 0)


def test_transient_port_settlement_failure_is_repaired_after_terminal_review(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Real port + real handler: settlement fails once, review commits, the sweeper repairs it."""
    import services.dify_builder.dify_port as port_module

    owner = consent_owner
    reserved, action, token = reserve_directly(owner)
    bind_fixture_engine(monkeypatch, owner)
    install_native_generation(owner, monkeypatch)
    port = port_module.WorkflowServiceDifyPort()
    _spy, order = ConfirmedSpyPort(), list[str]()
    mod, repo, _events, _released = wire_worker(monkeypatch, owner, _spy, order)
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", lambda: port)
    failures = _fail_settlement_once(monkeypatch)

    mod.advance_session(owner.session_id, asdict(action), asdict(owner.actor), token)

    assert failures == [reserved.consent_id]
    session, fc = repo.get_session(owner.session_id)
    assert session.current_state == PcState.BUILD_REVIEW
    assert (fc.confirmed_consent_id, fc.confirmed_command_id) == ("", "")
    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.outcome_state, row.business_count) == ("claimed", "completed", 1)

    # A live lease (an active worker) is never touched.
    _sweep(monkeypatch, owner, lease_held=True)
    assert owner.consent_row(reserved.consent_id).state == "claimed"

    before = repo.get_session(owner.session_id)[0].version
    _sweep(monkeypatch, owner)

    row = owner.consent_row(reserved.consent_id)
    # Completed from the sidecar's own sealed proof; counters untouched; no redispatch or head rewrite.
    assert (row.state, row.business_count, row.refresh_count) == ("completed", 1, 0)
    assert repo.get_session(owner.session_id)[0].version == before


def test_terminal_repair_never_selects_an_unexecuted_user_confirmation(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = consent_owner
    # An unexecuted, user-confirmed grant has no reserved command and is never selected,
    # even after its session left the waiting gate.
    unreserved = confirmed(owner)
    from models.dify_builder import DifyBuilderSession

    with owner.factory.begin() as db:
        head = db.get(DifyBuilderSession, owner.session_id)
        assert head is not None
        head.current_state = str(PcState.BUILD_REVIEW)
    _sweep(monkeypatch, owner)
    assert owner.consent_row(unreserved.consent_id).state == "confirmed"
    assert owner.consent_row(unreserved.consent_id).command_id is None


def test_terminal_repair_is_bounded_and_unknown_stays_final(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, _action, _token = reserve_directly(owner)
    context, run_id = simulate_task6_launch(owner, reserved)
    binding = owner.service().claim_tool(
        context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-exec-1"
    )
    owner.service().claim_phase(binding=binding, phase="business", final_parameters=APPROVED)
    from core.dify_builder.real_call_consent import ActionOutcome
    from models.dify_builder import DifyBuilderSession

    owner.service().finish(binding=binding, outcome=ActionOutcome(state="unknown", reason_code="stream_incomplete"))
    with owner.factory.begin() as db:
        head = db.get(DifyBuilderSession, owner.session_id)
        assert head is not None
        head.current_state = str(PcState.FAILED)

    assert owner.service().reconcile_terminal_grants(limit=0, lease_held=lambda _sid: False) == 0
    assert owner.service().reconcile_terminal_grants(limit=10, lease_held=lambda _sid: False) == 0
    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.reason_code, row.business_count) == ("unknown", "stream_incomplete", 1)


@pytest.mark.parametrize("kind", ["recovery_continue", "recovery_restart"])
def test_recovery_clears_pending_reference_and_never_reuses_the_grant(consent_owner: Owner, kind: str) -> None:
    owner = consent_owner
    reserved, _action, _token = reserve_directly(owner)
    repo = SqlDifyBuilderRepository(owner.factory)
    port = ConfirmedSpyPort()
    dify, agent, typed_repo = as_env_collaborators(port, StubAgent(), repo)
    runner = Runner(Env(dify=dify, agent=agent, repo=typed_repo, now=naive_utc_now), _registries())
    session, _fc = repo.get_session(owner.session_id)
    turn_action = Action(kind=kind, base_version=session.version)
    from core.dify_builder.models import Turn

    ordinary_refusal: str | None = None
    try:
        runner.advance(owner.session_id, Turn(action=turn_action, actor=owner.actor))
    except Exception as error:
        # The ordinary (non-confirmed) path may refuse this fixture graph; the grant must stay unused either way.
        ordinary_refusal = type(error).__name__
    _ = ordinary_refusal
    _session, fc = repo.get_session(owner.session_id)
    assert (fc.confirmed_consent_id, fc.confirmed_command_id) == ("", "")
    assert all(call["confirmed_consent_id"] is None for call in port.confirmed_calls)
    assert owner.consent_row(reserved.consent_id).claimed_at is None


def run_confirmed_handler(
    entry_mode: str, state: PcState, *, command: str = "command-1", port: "ConfirmedSpyPort | None" = None
) -> tuple["InMemoryRepository", ConfirmedSpyPort, str, str]:
    """Drive the real working handler through ``Runner`` for one reserved confirmed command.

    Uses the in-memory repository with a saved approved test input; detection
    and localization raise so any model call fails the caller's test.
    """
    from core.dify_builder.models import ConversationItem, DifyBuilderContext, EntryMode, Session, TestInput, Turn
    from tests.unit_tests.core.dify_builder.fakes import InMemoryRepository

    def no_detection(_text: str) -> NoReturn:
        raise AssertionError("confirmed outcome must not detect a language with a model")

    def no_localization(_items: list[ConversationItem], _language: str) -> NoReturn:
        raise AssertionError("confirmed outcome must not localize with a model")

    repo = InMemoryRepository()
    port = port if port is not None else ConfirmedSpyPort()
    dify, agent, typed_repo = as_env_collaborators(port, NoModelAgent(), repo)
    env = Env(
        dify=dify,
        agent=agent,
        repo=typed_repo,
        now=lambda: datetime.min,
        detect_language=no_detection,
    )
    session = Session(
        app_id="app-1",
        tenant_id="tenant-1",
        owner_account_id="actor-1",
        entry_mode=EntryMode(entry_mode),
        current_state=state,
    )
    test_input = TestInput(session_id=session.id, source="user", inputs={"note": "saved"})
    repo.create_session(
        session,
        DifyBuilderContext(
            confirmed_consent_id="consent-1",
            confirmed_command_id="command-1",
            reply_language="fr",
            goal_text="read one message",
        ),
        [],
    )
    repo.save_test_input(test_input)
    _s, fc = repo.get_session(session.id)
    fc.test_input_ref = test_input.id
    repo._contexts[session.id] = fc
    actor = Actor(account_id="actor-1", tenant_id="tenant-1")
    action = Action(kind=CONFIRMED_TOOL_ACTION, base_version=_s.version, command_id=command)
    Runner(env, _registries()).advance(session.id, Turn(action=action, actor=actor))
    return repo, port, session.id, test_input.id


def assert_confirmed_handler_outcome(entry_mode: str, state: PcState, review: PcState) -> None:
    repo, port, session_id, test_input_id = run_confirmed_handler(entry_mode, state)
    [call] = port.confirmed_calls
    assert call == {
        "inputs": {"note": "saved"},
        "test_input_id": test_input_id,
        "confirmed_consent_id": "consent-1",
        "command_id": "command-1",
    }
    session, fc = repo.get_session(session_id)
    assert session.current_state == review
    assert (fc.confirmed_consent_id, fc.confirmed_command_id) == ("", "")
    assert fc.staged_repair == []
    assert fc.diagnosis is None
    assert fc.last_command_id == "command-1"
    run = repo.get_run(fc.verify_run_id)
    assert run.inputs_ref == test_input_id
    assert run.immutable
    cards = [item for item in repo.list_conversation(session_id) if item.kind == "test_result"]
    assert [card.payload["safety_outcome"] for card in cards] == ["confirmed_tool_completed"]
    assert cards[0].payload["terminal_outputs"] is None


def _registries() -> dict[PcState, Handler]:
    from services.dify_builder.application.handlers_build import build_registry
    from services.dify_builder.application.handlers_edit import edit_registry
    from services.dify_builder.application.handlers_fix import fix_registry

    return fix_registry() | build_registry() | edit_registry()


# --- native proof, sealing and settlement --------------------------------------------------


def launched(owner: Owner) -> tuple[ConsentReceipt, ConfirmedToolExecutionContext, str, "ConfirmedLaunchRecorder"]:
    """Reserve through dispatch, revalidate the sidecar, claim launch and build the launch recorder.

    The run ID is a uuid4 fixture launch identity, not a Graphon-allocated native ID.
    """
    from services.dify_builder.dify_port import ConfirmedLaunchRecorder

    reserved, _action, _token = reserve_through_dispatch(owner)
    policy = BuilderExecutionPolicyService(owner.factory)
    context = policy.prepare_confirmed(stored_context(owner, reserved.execution_request_id))
    run_id = str(uuid4())
    policy.claim_launch(context=context, native_run_id=run_id, task_id="task")
    recorder = ConfirmedLaunchRecorder(
        policy.recorder(context=context, native_run_id=run_id, task_id="task"), owner.service(), context, run_id
    )
    return reserved, context, run_id, recorder


def native_rows(owner: Owner, run_id: str, tool_execution_id: str, *, status: str = "succeeded") -> None:
    with owner.factory.begin() as db:
        workflow = db.get(Workflow, owner.workflow_id)
        assert workflow is not None
        db.add(
            WorkflowRun(
                id=run_id,
                tenant_id=owner.actor.tenant_id,
                app_id=owner.app_id,
                workflow_id=owner.workflow_id,
                type="workflow",
                triggered_from="debugging",
                version="draft",
                graph=workflow.graph,
                inputs=json.dumps({"note": "hello", "sys.workflow_run_id": run_id}),
                status=status,
                created_by_role="account",
                created_by=owner.actor.account_id,
                total_steps=3,
                finished_at=datetime.now(),
                outputs=json.dumps({"result": {"message": BODY_SENTINEL}}),
                exceptions_count=0,
            )
        )
        for index, node in enumerate(json.loads(workflow.graph)["nodes"], 1):
            db.add(
                WorkflowNodeExecutionModel(
                    id=str(uuid4()),
                    tenant_id=owner.actor.tenant_id,
                    app_id=owner.app_id,
                    workflow_id=owner.workflow_id,
                    workflow_run_id=run_id,
                    node_execution_id=tool_execution_id if node["id"] == "tool" else str(uuid4()),
                    node_id=node["id"],
                    node_type=node["data"]["type"],
                    title="test",
                    index=index,
                    predecessor_node_id=None,
                    triggered_from="workflow-run",
                    created_by_role="account",
                    created_by=owner.actor.account_id,
                    status="succeeded" if status == "succeeded" or node["id"] != "end" else "failed",
                    finished_at=datetime.now(),
                    outputs=json.dumps({"text": BODY_SENTINEL}),
                )
            )


def done(context: ConfirmedToolExecutionContext, run_id: str, **changes: object) -> TrustedExecutionCompletion:
    values: dict[str, object] = {
        "context": context,
        "native_run_id": run_id,
        "task_id": "task",
        "worker_finished": True,
        "worker_exit": "returned",
        "recorder_healthy": True,
        "response_completed": True,
        **changes,
    }
    return TrustedExecutionCompletion.model_validate(values)


SUCCESS_JSON: dict[str, object] = {
    "message": {"id": APPROVED.message_id, "snippet": BODY_SENTINEL},
    "message_id": APPROVED.message_id,
}


def dispatched(
    recorder: "ConfirmedLaunchRecorder",
    *,
    messages: tuple[Mapping[str, object], ...] = (SUCCESS_JSON,),
    complete: bool = True,
    node_execution_id: str = "node-exec-1",
) -> "ServiceConfirmedToolGuard":
    guard = recorder.confirmed_guard(
        node_id="tool", native_run_id=recorder.native_run_id, native_node_execution_id=node_execution_id
    )
    guard.before_invoke(APPROVED.model_dump())
    for message in messages:
        guard.observe_json(message)
    guard.finish_stream(complete=complete, declared_failure=False)
    return guard


def seal_and_settle(
    owner: Owner, context: ConfirmedToolExecutionContext, completion: TrustedExecutionCompletion
) -> tuple[ExecutionEvidenceSummary, ConsentReceipt]:
    summary = BuilderExecutionPolicyService(owner.factory).seal(request_id=context.request_id, completion=completion)
    receipt = owner.service().settle_launch(context=context)
    return summary, receipt


def test_completed_seal_requires_matching_native_rows_healthy_recorder_and_completed_action(
    consent_owner: Owner,
) -> None:
    owner = consent_owner
    reserved, context, run_id, recorder = launched(owner)
    dispatched(recorder)
    native_rows(owner, run_id, "node-exec-1")

    summary, receipt = seal_and_settle(owner, context, done(context, run_id))

    assert summary.safety_outcome == "confirmed_tool_completed"
    assert (summary.mode, summary.policy_version, summary.sealed) == (
        "confirmed_tool",
        "builder-confirmed-gmail-read-v1",
        True,
    )
    assert (summary.consent_id, summary.action_state, summary.action_reason_code) == (
        reserved.consent_id,
        "completed",
        "message_returned",
    )
    assert summary.native_run_id == run_id
    assert (receipt.state, receipt.native_run_id) == ("completed", run_id)
    row = owner.consent_row(reserved.consent_id)
    assert (row.business_count, row.refresh_count) == (1, 0)
    assert not any(s in json.dumps(summary.model_dump(mode="json")) for s in SENTINELS)


@pytest.mark.parametrize("mismatch", ["node_execution", "recorder", "native_failed", "response"])
def test_mismatched_or_incomplete_proof_never_seals_completed(consent_owner: Owner, mismatch: str) -> None:
    owner = consent_owner
    reserved, context, run_id, recorder = launched(owner)
    dispatched(recorder)
    native_rows(
        owner,
        run_id,
        "other-node-exec" if mismatch == "node_execution" else "node-exec-1",
        status="failed" if mismatch == "native_failed" else "succeeded",
    )
    changes: dict[str, object] = {}
    if mismatch == "recorder":
        changes["recorder_healthy"] = False
    if mismatch == "response":
        changes["response_completed"] = False

    summary, receipt = seal_and_settle(owner, context, done(context, run_id, **changes))

    assert summary.safety_outcome == "execution_evidence_unknown"
    assert receipt.state == "unknown"
    row = owner.consent_row(reserved.consent_id)
    # The candidate is never upgraded, and spent counters are never reset.
    assert (row.state, row.business_count) == ("unknown", 1)


@pytest.mark.parametrize(
    ("messages", "complete", "reason"),
    [((SUCCESS_JSON,), False, "stream_incomplete"), ((), True, "result_missing")],
)
def test_native_success_with_unknown_action_outcome_stays_unknown(
    consent_owner: Owner, messages: tuple[Mapping[str, object], ...], complete: bool, reason: str
) -> None:
    owner = consent_owner
    reserved, context, run_id, recorder = launched(owner)
    dispatched(recorder, messages=messages, complete=complete)
    native_rows(owner, run_id, "node-exec-1")

    summary, receipt = seal_and_settle(owner, context, done(context, run_id))

    assert summary.safety_outcome == "execution_evidence_unknown"
    assert (summary.action_state, summary.action_reason_code) == ("unknown", reason)
    assert receipt.state == "unknown"
    # Unknown is final: a later identical seal/settle never downgrades or upgrades it.
    assert seal_and_settle(owner, context, done(context, run_id))[1].state == "unknown"


def test_terminal_expiry_does_not_erase_a_completed_dispatched_read(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = consent_owner
    reserved, context, run_id, recorder = launched(owner)
    guard = recorder.confirmed_guard(node_id="tool", native_run_id=run_id, native_node_execution_id="node-exec-1")
    guard.before_invoke(APPROVED.model_dump())
    shift_clock(monkeypatch, timedelta(minutes=30))
    guard.observe_json(SUCCESS_JSON)
    guard.finish_stream(complete=True, declared_failure=False)
    native_rows(owner, run_id, "node-exec-1")

    summary, receipt = seal_and_settle(owner, context, done(context, run_id))

    assert summary.safety_outcome == "confirmed_tool_completed"
    assert receipt.state == "completed"


def test_stranded_pre_retention_claim_is_conservatively_unknown(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, context, run_id, recorder = launched(owner)
    # The factory claimed, then native validation failed before any phase or retention.
    recorder.confirmed_guard(node_id="tool", native_run_id=run_id, native_node_execution_id="node-exec-1")

    summary, receipt = seal_and_settle(
        owner, context, done(context, run_id, worker_exit="failed", response_completed=False)
    )

    assert summary.safety_outcome == "execution_evidence_unknown"
    assert receipt.state == "unknown"
    row = owner.consent_row(reserved.consent_id)
    assert (row.refresh_count, row.business_count, row.claimed_at is not None) == (0, 0, True)


def test_outcome_recording_db_failure_stays_unknown_without_resetting_counters(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = consent_owner
    reserved, context, run_id, recorder = launched(owner)
    service = recorder.consent

    def failing_finish(**_kwargs: object) -> NoReturn:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(service, "finish", failing_finish)
    with pytest.raises(RuntimeError):
        dispatched(recorder)
    native_rows(owner, run_id, "node-exec-1")

    summary, receipt = seal_and_settle(owner, context, done(context, run_id))

    assert summary.safety_outcome == "execution_evidence_unknown"
    assert receipt.state == "unknown"
    assert owner.consent_row(reserved.consent_id).business_count == 1


def _head_version(owner: Owner) -> int:
    return SqlDifyBuilderRepository(owner.factory).get_session(owner.session_id)[0].version


def _reconcile_observed(owner: Owner) -> int:
    """Observe the stale session's reserved grants, then settle exactly those (the sweeper's order)."""
    service = owner.service()
    observation = service.observe_stranded(session_id=owner.session_id, session_version=_head_version(owner))
    assert observation is not None
    return service.reconcile_stranded(observation=observation)


def test_reserved_but_never_launched_settles_failed_before_any_claim(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, _action, _token = reserve_through_dispatch(owner)

    assert _reconcile_observed(owner) == 1

    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.claimed_at, row.refresh_count, row.business_count) == ("failed", None, 0, 0)
    assert row.reason_code == "launch_stranded"
    # Idempotent and never redispatched.
    assert _reconcile_observed(owner) == 0


def test_reconcile_after_spent_phase_is_unknown_and_final(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, context, run_id, recorder = launched(owner)
    guard = recorder.confirmed_guard(node_id="tool", native_run_id=run_id, native_node_execution_id="node-exec-1")
    guard.before_invoke(APPROVED.model_dump())

    assert _reconcile_observed(owner) == 1

    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.business_count) == ("unknown", 1)
    assert _reconcile_observed(owner) == 0
    assert owner.consent_row(reserved.consent_id).state == "unknown"


def _recover_to_waiting_gate(owner: Owner) -> None:
    """Deterministic repository-CAS race fixture; actual dispatched recovery is CI-owned."""
    repo = SqlDifyBuilderRepository(owner.factory)
    session, fc = repo.get_session(owner.session_id)
    fc.confirmed_consent_id, fc.confirmed_command_id = "", ""
    repo.compare_and_advance(owner.session_id, session.version, PcState.BUILD_AWAIT_TESTDATA, fc, [])


def test_stale_sweep_settles_only_the_grant_it_observed_never_a_fresh_reservation(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Between the sweep's observation and its settlement, recovery and a fresh coordinator
    reservation commit with a new live lease. Only the observed stranded grant settles, once."""
    import schedule.dify_builder_reconcile_task as sweeper

    owner = consent_owner
    lease, enqueue = SpyLease(), SpyEnqueue()
    dispatcher = builder(owner, lease, enqueue)
    stranded = execute(dispatcher, owner, confirmed(owner))
    lease.release(owner.session_id, enqueue.calls[0][3])  # its dispatch lease expired; the delivery never ran
    fresh: list[ConsentReceipt] = []
    fresh_head: list[tuple[int, PcState, str, str]] = []

    def lease_check_then_interleave(session_id: str) -> bool:
        held = lease.exists(session_id)
        if session_id == owner.session_id and not fresh:
            _recover_to_waiting_gate(owner)
            fresh_grant = confirm(
                owner,
                prepare(owner, idempotency_key="prepare-fresh", at_version=_head_version(owner)),
                idempotency_key="confirm-fresh",
            )
            fresh.append(execute(dispatcher, owner, fresh_grant, key="execute-fresh"))
            session, fc = SqlDifyBuilderRepository(owner.factory).get_session(owner.session_id)
            fresh_head.append(
                (session.version, session.current_state, fc.confirmed_consent_id, fc.confirmed_command_id)
            )
        return held

    monkeypatch.setattr(sweeper, "_session_factory", lambda: owner.factory)
    stale_now = naive_utc_now() + timedelta(days=1)
    monkeypatch.setattr(sweeper, "naive_utc_now", lambda: stale_now)
    monkeypatch.setattr(sweeper.session_lock, "exists", lease_check_then_interleave)
    monkeypatch.setattr(sweeper.progress_bus, "publish", lambda *_args: None)

    sweeper.reconcile_interrupted_sessions()

    assert len(fresh) == 1
    live = owner.consent_row(fresh[0].consent_id)
    assert (live.state, live.command_id, live.reason_code, live.claimed_at) == (
        "confirmed",
        fresh[0].command_id,
        None,
        None,
    )
    assert lease.holder[owner.session_id] == enqueue.calls[1][3]
    session, fc = SqlDifyBuilderRepository(owner.factory).get_session(owner.session_id)
    assert [(session.version, session.current_state, fc.confirmed_consent_id, fc.confirmed_command_id)] == fresh_head
    with owner.factory() as db:
        request = db.get(DifyBuilderExecutionRequest, fresh[0].execution_request_id)
        assert request is not None
        assert (request.state, request.native_run_id, request.task_id) == ("prepared", None, None)
    assert (live.refresh_count, live.business_count) == (0, 0)
    old = owner.consent_row(stranded.consent_id)
    assert (old.state, old.reason_code, old.claimed_at, old.refresh_count, old.business_count) == (
        "failed",
        "launch_stranded",
        None,
        0,
        0,
    )
    # A later sweep while the fresh lease is live changes nothing; nothing was redispatched.
    sweeper.reconcile_interrupted_sessions()
    assert owner.consent_row(fresh[0].consent_id).state == "confirmed"
    assert owner.consent_row(stranded.consent_id).updated_at == old.updated_at
    assert len(enqueue.calls) == 2


def test_observation_excludes_reservations_after_its_session_version(consent_owner: Owner) -> None:
    owner = consent_owner
    observed_version = _head_version(owner)
    reserved, _action, _token = reserve_through_dispatch(owner)

    observation = owner.service().observe_stranded(session_id=owner.session_id, session_version=observed_version)

    # The session moved past the observed version: nothing of it is this sweep's to settle.
    assert observation is None
    assert owner.consent_row(reserved.consent_id).state == "confirmed"


def test_grant_progressed_after_observation_is_not_settled(consent_owner: Owner) -> None:
    """A worker that launched and claimed after the sweep's observation keeps its grant."""
    owner = consent_owner
    reserved, _action, _token = reserve_through_dispatch(owner)
    service = owner.service()
    observation = service.observe_stranded(session_id=owner.session_id, session_version=_head_version(owner))
    assert observation is not None
    assert [grant.consent_id for grant in observation.grants] == [reserved.consent_id]
    context, run_id = simulate_task6_launch(owner, reserved)
    service.claim_tool(context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-exec-1")

    assert service.reconcile_stranded(observation=observation) == 0

    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.reason_code, row.native_run_id) == ("claimed", None, run_id)


@pytest.mark.parametrize("progress", ["launch", "refresh_claim", "refresh_finish", "business_claim", "outcome"])
def test_stale_observation_never_settles_a_progressing_worker(consent_owner: Owner, progress: str) -> None:
    """Real launch/phase/CAS/outcome writes after observation invalidate that sweep's snapshot."""
    from core.dify_builder.real_call_consent import ActionOutcome

    owner = consent_owner
    reserved, _action, _token = reserve_through_dispatch(owner)
    service = owner.service()
    binding = None
    if progress != "launch":
        context, run_id = simulate_task6_launch(owner, reserved)
        binding = service.claim_tool(
            context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-exec-1"
        )
        if progress == "refresh_finish":
            service.claim_phase(binding=binding, phase="refresh", final_parameters=None)
        elif progress == "outcome":
            service.claim_phase(binding=binding, phase="business", final_parameters=APPROVED)
    observation = service.observe_stranded(session_id=owner.session_id, session_version=_head_version(owner))
    assert observation is not None

    if progress == "launch":
        simulate_task6_launch(owner, reserved)
    else:
        assert binding is not None
        if progress == "refresh_finish":
            service.finish_refresh(
                binding=binding,
                old_revision=owner.consent_row(reserved.consent_id).initial_credential_revision,
                encrypted_credentials='{"access_token":"new-encrypted-token"}',
                expires_at=1_900_000_001,
            )
        elif progress == "outcome":
            service.finish(binding=binding, outcome=ActionOutcome(state="completed", reason_code="message_returned"))
        else:
            phase = "refresh" if progress == "refresh_claim" else "business"
            service.claim_phase(binding=binding, phase=phase, final_parameters=None if phase == "refresh" else APPROVED)

    before = owner.consent_row(reserved.consent_id)
    assert service.reconcile_stranded(observation=observation) == 0
    after = owner.consent_row(reserved.consent_id)
    assert (after.state, after.reason_code, after.refresh_count, after.business_count, after.updated_at) == (
        before.state,
        before.reason_code,
        before.refresh_count,
        before.business_count,
        before.updated_at,
    )


def test_stale_observation_cannot_downgrade_a_newly_sealed_native_completion(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, context, run_id, recorder = launched(owner)
    dispatched(recorder)
    service = owner.service()
    observation = service.observe_stranded(session_id=owner.session_id, session_version=_head_version(owner))
    assert observation is not None
    native_rows(owner, run_id, "node-exec-1")

    summary = BuilderExecutionPolicyService(owner.factory).seal(
        request_id=context.request_id, completion=done(context, run_id)
    )
    assert summary.safety_outcome == "confirmed_tool_completed"
    assert service.reconcile_stranded(observation=observation) == 0
    assert owner.consent_row(reserved.consent_id).state == "claimed"

    # The worker's own terminal settlement still records the sealed success exactly once.
    assert service.settle_launch(context=context).state == "completed"
    final = owner.consent_row(reserved.consent_id)
    assert service.reconcile_stranded(observation=observation) == 0
    after = owner.consent_row(reserved.consent_id)
    assert (after.state, after.refresh_count, after.business_count, after.updated_at) == (
        "completed",
        0,
        1,
        final.updated_at,
    )


@pytest.mark.parametrize("phase", [None, "refresh", "business"])
def test_same_stranded_observation_settles_a_claimed_grant_once_without_reopening(
    consent_owner: Owner, phase: Literal["refresh", "business"] | None
) -> None:
    """Unchanged old claims settle unknown; repeating the original observation cannot reset a spend."""
    owner = consent_owner
    reserved, _action, _token = reserve_through_dispatch(owner)
    context, run_id = simulate_task6_launch(owner, reserved)
    service = owner.service()
    binding = service.claim_tool(
        context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-exec-1"
    )
    if phase is not None:
        service.claim_phase(binding=binding, phase=phase, final_parameters=APPROVED if phase == "business" else None)
    observation = service.observe_stranded(session_id=owner.session_id, session_version=_head_version(owner))
    assert observation is not None
    before = owner.consent_row(reserved.consent_id)

    assert service.reconcile_stranded(observation=observation) == 1
    assert service.reconcile_stranded(observation=observation) == 0

    after = owner.consent_row(reserved.consent_id)
    assert (after.state, after.reason_code) == ("unknown", "launch_stranded")
    assert (
        after.claimed_at,
        after.refresh_claimed_at,
        after.business_claimed_at,
        after.refresh_count,
        after.business_count,
    ) == (
        before.claimed_at,
        before.refresh_claimed_at,
        before.business_claimed_at,
        int(phase == "refresh"),
        int(phase == "business"),
    )
    with pytest.raises(BuilderExecutionPolicyError):
        service.claim_phase(binding=binding, phase="business", final_parameters=APPROVED)


def test_publication_accepts_only_sealed_exact_revision_confirmed_success() -> None:
    def run(
        outcome: SafetyOutcome,
        *,
        sealed: bool = True,
        action: Literal["completed", "unknown"] = "completed",
        revision: str = "r1",
    ) -> Run:
        summary = ExecutionEvidenceSummary(
            request_id="request-1",
            policy_version="builder-confirmed-gmail-read-v1",
            mode="confirmed_tool",
            sealed=True,
            safety_outcome=outcome,
            sandbox_profile="disabled",
            native_run_id="native-1",
            consent_id="consent-1",
            action_state=action,
            action_reason_code="message_returned",
        )
        if not sealed:
            # The model refuses an unsealed completion; a forged copy must still be refused here.
            summary = summary.model_copy(update={"sealed": False})
        return Run(
            id="run-1",
            session_id="s-1",
            kind="verify",
            immutable=True,
            status="succeeded",
            dify_run_id="native-1",
            verification=RunVerification(
                execution_revision=revision,
                executed_graph_revision="g1",
                terminal_outputs=None,
                output_findings=[],
                executed_node_ids=["start", "tool", "end"],
                no_output_dead_branch=False,
                execution_evidence=summary,
            ),
        )

    def decide(candidate: Run) -> PublicationDecision:
        return publication_decision(candidate, session_id="s-1", current_revision="r1", current_graph_revision="g1")

    assert decide(run("confirmed_tool_completed")).allowed is True
    assert decide(run("confirmed_tool_completed", sealed=False)).allowed is False
    assert decide(run("confirmed_tool_completed", revision="stale")).reason == "stale_revision"
    assert decide(run("execution_evidence_unknown", action="unknown")).allowed is False


# --- sanitization of Builder-side projections ----------------------------------------------


def test_confirmed_builder_projections_carry_ids_status_and_reasons_only(caplog: pytest.LogCaptureFixture) -> None:
    from services.dify_builder.run_mapping import (
        sanitize_confirmed_node_event,
        sanitize_confirmed_run,
        sanitize_confirmed_stream_event,
    )

    caplog.set_level(logging.DEBUG)
    raw = Run(
        dify_run_id="native-1",
        status="failed",
        error=PROVIDER_ERROR_SENTINEL,
        per_node=[
            NodeOutput(
                node_id="tool",
                title=BODY_SENTINEL,
                status="failed",
                error=PROVIDER_ERROR_SENTINEL,
                inputs={"token": TOKEN_SENTINEL},
                outputs={"text": BODY_SENTINEL},
                outputs_available=True,
            )
        ],
        verification=RunVerification(
            execution_revision="r1",
            executed_graph_revision="g1",
            terminal_outputs={"result": BODY_SENTINEL},
            output_findings=[],
            executed_node_ids=["start", "tool"],
            no_output_dead_branch=False,
        ),
    )
    run = sanitize_confirmed_run(raw)
    frame = sanitize_confirmed_stream_event(
        {
            "event": "node_finished",
            "workflow_run_id": "native-1",
            "task_id": "task",
            "data": {
                "id": "node-exec-1",
                "node_id": "tool",
                "node_type": "tool",
                "title": BODY_SENTINEL,
                "status": "failed",
                "inputs": {"token": TOKEN_SENTINEL},
                "outputs": {"text": BODY_SENTINEL},
                "error": PROVIDER_ERROR_SENTINEL,
                "execution_metadata": {"tool_info": {"credential": TOKEN_SENTINEL}},
            },
        }
    )
    event = sanitize_confirmed_node_event(
        NodeEvent(node_id="tool", title=BODY_SENTINEL, status="failed", error=PROVIDER_ERROR_SENTINEL, run_id="n")
    )
    card: TestResultCard = result_card(run)
    text = json.dumps([asdict(run), frame, asdict(event), asdict(card)], default=str) + caplog.text

    assert not any(sentinel in text for sentinel in SENTINELS)
    assert run.verification is not None
    assert run.verification.terminal_outputs is None
    assert [(n.node_id, n.status) for n in run.per_node] == [("tool", "failed")]
    assert frame == {
        "event": "node_finished",
        "workflow_run_id": "native-1",
        "data": {"id": "node-exec-1", "node_id": "tool", "node_type": "tool", "status": "failed"},
    }
    assert (event.node_id, event.status, event.run_id) == ("tool", "failed", "n")


def test_terminal_outputs_are_not_copied_even_when_native_run_retains_content(consent_owner: Owner) -> None:
    owner = consent_owner
    _reserved, context, run_id, recorder = launched(owner)
    dispatched(recorder)
    native_rows(owner, run_id, "node-exec-1")
    with owner.factory() as db:
        retained = db.get(WorkflowRun, run_id)
        assert retained is not None
        assert BODY_SENTINEL in (retained.outputs or "")
    summary, _receipt = seal_and_settle(owner, context, done(context, run_id))
    text = json.dumps(summary.model_dump(mode="json"))
    assert BODY_SENTINEL not in text


@dataclass(frozen=True)
class ConfirmedDatabase:
    engine: object
    session: object | None = None


def bind_fixture_engine(monkeypatch: pytest.MonkeyPatch, owner: Owner) -> None:
    """Point the port's and WorkflowService's engine owners at the fixture SQLite engine (no Flask app)."""

    import services.dify_builder.dify_port as port_module
    import services.workflow_service as workflow_service_module

    engine = ConfirmedDatabase(engine=owner.factory.kw["bind"])
    monkeypatch.setattr(port_module, "_session_factory", lambda: owner.factory)
    monkeypatch.setattr(port_module, "db", engine)
    monkeypatch.setattr(workflow_service_module, "db", engine)
    monkeypatch.setattr(port_module, "set_login_user", lambda _account: None)


def install_native_generation(owner: Owner, monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Replace only native generation: real admission → launch claim → recorder → guard → native rows.

    The worker thread runs the real admission callback, dispatches the approved read through
    the service guard, writes fixture native Run/node rows and reports completion, exactly as
    the port e2e test does. Returns the fixture native Run IDs (uuid4, not Graphon-allocated).
    """
    import threading

    from sqlalchemy.orm import Session

    import services.dify_builder.dify_port as port_module
    from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
    from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
    from models.account import Account
    from models.model import App
    from services.dify_builder.dify_port import ConfirmedLaunchRecorder
    from services.workflow_runtime.workflow_generator import BuilderExecutionAdmission

    run_ids: list[str] = []

    def native_generate(
        *,
        app_model: App,
        user: Account,
        args: Mapping[str, Mapping[str, object]],
        invoke_from: InvokeFrom,
        session: Session,
        builder_execution: ConfirmedToolExecutionContext,
        builder_execution_admit: BuilderExecutionAdmission,
        **_kw: object,
    ) -> Iterator[str]:
        _ = (user, invoke_from, session)
        run_id = str(uuid4())
        run_ids.append(run_id)
        with owner.factory() as db:
            workflow = db.get(Workflow, owner.workflow_id)
        assert workflow is not None
        entity = WorkflowAppGenerateEntity(
            builder_execution=builder_execution,
            files=[],
            single_iteration_run=None,
            single_loop_run=None,
            invoke_from=InvokeFrom.DEBUGGER,
            app_config=WorkflowAppConfigManager.get_app_config(app_model, workflow),
            user_id=owner.actor.account_id,
            inputs=dict(args["inputs"]),
            call_depth=0,
            workflow_execution_id=run_id,
            task_id="task",
            stream=True,
        )

        def worker() -> None:
            builder_execution_admit.admit_raw(workflow, app_model)
            recorder = builder_execution_admit(
                workflow, app_model, cast(WorkflowAppGenerateEntity, entity), "start", False
            )
            assert isinstance(recorder, ConfirmedLaunchRecorder)
            dispatched(recorder)
            native_rows(owner, run_id, "node-exec-1")
            builder_execution_admit.on_worker_finished(
                context=builder_execution,
                native_run_id=run_id,
                task_id="task",
                recorder=recorder,
                worker_thread=threading.current_thread(),
                exit_kind="returned",
            )

        thread = threading.Thread(target=worker)
        thread.start()
        thread.join()
        return iter(_native_frames(run_id))

    monkeypatch.setattr(port_module.AppGenerateService, "generate", native_generate)
    return run_ids


def _native_frames(run_id: str) -> list[str]:
    """SSE frames a native workflow stream would carry, with body/token/provider sentinels."""
    frames = [
        {
            "event": "workflow_started",
            "workflow_run_id": run_id,
            "task_id": "task",
            "data": {"id": run_id, "inputs": {"note": BODY_SENTINEL}},
        },
        {
            "event": "node_finished",
            "workflow_run_id": run_id,
            "task_id": "task",
            "data": {
                "id": "node-exec-1",
                "node_id": "tool",
                "node_type": "tool",
                "title": "Get message",
                "status": "succeeded",
                "outputs": {"text": BODY_SENTINEL, "json": [{"token": TOKEN_SENTINEL}]},
                "error": PROVIDER_ERROR_SENTINEL,
            },
        },
        {
            "event": "workflow_finished",
            "workflow_run_id": run_id,
            "task_id": "task",
            "data": {"id": run_id, "status": "succeeded", "outputs": {"result": BODY_SENTINEL}},
        },
    ]
    return [f"data: {json.dumps(frame)}\n\n" for frame in frames]


def test_port_launches_reserved_command_natively_and_projects_sanitized_builder_run(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The actual port/admission/recorder/seal/settle chain on real rows; only native generation is faked."""
    import threading

    from sqlalchemy.orm import Session

    import services.dify_builder.dify_port as port_module
    from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
    from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
    from models.account import Account
    from models.model import App
    from services.dify_builder.dify_port import ConfirmedLaunchRecorder
    from services.workflow_runtime.workflow_generator import BuilderExecutionAdmission

    caplog.set_level(logging.DEBUG)
    owner = consent_owner
    reserved, _action, _token = reserve_through_dispatch(owner)
    bind_fixture_engine(monkeypatch, owner)
    open_sessions: list[bool] = []
    generated: list[dict[str, Mapping[str, object]]] = []
    users: list[str] = []

    def native_generate(
        *,
        app_model: App,
        user: Account,
        args: Mapping[str, Mapping[str, object]],
        invoke_from: InvokeFrom,
        session: Session,
        builder_execution: ConfirmedToolExecutionContext,
        builder_execution_admit: BuilderExecutionAdmission,
        **kw: object,
    ) -> Iterator[str]:
        users.append(user.id)
        assert kw["workflow_execution_mode"] == "in_process"
        assert kw["streaming"] is True
        assert invoke_from == InvokeFrom.DEBUGGER
        generated.append(dict(args))
        open_sessions.append(session.in_transaction())
        launch, context, run_id = builder_execution_admit, builder_execution, str(uuid4())
        with owner.factory() as db:
            workflow = db.get(Workflow, owner.workflow_id)
        assert workflow is not None
        # Duck-typed generate entity carrying exactly the attributes the admission reads.
        entity = WorkflowAppGenerateEntity(
            builder_execution=context,
            files=[],
            single_iteration_run=None,
            single_loop_run=None,
            invoke_from=InvokeFrom.DEBUGGER,
            app_config=WorkflowAppConfigManager.get_app_config(app_model, workflow),
            user_id=owner.actor.account_id,
            inputs=dict(args["inputs"]),
            call_depth=0,
            workflow_execution_id=run_id,
            task_id="task",
            stream=True,
        )

        def worker() -> None:
            launch.admit_raw(workflow, app_model)
            recorder = launch(workflow, app_model, cast(WorkflowAppGenerateEntity, entity), "start", False)
            assert isinstance(recorder, ConfirmedLaunchRecorder)
            dispatched(recorder)
            native_rows(owner, run_id, "node-exec-1")
            launch.on_worker_finished(
                context=context,
                native_run_id=run_id,
                task_id="task",
                recorder=recorder,
                worker_thread=threading.current_thread(),
                exit_kind="returned",
            )

        thread = threading.Thread(target=worker)
        thread.start()
        thread.join()
        return iter(_native_frames(run_id))

    monkeypatch.setattr(port_module.AppGenerateService, "generate", native_generate)
    forwarded: list[Mapping[str, object]] = []
    node_events: list[NodeEvent] = []

    run = port_module.WorkflowServiceDifyPort().run_draft(
        owner.app_id,
        owner.actor,
        {"note": "hello"},
        node_events.append,
        session_id=owner.session_id,
        test_input_id=owner.test_input_id,
        on_workflow_event=forwarded.append,
        confirmed_consent_id=reserved.consent_id,
        command_id=reserved.command_id,
    )

    assert generated == [{"inputs": {"note": "hello"}}]
    assert users == [owner.actor.account_id]
    assert open_sessions == [False]  # Builder preparation transactions are closed before generation
    assert run.verification is not None
    assert run.verification.execution_evidence is not None
    summary = run.verification.execution_evidence
    assert (summary.safety_outcome, summary.consent_id) == ("confirmed_tool_completed", reserved.consent_id)
    assert run.status == "succeeded"
    assert run.dify_run_id == summary.native_run_id
    assert run.verification.terminal_outputs is None
    assert owner.consent_row(reserved.consent_id).state == "completed"
    text = json.dumps([asdict(run), list(forwarded), [asdict(e) for e in node_events]], default=str) + caplog.text
    assert not any(sentinel in text for sentinel in SENTINELS)
    assert [frame["event"] for frame in forwarded] == ["workflow_started", "node_finished", "workflow_finished"]


def test_port_refuses_unreserved_or_mismatched_command_before_generation(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:

    import services.dify_builder.dify_port as port_module

    owner = consent_owner
    reserved, _action, _token = reserve_through_dispatch(owner)
    bind_fixture_engine(monkeypatch, owner)
    calls: list[object] = []
    monkeypatch.setattr(port_module.AppGenerateService, "generate", lambda **kw: calls.append(kw))

    run = port_module.WorkflowServiceDifyPort().run_draft(
        owner.app_id,
        owner.actor,
        {"note": "hello"},
        lambda _event: None,
        session_id=owner.session_id,
        test_input_id=owner.test_input_id,
        confirmed_consent_id=reserved.consent_id,
        command_id=str(uuid4()),
    )

    assert calls == []
    assert run.execution_refusal is not None
    assert run.dify_run_id == ""
    assert owner.consent_row(reserved.consent_id).claimed_at is None


def test_duplicate_port_launch_never_settles_the_winning_launch(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    import services.dify_builder.dify_port as port_module

    owner = consent_owner
    reserved, _context, _run_id, recorder = launched(owner)
    recorder.confirmed_guard(node_id="tool", native_run_id=recorder.native_run_id, native_node_execution_id="n-1")
    bind_fixture_engine(monkeypatch, owner)
    calls: list[object] = []
    monkeypatch.setattr(port_module.AppGenerateService, "generate", lambda **kw: calls.append(kw))

    run = port_module.WorkflowServiceDifyPort().run_draft(
        owner.app_id,
        owner.actor,
        {"note": "hello"},
        lambda _event: None,
        session_id=owner.session_id,
        test_input_id=owner.test_input_id,
        confirmed_consent_id=reserved.consent_id,
        command_id=reserved.command_id,
    )

    assert calls == []
    assert run.execution_refusal is not None
    assert run.execution_refusal.reason_code == "execution_already_launched"
    # The winner's claimed grant is untouched by the duplicate.
    assert owner.consent_row(reserved.consent_id).state == "claimed"


def test_handler_commits_nothing_for_a_delivery_that_lost_the_launch() -> None:
    from core.dify_builder.errors import ConflictError

    lost = BuilderExecutionRefusal(reason_code="execution_already_claimed")
    with pytest.raises(ConflictError):
        run_confirmed_handler("build", PcState.BUILD_TEST_AND_REPAIR, port=ConfirmedSpyPort(refusal=lost))


class _DraftWrites:
    """Stand-in for the mutable workspace draft-variable writer (``DraftVariableSaverImpl``)."""

    def __init__(self) -> None:
        self.saved: list[dict[str, object]] = []

    def writer(self, **kwargs: object) -> "_DraftWrites._Writer":
        return _DraftWrites._Writer(self, kwargs)

    class _Writer:
        def __init__(self, owner: "_DraftWrites", binding: dict[str, object]) -> None:
            self._owner = owner
            self._binding = binding

        def save(self, process_data: Mapping[str, object] | None, outputs: Mapping[str, object] | None) -> None:
            self._owner.saved.append(
                {"node_id": self._binding.get("node_id"), "process_data": process_data, "outputs": outputs}
            )


def _drive_generator_draft_saving(
    owner: Owner,
    monkeypatch: pytest.MonkeyPatch,
    builder_execution: "ConfirmedToolExecutionContext | BuilderExecutionContext | None",
) -> tuple[_DraftWrites, dict[str, object], list[object]]:
    """Run the real ``WorkflowAppGenerator._generate`` selection/response plumbing for a DEBUGGER run.

    Replaced only: the worker thread (captured, never started work), the queue manager, the Flask
    app proxy, the response converter, and the task pipeline, whose stand-in calls the selected
    draft-variable factory exactly as the real pipeline does when a node succeeds, with body and
    token sentinels. The mutable draft-variable writer is a recorder bound to the fixture SQLite engine.
    """
    import contextlib

    import core.app.apps.base_app_generator as base_generator_module
    from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
    from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
    from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
    from graphon.enums import BuiltinNodeTypes
    from models.account import Account
    from models.model import App, AppMode
    from services.workflow_runtime import workflow_generator as app_generator_module
    from services.workflow_runtime.workflow_generator import WorkflowAppGenerator

    engine = owner.factory.kw["bind"]
    writes = _DraftWrites()
    monkeypatch.setattr(base_generator_module, "DraftVariableSaverImpl", writes.writer)
    monkeypatch.setattr(base_generator_module, "db", ConfirmedDatabase(engine=engine))
    with owner.factory() as db:
        account = db.get(Account, owner.actor.account_id)
        app = db.get(App, owner.app_id)
        workflow = db.get(Workflow, owner.workflow_id)
        assert account is not None
        assert app is not None
        assert workflow is not None
    session = owner.factory()
    monkeypatch.setattr(app_generator_module, "db", ConfirmedDatabase(engine=engine, session=session))

    def forbidden_driver(*_args, **_kwargs):
        raise AssertionError("captured generation must not execute the worker")

    generator = WorkflowAppGenerator(execution_driver=forbidden_driver)
    monkeypatch.setattr(generator, "_bind_file_access_scope", lambda **_kwargs: contextlib.nullcontext())
    import core.app.apps.base_app_queue_manager as queue_module

    monkeypatch.setattr(queue_module.redis_client, "setex", lambda *_args: True)
    native_thread = app_generator_module.threading.Thread
    worker_kwargs: dict[str, object] = {}

    def thread(**kwargs: object):
        worker_kwargs.update(cast(dict[str, object], kwargs["kwargs"]))
        worker = native_thread(**kwargs)
        monkeypatch.setattr(worker, "start", lambda: None)
        monkeypatch.setattr(worker, "is_alive", lambda: False)
        monkeypatch.setattr(worker, "join", lambda *_args, **_kwargs: None)
        return worker

    monkeypatch.setattr(app_generator_module.threading, "Thread", thread)
    seen_pipeline: list[object] = []

    class PipelineStandIn:
        def __init__(
            self,
            *,
            application_generate_entity: WorkflowAppGenerateEntity,
            draft_var_saver_factory: DraftVariableSaverFactory,
            **_kwargs: object,
        ) -> None:
            seen_pipeline.append(application_generate_entity.invoke_from)
            self._factory = draft_var_saver_factory

        def process(self) -> Iterator[dict[str, object]]:
            saver = self._factory(owner.app_id, "tool", BuiltinNodeTypes.TOOL, "node-exec-1")
            saver.save({"request": {"token": TOKEN_SENTINEL}}, {"text": BODY_SENTINEL})
            yield {"event": "workflow_finished"}

    monkeypatch.setattr(app_generator_module, "WorkflowAppGenerateTaskPipeline", PipelineStandIn)

    def convert(response: Iterator[dict[str, object]], invoke_from: InvokeFrom) -> Iterator[dict[str, object]]:
        seen_pipeline.append(invoke_from)
        return response

    monkeypatch.setattr(app_generator_module.WorkflowAppGenerateResponseConverter, "convert", convert)
    entity = WorkflowAppGenerateEntity.model_construct(
        builder_execution=builder_execution,
        task_id="task",
        app_config=WorkflowUIBasedAppConfig(
            tenant_id=owner.actor.tenant_id,
            app_id=owner.app_id,
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id=owner.workflow_id,
        ),
        inputs={"note": "hello"},
        files=[],
        user_id=owner.actor.account_id,
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        extras={},
        call_depth=0,
        workflow_execution_id=str(uuid4()),
    )
    native_execution_repository, native_node_repository = object(), object()
    stream = generator._generate(
        app_model=app,
        workflow=workflow,
        user=account,
        application_generate_entity=entity,
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_execution_repository=cast("WorkflowExecutionRepository", native_execution_repository),
        workflow_node_execution_repository=cast("WorkflowNodeExecutionRepository", native_node_repository),
        streaming=True,
    )
    assert isinstance(stream, Iterator)
    assert list(stream) == [{"event": "workflow_finished"}]
    assert worker_kwargs["workflow_execution_repository"] is native_execution_repository
    assert worker_kwargs["workflow_node_execution_repository"] is native_node_repository
    return writes, worker_kwargs, seen_pipeline


def test_confirmed_generator_selects_no_mutable_draft_variable_copy(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = consent_owner
    _reserved, context, _run_id = launched_with_existing_apis(owner)

    writes, worker_kwargs, seen_pipeline = _drive_generator_draft_saving(owner, monkeypatch, context)

    # Still the actual DEBUGGER transport with the native Run/node persistence repositories.
    from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity

    # Pipeline and response converter both still see the actual DEBUGGER transport.
    assert seen_pipeline == [InvokeFrom.DEBUGGER, InvokeFrom.DEBUGGER]
    application_generate_entity = worker_kwargs["application_generate_entity"]
    assert isinstance(application_generate_entity, WorkflowAppGenerateEntity)
    assert application_generate_entity.builder_execution == context
    # No mutable workspace draft-variable copy of tool content.
    assert writes.saved == []
    assert not any(sentinel in json.dumps(writes.saved) for sentinel in SENTINELS)


@pytest.mark.parametrize("variant", ["ordinary", "restricted"])
def test_ordinary_and_restricted_debugger_generator_keep_the_native_draft_variable_saver(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch, variant: str
) -> None:
    from tests.unit_tests.core.app.apps.test_builder_execution_admission import context as restricted_context

    owner = consent_owner
    builder_execution = restricted_context() if variant == "restricted" else None

    writes, _worker_kwargs, _seen = _drive_generator_draft_saving(owner, monkeypatch, builder_execution)

    assert [entry["node_id"] for entry in writes.saved] == ["tool"]
    assert writes.saved[0]["outputs"] == {"text": BODY_SENTINEL}


def test_settle_before_launch_marks_expired_unclaimed_grant_without_spend(
    consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = consent_owner
    reserved, _action, _token = reserve_through_dispatch(owner)
    context = stored_context(owner, reserved.execution_request_id)
    shift_clock(monkeypatch, timedelta(minutes=11))
    receipt = owner.service().settle_launch(context=context)
    row = owner.consent_row(reserved.consent_id)
    assert (receipt.state, row.claimed_at, row.business_count) == ("expired", None, 0)
    with owner.factory() as db:
        request = db.get(DifyBuilderExecutionRequest, reserved.execution_request_id)
        assert request is not None
        assert request.native_run_id is None
