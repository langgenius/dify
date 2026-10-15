"""Transaction-local quarantine shared by every native unknown outcome path."""

from sqlalchemy import select

from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState, NativeTestInvocation


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
