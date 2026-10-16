"""Transaction-local native admission, acknowledged fences and unknown quarantine."""

from sqlalchemy import select

from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeInvocationState,
    NativePendingAction,
    NativeTestInvocation,
    NativeTestScope,
)
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError


def validate_pending_fence(rows, *, state, ref, tenant_id, pending_ids):
    """Validate exact current local pending facts, preserving the represented order."""
    if (
        not isinstance(pending_ids, (tuple, list))
        or not pending_ids
        or any(type(identity) is not str or not identity for identity in pending_ids)
        or len(set(pending_ids)) != len(pending_ids)
        or len(rows) != len(pending_ids)
    ):
        raise BuilderExecutionPolicyError("native_pending_mismatch")
    by_id = {row.id: row for row in rows}
    if set(by_id) != set(pending_ids) or any(
        (row.tenant_id, row.request_id, row.invocation_id, row.generation)
        != (tenant_id, ref.request_id, ref.invocation_id, state.generation)
        or row.category not in {"approval", "configuration", "interaction"}
        for row in rows
    ):
        raise BuilderExecutionPolicyError("native_pending_mismatch")
    return tuple(by_id[identity] for identity in pending_ids)


def pending_reason(rows):
    """The actual private reason uses the existing waiting-category precedence."""
    categories = {row.category for row in rows}
    if not categories or not categories <= {"configuration", "interaction", "approval"}:
        raise BuilderExecutionPolicyError("native_pending_mismatch")
    return next(reason for reason in ("configuration", "interaction", "approval") if reason in categories)


def validate_pending_history(session, *, ref, tenant_id, state, states=None, dispatch_states=("claimed", "completed")):
    """Retained IDs prove a past acknowledged claim, never a current pause fence.

    Root's preservation ruling uses real wait_reason=None to open admission.
    Each retained owner must still have its exact saved checkpoint and older
    pending generation. Never reconstruct a lost set by scanning a generation.
    """
    if states is None:
        states = {
            row.invocation_id: row
            for row in session.scalars(
                select(NativeInvocationState).where(
                    NativeInvocationState.request_id == ref.request_id, NativeInvocationState.tenant_id == tenant_id
                )
            )
        }
    ids = state.pending_ids
    if (
        not state.checkpoint_id
        or type(state.generation) is not int
        or state.generation <= 0
        or type(ids) is not list
        or not ids
        or any(type(identity) is not str or not identity for identity in ids)
        or len(set(ids)) != len(ids)
    ):
        raise BuilderExecutionPolicyError("native_pending_mismatch")
    continuations = {
        (row.invocation_id, row.checkpoint_id): row
        for row in session.scalars(
            select(NativeContinuation).where(
                NativeContinuation.request_id == ref.request_id, NativeContinuation.tenant_id == tenant_id
            )
        )
    }
    path, selected = set(), state.invocation_id
    while selected is not None:
        owner = states.get(selected)
        if selected in path or owner is None or (owner.tenant_id, owner.request_id) != (tenant_id, ref.request_id):
            raise BuilderExecutionPolicyError("native_pending_mismatch")
        path.add(selected)
        selected = owner.parent_invocation_id
    claims = session.scalars(
        select(NativeDispatch).where(NativeDispatch.request_id == ref.request_id, NativeDispatch.tenant_id == tenant_id)
    ).all()
    if not any(
        row.invocation_id in path
        and row.generation == state.generation
        and row.state in dispatch_states
        and (row.tenant_id, row.request_id) == (tenant_id, ref.request_id)
        and (row.invocation_id, row.checkpoint_id) in continuations
        and continuations[row.invocation_id, row.checkpoint_id].generation < row.generation
        and (row.invocation_id != state.invocation_id or row.checkpoint_id == state.checkpoint_id)
        for row in claims
    ):
        raise BuilderExecutionPolicyError("native_pending_mismatch")
    selected_checkpoint = continuations.get((state.invocation_id, state.checkpoint_id))
    if (
        selected_checkpoint is None
        or selected_checkpoint.generation >= state.generation
        or (selected_checkpoint.tenant_id, selected_checkpoint.request_id, selected_checkpoint.invocation_id)
        != (tenant_id, ref.request_id, state.invocation_id)
    ):
        raise BuilderExecutionPolicyError("native_pending_mismatch")
    rows = session.scalars(
        select(NativePendingAction).where(
            NativePendingAction.request_id == ref.request_id,
            NativePendingAction.tenant_id == tenant_id,
            NativePendingAction.id.in_(ids),
        )
    ).all()
    by_id = {row.id: row for row in rows}
    if set(by_id) != set(ids) or len(rows) != len(ids):
        raise BuilderExecutionPolicyError("native_pending_mismatch")
    for row in rows:
        owner = states.get(row.invocation_id)
        saved = continuations.get((row.invocation_id, owner.checkpoint_id)) if owner is not None else None
        if (
            owner is None
            or saved is None
            or row.id not in owner.pending_ids
            or (owner.tenant_id, owner.request_id) != (tenant_id, ref.request_id)
            or (row.tenant_id, row.request_id, saved.tenant_id, saved.request_id)
            != (tenant_id, ref.request_id, tenant_id, ref.request_id)
            or row.category not in {"approval", "configuration", "interaction"}
            or row.generation != saved.generation
            or saved.generation >= owner.generation
        ):
            raise BuilderExecutionPolicyError("native_pending_mismatch")
        descendant, seen = row.invocation_id, set()
        while descendant != state.invocation_id:
            if descendant in seen or descendant not in states:
                raise BuilderExecutionPolicyError("native_pending_mismatch")
            seen.add(descendant)
            descendant = states[descendant].parent_invocation_id
            if descendant is None:
                raise BuilderExecutionPolicyError("native_pending_mismatch")
    return tuple(by_id[identity] for identity in ids)


def dispatch_readiness(session, *, ref, tenant_id, now, coalesce_self=False):
    """SQL-only physical admission; caller's root lock serializes any write.

    Recovery/private reads retain their separate authority. Global generation
    changes do not invalidate another branch's current local generation.
    Owned wait boundaries may coalesce a validated self fence into an owned wait.
    """
    request = session.scalar(
        select(DifyBuilderExecutionRequest).where(
            DifyBuilderExecutionRequest.id == ref.request_id, DifyBuilderExecutionRequest.tenant_id == tenant_id
        )
    )
    scope = session.scalar(
        select(NativeTestScope).where(
            NativeTestScope.request_id == ref.request_id, NativeTestScope.tenant_id == tenant_id
        )
    )
    if (
        request is None
        or (request.id, request.tenant_id, request.context_digest) != (ref.request_id, tenant_id, ref.context_digest)
        or scope is None
        or (scope.request_id, scope.tenant_id) != (ref.request_id, tenant_id)
        or scope.cancelled
        or scope.expires_at <= now
    ):
        raise BuilderExecutionPolicyError("native_dispatch_closed")
    states = {
        state.invocation_id: state
        for state in session.scalars(
            select(NativeInvocationState).where(
                NativeInvocationState.request_id == ref.request_id, NativeInvocationState.tenant_id == tenant_id
            )
        )
    }
    active = {
        row.invocation_id
        for row in session.scalars(
            select(NativeTestInvocation).where(
                NativeTestInvocation.request_id == ref.request_id, NativeTestInvocation.tenant_id == tenant_id
            )
        )
        if row.active and (row.request_id, row.tenant_id) == (ref.request_id, tenant_id)
    }
    roots = [state for state in states.values() if state.parent_invocation_id is None]
    selected, seen, fence = ref.invocation_id, set(), None
    while True:
        state = states.get(selected)
        if (
            selected in seen
            or state is None
            or selected not in active
            or (state.request_id, state.tenant_id) != (ref.request_id, tenant_id)
            or state.state != "running"
        ):
            raise BuilderExecutionPolicyError("native_dispatch_closed")
        seen.add(selected)
        if type(state.pending_ids) is not list or state.wait_reason not in {
            None,
            "approval",
            "configuration",
            "interaction",
        }:
            raise BuilderExecutionPolicyError("native_pending_mismatch")
        if state.wait_reason is not None:
            if selected != ref.invocation_id or not coalesce_self:
                raise BuilderExecutionPolicyError("native_dispatch_fenced")
            rows = session.scalars(
                select(NativePendingAction).where(
                    NativePendingAction.tenant_id == tenant_id,
                    NativePendingAction.request_id == ref.request_id,
                    NativePendingAction.id.in_(state.pending_ids),
                )
            ).all()
            validated = validate_pending_fence(
                rows, state=state, ref=ref, tenant_id=tenant_id, pending_ids=state.pending_ids
            )
            if pending_reason(validated) != state.wait_reason:
                raise BuilderExecutionPolicyError("native_pending_mismatch")
            fence = next(row for row in validated if row.category == state.wait_reason)
        elif state.pending_ids:
            validate_pending_history(
                session,
                ref=ref.model_copy(update={"invocation_id": selected}),
                tenant_id=tenant_id,
                state=state,
                states=states,
            )
        if state.parent_invocation_id is None:
            if len(roots) != 1 or (state.app_id, state.workflow_id) != (request.app_id, request.workflow_id):
                raise BuilderExecutionPolicyError("native_dispatch_closed")
            return fence
        selected = state.parent_invocation_id


def invocation_subtree(session, ref, tenant_id):
    states = session.scalars(
        select(NativeInvocationState).where(
            NativeInvocationState.request_id == ref.request_id, NativeInvocationState.tenant_id == tenant_id
        )
    ).all()
    ids = {ref.invocation_id}
    while True:
        expanded = ids | {state.invocation_id for state in states if state.parent_invocation_id in ids}
        if expanded == ids:
            return [state for state in states if state.invocation_id in ids]
        ids = expanded


def quarantine_unknown(session, *, ref, tenant_id, outcome=None):
    """Caller holds the root request lock. Preserve descendants' saved execution facts.

    An unknown descendant blocks ancestor resume separately; only trusted whole
    subtree native fencing evidence may restore execution authority.
    """
    states = invocation_subtree(session, ref, tenant_id)
    ids = {state.invocation_id for state in states}
    for state in states:
        if state.invocation_id == ref.invocation_id and state.state not in {"completed", "stopped", "cancelled"}:
            state.state = "unknown"
            if outcome is not None:
                state.outcome = outcome
    for invocation in session.scalars(
        select(NativeTestInvocation).where(
            NativeTestInvocation.request_id == ref.request_id,
            NativeTestInvocation.tenant_id == tenant_id,
            NativeTestInvocation.invocation_id.in_(ids),
        )
    ):
        invocation.active = False
    for dispatch in session.scalars(
        select(NativeDispatch).where(
            NativeDispatch.request_id == ref.request_id,
            NativeDispatch.tenant_id == tenant_id,
            NativeDispatch.invocation_id.in_(ids),
            NativeDispatch.state.in_(("queued", "published", "claimed")),
        )
    ):
        dispatch.state = "unknown"


def has_unknown_descendant(session, ref, tenant_id):
    return any(state.state == "unknown" for state in invocation_subtree(session, ref, tenant_id))


def require_ancestor_authority(session, ref, tenant_id):
    """An invocation's own proof cannot discharge a controlling ancestor quarantine.

    Call before external recovery proof and again under the root request lock.
    The selected invocation may itself be unknown/inactive during recovery;
    every ancestor must still own execution authority. Missing/cyclic lineage
    fails closed instead of treating a disconnected child as another root.
    """
    states = {
        state.invocation_id: state
        for state in session.scalars(
            select(NativeInvocationState).where(
                NativeInvocationState.request_id == ref.request_id, NativeInvocationState.tenant_id == tenant_id
            )
        )
    }
    active_ids = set(
        session.scalars(
            select(NativeTestInvocation.invocation_id).where(
                NativeTestInvocation.request_id == ref.request_id,
                NativeTestInvocation.tenant_id == tenant_id,
                NativeTestInvocation.active.is_(True),
            )
        )
    )
    state = states.get(ref.invocation_id)
    seen = {ref.invocation_id}
    if state is None:
        raise BuilderExecutionPolicyError("native_ancestor_quarantined")
    while state.parent_invocation_id is not None:
        parent_id = state.parent_invocation_id
        if parent_id in seen or parent_id not in active_ids:
            raise BuilderExecutionPolicyError("native_ancestor_quarantined")
        seen.add(parent_id)
        state = states.get(parent_id)
        if state is None or state.state not in {"running", "waiting", "queued"}:
            raise BuilderExecutionPolicyError("native_ancestor_quarantined")


def recoverable_invocation_ids(states, root_invocation_id):
    """Restore only paths whose complete lineage belongs to the recovered subtree.

    An independently unknown or completed branch remains inactive, including its
    descendants, even when the controlling root's physical fence is proven.
    """
    eligible = {state.invocation_id: state for state in states if state.state in {"running", "waiting", "queued"}}
    recoverable = {root_invocation_id} if root_invocation_id in eligible else set()
    while True:
        expanded = recoverable | {
            state.invocation_id for state in eligible.values() if state.parent_invocation_id in recoverable
        }
        if expanded == recoverable:
            return recoverable
        recoverable = expanded
