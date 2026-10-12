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
from collections.abc import Callable, Mapping
from dataclasses import asdict
from datetime import datetime, timedelta
from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from core.dify_builder.contract import TestResultCard
from core.dify_builder.errors import BadRequestError, BusyError
from core.dify_builder.execution_policy import (
    BuilderExecutionPolicyError,
    ConfirmedToolExecutionContext,
    ExecutionEvidenceSummary,
    TrustedExecutionCompletion,
    validate_execution_context,
)
from core.dify_builder.models import (
    Action,
    Actor,
    NodeEvent,
    NodeOutput,
    Run,
    RunVerification,
)
from core.dify_builder.real_call_consent import ConfirmedToolBinding, ConsentReceipt
from core.dify_builder.runner import Env, Runner
from core.dify_builder.state import PcState
from core.dify_builder.verification import publication_decision, result_card
from libs.datetime_utils import naive_utc_now
from models.dify_builder import DifyBuilderExecutionRequest
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
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
    from services.dify_builder.dify_port import ConfirmedLaunchRecorder

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
    service: DifyBuilderService, owner: Owner, receipt: ConsentReceipt, *, key: str = "execute-1", **changes: object
) -> ConsentReceipt:
    values: dict[str, object] = {
        "consent_id": receipt.consent_id,
        "scope_digest": receipt.scope_digest,
        "at_version": receipt.at_version,
        "idempotency_key": key,
        **changes,
    }
    return service.execute_confirmed_tool(owner.session_id, owner.actor, **values)  # type: ignore[arg-type]


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

    def __init__(self, consent, context: ConfirmedToolExecutionContext, native_run_id: str) -> None:
        self.consent = consent
        self.context = context
        self.native_run_id = native_run_id
        self.healthy = True
        self.bindings: list[ConfirmedToolBinding] = []

    def record(self, _observation) -> None:
        raise AssertionError("a confirmed run records no restricted observations")

    def confirmed_guard(self, *, node_id: str, native_run_id: str, native_node_execution_id: str):
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


class ConfirmedSpyPort(FakeDifyPort):
    """Records the shared port call; returns a sealed confirmed Run shape."""

    def __init__(self, outcome: str = "confirmed_tool_completed") -> None:
        super().__init__()
        self.confirmed_calls: list[dict[str, object]] = []
        self.outcome = outcome

    def run_draft(  # type: ignore[override]
        self,
        app_id: str,
        actor: Actor,
        inputs: dict,
        on_event: Callable[[NodeEvent], None],
        *,
        session_id: str,
        test_input_id: str,
        on_workflow_event: Callable[[Mapping[str, object]], None] | None = None,
        confirmed_consent_id: str | None = None,
        command_id: str | None = None,
    ) -> Run:
        _ = (app_id, actor, session_id, on_workflow_event)  # the shared port signature; not inspected here
        self.confirmed_calls.append(
            {
                "inputs": dict(inputs),
                "test_input_id": test_input_id,
                "confirmed_consent_id": confirmed_consent_id,
                "command_id": command_id,
            }
        )
        on_event(NodeEvent(node_id="tool", status="succeeded"))
        summary = ExecutionEvidenceSummary(
            request_id="request-1",
            policy_version="builder-confirmed-gmail-read-v1",
            mode="confirmed_tool",
            sealed=True,
            safety_outcome=self.outcome,  # type: ignore[arg-type]
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

    def diagnose(self, *_args, **_kwargs):  # type: ignore[override]
        raise AssertionError("confirmed outcome must not be diagnosed")

    def propose_repair(self, *_args, **_kwargs):  # type: ignore[override]
        raise AssertionError("confirmed outcome must not be repaired")

    def generate_mock_inputs(self, *_args, **_kwargs):  # type: ignore[override]
        raise AssertionError("confirmed test must use the saved input")


def wire_worker(monkeypatch: pytest.MonkeyPatch, owner: Owner, port: ConfirmedSpyPort, order: list[str]):
    import tasks.dify_builder_advance_task as mod

    repo = SqlDifyBuilderRepository(owner.factory)
    monkeypatch.setattr(mod, "_build_repo", lambda: repo)
    service = owner.service()
    real_reload = getattr(service, "reserved_launch", None)

    def reload(**kwargs):
        order.append("reload")
        if real_reload is None:
            raise AssertionError("no reserved-command reload owner")
        return real_reload(**kwargs)

    # Non-raising seams: the worker's consent-owner seam is a Task 6 addition.
    monkeypatch.setattr(service, "reserved_launch", reload, raising=False)
    monkeypatch.setattr(mod, "_build_consent_service", lambda: service, raising=False)
    monkeypatch.setattr(mod, "WorkflowServiceDifyPort", lambda: port)

    def agent(**_kwargs):
        order.append("agent")
        return NoModelAgent()

    monkeypatch.setattr(mod, "build_dify_builder_agent", agent)
    events: list[dict] = []
    released: list[str] = []
    monkeypatch.setattr(mod.progress_bus, "publish", lambda _sid, ev: events.append(ev))
    monkeypatch.setattr(mod.session_lock, "release", lambda _sid, tok: released.append(tok))
    monkeypatch.setattr(mod.session_lock, "activate", lambda _sid, _tok: True)
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
    port, order = ConfirmedSpyPort(), []
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
    port, order = ConfirmedSpyPort(), []
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
    port, order = ConfirmedSpyPort(), []
    mod, repo, events, _released = wire_worker(monkeypatch, owner, port, order)

    mod.advance_session(owner.session_id, asdict(action), asdict(owner.actor), token)

    assert port.confirmed_calls == []
    assert "agent" not in order
    assert events[-1]["kind"] == "error"


@pytest.mark.parametrize("kind", ["recovery_continue", "recovery_restart"])
def test_recovery_clears_pending_reference_and_never_reuses_the_grant(consent_owner: Owner, kind: str) -> None:
    owner = consent_owner
    reserved, _action, _token = reserve_directly(owner)
    repo = SqlDifyBuilderRepository(owner.factory)
    port = ConfirmedSpyPort()
    runner = Runner(Env(dify=port, agent=StubAgent(), repo=repo, now=naive_utc_now), _registries())
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
):
    """Drive the real working handler through ``Runner`` for one reserved confirmed command.

    Uses the in-memory repository with a saved approved test input; detection
    and localization raise so any model call fails the caller's test.
    """
    from core.dify_builder.models import DifyBuilderContext, EntryMode, Session, TestInput, Turn
    from tests.unit_tests.core.dify_builder.fakes import InMemoryRepository

    def no_model(*_args, **_kwargs):
        raise AssertionError("confirmed outcome must not call a model")

    repo = InMemoryRepository()
    port = port if port is not None else ConfirmedSpyPort()
    env = Env(
        dify=port,
        agent=NoModelAgent(),
        repo=repo,
        now=lambda: datetime.min,
        detect_language=no_model,
        localize_items=no_model,
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


def _registries():
    from core.dify_builder.handlers_build import build_registry
    from core.dify_builder.handlers_edit import edit_registry
    from core.dify_builder.handlers_fix import fix_registry

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


SUCCESS_JSON = {"message": {"id": APPROVED.message_id, "snippet": BODY_SENTINEL}, "message_id": APPROVED.message_id}


def dispatched(recorder, *, messages=(SUCCESS_JSON,), complete=True, node_execution_id="node-exec-1"):
    guard = recorder.confirmed_guard(
        node_id="tool", native_run_id=recorder.native_run_id, native_node_execution_id=node_execution_id
    )
    guard.before_invoke(APPROVED.model_dump())
    for message in messages:
        guard.observe_json(message)
    guard.finish_stream(complete=complete, declared_failure=False)
    return guard


def seal_and_settle(owner: Owner, context, completion):
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
    consent_owner: Owner, messages, complete: bool, reason: str
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

    def failing_finish(**_kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(service, "finish", failing_finish)
    with pytest.raises(RuntimeError):
        dispatched(recorder)
    native_rows(owner, run_id, "node-exec-1")

    summary, receipt = seal_and_settle(owner, context, done(context, run_id))

    assert summary.safety_outcome == "execution_evidence_unknown"
    assert receipt.state == "unknown"
    assert owner.consent_row(reserved.consent_id).business_count == 1


def test_reserved_but_never_launched_settles_failed_before_any_claim(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, _action, _token = reserve_through_dispatch(owner)

    assert owner.service().reconcile_stranded(session_id=owner.session_id) == 1

    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.claimed_at, row.refresh_count, row.business_count) == ("failed", None, 0, 0)
    assert row.reason_code == "launch_stranded"
    # Idempotent and never redispatched.
    assert owner.service().reconcile_stranded(session_id=owner.session_id) == 0


def test_reconcile_after_spent_phase_is_unknown_and_final(consent_owner: Owner) -> None:
    owner = consent_owner
    reserved, context, run_id, recorder = launched(owner)
    guard = recorder.confirmed_guard(node_id="tool", native_run_id=run_id, native_node_execution_id="node-exec-1")
    guard.before_invoke(APPROVED.model_dump())

    assert owner.service().reconcile_stranded(session_id=owner.session_id) == 1

    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.business_count) == ("unknown", 1)
    assert owner.service().reconcile_stranded(session_id=owner.session_id) == 0
    assert owner.consent_row(reserved.consent_id).state == "unknown"


def test_publication_accepts_only_sealed_exact_revision_confirmed_success() -> None:
    def run(outcome: str, *, sealed: bool = True, action: str = "completed", revision: str = "r1") -> Run:
        summary = ExecutionEvidenceSummary(
            request_id="request-1",
            policy_version="builder-confirmed-gmail-read-v1",
            mode="confirmed_tool",
            sealed=True,
            safety_outcome=outcome,  # type: ignore[arg-type]
            sandbox_profile="disabled",
            native_run_id="native-1",
            consent_id="consent-1",
            action_state=action,  # type: ignore[arg-type]
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

    def decide(candidate: Run):
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


def bind_fixture_engine(monkeypatch: pytest.MonkeyPatch, owner: Owner) -> None:
    """Point the port's and WorkflowService's engine owners at the fixture SQLite engine (no Flask app)."""
    from types import SimpleNamespace

    import services.dify_builder.dify_port as port_module
    import services.workflow_service as workflow_service_module

    engine = SimpleNamespace(engine=owner.factory.kw["bind"])
    monkeypatch.setattr(port_module, "_session_factory", lambda: owner.factory)
    monkeypatch.setattr(port_module, "db", engine)
    monkeypatch.setattr(workflow_service_module, "db", engine)
    monkeypatch.setattr(port_module, "set_login_user", lambda _account: None)


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
    from types import SimpleNamespace

    import services.dify_builder.dify_port as port_module
    from core.app.entities.app_invoke_entities import InvokeFrom

    caplog.set_level(logging.DEBUG)
    owner = consent_owner
    reserved, _action, _token = reserve_through_dispatch(owner)
    bind_fixture_engine(monkeypatch, owner)
    open_sessions: list[bool] = []
    generated: list[dict] = []
    users: list[str] = []

    def native_generate(
        *, app_model, user, args, invoke_from, session, builder_execution, builder_execution_admit, **kw
    ):
        users.append(user.id)
        assert kw["workflow_execution_mode"] == "in_process"
        assert kw["streaming"] is True
        assert invoke_from == InvokeFrom.DEBUGGER
        generated.append(dict(args))
        open_sessions.append(session.in_transaction())
        launch, context, run_id = builder_execution_admit, builder_execution, str(uuid4())
        with owner.factory() as db:
            workflow = db.get(Workflow, owner.workflow_id)
        entity = SimpleNamespace(
            builder_execution=context,
            files=[],
            single_iteration_run=None,
            single_loop_run=None,
            invoke_from=InvokeFrom.DEBUGGER,
            app_config=SimpleNamespace(
                app_id=owner.app_id, tenant_id=owner.actor.tenant_id, workflow_id=owner.workflow_id, app_mode="workflow"
            ),
            user_id=owner.actor.account_id,
            inputs=dict(args["inputs"]),
            call_depth=0,
            workflow_execution_id=run_id,
            task_id="task",
        )

        def worker() -> None:
            launch.admit_raw(workflow, app_model)
            recorder = launch(workflow, app_model, entity, "start", False)
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
    from core.dify_builder.execution_policy import BuilderExecutionRefusal

    class LostLaunchPort(ConfirmedSpyPort):
        def run_draft(self, *args, **kwargs):  # type: ignore[override]
            super().run_draft(*args, **kwargs)
            return Run(
                status="failed",
                execution_refusal=BuilderExecutionRefusal(reason_code="execution_already_claimed"),
            )

    with pytest.raises(ConflictError):
        run_confirmed_handler("build", PcState.BUILD_TEST_AND_REPAIR, port=LostLaunchPort())


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
