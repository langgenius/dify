"""Physical ownership witnesses: real threads/native nodes, no SQL or provider I/O."""

from __future__ import annotations

from collections.abc import Callable, Generator
from threading import Barrier, Event, Thread, current_thread
from time import monotonic, sleep
from typing import Literal, cast, override

import pytest

from services.dify_builder.native_testing.control import NativeApprovalWait, NativeControlRecord
from services.dify_builder.native_testing.host_lifetime import (
    NativeHostCallTicket,
    NativeHostLifetime,
    NativeHostLifetimeRegistry,
    ThreadRole,
)
from services.dify_builder.native_testing.runtime_contracts import ResolvedNativeTestContext
from tests.unit_tests.services.dify_builder.native_testing.test_runtime_contracts import CONTEXT


def opened(
    *, registry: NativeHostLifetimeRegistry | None = None, context: ResolvedNativeTestContext | None = None
) -> tuple[NativeHostLifetimeRegistry, NativeHostLifetime]:
    registry = registry or NativeHostLifetimeRegistry()
    life = NativeHostLifetime(
        context=context or ResolvedNativeTestContext.model_validate(CONTEXT), dispatch_id="dispatch"
    )
    registry.activate(lifetime=life)  # Trusted composition AFTER durable claim; not a SQL witness.
    return registry, life


def consume(life: NativeHostLifetime) -> None:
    assert life.consume_cleanup(ref=life.ref, generation=life.generation, dispatch_id="dispatch") is None


def close(life: NativeHostLifetime, allowance: float = 0.5) -> None:
    life.request_close(reason="cancel", deadline=monotonic() + allowance)


def worker(life: NativeHostLifetime, body: Callable[[], None] = lambda: None, *, role: ThreadRole = "worker") -> Thread:
    def run() -> None:
        try:
            body()
        finally:
            life.thread_finished(thread=current_thread())

    thread = Thread(target=run)
    life.register_thread(thread=thread, role=role)
    life.start_thread(thread=thread)
    return thread


def test_inert_or_missing_ownership_never_establishes_cleanup() -> None:
    registry = NativeHostLifetimeRegistry()
    life = NativeHostLifetime(context=ResolvedNativeTestContext.model_validate(CONTEXT), dispatch_id="dispatch")
    with pytest.raises(ValueError):
        life.register_thread(thread=Thread(), role="worker")
    with pytest.raises(ValueError):
        consume(life)
    registry.activate(lifetime=life)
    close(life)
    assert life.settle() == "unknown"
    with pytest.raises(ValueError):
        consume(life)


def test_registration_refusal_prevents_start_and_unstarted_false_is_not_proof() -> None:
    _, life = opened()
    ran = Event()
    thread = Thread(target=ran.set)
    with pytest.raises(ValueError):
        life.start_thread(thread=thread)
    assert not ran.is_set()
    assert thread.ident is None
    life.register_thread(thread=thread, role="worker")
    close(life, 0.01)
    assert not thread.is_alive()
    assert life.settle() == "unknown"
    with pytest.raises(ValueError):
        consume(life)
    with pytest.raises(ValueError):
        life.start_thread(thread=thread)
    assert thread.ident is None


def test_finally_callback_is_not_exit_and_late_cleanup_preserves_unknown() -> None:
    _, life = opened()
    finished, release = Event(), Event()

    def run() -> None:
        life.thread_finished(thread=current_thread())
        finished.set()
        release.wait(2)

    thread = Thread(target=run)
    life.register_thread(thread=thread, role="worker")
    life.start_thread(thread=thread)
    try:
        assert finished.wait(1)
        close(life, 0.02)
        assert life.settle() == "unknown"
        assert thread.is_alive()
        with pytest.raises(ValueError):
            consume(life)
    finally:
        release.set()
        thread.join(2)
    assert life.settle() == "unknown"
    consume(life)
    assert life.unknown
    with pytest.raises(ValueError):
        consume(life)


def test_start_failure_is_explicit_and_cleanup_is_exactly_once() -> None:
    _, life = opened()

    class FailedStart(Thread):
        @override
        def start(self) -> None:
            raise RuntimeError("startup refused")

    thread = FailedStart()
    life.register_thread(thread=thread, role="worker")
    with pytest.raises(RuntimeError, match="startup refused"):
        life.start_thread(thread=thread)
    close(life)
    assert life.settle() == "settled"
    consume(life)
    with pytest.raises(ValueError):
        consume(life)


def test_missing_finally_is_not_equivalent_to_joined_thread() -> None:
    _, life = opened()
    thread = Thread(target=lambda: None)
    life.register_thread(thread=thread, role="worker")
    life.start_thread(thread=thread)
    thread.join(1)
    close(life, 0.01)
    assert life.settle() == "unknown"
    with pytest.raises(ValueError):
        consume(life)


def test_foreign_generation_and_reacquired_same_identity_cannot_consume_current() -> None:
    registry, old = opened()
    worker(old).join(1)
    close(old)
    assert old.settle() == "settled"
    ref = old.context.ref.model_copy(update={"request_id": "foreign"})
    for other_ref, generation, dispatch in [
        (ref, old.context.generation, "dispatch"),
        (old.context.ref, 99, "dispatch"),
        (old.context.ref, old.context.generation, "other"),
    ]:
        with pytest.raises(ValueError):
            old.consume_cleanup(ref=other_ref, generation=generation, dispatch_id=dispatch)
    with pytest.raises(ValueError):
        opened(registry=registry)
    consume(old)
    _, new = opened(registry=registry)
    worker(new).join(1)
    close(new)
    assert new.settle() == "settled"
    with pytest.raises(ValueError):
        consume(old)
    consume(new)
    _, later = opened(
        registry=registry,
        context=ResolvedNativeTestContext.model_validate(CONTEXT).model_copy(update={"generation": new.generation + 1}),
    )
    with pytest.raises(ValueError):
        consume(new)
    worker(later).join(1)
    close(later)
    assert later.settle() == "settled"
    consume(later)


def test_one_shared_deadline_across_actual_threads_and_slow_precontrol_work() -> None:
    _, life = opened()
    ready, release = Barrier(4), Event()

    def blocked() -> None:
        ready.wait(2)
        release.wait(2)

    threads = [worker(life, blocked, role=role) for role in ("worker", "reader", "dispatcher")]
    try:
        ready.wait(2)
        sleep(0.06)
        assert not life.unknown
        started = monotonic()
        close(life, 0.08)
        assert life.settle() == "unknown"
        elapsed = monotonic() - started
        assert 0.06 <= elapsed < 0.19, elapsed
        assert all(thread.is_alive() for thread in threads)
    finally:
        release.set()
        for thread in threads:
            thread.join(2)
    consume(life)


def test_control_does_not_wait_for_blocked_permission_and_refuses_late_callback() -> None:
    _, life = opened()
    entered, release, dispatched, refused = Event(), Event(), Event(), Event()

    def blocked_permission() -> None:
        with life.call_scope() as ticket:
            entered.set()
            release.wait(2)  # Actual admission RPC belongs outside lifetime lock.
            try:
                with ticket.callback_scope():
                    dispatched.set()
            except ValueError:
                refused.set()

    thread = worker(life, blocked_permission)
    try:
        assert entered.wait(1)
        started = monotonic()
        close(life, 0.03)
        life.request_close(reason="cancel", deadline=monotonic() + 20)
        assert life.settle() == "unknown"
        assert monotonic() - started < 0.15
        assert not dispatched.is_set()
        with pytest.raises(ValueError):
            consume(life)
    finally:
        release.set()
        thread.join(2)
    assert refused.is_set()
    assert not dispatched.is_set()
    consume(life)
    assert life.unknown


def test_open_stream_retains_actual_ticket_until_owner_closes() -> None:
    _, life = opened()
    yielded, release, closed = Event(), Event(), Event()

    def source() -> Generator[str]:
        try:
            yield "value"
        finally:
            closed.set()

    def read() -> None:
        with life.call_scope() as ticket:
            stream = source()
            ticket.own_stream(stream=stream)
            assert next(stream) == "value"
            yielded.set()
            release.wait(2)

    thread = worker(life, read)
    try:
        assert yielded.wait(1)
        close(life, 0.02)
        assert life.settle() == "unknown"
        assert not closed.is_set()
        with pytest.raises(ValueError):
            consume(life)
    finally:
        release.set()
        thread.join(2)
    assert closed.is_set()
    consume(life)


def test_stream_close_failure_is_ambiguous_even_when_thread_exits() -> None:
    _, life = opened()
    errors: list[BaseException] = []

    class BrokenStream:
        def close(self) -> None:
            raise RuntimeError("closure unacknowledged")

    def read() -> None:
        try:
            with life.call_scope() as ticket:
                ticket.own_stream(stream=BrokenStream())
        except RuntimeError as exc:
            errors.append(exc)

    worker(life, read).join(1)
    close(life, 0.01)
    assert life.settle() == "unknown"
    assert len(errors) == 1
    with pytest.raises(ValueError):
        consume(life)


@pytest.mark.parametrize("phase", ["run", "resume_container"])
def test_real_native_scope_retains_node_runtime_execution_thread_through_closure(
    phase: Literal["run", "resume_container"],
) -> None:
    from tests.unit_tests.services.dify_builder.native_testing.test_control import bound_guard, make_native, permit

    _, life = opened()
    _, factory = make_native(decision=permit())
    node = bound_guard(factory)
    life.bind_runtime(runtime_state=factory.runtime)
    active, release = Event(), Event()

    def run() -> None:
        with life.node_scope(node=node, phase=phase):
            active.set()
            release.wait(2)

    thread = worker(life, run)
    try:
        assert active.wait(1)
        (scope,) = life.active_node_scopes
        assert scope.node is node
        assert scope.runtime_state is factory.runtime
        assert scope.thread is thread
        assert scope.execution_id == node.execution_id
        assert scope.phase == phase
        close(life, 0.02)
        assert life.settle() == "unknown"
        with pytest.raises(ValueError):
            consume(life)
    finally:
        release.set()
        thread.join(2)
    assert life.active_node_scopes == ()
    consume(life)


def test_control_record_requires_actual_active_node_and_exact_execution() -> None:
    from tests.unit_tests.services.dify_builder.native_testing.test_control import bound_guard, make_native, permit

    _, life = opened()
    _, factory = make_native(decision=permit())
    node = bound_guard(factory)
    life.bind_runtime(runtime_state=factory.runtime)
    record = NativeControlRecord(
        control=NativeApprovalWait(ref=life.context.ref, pending_operation_id="pending", wait_reason="approval"),
        node_id=node.id,
        native_execution_id=node.execution_id,
        carrier_ref="carrier",
    )
    with pytest.raises(ValueError):
        life.record_control(record=record, deadline=monotonic() + 1)
    with life.node_scope(node=node, phase="run"):
        life.record_control(record=record, deadline=monotonic() + 1)
    worker_thread = Thread()
    with pytest.raises(ValueError):
        life.register_thread(thread=worker_thread, role="worker")
    assert life.control_records == (record,)


def test_foreign_runtime_node_is_refused_and_self_join_never_blocks() -> None:
    from tests.unit_tests.services.dify_builder.native_testing.test_control import bound_guard, make_native, permit

    _, life = opened()
    _, factory = make_native(decision=permit())
    with pytest.raises(ValueError):
        with life.node_scope(node=bound_guard(factory), phase="run"):
            pass
    result: list[str] = []

    def run() -> None:
        close(life, 0.02)
        result.append(life.settle())

    thread = worker(life, run)
    thread.join(1)
    assert not thread.is_alive()
    assert result == ["unknown"]
    consume(life)


def test_unaccounted_child_prevents_parent_cleanup_until_actual_child_settles() -> None:
    registry, parent = opened()
    child_ref = parent.context.ref.model_copy(update={"invocation_id": "child"})
    parent.expect_child(ref=child_ref)
    worker(parent).join(1)
    close(parent, 0.01)
    assert parent.settle() == "unknown"
    with pytest.raises(ValueError):
        consume(parent)
    child_context = parent.context.model_copy(
        update={
            "ref": child_ref,
            "parent_invocation_id": parent.context.ref.invocation_id,
            "call_depth": parent.context.call_depth + 1,
        }
    )
    _, child = opened(registry=registry, context=child_context)
    parent.attach_child(child=child)
    worker(child).join(1)
    close(child)
    assert child.settle() == "settled"
    consume(parent)
    consume(child)


def test_owned_dispatcher_observation_and_ordinary_work_are_independent() -> None:
    _, life = opened()
    ready, release = Event(), Event()

    def dispatch() -> None:
        life.observe_dispatcher()
        ready.set()
        release.wait(2)

    dispatcher = Thread(target=dispatch)
    dispatcher.start()
    ordinary_release = Event()
    ordinary = Thread(target=lambda: ordinary_release.wait(2))
    ordinary.start()
    try:
        assert ready.wait(1)
        worker(life).join(1)
        close(life, 0.02)
        assert life.settle() == "unknown"
        assert dispatcher.is_alive()
        assert ordinary.is_alive()
    finally:
        release.set()
        dispatcher.join(2)
    try:
        consume(life)
        assert ordinary.is_alive()
    finally:
        ordinary_release.set()
        ordinary.join(2)


def test_first_coordinator_arrival_after_deadline_is_conservatively_unknown() -> None:
    _, life = opened()
    worker(life).join(1)
    close(life, 0.01)
    sleep(0.02)
    assert life.settle() == "unknown"
    consume(life)
    assert life.unknown


def test_control_registration_stays_unblocked_while_coordinator_joins() -> None:
    _, life = opened()
    entered, release, settling = Event(), Event(), Event()

    def blocked() -> None:
        entered.set()
        release.wait(2)

    thread = worker(life, blocked)
    assert entered.wait(1)
    close(life, 0.15)
    result: list[str] = []

    def coordinate() -> None:
        settling.set()
        result.append(life.settle())

    coordinator = Thread(target=coordinate)
    coordinator.start()
    try:
        assert settling.wait(1)
        sleep(0.02)
        started = monotonic()
        life.request_close(reason="consumer_closed", deadline=monotonic() + 20)
        assert monotonic() - started < 0.05
        coordinator.join(1)
        assert result == ["unknown"]
        assert thread.is_alive()
    finally:
        release.set()
        thread.join(2)
        coordinator.join(2)
    consume(life)


@pytest.mark.parametrize("phase", ["run", "resume_container"])
def test_actual_native_boundary_keeps_scope_across_generator_yield_and_real_close(
    phase: Literal["run", "resume_container"],
) -> None:
    from graphon.graph_events.node import NodeRunStartedEvent
    from graphon.nodes.container_effects import IterationFrameRequest
    from tests.unit_tests.services.dify_builder.native_testing.test_control import (
        Observations,
        bound_guard,
        make_native,
        observed_iteration_config,
        permit,
    )

    _, life = opened()
    _, factory = make_native(config=observed_iteration_config(), decision=permit(), ownership=cast(Observations, life))
    life.bind_runtime(runtime_state=factory.runtime)
    node = bound_guard(factory)
    if phase == "resume_container":
        initial = list(node.run())
        frame = next(event for event in initial if isinstance(event, IterationFrameRequest))
        started_at = next(event.start_at for event in initial if isinstance(event, NodeRunStartedEvent))
        stream = node.resume_container(result=frame, started_at=started_at)
    else:
        stream = node.run()
    entered, release = Event(), Event()

    def execute() -> None:
        try:
            next(stream)
            entered.set()
            release.wait(2)
        finally:
            stream.close()

    thread = worker(life, execute)
    try:
        assert entered.wait(1)
        (scope,) = life.active_node_scopes
        assert scope.node is node
        assert scope.thread is thread
        assert scope.phase == phase
        assert scope.runtime_state is factory.runtime
        assert scope.execution_id == node.execution_id
        close(life, 0.02)
        assert life.settle() == "unknown"
        assert life.active_node_scopes == (scope,)
    finally:
        release.set()
        thread.join(2)
    assert life.active_node_scopes == ()
    consume(life)


def test_distinct_call_tickets_and_active_callback_remain_owned_until_real_return() -> None:
    _, life = opened()
    callback_entered, release = Event(), Event()
    tickets: list[NativeHostCallTicket] = []

    def run() -> None:
        with life.call_scope() as first:
            tickets.append(first)
        with life.call_scope() as second:
            tickets.append(second)
            with second.callback_scope():
                callback_entered.set()
                release.wait(2)

    thread = worker(life, run)
    try:
        assert callback_entered.wait(1)
        assert len(tickets) == 2
        assert tickets[0] is not tickets[1]
        close(life, 0.02)
        assert life.settle() == "unknown"
        with pytest.raises(ValueError):
            consume(life)
        assert thread.is_alive()
    finally:
        release.set()
        thread.join(2)
    consume(life)


def test_ambiguous_acknowledgement_stays_unknown_after_complete_physical_cleanup() -> None:
    _, life = opened()
    worker(life).join(1)
    life.mark_unknown()  # Trusted sink observed ambiguous acknowledgement, not a clean flag.
    close(life)
    assert life.settle() == "unknown"
    consume(life)
    assert life.unknown


def test_full_lifetime_identity_cannot_be_replaced_after_activation() -> None:
    _, life = opened()
    with pytest.raises(AttributeError):
        life.context = life.context.model_copy(update={"generation": 9})  # pyrefly: ignore[read-only] - mutation witness
    with pytest.raises(AttributeError):
        life.dispatch_id = "different"  # pyrefly: ignore[read-only] - mutation witness
    worker(life).join(1)
    close(life)
    assert life.settle() == "settled"
    consume(life)


def test_unregistered_ticket_cannot_enter_a_physical_callback() -> None:
    _, life = opened()
    fabricated = NativeHostCallTicket(life)
    with pytest.raises(ValueError):
        with fabricated.callback_scope():
            pytest.fail("unretained callback must not execute")
    worker(life).join(1)
    close(life)
    assert life.settle() == "settled"
    consume(life)


def test_late_node_and_call_tracking_survives_control_without_reopening_physical_entry() -> None:
    from tests.unit_tests.services.dify_builder.native_testing.test_control import bound_guard, make_native, permit

    _, life = opened()
    _, factory = make_native(decision=permit())
    node = bound_guard(factory)
    life.bind_runtime(runtime_state=factory.runtime)
    before_control, enter_late, active, release, refused = Event(), Event(), Event(), Event(), Event()
    errors: list[BaseException] = []

    def run() -> None:
        before_control.set()
        enter_late.wait(2)
        try:
            with life.node_scope(node=node, phase="resume_container"), life.call_scope() as ticket:
                try:
                    with ticket.callback_scope():
                        pytest.fail("late tracking cannot reopen physical entry")
                except ValueError:
                    refused.set()
                active.set()
                release.wait(2)
        except BaseException as exc:
            errors.append(exc)
            active.set()

    thread = worker(life, run)
    try:
        assert before_control.wait(1)
        started = monotonic()
        close(life, 0.06)
        enter_late.set()
        assert active.wait(1)
        assert errors == []
        assert refused.is_set()
        assert len(life.active_node_scopes) == 1
        with pytest.raises(ValueError):
            life.register_thread(thread=Thread(), role="reader")
        with pytest.raises(ValueError):
            consume(life)
        life.request_close(reason="consumer_closed", deadline=monotonic() + 20)
        assert life.settle() == "unknown"
        assert monotonic() - started < 0.18
        assert thread.is_alive()
        assert len(life.active_node_scopes) == 1
    finally:
        release.set()
        thread.join(2)
    assert errors == []
    consume(life)
    with pytest.raises(ValueError):
        with life.call_scope():
            pass
    with pytest.raises(ValueError):
        with life.node_scope(node=node, phase="run"):
            pass


@pytest.mark.parametrize("kind", ["node", "call"])
def test_late_owned_activity_invalidates_an_earlier_in_time_quiet_sample(kind: str) -> None:
    from tests.unit_tests.services.dify_builder.native_testing.test_control import bound_guard, make_native, permit

    _, life = opened()
    _, factory = make_native(decision=permit())
    life.bind_runtime(runtime_state=factory.runtime)
    worker(life).join(1)
    close(life, 0.04)
    assert life.settle() == "settled"
    scope = life.call_scope() if kind == "call" else life.node_scope(node=bound_guard(factory), phase="run")
    with scope:
        sleep(0.06)
    assert life.settle() == "unknown"
    consume(life)
    assert life.unknown


def attached_tree(depth: int) -> tuple[NativeHostLifetimeRegistry, list[NativeHostLifetime]]:
    registry, root = opened()
    tree = [root]
    for index in range(depth):
        parent = tree[-1]
        ref = parent.context.ref.model_copy(update={"invocation_id": f"descendant-{index}"})
        parent.expect_child(ref=ref)
        context = parent.context.model_copy(
            update={
                "ref": ref,
                "parent_invocation_id": parent.context.ref.invocation_id,
                "call_depth": parent.context.call_depth + 1,
            }
        )
        _, child = opened(registry=registry, context=context)
        parent.attach_child(child=child)
        tree.append(child)
    return registry, tree


@pytest.mark.parametrize("depth", [1, 2])
@pytest.mark.parametrize("kind", ["node", "call"])
@pytest.mark.parametrize("check", ["settle", "consume"])
def test_descendant_late_activity_invalidates_ancestor_sample(depth: int, kind: str, check: str) -> None:
    from tests.unit_tests.services.dify_builder.native_testing.test_control import bound_guard, make_native, permit

    _, tree = attached_tree(depth)
    parent, descendant = tree[0], tree[-1]
    _, factory = make_native(decision=permit())
    descendant.bind_runtime(runtime_state=factory.runtime)
    for lifetime in tree:
        worker(lifetime).join(1)
        close(lifetime, 0.04 if lifetime is parent else 0.5)
    assert parent.settle() == "settled"
    scope = descendant.call_scope() if kind == "call" else descendant.node_scope(node=bound_guard(factory), phase="run")
    with scope:
        sleep(0.06)
    if check == "settle":
        assert parent.settle() == "unknown"
    consume(parent)
    assert parent.unknown
    for lifetime in tree[1:]:
        consume(lifetime)


@pytest.mark.parametrize("depth", [1, 2])
@pytest.mark.parametrize("kind", ["node", "call"])
def test_descendant_completion_wakes_waiting_ancestor_promptly(depth: int, kind: str) -> None:
    from tests.unit_tests.services.dify_builder.native_testing.test_control import bound_guard, make_native, permit

    _, tree = attached_tree(depth)
    parent, descendant = tree[0], tree[-1]
    _, factory = make_native(decision=permit())
    descendant.bind_runtime(runtime_state=factory.runtime)
    for lifetime in tree:
        worker(lifetime).join(1)
    active, release, done = Event(), Event(), Event()
    ready = Barrier(2)
    result: list[str] = []

    def pool_work() -> None:
        scope = (
            descendant.call_scope() if kind == "call" else descendant.node_scope(node=bound_guard(factory), phase="run")
        )
        with scope:
            active.set()
            release.wait(2)

    pool_thread = Thread(target=pool_work)
    pool_thread.start()
    assert active.wait(1)
    deadline = monotonic() + 0.6
    for lifetime in tree:
        lifetime.request_close(reason="cancel", deadline=deadline)

    def coordinate() -> None:
        ready.wait(1)
        result.append(parent.settle())
        done.set()

    coordinator = Thread(target=coordinate)
    coordinator.start()
    try:
        ready.wait(1)
        sleep(0.02)
        assert not done.is_set()
        release.set()
        assert done.wait(0.15), "descendant completion must wake the ancestor before its deadline"
        assert result == ["settled"]
        assert monotonic() < deadline
    finally:
        release.set()
        pool_thread.join(2)
        coordinator.join(2)
    for lifetime in tree:
        consume(lifetime)


def test_cleaned_payloads_collect_while_compact_verifier_is_retained() -> None:
    import gc
    import weakref

    from tests.unit_tests.services.dify_builder.native_testing.test_control import bound_guard, make_native, permit

    class Stream:
        closed = False

        def close(self) -> None:
            self.closed = True

    def complete() -> tuple[NativeHostLifetimeRegistry, NativeHostLifetime, list[weakref.ReferenceType[object]]]:
        registry, life = opened()
        context = life.context
        _, factory = make_native(decision=permit())
        node = bound_guard(factory)
        life.bind_runtime(runtime_state=factory.runtime)
        with life.node_scope(node=node, phase="run"):
            pass
        with life.call_scope() as ticket:
            stream = Stream()
            ticket.own_stream(stream=stream)
        assert stream.closed
        thread = worker(life)
        thread.join(1)
        refs: list[weakref.ReferenceType[object]] = [
            weakref.ref(item) for item in [context, factory.runtime, node, ticket, stream, thread]
        ]
        close(life)
        assert life.settle() == "settled"
        consume(life)
        return registry, life, refs

    registry, life, refs = complete()
    gc.collect()
    assert all(item() is None for item in refs), "proven-clean payloads remain retained"
    with pytest.raises(ValueError, match="native_host_payload_retired"):
        _ = life.context
    assert life.ref.request_id == ResolvedNativeTestContext.model_validate(CONTEXT).ref.request_id
    assert life.generation == 0
    assert life.dispatch_id == "dispatch"
    with pytest.raises(ValueError):
        consume(life)
    registry.dispose()


def test_repeated_clean_acquisitions_do_not_retain_full_history_and_keep_monotonicity() -> None:
    import gc
    import weakref

    registry = NativeHostLifetimeRegistry()
    refs = []
    base = ResolvedNativeTestContext.model_validate(CONTEXT)
    for index in range(6):
        _, life = opened(registry=registry, context=base.model_copy(update={"generation": index // 2}))
        worker(life).join(1)
        close(life)
        assert life.settle() == "settled"
        consume(life)
        refs.append(weakref.ref(life))
    gc.collect()
    assert all(item() is None for item in refs[:-1]), "completed acquisition history is unbounded"
    with pytest.raises(ValueError):
        opened(registry=registry, context=base.model_copy(update={"generation": 1}))
    registry.dispose()
    with pytest.raises(ValueError):
        opened(registry=registry, context=base.model_copy(update={"generation": 3}))


def test_registry_scope_and_disposal_never_evict_incomplete_ownership() -> None:
    registry, life = opened()
    foreign_context = life.context.model_copy(
        update={"ref": life.context.ref.model_copy(update={"request_id": "foreign"})}
    )
    with pytest.raises(ValueError):
        opened(registry=registry, context=foreign_context)
    thread = Thread()
    life.register_thread(thread=thread, role="worker")
    close(life, 0.01)
    assert life.settle() == "unknown"
    with pytest.raises(ValueError):
        registry.dispose()
    with pytest.raises(ValueError):
        consume(life)
    assert thread.ident is None


@pytest.mark.parametrize("replace_child", [False, True])
def test_retired_child_proof_requires_that_exact_child_to_remain_current(replace_child: bool) -> None:
    registry, tree = attached_tree(1)
    parent, child = tree
    child_context = child.context
    for lifetime in tree:
        worker(lifetime).join(1)
        close(lifetime)
    assert child.settle() == "settled"
    consume(child)
    if replace_child:
        _, replacement = opened(registry=registry, context=child_context)
        worker(replacement).join(1)
        close(replacement)
        assert replacement.settle() == "settled"
        consume(replacement)
        with pytest.raises(ValueError):
            consume(parent)
        with pytest.raises(ValueError):
            registry.dispose()
    else:
        assert parent.settle() == "settled"
        consume(parent)
        registry.dispose()


def test_unknown_live_payload_is_retained_until_actual_late_cleanup() -> None:
    import gc
    import weakref

    from tests.unit_tests.services.dify_builder.native_testing.test_control import make_native, permit

    registry, life = opened()
    engine, factory = make_native(decision=permit())
    runtime = factory.runtime
    life.bind_runtime(runtime_state=runtime)
    runtime_ref = weakref.ref(runtime)
    context_ref = weakref.ref(life.context)
    entered, release = Event(), Event()

    def blocked() -> None:
        entered.set()
        release.wait(2)

    thread = worker(life, blocked)
    del engine, factory, runtime
    try:
        assert entered.wait(1)
        close(life, 0.02)
        assert life.settle() == "unknown"
        gc.collect()
        assert runtime_ref() is not None
        assert context_ref() is not None
        with pytest.raises(ValueError):
            registry.dispose()
        with pytest.raises(ValueError):
            consume(life)
    finally:
        release.set()
        thread.join(2)
    consume(life)
    gc.collect()
    assert runtime_ref() is None
    assert context_ref() is None
    assert life.unknown
    registry.dispose()


def test_disposed_registry_drops_compact_tombstones_and_stays_permanently_closed() -> None:
    import gc
    import weakref

    registry, life = opened()
    worker(life).join(1)
    close(life)
    assert life.settle() == "settled"
    consume(life)
    retained = weakref.ref(life)
    del life
    gc.collect()
    assert retained() is not None
    registry.dispose()
    gc.collect()
    assert retained() is None
    with pytest.raises(ValueError):
        opened(registry=registry)


def test_consumed_ancestor_blocks_late_tracking_while_child_cleanup_remains_possible() -> None:
    from tests.unit_tests.services.dify_builder.native_testing.test_control import bound_guard, make_native, permit

    registry, tree = attached_tree(1)
    parent, child = tree
    _, factory = make_native(decision=permit())
    child.bind_runtime(runtime_state=factory.runtime)
    for lifetime in tree:
        worker(lifetime).join(1)
        close(lifetime)
    assert parent.settle() == "settled"
    consume(parent)
    with pytest.raises(ValueError):
        with child.call_scope():
            pass
    with pytest.raises(ValueError):
        with child.node_scope(node=bound_guard(factory), phase="run"):
            pass
    consume(child)
    registry.dispose()


def test_child_unknown_outcome_does_not_replace_actual_subtree_cleanup_evidence() -> None:
    registry, tree = attached_tree(1)
    parent, child = tree
    for lifetime in tree:
        worker(lifetime).join(1)
        close(lifetime)
    child.mark_unknown()
    assert child.settle() == "unknown"
    assert parent.settle() == "settled"
    consume(child)
    consume(parent)
    assert child.unknown
    registry.dispose()
