from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field

from opentelemetry.metrics import Observation

from services.knowledge_fs.observability import (
    KnowledgeFSBatchStatusMetric,
    KnowledgeFSCapabilityIssuanceMetric,
    KnowledgeFSControlSpaceStateMetric,
    KnowledgeFSLifecycleTaskMetric,
    OpenTelemetryKnowledgeFSOperationalMetrics,
)
from tests.unit_tests.knowledge_fs_core_fakes import RecordedCall


@dataclass
class _FakeInstrument:
    name: str
    log: list[RecordedCall]
    calls: list[RecordedCall] = field(default_factory=list)

    def add(self, amount: int, *, attributes: dict[str, str]) -> None:
        self._record(amount, attributes=attributes)

    def record(self, amount: float, *, attributes: dict[str, str]) -> None:
        self._record(amount, attributes=attributes)

    def _record(self, *args: object, **kwargs: object) -> None:
        call = RecordedCall(args=args, kwargs=kwargs)
        self.calls.append(call)
        self.log.append(call)


@dataclass(frozen=True)
class _GaugeRegistration:
    name: str
    callbacks: tuple[Callable[[object], Iterable[Observation]], ...]
    description: str
    unit: str


@dataclass
class _FakeMeter:
    log: list[RecordedCall] = field(default_factory=list)
    counters: dict[str, _FakeInstrument] = field(default_factory=dict)
    histograms: dict[str, _FakeInstrument] = field(default_factory=dict)
    gauge_calls: list[_GaugeRegistration] = field(default_factory=list)

    def create_counter(self, name: str, *, description: str, unit: str) -> _FakeInstrument:
        self.log.append(RecordedCall(args=(name,), kwargs={"description": description, "unit": unit}))
        return self.counters.setdefault(name, _FakeInstrument(name=name, log=self.log))

    def create_histogram(self, name: str, *, description: str, unit: str) -> _FakeInstrument:
        self.log.append(RecordedCall(args=(name,), kwargs={"description": description, "unit": unit}))
        return self.histograms.setdefault(name, _FakeInstrument(name=name, log=self.log))

    def create_observable_gauge(
        self,
        name: str,
        *,
        callbacks: tuple[Callable[[object], Iterable[Observation]], ...],
        description: str,
        unit: str,
    ) -> object:
        self.gauge_calls.append(_GaugeRegistration(name=name, callbacks=callbacks, description=description, unit=unit))
        self.log.append(
            RecordedCall(args=(name,), kwargs={"callbacks": callbacks, "description": description, "unit": unit})
        )
        return object()


def test_operational_metrics_use_only_bounded_labels_and_numeric_measurements() -> None:
    meter = _FakeMeter()
    counters = meter.counters
    metrics = OpenTelemetryKnowledgeFSOperationalMetrics(meter=meter)

    metrics.record_capability_issuance(
        KnowledgeFSCapabilityIssuanceMetric(
            caller_kind="interactive",
            operation_id="getKnowledgeSpace",
            outcome="issued",
            reason="success",
        )
    )
    metrics.record_batch_status(
        KnowledgeFSBatchStatusMetric(
            duration_seconds=0.25,
            missing_spaces=1,
            outcome="degraded",
            requested_spaces=3,
            returned_spaces=2,
        )
    )
    metrics.record_control_space_state(
        KnowledgeFSControlSpaceStateMetric(
            duration_seconds=12.0,
            from_state="provisioning",
            to_state="active",
        )
    )
    metrics.record_lifecycle_task(
        KnowledgeFSLifecycleTaskMetric(
            duration_seconds=3.5,
            operation="revoke",
            status="succeeded",
        )
    )
    capability_counter = counters["dify.knowledge_fs.capability_issuance"]
    assert capability_counter.calls[-1].args == (1,)
    assert capability_counter.calls[-1].kwargs == {
        "attributes": {
            "caller_kind": "interactive",
            "operation_id": "getKnowledgeSpace",
            "outcome": "issued",
            "reason": "success",
        }
    }
    all_calls = str(meter.log)
    assert "tenant_id" not in all_calls
    assert "control_space_id" not in all_calls
    assert "jti" not in all_calls
    assert "token" not in all_calls


def test_control_space_current_state_gauge_uses_bounded_states_and_is_best_effort() -> None:
    meter = _FakeMeter()
    metrics = OpenTelemetryKnowledgeFSOperationalMetrics(meter=meter)
    counts_error: list[Exception] = []

    def read_counts() -> Mapping[str, int]:
        if counts_error:
            raise counts_error[0]
        return {"deleting": 2, "error": 1, "provisioning": 3}

    metrics.register_control_space_state_gauge(read_counts)

    assert len(meter.gauge_calls) == 1
    gauge_call = meter.gauge_calls[0]
    assert gauge_call.name == "dify.knowledge_fs.control_spaces"
    assert gauge_call.unit == "{space}"
    callback = gauge_call.callbacks[0]
    observations = tuple(callback(object()))
    assert [(observation.value, observation.attributes) for observation in observations] == [
        (3, {"aggregation_scope": "global_database_snapshot", "state": "provisioning"}),
        (2, {"aggregation_scope": "global_database_snapshot", "state": "deleting"}),
        (1, {"aggregation_scope": "global_database_snapshot", "state": "error"}),
    ]

    assert "aggregate replica series with max, never sum" in gauge_call.description

    counts_error.append(RuntimeError("database unavailable"))
    assert tuple(callback(object())) == ()
    metrics.register_control_space_state_gauge(read_counts)
    assert len(meter.gauge_calls) == 1
