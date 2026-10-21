"""Opt-in queue copies for native diagnostics; no dispatch or history authority."""

from collections.abc import Mapping
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, cast

from core.app.entities import queue_entities as q
from core.app.entities.app_invoke_entities import AppGenerateEntity
from graphon.entities import WorkflowStartReason
from graphon.entities.pause_reason import SchedulingPause
from graphon.runtime import RuntimeState
from services.dify_builder.native_testing.observation_adapters import NativeObservationError, NativeObservationGuard
from services.dify_builder.native_testing.observation_privacy import _count, _identity, _shape

_REDACTED = "[native content redacted]"
_SUPPORTED: set[type[q.AppQueueEvent]] = {
    q.QueuePingEvent,
    q.QueueErrorEvent,
    q.QueueStopEvent,
    q.QueueWorkflowStartedEvent,
    q.QueueWorkflowSucceededEvent,
    q.QueueWorkflowFailedEvent,
    q.QueueWorkflowPartialSuccessEvent,
    q.QueueWorkflowPausedEvent,
    q.QueueNodeStartedEvent,
    q.QueueNodeSucceededEvent,
    q.QueueNodeFailedEvent,
    q.QueueNodeExceptionEvent,
    q.QueueNodeRetryEvent,
    q.QueueTextChunkEvent,
    q.QueueIterationStartEvent,
    q.QueueIterationNextEvent,
    q.QueueIterationCompletedEvent,
    q.QueueLoopStartEvent,
    q.QueueLoopNextEvent,
    q.QueueLoopCompletedEvent,
}


def require_native_observation(
    *, guard: NativeObservationGuard | None, entity: AppGenerateEntity | None = None
) -> None:
    """Require an exact healthy guard before any marked adapter setup."""
    marked = entity is not None and (entity.native_test_required or entity.native_test_ref is not None)
    if guard is None and not marked:
        return
    if type(guard) is not NativeObservationGuard:
        raise NativeObservationError() from None
    guard.require_healthy()


def _canonical_shape(shape: Any, *, depth: int = 0, budget: list[int] | None = None) -> bool:
    if budget is None:
        budget = [100_000]
    budget[0] -= 1
    if type(shape) is not dict or depth > 24 or budget[0] < 0 or any(type(key) is not str for key in shape):
        return False
    tag = shape.get("type")
    if type(tag) is not str:
        return False
    if tag in {"null", "boolean", "integer", "number"}:
        return set(shape) == {"type"}
    if tag == "string":
        return set(shape) == {"type", "length"} and _bounded(shape["length"])
    if tag not in {"object", "array"}:
        return False
    count, children = ("fields", "values") if tag == "object" else ("length", "items")
    # The policy's empty native files segment has no items field.
    if tag == "array" and set(shape) == {"type", "length"} and type(shape["length"]) is int and shape["length"] == 0:
        return True
    return (
        set(shape) == {"type", count, children}
        and _bounded(shape[count])
        and type(shape[children]) is list
        and len(shape[children]) == (min(8, shape[count]) if depth < 3 else 0)
        and all(_canonical_shape(child, depth=depth + 1, budget=budget) for child in shape[children])
    )


def _bounded(value: Any) -> bool:
    return type(value) is int and 0 <= value <= 2**63 - 1


def _observed(values: Any) -> bool:
    return (
        type(values) is dict
        and set(values) == {"redacted", "shape"}
        and values["redacted"] is True
        and _canonical_shape(values["shape"])
        and values["shape"]["type"] == "object"
    )


def observed_values(*, guard: NativeObservationGuard, values: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Retain only canonical content-safe shape evidence, never provenance."""
    if type(guard) is not NativeObservationGuard:
        raise NativeObservationError() from None
    require_native_observation(guard=guard)
    with guard.persistence_scope():
        if _observed(values):
            assert type(values) is dict
            return deepcopy(values)
        if type(values) is dict and set(values) == {"redacted", "shape", "__dify_retry_history"}:
            if _observed({key: value for key, value in values.items() if key != "__dify_retry_history"}):
                return _process_data(guard, values)
        return guard.values(values)


def observed_runtime_outputs(*, guard: NativeObservationGuard, state: RuntimeState) -> dict[str, Any]:
    """Include actual live output snapshot copying in the safe failure boundary."""
    if type(guard) is not NativeObservationGuard:
        raise NativeObservationError() from None
    with guard.persistence_scope():
        return observed_values(guard=guard, values=state.outputs or {}) or {}


def _process_data(guard: NativeObservationGuard, values: Any) -> dict[str, Any] | None:
    history_key = "__dify_retry_history"
    # Existing policy owns the retry history schema and its safe projections.
    if type(values) is dict and history_key in values:
        base = {key: value for key, value in values.items() if key != history_key}
        if _observed(base):
            history = values[history_key]
            if type(history) is not list or len(history) > 100_000:
                guard.fail()
            checked = guard._policy._process_data({history_key: history})
            result = deepcopy(base)
            for original, projected in zip(history, checked[history_key], strict=True):
                for name in ("inputs", "outputs", "process_data"):
                    projected[name] = observed_values(guard=guard, values=original[name])
            result[history_key] = checked[history_key]
            return result
        return guard._policy._process_data(values)
    return observed_values(guard=guard, values=values)


def _node_execution_snapshots(guard: NativeObservationGuard, value: object) -> tuple[q.NodeExecutionSnapshot, ...]:
    """Copy the known resume metadata shape; titles never cross this boundary."""
    if type(value) is not tuple or len(value) > 100_000:
        guard.fail()
    known_fields = {"execution_id", "title", "index", "start_at", "iteration_id", "loop_id"}
    snapshots = []
    for snapshot in value:
        if (
            type(snapshot) is not q.NodeExecutionSnapshot
            or snapshot.model_extra
            or set(snapshot.__dict__) != known_fields
            or type(snapshot.title) is not str
            or type(snapshot.start_at) is not datetime
            or snapshot.start_at.tzinfo is not None
            and type(snapshot.start_at.tzinfo) is not timezone
        ):
            guard.fail()
        # Empty means no enclosing iteration/loop; nonempty IDs retain only
        # existing bounded correlation semantics, never input/output data.
        iteration_id = "" if snapshot.iteration_id == "" else _identity(snapshot.iteration_id)
        loop_id = "" if snapshot.loop_id == "" else _identity(snapshot.loop_id)
        snapshots.append(
            q.NodeExecutionSnapshot(
                execution_id=_identity(snapshot.execution_id),
                title=_REDACTED,
                index=_count(snapshot.index),
                start_at=snapshot.start_at,
                iteration_id=iteration_id,
                loop_id=loop_id,
            )
        )
    return tuple(snapshots)


def project_native_queue_event[E: q.AppQueueEvent](
    *, guard: NativeObservationGuard, event: E, native_host: Any = None, queue: Any = None
) -> E:
    """Project BEFORE model_dump and produce a fresh exact supported DTO."""
    if type(guard) is not NativeObservationGuard:
        raise NativeObservationError() from None
    require_native_observation(guard=guard)
    with guard.persistence_scope():
        if native_host is not None:
            from services.dify_builder.native_testing.runtime import validate_projection_host

            validate_projection_host(host=native_host, guard=guard)
            event = native_host.diagnostic_event(event=event)
        cls: type[q.AppQueueEvent] = type(event)
        if cls not in _SUPPORTED or event.model_extra or event.event != cls.model_fields["event"].default:
            guard.fail()
        payload: Any = event
        if hasattr(payload, "node_id"):
            node = guard._policy._nodes.get(_identity(payload.node_id))
            if node is None or type(payload.node_type) is not str or payload.node_type != node[0]:
                guard.fail()
            if cls.__name__.startswith("QueueIteration") and node[0] != "iteration":
                guard.fail()
            if cls.__name__.startswith("QueueLoop") and node[0] != "loop":
                guard.fail()
        fields: dict[str, Any] = {}
        raw_fields = dict(event)
        for name in cls.model_fields:
            value = raw_fields[name]
            if name == "event":
                continue
            if name == "node_execution_snapshots" and cls is q.QueueWorkflowStartedEvent:
                fields[name] = _node_execution_snapshots(guard, value)
            elif name in {"node_id", "node_execution_id", "in_iteration_id", "in_loop_id"}:
                fields[name] = _identity(value, optional=name in {"in_iteration_id", "in_loop_id"})
            elif name == "node_type":
                fields[name] = value
            elif name in {"node_run_index", "index", "steps", "retry_index", "exceptions_count"}:
                fields[name] = _count(value)
            elif name in {"inputs", "outputs"}:
                fields[name] = observed_values(guard=guard, values=value)
            elif name == "process_data":
                fields[name] = _process_data(guard, value)
            elif name in {"metadata", "execution_metadata"}:
                fields[name] = None if value is None else guard._policy._metadata(value, container_lengths=True)
            elif name in {"start_at", "finished_at"}:
                if value is not None and (
                    type(value) is not datetime or (value.tzinfo is not None and type(value.tzinfo) is not timezone)
                ):
                    guard.fail()
                if name == "start_at" and value is None:
                    guard.fail()
                fields[name] = value
            elif name == "node_title":
                if type(value) is not str:
                    guard.fail()
                fields[name] = payload.node_type
            elif name in {"provider_id", "provider_type"}:
                if type(value) is not str:
                    guard.fail()
                fields[name] = ""
            elif name == "agent_strategy":
                if value is not None:
                    guard.fail()
                fields[name] = None
            elif name in {"error", "reason"}:
                if name == "reason" and cls is q.QueueWorkflowStartedEvent:
                    if value is WorkflowStartReason.RESUMPTION:
                        from services.dify_builder.native_testing.runtime import require_resume_projection

                        require_resume_projection(host=native_host, guard=guard, queue=queue)
                    elif value is not WorkflowStartReason.INITIAL:
                        guard.fail()
                    fields[name] = value
                else:
                    fields[name] = guard.error(value)
            elif name in {"text", "output"}:
                _shape(value)
                fields[name] = _REDACTED
            elif name == "from_variable_selector":
                if value is None:
                    fields[name] = None
                else:
                    if type(value) is not list or not value or value[0] not in guard._policy._nodes:
                        guard.fail()
                    _shape(value)
                    fields[name] = [value[0], _REDACTED]
            elif name == "reasons":
                if type(value) not in (list, tuple) or len(value) > 100_000:
                    guard.fail()
                if any(type(reason) is not SchedulingPause or type(reason.message) is not str for reason in value):
                    guard.fail()
                fields[name] = [SchedulingPause(message=_REDACTED) for _ in value]
            elif name == "paused_nodes":
                if type(value) not in (list, tuple) or len(value) > 100_000:
                    guard.fail()
                fields[name] = [_identity(item) for item in value]
                if any(item not in guard._policy._nodes for item in fields[name]):
                    guard.fail()
            elif name == "stopped_by":
                if type(value) is not q.QueueStopEvent.StopBy:
                    guard.fail()
                fields[name] = value
            else:
                guard.fail()
        return cast(E, cls.model_validate(fields))
