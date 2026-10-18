"""Project a completed ordinary Agent continuation into its existing Builder Run.

This is observation only: native result mapping and revision binding are reused,
and no generator, model, diagnosis or execution entry point is called. The final
transaction locks the Builder session before the workflow and request scope,
matching admission's lock order. It contains SQL and pure presentation only.
"""

from dataclasses import asdict
from uuid import NAMESPACE_URL, uuid5

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select

from core.dify_builder.errors import ConflictError
from core.dify_builder.handlers_fix import append_card
from core.dify_builder.models import Actor
from core.dify_builder.state import PcState
from core.dify_builder.verification import has_output_blocker, result_card
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderRun, DifyBuilderSession, DifyBuilderTestInput
from models.dify_builder_native_tests import NativeEffectOperation, NativeInvocationState, NativeTestScope
from models.enums import CreatorUserRole
from models.workflow import Workflow, WorkflowRun
from services.dify_builder import session_lock
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.execution_contracts import ExecutionEvidenceSummary, canonical_digest
from services.dify_builder.native_testing.contracts import ID, NativeTestContextRef
from services.dify_builder.native_testing.repository import admitted_workflow_revision
from services.dify_builder.native_testing.runtime_contracts import NativeWorkflowOutcome
from services.dify_builder.repository import SqlDifyBuilderRepository


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
        or any(
            request.context.get(key) != getattr(request, key)
            for key in (
                "tenant_id",
                "actor_id",
                "app_id",
                "workflow_id",
                "session_id",
                "test_input_id",
            )
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
    if scope is None or scope.cancelled or state is None or state.state != "completed" or state.outcome is None:
        return None
    outcome = NativeWorkflowOutcome.model_validate(state.outcome)
    if (
        outcome.ref != ref
        or outcome.status != "completed"
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
    return outcome


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
    if (
        (owner.tenant_id, owner.owner_account_id) != (actor.tenant_id, actor.account_id)
        or owner.version != request.context.get("expected_version", -2) + 1
        or owner.current_state not in {PcState.BUILD_EXECUTION, PcState.BUILD_AWAIT_REPAIR}
        or context.paused
        or context.recovery_class
        or context.staged_repair
        or context.test_input_ref != test_input_id
        or not context.verify_run_id
    ):
        return False
    reservation_id = str(uuid5(NAMESPACE_URL, f"dify-builder-full-run:{session_id}:{test_input_id}"))
    with sessions() as sql:
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
        if _terminal_proof(sql, request=request, ref=ref) is None:
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
    card = result_card(run)
    items = append_card(context, card)
    for item in items:
        item.at_version = owner.version + 1
    context.diagnosis, context.staged_repair, context.unknown_outcome_count = None, [], 0
    next_state = (
        PcState.BUILD_REVIEW
        if run.status == "succeeded" and not has_output_blocker(run)
        else PcState.BUILD_AWAIT_REPAIR
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
            ):
                return False
            _write_run(current, run)
            _write_run(reservation, run)
            repo._compare_and_advance_in_session(sql, session_id, owner.version, next_state, context, items)
        return True
    except ConflictError:
        return False
