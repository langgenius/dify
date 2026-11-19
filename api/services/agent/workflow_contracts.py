"""Read-only binding data and persistence ports owned by Workflow Agent use cases."""

from collections.abc import Set
from typing import Protocol

from models.agent_runtime_contracts import AgentRecord, AgentSnapshotRecord, WorkflowBindingRecord
from services.workflow.contracts import WorkflowBindingScope


class WorkflowAgentBindingStore(Protocol):
    def list_bindings(
        self, workflow: WorkflowBindingScope, *, node_ids: Set[str] | None = None
    ) -> list[WorkflowBindingRecord]: ...
    def get_binding(
        self, *, tenant_id: str, app_id: str, workflow_id: str, node_id: str
    ) -> WorkflowBindingRecord | None: ...
    def save_binding(self, binding: WorkflowBindingRecord) -> None: ...
    def delete_binding(self, binding: WorkflowBindingRecord) -> None: ...
    def get_agent(self, tenant_id: str, agent_id: str, *, callable_roster: bool = False) -> AgentRecord | None: ...
    def get_snapshot(self, tenant_id: str, agent_id: str, snapshot_id: str) -> AgentSnapshotRecord | None: ...
    def upload_exists(self, tenant_id: str, upload_id: str) -> bool: ...
    def missing_dataset_ids(self, tenant_id: str, dataset_ids: list[str]) -> list[str]: ...

    def clone(
        self,
        *,
        workflow: WorkflowBindingScope,
        node_id: str,
        source_agent: AgentRecord,
        source_snapshot: AgentSnapshotRecord,
        account_id: str,
    ) -> tuple[AgentRecord, str]: ...


class AgentSkillReader(Protocol):
    def names(self, tenant_id: str, agent_id: str, snapshot_id: str) -> set[str]: ...
