from __future__ import annotations

from dataclasses import dataclass

import pytest

from services.rag_pipeline.tenant_task_queue import (
    RagPipelineTaskClaim,
    RagPipelineTaskTarget,
    RagPipelineTenantTask,
)
from tasks.rag_pipeline import rag_pipeline_queue_recovery_task as recovery_module
from tests.unit_tests.config_override import apply_config_overrides


@dataclass
class _RecoveryQueue:
    tenant_id: str

    @classmethod
    def registered_tenants(cls) -> tuple[str, ...]:
        return ("tenant-failing", "tenant-ready")

    def recover(self, *, concurrency: int) -> tuple[RagPipelineTaskClaim, ...]:
        assert concurrency == 2
        if self.tenant_id == "tenant-failing":
            raise ConnectionError("temporary redis failure")
        return (
            RagPipelineTaskClaim(
                receipt="receipt-1",
                task=RagPipelineTenantTask(file_id="file-1", target=RagPipelineTaskTarget.REGULAR),
            ),
        )


def test_periodic_recovery_continues_after_one_tenant_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    dispatched: list[tuple[str, _RecoveryQueue, tuple[RagPipelineTaskClaim, ...]]] = []

    def dispatch(
        *,
        tenant_id: str,
        queue: _RecoveryQueue,
        claims: tuple[RagPipelineTaskClaim, ...],
    ) -> int:
        dispatched.append((tenant_id, queue, claims))
        return len(claims)

    monkeypatch.setattr(recovery_module, "RagPipelineTenantTaskQueue", _RecoveryQueue)
    monkeypatch.setattr(recovery_module, "dispatch_rag_pipeline_claims", dispatch)
    apply_config_overrides(monkeypatch, TENANT_ISOLATED_TASK_CONCURRENCY=2)

    recovery_module.recover_rag_pipeline_tenant_queue.run()

    assert [(tenant_id, queue.tenant_id, claims[0].task.file_id) for tenant_id, queue, claims in dispatched] == [
        ("tenant-ready", "tenant-ready", "file-1")
    ]
