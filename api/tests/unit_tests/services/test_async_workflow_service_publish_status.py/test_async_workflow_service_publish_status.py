from __future__ import annotations

from collections.abc import Mapping, Sequence

from enums import QuotaType
from models.enums import CreatorUserRole, WorkflowTriggerStatus
from services.async_workflow_service import AsyncWorkflowService
from services.workflow.entities import ScheduleTriggerData, TriggerActor, TriggerData, TriggerWorkflowSnapshot


class _Workflows:
    def get_trigger_workflow(self, *, tenant_id: str, app_id: str, workflow_id: str | None) -> TriggerWorkflowSnapshot:
        assert (tenant_id, app_id, workflow_id) == ("tenant-1", "app-1", None)
        return TriggerWorkflowSnapshot(
            id="workflow-1", tenant_id=tenant_id, app_id=app_id, type="workflow", version="published", graph="{}"
        )

    def get_published_trigger_workflows(
        self, *, tenant_id: str, app_ids: Sequence[str]
    ) -> Mapping[str, TriggerWorkflowSnapshot]:
        assert tenant_id == "tenant-1"
        assert not app_ids
        raise NotImplementedError


class _Logs:
    def __init__(self) -> None:
        self.queued: list[tuple[str, str]] = []

    def create_pending(self, *, actor: TriggerActor, trigger_data: TriggerData, workflow_id: str, queue: str) -> str:
        assert actor.id == "account-1"
        assert trigger_data.app_id == "app-1"
        assert workflow_id == "workflow-1"
        assert queue == "workflow_sandbox"
        return "trigger-log-1"

    def mark_failed(
        self, *, tenant_id: str, app_id: str, log_id: str, status: WorkflowTriggerStatus, error: str
    ) -> None:
        assert (tenant_id, app_id, log_id) == ("tenant-1", "app-1", "trigger-log-1")
        assert status == WorkflowTriggerStatus.FAILED
        assert error
        raise AssertionError("a published task must not be marked as a failed dispatch")

    def mark_queued(self, *, tenant_id: str, app_id: str, log_id: str, task_id: str) -> None:
        assert (tenant_id, app_id, log_id, task_id) == ("tenant-1", "app-1", "trigger-log-1", "celery-task-1")
        self.queued.append((log_id, task_id))
        raise RuntimeError("database unavailable after broker acknowledgement")

    def record_invocation_failure(
        self,
        *,
        workflow: TriggerWorkflowSnapshot,
        actor: TriggerActor,
        trigger_data: TriggerData,
        failure_inputs: Mapping[str, str],
        error: str,
        queue: str,
    ) -> None:
        raise NotImplementedError


class _Queues:
    def __init__(self) -> None:
        self.published: list[str] = []

    def get_queue(self, tenant_id: str) -> str:
        assert tenant_id == "tenant-1"
        return "workflow_sandbox"

    def publish(self, *, queue: str, trigger_log_id: str) -> str:
        assert (queue, trigger_log_id) == ("workflow_sandbox", "trigger-log-1")
        self.published.append(trigger_log_id)
        return "celery-task-1"


class _Charge:
    def __init__(self) -> None:
        self.committed = False
        self.refunded = False

    def commit(self) -> None:
        self.committed = True

    def refund(self) -> None:
        self.refunded = True


def test_published_workflow_is_acknowledged_when_queued_status_write_fails() -> None:
    logs = _Logs()
    queues = _Queues()
    charge = _Charge()

    def reserve_quota(quota_type: QuotaType, tenant_id: str) -> _Charge:
        assert quota_type == QuotaType.WORKFLOW
        assert tenant_id == "tenant-1"
        return charge

    service = AsyncWorkflowService(
        workflows=_Workflows(),
        logs=logs,
        queues=queues,
        reserve_quota=reserve_quota,
    )

    response = service.trigger_workflow_async(
        actor=TriggerActor(id="account-1", role=CreatorUserRole.ACCOUNT),
        trigger_data=ScheduleTriggerData(tenant_id="tenant-1", app_id="app-1", root_node_id="root-1", inputs={}),
    )

    assert response.workflow_trigger_log_id == "trigger-log-1"
    assert response.task_id == "celery-task-1"
    assert response.status == "queued"
    assert queues.published == ["trigger-log-1"]
    assert logs.queued == [("trigger-log-1", "celery-task-1")]
    assert charge.committed
    assert not charge.refunded
