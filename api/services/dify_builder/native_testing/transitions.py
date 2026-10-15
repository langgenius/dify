"""Transaction-local quarantine shared by every native unknown outcome path."""

from sqlalchemy import select

from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState, NativeTestInvocation
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError


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
