"""Project a completed ordinary Agent continuation into its existing Builder Run.

This is observation only: native result mapping and revision binding are reused,
and no generator, model, diagnosis or execution entry point is called. The final
transaction locks the Builder session before the workflow and request scope,
matching admission's lock order. It contains SQL and pure presentation only.
"""

from dataclasses import asdict, replace
from uuid import NAMESPACE_URL, uuid5

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import String, cast, select

from core.dify_builder.errors import ConflictError
from core.dify_builder.models import Actor, EntryMode
from core.dify_builder.state import PcState
from models.dify_builder import (
    DifyBuilderConversationItem,
    DifyBuilderExecutionRequest,
    DifyBuilderRun,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderTestInput,
)
from models.dify_builder_native_tests import (
    NativeDispatch,
    NativeEffectDispatchClaim,
    NativeEffectOperation,
    NativeEffectOutcome,
    NativeInvocationState,
    NativeTestInvocation,
    NativeTestScope,
)
from models.enums import CreatorUserRole
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
from runtime_contracts.builder.execution import ExecutionEvidenceSummary, canonical_digest
from runtime_contracts.builder.native.contracts import ID, NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome
from services.agent.workflow_run_recovery import WorkflowAgentRunRecovery
from services.dify_builder import session_lock
from services.dify_builder.application.handlers_fix import append_card
from services.dify_builder.application.verification import has_output_blocker, result_card
from services.dify_builder.business_acceptance import business_failure_context, record_run_acceptance
from services.dify_builder.conversation_tasks import active_entry_mode
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.native_testing.repository import admitted_workflow_revision
from services.dify_builder.repository import SqlDifyBuilderRepository

CANCELLED_CHILD_OBSERVATION = "confirmed_agent_cancelled_child_v1"


def _native_run_id(request: DifyBuilderExecutionRequest) -> str | None:
    try:
        planned = TypeAdapter(ID).validate_python(request.context.get("native_run_id"))
    except ValidationError:
        return None
    # Ordinary admission retains the allocated identity in the protected
    # context. Only the actual owned WorkflowRun below can acknowledge it.
    if request.native_run_id is not None and request.native_run_id != planned:
        return None
    return request.native_run_id or planned


def _request(sql, *, actor, ref):
    request = sql.scalar(
        select(DifyBuilderExecutionRequest).where(
            DifyBuilderExecutionRequest.id == ref.request_id,
            DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
            DifyBuilderExecutionRequest.actor_id == actor.account_id,
        )
    )
    if (
        request is None
        or request.context_digest != ref.context_digest
        or canonical_digest(request.context) != ref.context_digest
        or request.context.get("policy_version") != ref.policy_version
        or request.context.get("invocation_id") != ref.invocation_id
        or (
            request.context.get("tenant_id"),
            request.context.get("actor_id"),
            request.context.get("app_id"),
            request.context.get("workflow_id"),
            request.context.get("session_id"),
            request.context.get("test_input_id"),
        )
        != (
            request.tenant_id,
            request.actor_id,
            request.app_id,
            request.workflow_id,
            request.session_id,
            request.test_input_id,
        )
        or _native_run_id(request) is None
        or request.context.get("profile", {}).get("profile_id") != "builder-agent-confirmed-v1"
    ):
        return None
    return request


def _terminal_proof(sql, *, request, ref):
    scope = sql.scalar(
        select(NativeTestScope)
        .where(NativeTestScope.request_id == request.id, NativeTestScope.tenant_id == request.tenant_id)
        .with_for_update()
    )
    state = sql.scalar(
        select(NativeInvocationState).where(
            NativeInvocationState.request_id == request.id,
            NativeInvocationState.tenant_id == request.tenant_id,
            NativeInvocationState.invocation_id == ref.invocation_id,
            NativeInvocationState.parent_invocation_id.is_(None),
        )
    )
    if scope is None or state is None or state.outcome is None:
        return None
    outcome = NativeWorkflowOutcome.model_validate(state.outcome)
    declined = (
        scope.cancelled
        and state.state == "cancelled"
        and outcome.status == "stopped"
        and outcome.native_status == "stopped"
        and outcome.reason_code == "effect_denied"
    )
    cancelled = (
        scope.cancelled
        and state.state == "cancelled"
        and outcome.status == "stopped"
        and outcome.native_status == "failed"
        and outcome.reason_code == "native_cancelled"
    )
    if not (declined or cancelled) and (scope.cancelled or state.state != "completed" or outcome.status != "completed"):
        return None
    if (
        outcome.ref != ref
        or outcome.native_run_id != _native_run_id(request)
        or state.generation != scope.generation
        or outcome.pending_operation_ids
    ):
        return None
    operations = sql.scalars(
        select(NativeEffectOperation).where(
            NativeEffectOperation.request_id == request.id, NativeEffectOperation.tenant_id == request.tenant_id
        )
    ).all()
    if any(operation.state not in {"completed", "failed", "not_dispatched"} for operation in operations):
        return None
    native = sql.scalar(
        select(WorkflowRun).where(
            WorkflowRun.id == _native_run_id(request),
            WorkflowRun.tenant_id == request.tenant_id,
            WorkflowRun.app_id == request.app_id,
            WorkflowRun.workflow_id == request.workflow_id,
            WorkflowRun.created_by == request.actor_id,
            WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
        )
    )
    if native is None or native.status != outcome.native_status:
        return None
    if cancelled and cancelled_parent_proof(sql, request=request, ref=ref, allow_claimed=False) is None:
        return None
    return outcome


def settled_physical_facts(sql, *, ref, tenant_id, operations):
    """Owned durable terminal outcomes for every physical claim, shared by cancel proofs."""
    outcomes = sql.scalars(select(NativeEffectOutcome).where(NativeEffectOutcome.request_id == ref.request_id)).all()
    claims = sql.scalars(
        select(NativeEffectDispatchClaim).where(NativeEffectDispatchClaim.request_id == ref.request_id)
    ).all()
    if any(
        (outcome.tenant_id, outcome.invocation_id) != (tenant_id, ref.invocation_id)
        or outcome.outcome not in {"completed", "failed", "not_dispatched"}
        for outcome in outcomes
    ) or any(
        (claim.tenant_id, claim.invocation_id) != (tenant_id, ref.invocation_id)
        or not any(
            (outcome.operation_id, outcome.attempt_id) == (claim.operation_id, claim.attempt_id)
            and outcome.outcome in {"completed", "failed"}
            and any(
                operation.id == outcome.operation_id
                and operation.state == outcome.outcome
                and operation.result_ref == outcome.result_ref
                for operation in operations
            )
            for outcome in outcomes
        )
        for claim in claims
    ):
        return None
    return claims, outcomes


def cancelled_parent_proof(sql, *, request, ref, allow_claimed, allow_unobserved_guard=False):
    """Prove consumed cancellation or a saved observation of the original child.

    The caller holds the request/scope lock when writing. A current claimed
    source may close from this exact terminal producer; unknown sources and
    unresolved physical effects never become cancellation acknowledgements.
    ``allow_unobserved_guard`` only discovers a guarded original child for the
    cancellation owner's read outside SQL; its binding must be rechecked and
    an actual cancelled observation saved before that caller can seal.
    """
    states = sql.scalars(select(NativeInvocationState).where(NativeInvocationState.request_id == request.id)).all()
    invocations = sql.scalars(select(NativeTestInvocation).where(NativeTestInvocation.request_id == request.id)).all()
    scope = sql.get(NativeTestScope, request.id)
    if (
        len(states) != 1
        or len(invocations) != 1
        or scope is None
        or scope.tenant_id != request.tenant_id
        or not scope.cancelled
    ):
        return None
    state, invocation = states[0], invocations[0]
    if (
        (state.tenant_id, state.invocation_id, state.parent_invocation_id)
        != (request.tenant_id, ref.invocation_id, None)
        or (state.app_id, state.workflow_id) != (request.app_id, request.workflow_id)
        or (invocation.tenant_id, invocation.invocation_id) != (request.tenant_id, ref.invocation_id)
        or invocation.active
        or state.state != "cancelled"
        or not state.cancellation_key
        or type(state.generation) is not int
        or state.generation < 0
        or state.generation != scope.generation
    ):
        return None
    native = sql.scalar(
        select(WorkflowRun)
        .where(
            WorkflowRun.id == _native_run_id(request),
            WorkflowRun.tenant_id == request.tenant_id,
            WorkflowRun.app_id == request.app_id,
            WorkflowRun.workflow_id == request.workflow_id,
            WorkflowRun.created_by == request.actor_id,
            WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
            WorkflowRun.status == "failed",
            WorkflowRun.finished_at.is_not(None),
        )
        .with_for_update()
    )
    if native is None:
        return None
    nodes = sql.scalars(
        select(WorkflowNodeExecutionModel)
        .where(
            WorkflowNodeExecutionModel.workflow_run_id == native.id,
            WorkflowNodeExecutionModel.tenant_id == request.tenant_id,
            WorkflowNodeExecutionModel.app_id == request.app_id,
            WorkflowNodeExecutionModel.workflow_id == request.workflow_id,
            WorkflowNodeExecutionModel.created_by == request.actor_id,
            WorkflowNodeExecutionModel.created_by_role == CreatorUserRole.ACCOUNT,
            WorkflowNodeExecutionModel.node_type == "agent",
        )
        .with_for_update()
    ).all()
    failed = [node for node in nodes if node.status == "failed" and node.error == native.error]
    if (
        len(failed) != 1
        or not native.error
        or any(node is not failed[0] and node.status not in {"succeeded", "skipped"} for node in nodes)
    ):
        return None
    node = failed[0]
    agent_log = node.execution_metadata_dict.get("agent_log", {})
    if not isinstance(agent_log, dict):
        return None
    child = agent_log.get("agent_backend", {})
    if not isinstance(child, dict):
        return None
    # Reuse the ordinary create owner's durable child association. Terminal
    # metadata alone cannot select an unrelated cancelled backend run.
    try:
        intents = WorkflowAgentRunRecovery._intents(node)
    except ValueError:
        return None
    workflow_binding = (node.process_data_dict or {}).get("workflow_agent_binding_id")
    if (
        not intents
        or not node.agent_workspace_binding_id
        or not isinstance(workflow_binding, str)
        or not workflow_binding
    ):
        return None
    intent = max(intents, key=lambda intent: intent.attempt)
    if not intent.child_run_id or child.get("run_id") not in (None, intent.child_run_id):
        return None
    consumed = (
        child.get("run_id") == intent.child_run_id
        and child.get("status") == "cancelled"
        and child.get("terminal_event_id")
    )
    guarded = (
        node.error
        in {
            "Builder execution policy refused: native_invocation_mismatch",
            "Builder execution policy refused: native_cancelled",
        }
        and not child.get("terminal_event_id")
        and child.get("status") in {None, "not_started", "running", "waiting"}
    )
    if not consumed and not guarded:
        return None
    sources = sql.scalars(select(NativeDispatch).where(NativeDispatch.request_id == request.id)).all()
    current = [source for source in sources if source.generation == state.generation]
    if (state.generation == 0 and sources) or (state.generation > 0 and len(current) != 1):
        return None
    if current and current[0].checkpoint_id != state.checkpoint_id:
        return None
    if any(
        (source.tenant_id, source.invocation_id) != (request.tenant_id, ref.invocation_id)
        or not 0 <= source.generation <= state.generation
        or source.state not in ({"completed", "claimed"} if allow_claimed and source in current else {"completed"})
        for source in sources
    ):
        return None
    operations = sql.scalars(select(NativeEffectOperation).where(NativeEffectOperation.request_id == request.id)).all()
    if any(
        (operation.tenant_id, operation.invocation_id) != (request.tenant_id, ref.invocation_id)
        or operation.state not in {"completed", "failed", "not_dispatched"}
        for operation in operations
    ):
        return None
    physical = settled_physical_facts(sql, ref=ref, tenant_id=request.tenant_id, operations=operations)
    if physical is None:
        return None
    claims, outcomes = physical
    source = current[0] if current else None
    if not consumed:
        # The normal producer can fail its revoked restore guard before it
        # consumes the actual child's terminal event. Bind the bounded SDK
        # observation to this original SQL lineage and all settled facts.
        binding = {
            "request_id": request.id,
            "invocation_id": ref.invocation_id,
            "native_run_id": native.id,
            "node_execution_id": node.id,
            "child_run_id": intent.child_run_id,
            "create_digest": canonical_digest(intent.model_dump(mode="json")),
            "generation": state.generation,
            "source_id": source.id if source else None,
            "snapshot_digest": canonical_digest(
                {
                    "context": ref.context_digest,
                    "context_object_id": state.context_object_id,
                    "checkpoint_id": state.checkpoint_id,
                    "cancellation_key": state.cancellation_key,
                    "native_error": native.error,
                    "native_finished_at": native.finished_at.isoformat(),
                    "workspace_binding": node.agent_workspace_binding_id,
                    "workflow_binding": workflow_binding,
                    "sources": sorted((s.id, s.generation, s.checkpoint_id, s.idempotency_digest) for s in sources),
                    "operations": sorted((o.id, o.state, o.result_ref) for o in operations),
                    "claims": sorted((c.id, c.operation_id, c.attempt_id) for c in claims),
                    "outcomes": sorted((o.id, o.operation_id, o.attempt_id, o.outcome, o.result_ref) for o in outcomes),
                }
            ),
        }
        records = [
            record[CANCELLED_CHILD_OBSERVATION]
            for record in request.observations
            if CANCELLED_CHILD_OBSERVATION in record
        ]
        observed = (
            len(records) == 1
            and isinstance(records[0], dict)
            and set(records[0]) == {*binding, "status", "backend_updated_at"}
            and all(records[0].get(key) == value for key, value in binding.items())
            and records[0].get("status") == "cancelled"
            and isinstance(records[0].get("backend_updated_at"), str)
            and bool(records[0]["backend_updated_at"])
        )
        if not observed and (records or not allow_unobserved_guard):
            return None
        child = {"run_id": intent.child_run_id, "observation_binding": binding, "needs_observation": not observed}
    return native, child, source


def _write_run(row, run):
    row.status, row.error, row.immutable = run.status, run.error, True
    row.per_node = [asdict(node) for node in run.per_node]
    row.verification = {
        **asdict(run.verification),
        "execution_evidence": run.verification.execution_evidence.model_dump(mode="json"),
    }
    row.tokens, row.elapsed_ms, row.culprit_node_id = run.tokens, run.elapsed_ms, run.culprit_node_id


def reconcile_builder_run(*, sessions, actor: Actor, ref: NativeTestContextRef) -> bool:
    """Idempotently close only the still-current saved-input attempt after C03.

    Callers have already authenticated the scoped request through C04 or the
    claimed resume owner. Reconnect retries this bounded projection after a lost
    callback/CAS; conflicting user work always wins. No Redis or provider I/O is
    needed inside a SQL writer. The existing advance lease protects active user
    work, and a session CAS serializes duplicate terminal observers.
    """
    with sessions() as sql:
        request = _request(sql, actor=actor, ref=ref)
        if request is None:
            return False
    token = session_lock.acquire(request.session_id)
    if token is None:
        return False
    try:
        return _project(sessions=sessions, actor=actor, ref=ref, request=request)
    finally:
        session_lock.release(request.session_id, token)


def _project(*, sessions, actor, ref, request):
    repo = SqlDifyBuilderRepository(sessions)
    session_id, test_input_id, native_run_id = request.session_id, request.test_input_id, _native_run_id(request)
    if native_run_id is None:
        return False
    owner, context = repo.get_session(session_id)
    mode = active_entry_mode(owner, context)
    if mode == EntryMode.BUILD:
        pending_states = {PcState.BUILD_EXECUTION, PcState.BUILD_AWAIT_REPAIR}
        review_state, repair_state = PcState.BUILD_REVIEW, PcState.BUILD_AWAIT_REPAIR
    elif mode == EntryMode.EDIT:
        pending_states = {PcState.EDIT_TEST_AFFECTED_PATHS, PcState.EDIT_AWAIT_REPAIR}
        review_state, repair_state = PcState.EDIT_REVIEW, PcState.EDIT_AWAIT_REPAIR
    else:
        return False
    if (
        (owner.tenant_id, owner.owner_account_id) != (actor.tenant_id, actor.account_id)
        or owner.current_state not in pending_states
        or context.paused
        or context.recovery_class
        or context.test_input_ref != test_input_id
        or not context.verify_run_id
    ):
        return False
    reservation_id = str(uuid5(NAMESPACE_URL, f"dify-builder-full-run:{session_id}:{test_input_id}"))
    with sessions() as sql:
        if not _control_only_versions(sql, request=request, current_version=owner.version):
            return False
        current = sql.get(DifyBuilderRun, context.verify_run_id)
        reservation = sql.get(DifyBuilderRun, reservation_id)
        if (
            any(
                row is None
                or (row.session_id, row.inputs_ref, row.dify_run_id) != (session_id, test_input_id, native_run_id)
                for row in (current, reservation)
            )
            or current.kind != "verify"
            or current.status != "running"
            or reservation.kind != "native_test_launch"
        ):
            return False
        outcome = _terminal_proof(sql, request=request, ref=ref)
        if outcome is None:
            return False
        declined = outcome.reason_code == "effect_denied" and outcome.status == "stopped"
        if context.staged_repair and not declined:
            return False
    original = repo.get_run(reservation_id)
    evidence = original.verification
    if evidence is None or not evidence.execution_revision or not evidence.executed_graph_revision:
        return False
    port = WorkflowServiceDifyPort()
    result = port._finish_run(actor.tenant_id, owner.app_id, {}, native_run_id)
    run = port._bind_run(
        result, owner.app_id, actor, evidence.execution_revision, evidence.executed_graph_revision, restricted=False
    )
    if (
        run.status not in {"succeeded", "failed"}
        or run.dify_run_id != native_run_id
        or run.execution_refusal is not None
        or run.verification is None
        or run.verification.execution_revision != evidence.execution_revision
    ):
        return False
    previous_summary = evidence.execution_evidence
    if previous_summary is None:
        return False
    run.verification.execution_evidence = ExecutionEvidenceSummary(
        request_id=reservation_id,
        policy_version="builder-confirmed-run-v1",
        mode="confirmed_run",
        sealed=True,
        safety_outcome="confirmed_run_completed" if run.status == "succeeded" else "native_failed",
        simulated_node_ids=previous_summary.simulated_node_ids,
        sandbox_profile="native",
        native_run_id=native_run_id,
    )
    # Continuations finish the original ordinary test, including its explicit
    # acceptance oracle. Bind the Builder identity before recording its finding;
    # the native mapper deliberately knows only the Workflow Run identity.
    run = replace(
        run, id=context.verify_run_id, session_id=session_id, kind="verify", inputs_ref=test_input_id, immutable=True
    )
    native_graph = result[1].graph_dict
    record_run_acceptance(
        owner, context, run, repo.get_test_input(test_input_id), native_graph, evidence.execution_revision
    )
    business_failure = business_failure_context(
        run,
        owner,
        context,
        current_revision=evidence.execution_revision,
        current_graph_revision=evidence.executed_graph_revision,
    )
    if declined:
        run.error = "Test declined by the user; continue adjusting to revise the plan."
    card = result_card(run)
    items = append_card(context, card)
    for item in items:
        item.at_version = owner.version + 1
    context.diagnosis, context.staged_repair, context.unknown_outcome_count = None, [], 0
    if declined:
        context.confirmed_consent_id, context.confirmed_command_id = "", ""
        context.effect_confirmation, context.effect_confirmation_form = {}, {}
    next_state = (
        review_state
        if declined or run.status == "succeeded" and not has_output_blocker(run) and business_failure is None
        else repair_state
    )
    try:
        with sessions.begin() as sql:
            session = sql.get(DifyBuilderSession, session_id, with_for_update=True)
            if session is None or (
                session.version,
                session.current_state,
                session.tenant_id,
                session.owner_account_id,
                session.app_id,
            ) != (owner.version, str(owner.current_state), actor.tenant_id, actor.account_id, owner.app_id):
                return False
            workflow = sql.scalar(
                select(Workflow)
                .where(
                    Workflow.id == request.workflow_id,
                    Workflow.tenant_id == actor.tenant_id,
                    Workflow.app_id == owner.app_id,
                )
                .with_for_update()
            )
            saved = sql.get(DifyBuilderTestInput, test_input_id)
            fresh = _request(sql, actor=actor, ref=ref)
            if (
                workflow is None
                or saved is None
                or saved.session_id != session_id
                or fresh is None
                or admitted_workflow_revision(workflow, fresh.context) != fresh.context.get("execution_revision")
                or canonical_digest(saved.inputs) != fresh.context.get("input_revision")
                or _terminal_proof(sql, request=fresh, ref=ref) is None
            ):
                return False
            current = sql.get(DifyBuilderRun, context.verify_run_id, with_for_update=True)
            reservation = sql.get(DifyBuilderRun, reservation_id, with_for_update=True)
            if (
                any(
                    row is None
                    or (row.session_id, row.inputs_ref, row.dify_run_id) != (session_id, test_input_id, native_run_id)
                    for row in (current, reservation)
                )
                or current.status != "running"
                or reservation.status != "running"
            ):
                return False
            _write_run(current, run)
            _write_run(reservation, run)
            repo._compare_and_advance_in_session(sql, session_id, owner.version, next_state, context, items)
        from services.dify_builder import progress_bus

        progress_bus.publish_native_change(session_id)
        return True
    except ConflictError:
        return False


def _control_only_versions(sql, *, request, current_version):
    """Accept only audited native controls after the original ordinary Run commit.

    A user edit/recovery/model/input transition cannot inherit this exception.
    The original immutable request/context and admission version stay unchanged.
    """
    from services.dify_builder.test_actions import TEST_ACTIONS

    baseline = request.context.get("expected_version", -2) + 1
    if current_version < baseline:
        return False
    if current_version == baseline:
        return True
    commits = sql.scalars(
        select(DifyBuilderSessionCommit)
        .where(
            DifyBuilderSessionCommit.session_id == request.session_id,
            DifyBuilderSessionCommit.version.between(baseline, current_version),
        )
        .order_by(DifyBuilderSessionCommit.version)
    ).all()
    if len(commits) != current_version - baseline + 1:
        return False
    ignored = {"next_seq", "last_command_id"}
    previous = commits[0]
    for commit in commits[1:]:
        if commit.state != previous.state or (
            {k: v for k, v in commit.context.items() if k not in ignored}
            != {k: v for k, v in previous.context.items() if k not in ignored}
        ):
            return False
        row = sql.scalar(
            select(DifyBuilderConversationItem).where(
                DifyBuilderConversationItem.session_id == request.session_id,
                DifyBuilderConversationItem.at_version == commit.version,
                DifyBuilderConversationItem.seq == previous.context.get("next_seq"),
                DifyBuilderConversationItem.kind == "decision",
            )
        )
        if (
            row is None
            or row.payload.get("request_id") != request.id
            or row.payload.get("test_command_id") != commit.context.get("last_command_id")
            or row.payload.get("test_action_kind") not in TEST_ACTIONS
            or not row.payload.get("test_action_digest")
            or commit.context.get("next_seq") != previous.context.get("next_seq", 0) + 1
        ):
            return False
        previous = commit
    return True


def reconcile_completed_builder_runs(*, sessions, limit: int = 100) -> int:
    """Recover terminal evidence after a lost projection callback, never execution."""
    with sessions() as sql:
        requests = sql.scalars(
            select(DifyBuilderExecutionRequest)
            .join(
                DifyBuilderRun,
                (DifyBuilderRun.session_id == DifyBuilderExecutionRequest.session_id)
                & (DifyBuilderRun.inputs_ref == cast(DifyBuilderExecutionRequest.test_input_id, String))
                & (DifyBuilderRun.kind == "verify")
                & (DifyBuilderRun.status == "running"),
            )
            .where(
                DifyBuilderExecutionRequest.context["profile"]["profile_id"].as_string()
                == "builder-agent-confirmed-v1",
                DifyBuilderExecutionRequest.state == "sealed",
            )
            .order_by(DifyBuilderExecutionRequest.created_at)
            .limit(limit)
        ).all()
    recovered = 0
    for request in requests:
        actor = Actor(tenant_id=request.tenant_id, account_id=request.actor_id)
        ref = NativeTestContextRef(
            request_id=request.id, invocation_id=request.context["invocation_id"], context_digest=request.context_digest
        )
        recovered += int(reconcile_builder_run(sessions=sessions, actor=actor, ref=ref))
    return recovered
