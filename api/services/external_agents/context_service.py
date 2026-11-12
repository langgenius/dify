"""Production context isolation and reservation use cases.

Contexts are server-origin opaque values, not authorization or remote memory.
Scope/epoch/revision and reservation fences prevent old results from changing a
new binding. Invocation-body retention cannot free an unresolved reservation.
"""

from .invocation_agg import remote_state
from .protocol import GatewayReceipt
from .runtime_contracts import ContextKey, ContextSlot, ContextStore, Invocation, RuntimeError


def context_key(invocation: Invocation) -> ContextKey | None:
    """Return complete production scope; tests/debugging never access this slot."""
    scope, identity = invocation.scope, invocation.identity
    if scope.origin != "production" or scope.app_id is None or identity.conversation_id is None:
        return None
    if invocation.connection_revision_id is None:
        raise RuntimeError("dispatch_not_admitted", "A context needs an admitted connection revision.")
    return ContextKey(
        tenant_id=scope.tenant_id,
        app_id=scope.app_id,
        conversation_id=identity.conversation_id,
        node_id=identity.node_id,
        binding_epoch=identity.binding_epoch,
        agent_id=invocation.agent_id,
        connection_revision_id=invocation.connection_revision_id,
        # Graphon root is stable across turns. Container frames include their
        # invocation lineage, so equal iteration indexes do not imply affinity.
        frame_scope="" if identity.frame_id == "root" else identity.frame_id,
    )


class ExternalContextService:
    """Coordinate the context port; the repository owns uniqueness and CAS."""

    def __init__(self, store: ContextStore) -> None:
        self._store = store

    def reserve(self, invocation: Invocation) -> ContextSlot | None:
        """Reserve full scope atomically, including the first call with no ctx.

        The dispatch repository normally invokes the same atomic rule inside its
        permit transaction. This entry point supports explicit owned reservation.
        A busy slot raises ContextBusyError; it never queues another turn.
        """
        key = context_key(invocation)
        return None if key is None else self._store.reserve(key, invocation.id)

    def observe(self, invocation: Invocation, receipt: GatewayReceipt) -> bool:
        """Settle only matching reservation; read/cancel failure cannot call this as terminal."""
        key = context_key(invocation)
        if key is None:
            return True
        carried = invocation.carried_context_id
        if carried and receipt.context_id and carried != receipt.context_id:
            raise RuntimeError("response_correlation_error", "External context ID conflicts with its Invocation.")
        terminal = receipt.kind == "message" or remote_state(receipt.state) in {
            "completed",
            "failed",
            "rejected",
            "canceled",
        }
        return self._store.settle(
            key,
            invocation.id,
            context_id=receipt.context_id,
            remote_terminal=terminal,
            unresolved=not terminal,
        )
