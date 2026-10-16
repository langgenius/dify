"""Private Dify decisions cross native ordinary-error conversion without I/O.

This opt-in component does not authorize, persist, dispatch, or issue a waiting
receipt. Trusted composition must bind its instance-owned context and sink.
"""

from collections.abc import Generator
from dataclasses import dataclass
from datetime import datetime
from functools import cache
from typing import Any, Literal, Protocol, cast
from uuid import uuid4

from pydantic import ValidationError

from graphon.entities.pause_reason import SchedulingPause
from graphon.graph_events.base import GraphNodeEventBase
from graphon.graph_events.node import NodeRunPauseRequestedEvent
from graphon.nodes.base.node import Node
from graphon.nodes.container_effects import ContainerAwaitRequest, ContainerRunResult
from services.dify_builder.native_testing.contracts import (
    ApprovalWait,
    DispatchPermit,
    EffectDecision,
    NativeTestContextRef,
    PolicyStop,
    RecordedResult,
    WaitReason,
)


class _NativeControl(BaseException):
    """Only this private family bypasses native ordinary Exception handlers."""

    def __init__(self, *, ref: NativeTestContextRef, diagnostic: str) -> None:
        super().__init__(diagnostic)
        self.ref = ref


class NativeApprovalWait(_NativeControl):
    """Host-owned wait category and pending operation, never message authority."""

    def __init__(self, *, ref: NativeTestContextRef, pending_operation_id: str, wait_reason: WaitReason) -> None:
        super().__init__(ref=ref, diagnostic="native_control_wait")
        self.pending_operation_id = pending_operation_id
        self.wait_reason = wait_reason


class NativePolicyStop(_NativeControl):
    """Host-owned fixed reason, carried separately from safe diagnostics."""

    def __init__(self, *, ref: NativeTestContextRef, reason_code: str) -> None:
        super().__init__(ref=ref, diagnostic="native_control_stop")
        self.reason_code = reason_code


class NativeControlBridge:
    """Convert only validated decisions; successful values keep their identity."""

    @staticmethod
    def resolve(*, ref: NativeTestContextRef, decision: EffectDecision) -> DispatchPermit | RecordedResult:
        if type(decision) not in (DispatchPermit, RecordedResult, ApprovalWait, PolicyStop):
            raise NativePolicyStop(ref=ref, reason_code="native_control_invalid_decision")
        try:
            # Frozen DTOs can still be constructed/copied without validation.
            type(decision).model_validate(decision.model_dump(warnings=False), strict=True)
        except (ValidationError, ValueError, TypeError):
            raise NativePolicyStop(ref=ref, reason_code="native_control_invalid_decision") from None
        if isinstance(decision, DispatchPermit | RecordedResult):
            return decision
        if isinstance(decision, ApprovalWait):
            raise NativeApprovalWait(
                ref=ref, pending_operation_id=decision.pending_operation_id, wait_reason=decision.wait_reason
            )
        raise NativePolicyStop(ref=ref, reason_code=decision.reason_code)


@dataclass(frozen=True, slots=True)
class NativeControlRecord:
    """Private typed facts; carrier_ref correlates only and grants no authority."""

    control: NativeApprovalWait | NativePolicyStop
    node_id: str
    native_execution_id: str
    carrier_ref: str


@dataclass(frozen=True, slots=True)
class NativeControlAccepted:
    """Sink recorded this exact object and sealed stop authority if needed."""

    record: NativeControlRecord


@dataclass(frozen=True, slots=True)
class NativeControlRefused:
    """Sink refusal contains no arbitrary diagnostics or resumable authority."""


class NativeControlSink(Protocol):
    """Trusted synchronous host port, supplied explicitly by composition.

    Validate the complete owner/context chain, retain the exact typed control,
    and for stop seal actual dispatch authority before returning acceptance of
    the same record. Refusal or any callback exception becomes UNKNOWN. A
    successful return is not a checkpoint commit or a public waiting receipt.
    """

    def record_control(self, *, record: NativeControlRecord) -> NativeControlAccepted | NativeControlRefused: ...


BoundaryStatus = Literal["OPEN", "CONTROL_PENDING", "WAIT_RECORDED", "STOP_RECORDED", "UNKNOWN_NONRESUMABLE"]


class BoundaryOwnerState:
    """Instance-owned in-memory facts, shared by all child frames of this owner.

    This is NOT a durable fence, generation claim, checkpoint eligibility check,
    capacity owner or physical cancellation mechanism. Trusted composition must
    consult dispatch_admissible before every new dispatch and retain/project
    UNKNOWN or STOP independently of native pause/success events. Never reopen
    this object on resume; separately admitted composition supplies a new owner.
    """

    def __init__(self, *, ref: NativeTestContextRef) -> None:
        if type(ref) is not NativeTestContextRef:
            raise ValueError("native_control_invalid_ref")
        NativeTestContextRef.model_validate(ref.model_dump(warnings=False), strict=True)
        self.ref = ref
        self._records: list[NativeControlRecord] = []
        self._accepted: set[str] = set()
        self._reason_code: str | None = None

    @property
    def records(self) -> tuple[NativeControlRecord, ...]:
        return tuple(self._records)

    @property
    def reason_code(self) -> str | None:
        return self._reason_code

    @property
    def dispatch_admissible(self) -> bool:
        return not self._records and self._reason_code is None

    @property
    def status(self) -> BoundaryStatus:
        if self._reason_code is not None:
            return "UNKNOWN_NONRESUMABLE"
        if any(
            isinstance(record.control, NativePolicyStop) and record.carrier_ref in self._accepted
            for record in self._records
        ):
            return "STOP_RECORDED"
        if len(self._accepted) != len(self._records):
            return "CONTROL_PENDING"
        return "WAIT_RECORDED" if self._records else "OPEN"

    def _begin(self, record: NativeControlRecord) -> None:
        # Retain facts and deny new dispatch before calling host code. Each
        # record moves pending -> accepted, or owner-wide sticky UNKNOWN.
        self._records.append(record)

    def _unknown(self, reason_code: str) -> None:
        if self._reason_code is None:
            self._reason_code = reason_code


NativeEventStream = Generator[GraphNodeEventBase | ContainerAwaitRequest]


class _NativeNodeDelegate(Protocol):
    def __init__(self, *args: Any, **kwargs: Any) -> None: ...

    def run(self) -> NativeEventStream: ...

    def resume_container(self, *, result: ContainerRunResult, started_at: datetime) -> NativeEventStream: ...


class _NativeControlBoundary:
    """Mixin selected only by marked composition, never by registry replacement."""

    def __init__(
        self,
        *args: Any,
        native_control_owner: BoundaryOwnerState,
        native_control_sink: NativeControlSink,
        **kwargs: Any,
    ) -> None:
        if type(native_control_owner) is not BoundaryOwnerState or not callable(
            getattr(native_control_sink, "record_control", None)
        ):
            raise ValueError("native_control_owner_and_sink_required")
        self._native_control_owner = native_control_owner
        self._native_control_sink = native_control_sink
        cast(_NativeNodeDelegate, super()).__init__(*args, **kwargs)

    def _abort_control(self, reason_code: str) -> None:
        """Contain only public abort-call failure; never relabel node failures."""
        try:
            cast(Node, self).graph_runtime_state.graph_execution.abort(reason_code)
        except BaseException:
            # No callback/host failure may escape a native worker. Native
            # settlement is unqualified if this public abort itself fails.
            self._native_control_owner._unknown("native_control_abort_unavailable")

    def _control_execution_id(self) -> str | None:
        try:
            execution_id = cast(Node, self).execution_id
        except RuntimeError:
            execution_id = ""
        if not execution_id:
            self._native_control_owner._unknown("native_control_execution_id_missing")
            self._abort_control("native_control_execution_id_missing")
            return None
        return execution_id

    def _record_control(self, control: NativeApprovalWait | NativePolicyStop, execution_id: str) -> NativeEventStream:
        node = cast(Node, self)
        owner = self._native_control_owner
        record = NativeControlRecord(
            control=control, node_id=node.id, native_execution_id=execution_id, carrier_ref=uuid4().hex
        )
        owner._begin(record)
        if control.ref != owner.ref:
            owner._unknown("native_control_ref_mismatch")
            self._abort_control("native_control_ref_mismatch")
            return
        try:
            response = self._native_control_sink.record_control(record=record)
        except BaseException:
            # Intentionally confined to this explicit host callback. Foreign
            # BaseException from the native delegate is never caught here.
            owner._unknown("native_control_sink_failed")
            self._abort_control("native_control_sink_failed")
            return
        if type(response) is not NativeControlAccepted or response.record is not record:
            owner._unknown("native_control_sink_refused")
            self._abort_control("native_control_sink_refused")
            return
        owner._accepted.add(record.carrier_ref)
        if owner.status in ("UNKNOWN_NONRESUMABLE", "STOP_RECORDED"):
            self._abort_control("native_control_nonresumable")
            return
        yield NodeRunPauseRequestedEvent(
            id=execution_id,
            node_id=node.id,
            node_type=node.node_type,
            reason=SchedulingPause(message=record.carrier_ref),
        )

    def run(self) -> NativeEventStream:
        execution_id = self._control_execution_id()
        if execution_id is None:
            return
        try:
            yield from cast(_NativeNodeDelegate, super()).run()
        except (NativeApprovalWait, NativePolicyStop) as control:
            yield from self._record_control(control, execution_id)

    def resume_container(self, *, result: ContainerRunResult, started_at: datetime) -> NativeEventStream:
        execution_id = self._control_execution_id()
        if execution_id is None:
            return
        try:
            yield from cast(_NativeNodeDelegate, super()).resume_container(result=result, started_at=started_at)
        except (NativeApprovalWait, NativePolicyStop) as control:
            yield from self._record_control(control, execution_id)


@cache
def _adapt_concrete_node(node_class: type[Node]) -> type[Node]:
    # Cache concrete classes only: no host/ref/sink/runtime captured in closure.
    # Native subclass registration increments the public registry version, so
    # downstream mapping caches must honor Graphon's version invalidation.
    return cast(
        type[Node],
        type(f"NativeControl{node_class.__name__}", (_NativeControlBoundary, node_class), {"__module__": __name__}),
    )


def marked_native_node_class(node_class: type[Node], *, marked: bool) -> type[Node]:
    """Adapt an already-resolved concrete class only on an explicit True marker.

    The real factory must finish native/extension loading and resolve its
    current type/version first, including after registry version changes. This
    cache is keyed by concrete class identity, never by a stale type mapping.
    Existing native type/version/latest entries are left untouched. Constructors
    require native_control_owner and native_control_sink as instance arguments.
    """
    if type(marked) is not bool:
        raise ValueError("native_control_concrete_class_required")
    if not marked:
        return node_class
    if not issubclass(node_class, Node) or issubclass(node_class, _NativeControlBoundary):
        raise ValueError("native_control_concrete_class_required")
    versions = Node.get_node_type_classes_mapping().get(node_class.node_type, {})
    if str(node_class.version()) not in versions:
        raise ValueError("native_control_native_class_not_loaded")
    return _adapt_concrete_node(node_class)
