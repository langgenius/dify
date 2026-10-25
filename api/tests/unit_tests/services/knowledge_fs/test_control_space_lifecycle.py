from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState
from repositories.knowledge_fs_control_space_repository import KnowledgeFSControlSpaceCASUpdate
from services.knowledge_fs.control_space_lifecycle import KnowledgeFSControlSpaceLifecycleService
from services.knowledge_fs.observability import KnowledgeFSControlSpaceStateMetric


@dataclass
class _SequencedRepository:
    reads: list[KnowledgeFSControlSpace]
    cas_updates: list[KnowledgeFSControlSpaceCASUpdate] = field(default_factory=list)
    get_calls: list[tuple[str, str]] = field(default_factory=list)

    def get(self, *, tenant_id: str, control_space_id: str) -> KnowledgeFSControlSpace | None:
        self.get_calls.append((tenant_id, control_space_id))
        return self.reads.pop(0)

    def compare_and_set_lifecycle(self, update: KnowledgeFSControlSpaceCASUpdate) -> bool:
        self.cas_updates.append(update)
        return True


@dataclass
class _RecordingMetrics:
    control_space_states: list[KnowledgeFSControlSpaceStateMetric] = field(default_factory=list)

    def record_control_space_state(self, event: KnowledgeFSControlSpaceStateMetric) -> None:
        self.control_space_states.append(event)


def _control_space(
    *,
    knowledge_space_id: str | None,
    resource_version: int,
    state: KnowledgeFSControlSpaceState,
    updated_at: datetime,
) -> KnowledgeFSControlSpace:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-secret",
        owner_account_id="account-1",
        provisioning_key="provision-1",
    )
    space.id = "control-secret"
    space.deletion_irreversible_at = None
    space.knowledge_space_id = knowledge_space_id
    space.knowledge_space_revision = 0
    space.resource_version = resource_version
    space.state = state
    space.updated_at = updated_at
    return space


def test_successful_transition_records_previous_state_dwell_without_resource_labels() -> None:
    entered_at = datetime(2026, 7, 21, 10, 0, 0)
    before = _control_space(
        knowledge_space_id=None,
        resource_version=3,
        state=KnowledgeFSControlSpaceState.PROVISIONING,
        updated_at=entered_at,
    )
    after = _control_space(
        knowledge_space_id="space-1",
        resource_version=4,
        state=KnowledgeFSControlSpaceState.ACTIVE,
        updated_at=entered_at + timedelta(seconds=12),
    )
    repository = _SequencedRepository(reads=[before, after])
    metrics = _RecordingMetrics()
    service = KnowledgeFSControlSpaceLifecycleService(
        repository,  # type: ignore[arg-type]
        metrics=metrics,  # type: ignore[arg-type]
    )

    transitioned = service.transition(
        tenant_id="tenant-secret",
        control_space_id="control-secret",
        expected_resource_version=3,
        new_state=KnowledgeFSControlSpaceState.ACTIVE,
        lifecycle_operation_id="operation-secret",
        knowledge_space_id="space-1",
        knowledge_space_revision=1,
    )

    assert transitioned is after
    assert len(repository.cas_updates) == 1
    assert metrics.control_space_states[-1] == (
        12.0,
        "provisioning",
        "active",
    )
    serialized = str(metrics.control_space_states)
    assert "tenant-secret" not in serialized
    assert "control-secret" not in serialized
    assert "space-1" not in serialized
