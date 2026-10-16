"""Private physical ownership kernel; no durable claim or execution authority.

Trusted composition constructs an inert per-acquisition verifier, injects that
exact instance into capacity, then activates it AFTER the durable claim. All
owned starts go through this owner. An unknown outcome is sticky even if actual
late cleanup subsequently permits the single capacity-cleanup consumption.

Native idle pool threads are outside this claim: node scopes retain concrete
work and its current thread, not a promise that Graphon's entire pool has died.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from math import isfinite
from threading import Condition, RLock, Thread, current_thread
from time import monotonic
from typing import Literal, Protocol

from graphon.nodes.base.node import Node
from graphon.runtime.graph_runtime_state import GraphRuntimeState
from services.dify_builder.native_testing.contracts import NativeTestContextRef
from services.dify_builder.native_testing.control import NativeControlRecord
from services.dify_builder.native_testing.runtime_contracts import ResolvedNativeTestContext

ThreadRole = Literal["worker", "reader", "dispatcher"]
CloseReason = Literal["cancel", "consumer_closed", "exhausted", "failed"]
Settlement = Literal["settled", "unknown"]
RefKey = tuple[str, str, str, str]


def _key(ref: NativeTestContextRef) -> RefKey:
    if type(ref) is not NativeTestContextRef:
        raise ValueError("native_host_ref_invalid")
    NativeTestContextRef.model_validate(ref.model_dump(warnings=False), strict=True)
    return ref.policy_version, ref.request_id, ref.invocation_id, ref.context_digest


class _Closable(Protocol):
    def close(self) -> None: ...


@dataclass(eq=False, slots=True)
class _ThreadOwnership:
    thread: Thread
    role: ThreadRole
    attempted: bool = False
    starting: bool = False
    startup_failed: bool = False
    finished: bool = False
    joined: bool = False


@dataclass(frozen=True, eq=False, slots=True)
class NativeHostNodeScope:
    """Retained actual observation, including pool-thread work between yields."""

    node: Node
    runtime_state: GraphRuntimeState
    execution_id: str
    phase: Literal["run", "resume_container"]
    thread: Thread


class NativeHostLifetimeRegistry:
    """One durable root request/tree's physical owners and compact tombstones.

    Trusted composition allocates one registry for that scope and MUST dispose
    it once the durable tree will admit no more deliveries and all registered
    physical cleanup authorities were consumed. Never reuse it across requests
    or keep it as a process-global history. Incomplete owners are never evicted.
    There is deliberately no ID-only cleanup lookup or full acquisition history.
    """

    def __init__(self) -> None:
        self._lock = RLock()
        self._condition = Condition(self._lock)
        self._current: dict[RefKey, NativeHostLifetime] = {}
        self._root_key: RefKey | None = None
        self._owner: tuple[str, str] | None = None
        self._disposed = False

    def activate(self, *, lifetime: NativeHostLifetime) -> None:
        """Trusted post-claim handoff only; this method does not claim SQL."""
        if type(lifetime) is not NativeHostLifetime:
            raise ValueError("native_host_lifetime_invalid")
        with self._condition:
            key = _key(lifetime.ref)
            context = lifetime.context
            if self._disposed or lifetime._registry is not None:
                raise ValueError("native_host_acquisition_not_current")
            if self._root_key is None:
                if context.parent_invocation_id is not None:
                    raise ValueError("native_host_registry_root_required")
            elif (
                lifetime.ref.request_id != self._root_key[1]
                or (context.tenant_id, context.actor_id) != self._owner
                or (context.parent_invocation_id is None and key != self._root_key)
                or (
                    context.parent_invocation_id is not None
                    and not any(
                        parent.ref.invocation_id == context.parent_invocation_id
                        and parent._call_depth + 1 == context.call_depth
                        and not parent._consumed
                        for parent in self._current.values()
                    )
                )
            ):
                raise ValueError("native_host_registry_scope_invalid")
            previous = self._current.get(key)
            if previous is not None and (not previous._consumed or previous.generation > lifetime.generation):
                raise ValueError("native_host_acquisition_not_current")
            if self._root_key is None:
                self._root_key = key
                self._owner = context.tenant_id, context.actor_id
            lifetime._registry = self
            lifetime._condition = self._condition
            self._current[key] = lifetime

    def dispose(self) -> None:
        """Permanently close this request/tree registry after proven cleanup.

        The durable owner must first stop admitting deliveries for this tree.
        This method checks physical ownership only, and refuses any unconsumed
        instance, including unknown/incomplete ownership. No TTL is consulted.
        """
        with self._condition:
            if self._disposed or any(not lifetime._consumed for lifetime in self._current.values()):
                raise ValueError("native_host_registry_disposal_refused")
            self._disposed = True
            self._current.clear()
            self._root_key = None
            self._owner = None
            self._condition.notify_all()


class NativeHostCallTicket:
    """One real call's admission/callback/stream lifetime, never a count.

    Created only by call_scope, before admission. The caller keeps that context
    around the actual scalar call and any owned stream. Stream close executes on
    the owning thread in finally; a failed close leaves this ticket retained and
    incomplete. This object grants no permit or scalar-ledger authority.
    """

    def __init__(self, lifetime: NativeHostLifetime) -> None:
        self._lifetime = lifetime
        self._thread: Thread | None = current_thread()
        self._streams: list[_Closable] = []
        self._closed_streams: list[_Closable] = []
        self._callback_active = False
        self._closed = False

    def _require_owner(self) -> None:
        if (
            self._thread is not current_thread()
            or self._closed
            or not any(ticket is self for ticket in self._lifetime._tickets)
        ):
            raise ValueError("native_host_ticket_owner_invalid")

    def own_stream(self, *, stream: _Closable) -> None:
        with self._lifetime._condition:
            self._require_owner()
            if not callable(getattr(stream, "close", None)) or any(item is stream for item in self._streams):
                raise ValueError("native_host_stream_invalid")
            self._streams.append(stream)

    @contextmanager
    def callback_scope(self) -> Generator[None]:
        life = self._lifetime
        with life._condition:
            self._require_owner()
            life._require_open()
            if self._callback_active:
                raise ValueError("native_host_callback_reentered")
            self._callback_active = True
        try:
            yield
        finally:
            with life._condition:
                self._callback_active = False
                life._condition.notify_all()

    def _finish(self) -> None:
        self._require_owner()
        try:
            # Never invoke external close while holding the ownership lock, or
            # close an executing generator concurrently from the coordinator.
            for stream in self._streams:
                stream.close()
                self._closed_streams.append(stream)
        except BaseException:
            self._lifetime.mark_unknown()
            raise
        with self._lifetime._condition:
            self._closed = True
            self._lifetime._condition.notify_all()

    def _retire(self) -> None:
        # Called only after complete physical proof, under the registry mutex.
        self._streams.clear()
        self._closed_streams.clear()
        self._thread = None


class NativeHostLifetime:
    """One exact context/local generation/dispatch and its physical descendants.

    The constructor is inert. Registry activation is a trusted server handoff,
    never a claim receipt. Registration/admission facts use only a short local
    mutex: permission RPCs, physical callbacks, stream closure and joins always
    execute outside it. Handles/tickets/observations remain until proven cleanup;
    then heavyweight payloads retire and only compact consumed identity remains.
    """

    def __init__(self, *, context: ResolvedNativeTestContext, dispatch_id: str) -> None:
        if type(context) is not ResolvedNativeTestContext or not isinstance(dispatch_id, str) or not dispatch_id:
            raise ValueError("native_host_identity_invalid")
        ResolvedNativeTestContext.model_validate(context.model_dump(warnings=False), strict=True)
        _key(context.ref)
        if context.execution_mode != "native":
            raise ValueError("native_host_native_context_required")
        self._context: ResolvedNativeTestContext | None = context
        self._ref = context.ref
        self._generation = context.generation
        self._tenant_id = context.tenant_id
        self._actor_id = context.actor_id
        self._parent_invocation_id = context.parent_invocation_id
        self._call_depth = context.call_depth
        self._dispatch_id = dispatch_id
        self._registry: NativeHostLifetimeRegistry | None = None
        self._condition = Condition(RLock())
        self._threads: list[_ThreadOwnership] = []
        self._runtimes: list[GraphRuntimeState] = []
        self._node_scopes: list[NativeHostNodeScope] = []
        self._active_scopes: list[NativeHostNodeScope] = []
        self._tickets: list[NativeHostCallTicket] = []
        self._expected_children: dict[RefKey, NativeHostLifetime | None] = {}
        self._records: list[NativeControlRecord] = []
        self._deadline: float | None = None
        self._unknown = False
        self._consumed = False
        self._settled_in_time = False
        self._parent: NativeHostLifetime | None = None

    def _invalidate_settlement(self) -> None:
        # Actual attached lineage, under the shared registry mutex. Every quiet
        # sample above this work is stale; child semantic outcomes are separate.
        owner: NativeHostLifetime | None = self
        while owner is not None:
            owner._settled_in_time = False
            owner = owner._parent

    @property
    def context(self) -> ResolvedNativeTestContext:
        """Live payload only; successful cleanup retires heavyweight context."""
        with self._condition:
            if self._context is None:
                raise ValueError("native_host_payload_retired")
            return self._context

    @property
    def ref(self) -> NativeTestContextRef:
        return self._ref

    @property
    def generation(self) -> int:
        return self._generation

    @property
    def dispatch_id(self) -> str:
        return self._dispatch_id

    def _require_current(self) -> None:
        registry = self._registry
        if registry is None or registry._current.get(_key(self.ref)) is not self or self._consumed:
            raise ValueError("native_host_acquisition_not_current")

    def _require_tracking(self) -> None:
        self._require_current()
        ancestor = self._parent
        while ancestor is not None:
            ancestor._require_current()
            ancestor = ancestor._parent

    def _require_open(self) -> None:
        self._require_tracking()
        if self._deadline is not None or self._unknown:
            raise ValueError("native_host_admission_closed")

    @property
    def unknown(self) -> bool:
        with self._condition:
            return self._unknown

    @property
    def active_node_scopes(self) -> tuple[NativeHostNodeScope, ...]:
        with self._condition:
            return tuple(self._active_scopes)

    @property
    def control_records(self) -> tuple[NativeControlRecord, ...]:
        with self._condition:
            return tuple(self._records)

    def mark_unknown(self) -> None:
        """Conservative ambiguity input; cannot confer cleanup/wait authority."""
        with self._condition:
            self._require_current()
            self._unknown = True
            self._condition.notify_all()

    def register_thread(self, *, thread: Thread, role: ThreadRole) -> None:
        """Retain new worker/reader/explicit dispatcher BEFORE start_thread."""
        with self._condition:
            self._require_open()
            if (
                not isinstance(thread, Thread)
                or role not in ("worker", "reader", "dispatcher")
                or thread.ident is not None
                or any(item.thread is thread for item in self._threads)
                or (role in ("worker", "reader") and any(item.role == role for item in self._threads))
            ):
                raise ValueError("native_host_thread_registration_refused")
            self._threads.append(_ThreadOwnership(thread=thread, role=role))

    def _thread(self, thread: Thread) -> _ThreadOwnership:
        for item in self._threads:
            if item.thread is thread:
                return item
        raise ValueError("native_host_thread_missing")

    def start_thread(self, *, thread: Thread) -> None:
        """Only owned start path: refusal never calls Thread.start."""
        with self._condition:
            self._require_open()
            item = self._thread(thread)
            if item.attempted:
                raise ValueError("native_host_thread_start_replayed")
            item.attempted = item.starting = True
        try:
            thread.start()
        except BaseException:
            with self._condition:
                item.startup_failed = True
            raise
        finally:
            with self._condition:
                item.starting = False
                self._condition.notify_all()

    def thread_finished(self, *, thread: Thread) -> None:
        """Actual worker/reader finally callback, separately from physical exit."""
        with self._condition:
            self._require_current()
            item = self._thread(thread)
            if thread is not current_thread() or not item.attempted or item.finished:
                raise ValueError("native_host_finally_invalid")
            item.finished = True
            self._condition.notify_all()

    def observe_dispatcher(self) -> None:
        """First delegated command poll retains its actual current Thread."""
        with self._condition:
            self._require_current()
            thread = current_thread()
            if any(item.thread is thread for item in self._threads):
                return
            self._require_open()
            self._threads.append(_ThreadOwnership(thread=thread, role="dispatcher", attempted=True))

    def bind_runtime(self, *, runtime_state: GraphRuntimeState) -> None:
        """Retain each actual root/container runtime before entering its nodes."""
        with self._condition:
            self._require_open()
            if not isinstance(runtime_state, GraphRuntimeState) or any(
                item is runtime_state for item in self._runtimes
            ):
                raise ValueError("native_host_runtime_invalid")
            self._runtimes.append(runtime_state)

    @contextmanager
    def node_scope(self, *, node: Node, phase: Literal["run", "resume_container"]) -> Generator[None]:
        # Observation remains available for late native siblings after control.
        # It grants no IO; C02 owns common wait/replay and callback_scope gates
        # actual new physical entry. Consumed/noncurrent owners still refuse.
        with self._condition:
            self._require_tracking()
            if (
                not isinstance(node, Node)
                or phase not in ("run", "resume_container")
                or not any(item is node.graph_runtime_state for item in self._runtimes)
                or not node.execution_id
            ):
                raise ValueError("native_host_node_invalid")
            scope = NativeHostNodeScope(node, node.graph_runtime_state, node.execution_id, phase, current_thread())
            self._invalidate_settlement()
            self._node_scopes.append(scope)
            self._active_scopes.append(scope)
        try:
            yield
        finally:
            with self._condition:
                self._active_scopes.remove(scope)
                self._condition.notify_all()

    @contextmanager
    def call_scope(self) -> Generator[NativeHostCallTicket]:
        # Retain before admission even when C02 will coalesce a fenced wait.
        with self._condition:
            self._require_tracking()
            self._invalidate_settlement()
            ticket = NativeHostCallTicket(self)
            self._tickets.append(ticket)
        try:
            yield ticket
        finally:
            ticket._finish()

    def _arm(self, deadline: float) -> None:
        if type(deadline) not in (float, int) or not isfinite(deadline):
            raise ValueError("native_host_deadline_invalid")
        self._require_current()
        if self._deadline is None:
            self._deadline = deadline
        self._condition.notify_all()

    def request_close(self, *, reason: CloseReason, deadline: float) -> None:
        """Arm trusted absolute monotonic deadline; never reset/extend it."""
        if reason not in ("cancel", "consumer_closed", "exhausted", "failed"):
            raise ValueError("native_host_close_reason_invalid")
        with self._condition:
            self._arm(deadline)

    def record_control(self, *, record: NativeControlRecord, deadline: float) -> None:
        """Record before any external admission/fence RPC; no fence acceptance."""
        with self._condition:
            self._require_current()
            if (
                type(record) is not NativeControlRecord
                or record.control.ref != self.ref
                or not any(
                    scope.node.id == record.node_id
                    and scope.execution_id == record.native_execution_id
                    and scope.thread is current_thread()
                    for scope in self._active_scopes
                )
            ):
                raise ValueError("native_host_control_scope_invalid")
            self._arm(deadline)
            self._records.append(record)

    def expect_child(self, *, ref: NativeTestContextRef) -> None:
        """Record a real impending descendant before child dispatch/composition."""
        with self._condition:
            self._require_open()
            key = _key(ref)
            if ref.request_id != self.ref.request_id or key == _key(self.ref) or key in self._expected_children:
                raise ValueError("native_host_child_invalid")
            self._expected_children[key] = None

    def attach_child(self, *, child: NativeHostLifetime) -> None:
        """Attach only an expected, actual current retained descendant."""
        with self._condition:
            self._require_current()
            child._require_current()
            key = _key(child.ref)
            if (
                child._registry is not self._registry
                or key not in self._expected_children
                or self._expected_children[key] is not None
                or child._parent is not None
                or child._parent_invocation_id != self.ref.invocation_id
                or child._call_depth != self._call_depth + 1
                or child._tenant_id != self._tenant_id
                or child._actor_id != self._actor_id
            ):
                raise ValueError("native_host_child_invalid")
            child._parent = self
            self._expected_children[key] = child
            self._invalidate_settlement()
            self._condition.notify_all()

    def _join_tree(self, deadline: float) -> None:
        # Snapshots only under lock. Joins must never block control registration.
        with self._condition:
            threads = tuple(self._threads)
            children = tuple(self._expected_children.values())
        for item in threads:
            thread = item.thread
            if thread is current_thread():
                with self._condition:
                    self._unknown = True
                continue
            if thread.ident is None:
                continue  # Unstarted is NOT proven; _ready checks startup facts.
            thread.join(timeout=max(0.0, deadline - monotonic()))
            if not thread.is_alive():
                with self._condition:
                    item.joined = True
        for child in children:
            if child is not None:
                child._join_tree(deadline)

    def _ready(self) -> bool:
        # All callers hold the service-local registry lock, including descendants.
        registry = self._registry
        if registry is None or registry._current.get(_key(self.ref)) is not self or self._deadline is None:
            return False
        if self._consumed:
            return True  # Exact current instance already proved physical cleanup.
        if not any(item.role == "worker" for item in self._threads) or self._active_scopes:
            return False
        for item in self._threads:
            if not item.attempted or item.starting:
                return False
            if item.startup_failed and item.thread.ident is None:
                continue
            if not item.joined or item.thread.is_alive() or (item.role != "dispatcher" and not item.finished):
                return False
        return all(ticket._closed and not ticket._callback_active for ticket in self._tickets) and all(
            child is not None and child._ready() for child in self._expected_children.values()
        )

    def settle(self) -> Settlement:
        """Independent coordinator; every join uses ONE trusted deadline.

        Expired/ambiguous outcomes stay unknown. A later call may refresh actual
        cleanup evidence but cannot change that outcome into resumable waiting.
        """
        with self._condition:
            self._require_current()
            if self._deadline is None:
                raise ValueError("native_host_settlement_not_armed")
            deadline = self._deadline
        while True:
            self._join_tree(deadline)
            with self._condition:
                if self._ready():
                    if monotonic() <= deadline:
                        self._settled_in_time = True
                    elif not self._settled_in_time:
                        self._unknown = True
                    return "unknown" if self._unknown else "settled"
                remaining = deadline - monotonic()
                if remaining <= 0 or any(item.thread is current_thread() for item in self._threads):
                    self._unknown = True
                    return "unknown"
                self._condition.wait(timeout=remaining)

    def consume_cleanup(self, *, ref: NativeTestContextRef, generation: int, dispatch_id: str) -> None:
        """Frozen capacity verifier: exactly-once, exact-current physical proof.

        Never infers proof from absent local state, SQL status, cancellation IDs,
        TTL or a caller-created clean flag. Nonblocking joins refresh late actual
        cleanup; sticky uncertainty remains intact after successful consumption.
        """
        with self._condition:
            self._require_current()
            if (
                _key(ref) != _key(self.ref)
                or type(generation) is not int
                or generation != self.generation
                or dispatch_id != self.dispatch_id
            ):
                raise ValueError("native_host_cleanup_identity_invalid")
        self._join_tree(monotonic())
        with self._condition:
            self._require_current()
            if not self._ready():
                raise ValueError("native_host_cleanup_incomplete")
            if self._deadline is not None and monotonic() > self._deadline and not self._settled_in_time:
                self._unknown = True
            self._consumed = True
            for ticket in self._tickets:
                ticket._retire()
            self._context = None
            self._threads.clear()
            self._runtimes.clear()
            self._node_scopes.clear()
            self._tickets.clear()
            self._expected_children.clear()
            self._records.clear()
            self._condition.notify_all()
