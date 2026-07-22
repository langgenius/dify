from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

from models.knowledge_fs import KnowledgeFSControlSpaceState
from services.knowledge_fs.control_space_lifecycle import KnowledgeFSControlSpaceLifecycleService


def test_successful_transition_records_previous_state_dwell_without_resource_labels() -> None:
    entered_at = datetime(2026, 7, 21, 10, 0, 0)
    before = SimpleNamespace(
        deletion_irreversible_at=None,
        knowledge_space_id=None,
        knowledge_space_revision=0,
        resource_version=3,
        state=KnowledgeFSControlSpaceState.PROVISIONING,
        updated_at=entered_at,
    )
    after = SimpleNamespace(
        **{
            **vars(before),
            "knowledge_space_id": "space-1",
            "resource_version": 4,
            "state": KnowledgeFSControlSpaceState.ACTIVE,
            "updated_at": entered_at + timedelta(seconds=12),
        }
    )
    repository = MagicMock()
    repository.get.side_effect = (before, after)
    repository.compare_and_set_lifecycle.return_value = True
    metrics = MagicMock()
    service = KnowledgeFSControlSpaceLifecycleService(repository, metrics=metrics)

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
    assert metrics.record_control_space_state.call_args.args[0] == (
        12.0,
        "provisioning",
        "active",
    )
    serialized = str(metrics.record_control_space_state.call_args_list)
    assert "tenant-secret" not in serialized
    assert "control-secret" not in serialized
    assert "space-1" not in serialized
