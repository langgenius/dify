"""Typed fakes shared by the KnowledgeFS task, command and extension unit tests."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from services.knowledge_fs.observability import (
    KnowledgeFSBatchStatusMetric,
    KnowledgeFSCapabilityIssuanceMetric,
    KnowledgeFSControlSpaceStateMetric,
    KnowledgeFSLifecycleTaskMetric,
)


@dataclass
class RecordingKnowledgeFSMetrics:
    """In-memory ``KnowledgeFSOperationalMetricsPort`` that records every event."""

    batch_statuses: list[KnowledgeFSBatchStatusMetric] = field(default_factory=list)
    capability_issuances: list[KnowledgeFSCapabilityIssuanceMetric] = field(default_factory=list)
    control_space_states: list[KnowledgeFSControlSpaceStateMetric] = field(default_factory=list)
    lifecycle_tasks: list[KnowledgeFSLifecycleTaskMetric] = field(default_factory=list)
    gauge_readers: list[Callable[[], Mapping[str, int]]] = field(default_factory=list)
    gauge_registration_error: Exception | None = None

    def record_batch_status(self, event: KnowledgeFSBatchStatusMetric) -> None:
        self.batch_statuses.append(event)

    def record_capability_issuance(self, event: KnowledgeFSCapabilityIssuanceMetric) -> None:
        self.capability_issuances.append(event)

    def record_control_space_state(self, event: KnowledgeFSControlSpaceStateMetric) -> None:
        self.control_space_states.append(event)

    def record_lifecycle_task(self, event: KnowledgeFSLifecycleTaskMetric) -> None:
        self.lifecycle_tasks.append(event)

    def register_control_space_state_gauge(self, read_counts: Callable[[], Mapping[str, int]]) -> None:
        if self.gauge_registration_error is not None:
            raise self.gauge_registration_error
        self.gauge_readers.append(read_counts)
