"""Low-cardinality operational metrics for the Dify side of KnowledgeFS.

The metric contracts intentionally exclude tenant, resource, principal, token, URL, and free-form
error values. Callers own best-effort failure isolation so telemetry can never change product state.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from functools import lru_cache
from typing import Literal, NamedTuple, Protocol

from opentelemetry.metrics import Observation, get_meter


class KnowledgeFSCapabilityIssuanceMetric(NamedTuple):
    caller_kind: str
    operation_id: str
    outcome: Literal["denied", "failed", "issued"]
    reason: str


class KnowledgeFSBatchStatusMetric(NamedTuple):
    duration_seconds: float
    missing_spaces: int
    outcome: Literal["degraded", "failed", "success"]
    requested_spaces: int
    returned_spaces: int


class KnowledgeFSControlSpaceStateMetric(NamedTuple):
    duration_seconds: float
    from_state: str
    to_state: str


class KnowledgeFSLifecycleTaskMetric(NamedTuple):
    duration_seconds: float | None
    operation: str
    status: Literal["dispatch_error", "queued", "retry", "running", "succeeded"]


class KnowledgeFSOperationAdmissionMetric(NamedTuple):
    operation_id: str
    bucket: str
    phase: Literal["commit", "refund", "reserve"]
    outcome: Literal["failure", "success"]


class KnowledgeFSOperationalMetricsPort(Protocol):
    def record_batch_status(self, event: KnowledgeFSBatchStatusMetric) -> None: ...

    def record_capability_issuance(self, event: KnowledgeFSCapabilityIssuanceMetric) -> None: ...

    def record_control_space_state(self, event: KnowledgeFSControlSpaceStateMetric) -> None: ...

    def record_lifecycle_task(self, event: KnowledgeFSLifecycleTaskMetric) -> None: ...

    def record_operation_admission(self, event: KnowledgeFSOperationAdmissionMetric) -> None: ...

    def register_control_space_state_gauge(self, read_counts: Callable[[], Mapping[str, int]]) -> None: ...


class _CounterPort(Protocol):
    def add(self, amount: int, *, attributes: dict[str, str]) -> None: ...


class _HistogramPort(Protocol):
    def record(self, amount: float, *, attributes: dict[str, str]) -> None: ...


class _MeterPort(Protocol):
    def create_counter(self, name: str, *, description: str, unit: str) -> _CounterPort: ...

    def create_histogram(self, name: str, *, description: str, unit: str) -> _HistogramPort: ...

    def create_observable_gauge(
        self,
        name: str,
        *,
        callbacks: tuple[Callable[[object], Iterable[Observation]], ...],
        description: str,
        unit: str,
    ) -> object: ...


class OpenTelemetryKnowledgeFSOperationalMetrics:
    """Map sanitized events to OpenTelemetry counters and duration histograms."""

    def __init__(self, *, meter: _MeterPort | None = None) -> None:
        resolved_meter = meter or get_meter("dify.knowledge_fs")
        self._meter = resolved_meter
        self._control_space_state_gauge: object | None = None
        self._capability_issuance = resolved_meter.create_counter(
            "dify.knowledge_fs.capability_issuance",
            description="KnowledgeFS capability issuance outcomes",
            unit="{issuance}",
        )
        self._batch_requests = resolved_meter.create_counter(
            "dify.knowledge_fs.batch_status_requests",
            description="KnowledgeFS batch status request outcomes",
            unit="{request}",
        )
        self._batch_spaces = resolved_meter.create_counter(
            "dify.knowledge_fs.batch_status_spaces",
            description="KnowledgeFS batch status returned and missing spaces",
            unit="{space}",
        )
        self._batch_latency = resolved_meter.create_histogram(
            "dify.knowledge_fs.batch_status_latency",
            description="KnowledgeFS batch status latency",
            unit="s",
        )
        self._control_space_transitions = resolved_meter.create_counter(
            "dify.knowledge_fs.control_space_transitions",
            description="KnowledgeFS control-space lifecycle transitions",
            unit="{transition}",
        )
        self._control_space_state_duration = resolved_meter.create_histogram(
            "dify.knowledge_fs.control_space_state_duration",
            description="Time spent in a KnowledgeFS control-space state before transition",
            unit="s",
        )
        self._lifecycle_tasks = resolved_meter.create_counter(
            "dify.knowledge_fs.lifecycle_tasks",
            description="KnowledgeFS durable lifecycle task state observations",
            unit="{task}",
        )
        self._lifecycle_task_latency = resolved_meter.create_histogram(
            "dify.knowledge_fs.lifecycle_task_latency",
            description="KnowledgeFS durable lifecycle task terminal latency",
            unit="s",
        )
        self._revoke_latency = resolved_meter.create_histogram(
            "dify.knowledge_fs.revoke_latency",
            description="KnowledgeFS capability revoke enqueue-to-ack latency",
            unit="s",
        )
        self._operation_admission = resolved_meter.create_counter(
            "dify.knowledge_fs.operation_admission",
            description="KnowledgeFS direct-operation reserve and finalization outcomes",
            unit="{operation}",
        )

    def record_capability_issuance(self, event: KnowledgeFSCapabilityIssuanceMetric) -> None:
        self._capability_issuance.add(
            1,
            attributes={
                "caller_kind": event.caller_kind,
                "operation_id": event.operation_id,
                "outcome": event.outcome,
                "reason": event.reason,
            },
        )

    def record_batch_status(self, event: KnowledgeFSBatchStatusMetric) -> None:
        outcome: dict[str, str] = {"outcome": event.outcome}
        self._batch_requests.add(1, attributes=outcome)
        self._batch_latency.record(event.duration_seconds, attributes=outcome)
        self._batch_spaces.add(event.returned_spaces, attributes={"result": "returned"})
        self._batch_spaces.add(event.missing_spaces, attributes={"result": "missing"})

    def record_control_space_state(self, event: KnowledgeFSControlSpaceStateMetric) -> None:
        attributes = {"from_state": event.from_state, "to_state": event.to_state}
        self._control_space_transitions.add(1, attributes=attributes)
        self._control_space_state_duration.record(event.duration_seconds, attributes=attributes)

    def record_lifecycle_task(self, event: KnowledgeFSLifecycleTaskMetric) -> None:
        attributes = {"operation": event.operation, "status": event.status}
        self._lifecycle_tasks.add(1, attributes=attributes)
        if event.duration_seconds is None:
            return
        self._lifecycle_task_latency.record(event.duration_seconds, attributes=attributes)
        if event.operation == "revoke" and event.status == "succeeded":
            self._revoke_latency.record(event.duration_seconds, attributes={"operation": "revoke"})

    def record_operation_admission(self, event: KnowledgeFSOperationAdmissionMetric) -> None:
        self._operation_admission.add(
            1,
            attributes={
                "bucket": event.bucket,
                "operation_id": event.operation_id,
                "outcome": event.outcome,
                "phase": event.phase,
            },
        )

    def register_control_space_state_gauge(self, read_counts: Callable[[], Mapping[str, int]]) -> None:
        """Register one DB-backed current-state instrument per process."""

        if self._control_space_state_gauge is not None:
            return

        def observe(_: object) -> Iterable[Observation]:
            try:
                counts = read_counts()
                return tuple(
                    Observation(
                        max(0, counts.get(state, 0)),
                        attributes={"aggregation_scope": "global_database_snapshot", "state": state},
                    )
                    for state in ("provisioning", "deleting", "error")
                )
            except Exception:
                return ()

        self._control_space_state_gauge = self._meter.create_observable_gauge(
            "dify.knowledge_fs.control_spaces",
            callbacks=(observe,),
            description=(
                "Global KnowledgeFS control-space database snapshot by operational state; "
                "aggregate replica series with max, never sum"
            ),
            unit="{space}",
        )


@lru_cache(maxsize=1)
def get_knowledge_fs_operational_metrics() -> KnowledgeFSOperationalMetricsPort:
    """Return one process-wide instrument set to avoid duplicate OpenTelemetry registration."""

    return OpenTelemetryKnowledgeFSOperationalMetrics()


__all__ = [
    "KnowledgeFSBatchStatusMetric",
    "KnowledgeFSCapabilityIssuanceMetric",
    "KnowledgeFSControlSpaceStateMetric",
    "KnowledgeFSLifecycleTaskMetric",
    "KnowledgeFSOperationAdmissionMetric",
    "KnowledgeFSOperationalMetricsPort",
    "OpenTelemetryKnowledgeFSOperationalMetrics",
    "get_knowledge_fs_operational_metrics",
]
