"""Typed recording fakes shared by the KnowledgeFS service unit tests in this group."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from services.knowledge_fs.observability import (
    KnowledgeFSBatchStatusMetric,
    KnowledgeFSCapabilityIssuanceMetric,
    KnowledgeFSControlSpaceStateMetric,
    KnowledgeFSLifecycleTaskMetric,
)
from services.knowledge_fs_capability import CapabilityIssuanceAuditEvent


@dataclass
class RecordingCapabilityAuditor:
    """Records issuance audit events; `failure` is raised after recording when set."""

    failure: BaseException | None = None
    events: list[CapabilityIssuanceAuditEvent] = field(default_factory=list)

    def record(self, event: CapabilityIssuanceAuditEvent) -> None:
        self.events.append(event)
        if self.failure is not None:
            raise self.failure


@dataclass
class RecordingOperationalMetrics:
    """Implements the operational metrics port and records capability issuance events."""

    capability_failure: BaseException | None = None
    capability_issuances: list[KnowledgeFSCapabilityIssuanceMetric] = field(default_factory=list)
    batch_statuses: list[KnowledgeFSBatchStatusMetric] = field(default_factory=list)
    control_space_states: list[KnowledgeFSControlSpaceStateMetric] = field(default_factory=list)
    lifecycle_tasks: list[KnowledgeFSLifecycleTaskMetric] = field(default_factory=list)
    gauge_readers: list[Callable[[], Mapping[str, int]]] = field(default_factory=list)

    def record_batch_status(self, event: KnowledgeFSBatchStatusMetric) -> None:
        self.batch_statuses.append(event)

    def record_capability_issuance(self, event: KnowledgeFSCapabilityIssuanceMetric) -> None:
        self.capability_issuances.append(event)
        if self.capability_failure is not None:
            raise self.capability_failure

    def record_control_space_state(self, event: KnowledgeFSControlSpaceStateMetric) -> None:
        self.control_space_states.append(event)

    def record_lifecycle_task(self, event: KnowledgeFSLifecycleTaskMetric) -> None:
        self.lifecycle_tasks.append(event)

    def register_control_space_state_gauge(self, read_counts: Callable[[], Mapping[str, int]]) -> None:
        self.gauge_readers.append(read_counts)
