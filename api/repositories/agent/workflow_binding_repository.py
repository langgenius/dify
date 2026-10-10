from repositories.agent.config_repository import AgentConfigRepository

"""Binding reads and writes in the owning workflow transaction.

A workflow revision and its Agent bindings must commit or roll back together.
The workflow repository supplies the short-lived Session; this adapter never
opens a second transaction or commits independently.
"""

from collections.abc import Set
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from core.agent.publish_visibility import workflow_callable_active_snapshot_filter
from enums.agent import WorkflowAgentBindingType
from models.agent import (
    Agent,
    AgentConfigRevisionOperation,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentPackageMetadata, AgentSoulConfig, WorkflowNodeJobConfig
from models.agent_runtime_contracts import (
    AgentRecord,
    AgentSnapshotRecord,
    WorkflowAgentBindingError,
    WorkflowBindingRecord,
)
from models.model import UploadFile
from models.workflow import Workflow
from repositories.agent.creation_repository import WorkflowAgentCreationRepository
from repositories.agent.runtime_repository import find_owned_workflow_binding
from repositories.knowledge.dataset_read_repository import get_datasets_by_ids
from services.workflow.contracts import DeletedWorkflowBinding, WorkflowBindingScope


def agent_record(agent: Agent) -> AgentRecord:
    return AgentRecord(
        id=agent.id,
        tenant_id=agent.tenant_id,
        scope=agent.scope,
        status=agent.status,
        app_id=agent.app_id,
        workflow_id=agent.workflow_id,
        workflow_node_id=agent.workflow_node_id,
        active_config_snapshot_id=agent.active_config_snapshot_id,
        metadata=AgentPackageMetadata(
            name=agent.name,
            description=agent.description,
            role=agent.role,
            icon_type=agent.icon_type.value if agent.icon_type else None,
            icon=agent.icon,
            icon_background=agent.icon_background,
        ),
    )


def binding_record(binding: WorkflowAgentNodeBinding) -> WorkflowBindingRecord:
    return WorkflowBindingRecord(
        tenant_id=binding.tenant_id,
        app_id=binding.app_id,
        workflow_id=binding.workflow_id,
        workflow_version=binding.workflow_version,
        node_id=binding.node_id,
        binding_type=binding.binding_type,
        agent_id=binding.agent_id,
        current_snapshot_id=binding.current_snapshot_id,
        node_job_config=WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict),
        created_by=binding.created_by,
        updated_by=binding.updated_by,
    )


class WorkflowAgentBindingRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def clone(
        self,
        *,
        workflow: WorkflowBindingScope,
        node_id: str,
        source_agent: AgentRecord,
        source_snapshot: AgentSnapshotRecord,
        account_id: str,
    ) -> tuple[AgentRecord, str]:
        if source_agent.tenant_id != workflow.tenant_id or source_snapshot.agent_id != source_agent.id:
            raise ValueError("Inline Agent clone source does not belong to this workspace")
        agent, snapshot = WorkflowAgentCreationRepository(self._session).create_workflow_agent(
            workflow=workflow,
            node_id=node_id,
            account_id=account_id,
            metadata=source_agent.metadata,
            soul=source_snapshot.config,
            source=AgentSource.WORKFLOW,
            operation=AgentConfigRevisionOperation.CREATE_VERSION,
        )
        return agent_record(agent), snapshot.id

    def list_bindings(
        self, workflow: WorkflowBindingScope, *, node_ids: Set[str] | None = None
    ) -> list[WorkflowBindingRecord]:
        query = select(WorkflowAgentNodeBinding).where(*self._workflow_key(workflow))
        if node_ids is not None:
            query = query.where(WorkflowAgentNodeBinding.node_id.in_(node_ids))
        return [binding_record(binding) for binding in self._session.scalars(query)]

    @staticmethod
    def _workflow_key(workflow: WorkflowBindingScope):
        return (
            WorkflowAgentNodeBinding.tenant_id == workflow.tenant_id,
            WorkflowAgentNodeBinding.app_id == workflow.app_id,
            WorkflowAgentNodeBinding.workflow_id == workflow.id,
            WorkflowAgentNodeBinding.workflow_version == workflow.version,
        )

    def lock_bindings(
        self, workflow: WorkflowBindingScope, *, node_ids: Set[str] | None = None
    ) -> list[WorkflowAgentNodeBinding]:
        """Lock bindings, then their Agents, in stable order for every writer.

        Acquire all binding locks before any Agent lock. In particular, Composer
        must do this before a flush can implicitly lock an updated Agent row.
        """
        query = select(WorkflowAgentNodeBinding).where(*self._workflow_key(workflow))
        if node_ids is not None:
            query = query.where(WorkflowAgentNodeBinding.node_id.in_(node_ids))
        bindings = list(
            self._session.scalars(
                query.order_by(WorkflowAgentNodeBinding.id).with_for_update().execution_options(populate_existing=True)
            )
        )
        agent_ids = {binding.agent_id for binding in bindings if binding.agent_id is not None}
        if agent_ids:
            list(
                self._session.scalars(
                    select(Agent)
                    .where(Agent.tenant_id == workflow.tenant_id, Agent.id.in_(agent_ids))
                    .order_by(Agent.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
        return bindings

    def execution_bindings(self, workflow: WorkflowBindingScope) -> dict[str, dict]:
        """Capture job config and immutable Soul references while the source revision is locked."""
        result: dict[str, dict] = {}
        for binding in self.lock_bindings(workflow):
            agent = self._session.scalar(
                select(Agent).where(Agent.tenant_id == workflow.tenant_id, Agent.id == binding.agent_id)
            )
            if agent is None or agent.status == AgentStatus.ARCHIVED:
                raise WorkflowAgentBindingError("agent_not_available", "Workflow Agent is unavailable.")
            snapshot_id = (
                agent.active_config_snapshot_id
                if binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
                else binding.current_snapshot_id
            )
            if snapshot_id is None or self.get_snapshot(workflow.tenant_id, agent.id, snapshot_id) is None:
                raise WorkflowAgentBindingError(
                    "agent_config_snapshot_not_found", "Workflow Agent config is unavailable."
                )
            result[binding.node_id] = {
                "id": binding.id,
                "tenant_id": workflow.tenant_id,
                "app_id": workflow.app_id,
                "workflow_id": workflow.id,
                "workflow_version": workflow.version,
                "node_id": binding.node_id,
                "binding_type": binding.binding_type.value,
                "agent_id": agent.id,
                "current_snapshot_id": snapshot_id,
                "node_job_config": binding.node_job_config_dict,
                "created_by": binding.created_by,
                "updated_by": binding.updated_by,
            }
        return result

    def delete_workflow_bindings(self, workflow: WorkflowBindingScope) -> list[DeletedWorkflowBinding]:
        bindings = [
            DeletedWorkflowBinding(binding_type=binding_type, agent_id=agent_id)
            for binding_type, agent_id in self._session.execute(
                select(WorkflowAgentNodeBinding.binding_type, WorkflowAgentNodeBinding.agent_id).where(
                    *self._workflow_key(workflow)
                )
            )
        ]
        self._session.execute(delete(WorkflowAgentNodeBinding).where(*self._workflow_key(workflow)))
        return bindings

    def get_binding(
        self, *, tenant_id: str, app_id: str, workflow_id: str, node_id: str
    ) -> WorkflowBindingRecord | None:
        binding = find_owned_workflow_binding(
            self._session, tenant_id=tenant_id, app_id=app_id, workflow_id=workflow_id, node_id=node_id
        )
        return binding_record(binding) if binding is not None else None

    @staticmethod
    def _binding_key(binding: WorkflowBindingRecord):
        return (
            WorkflowAgentNodeBinding.tenant_id == binding.tenant_id,
            WorkflowAgentNodeBinding.app_id == binding.app_id,
            WorkflowAgentNodeBinding.workflow_id == binding.workflow_id,
            WorkflowAgentNodeBinding.workflow_version == binding.workflow_version,
            WorkflowAgentNodeBinding.node_id == binding.node_id,
        )

    def save_binding(self, binding: WorkflowBindingRecord) -> None:
        row = self._session.scalar(select(WorkflowAgentNodeBinding).where(*self._binding_key(binding)))
        if row is None:
            row = WorkflowAgentNodeBinding(
                tenant_id=binding.tenant_id,
                app_id=binding.app_id,
                workflow_id=binding.workflow_id,
                workflow_version=binding.workflow_version,
                node_id=binding.node_id,
                created_by=binding.created_by,
            )
            self._session.add(row)
        row.binding_type = binding.binding_type
        row.agent_id = binding.agent_id
        row.current_snapshot_id = binding.current_snapshot_id
        row.node_job_config = binding.node_job_config
        row.updated_by = binding.updated_by
        self._session.flush()

    def delete_binding(self, binding: WorkflowBindingRecord) -> None:
        self._session.execute(delete(WorkflowAgentNodeBinding).where(*self._binding_key(binding)))
        self._session.flush()

    def get_agent(self, tenant_id: str, agent_id: str, *, callable_roster: bool = False) -> AgentRecord | None:
        query = select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id)
        if callable_roster:
            query = query.where(Agent.scope == AgentScope.ROSTER, workflow_callable_active_snapshot_filter())
        agent = self._session.scalar(query.limit(1))
        return agent_record(agent) if agent is not None else None

    def get_snapshot(self, tenant_id: str, agent_id: str, snapshot_id: str) -> AgentSnapshotRecord | None:
        snapshot = AgentConfigRepository.get_snapshot(
            session=self._session, tenant_id=tenant_id, agent_id=agent_id, version_id=snapshot_id
        )
        return (
            AgentSnapshotRecord(
                snapshot.id, snapshot.agent_id, AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
            )
            if snapshot is not None
            else None
        )

    def upload_exists(self, tenant_id: str, upload_id: str) -> bool:
        return (
            self._session.scalar(
                select(UploadFile.id)
                .where(
                    UploadFile.tenant_id == tenant_id,
                    UploadFile.id == upload_id,
                )
                .limit(1)
            )
            is not None
        )

    def missing_dataset_ids(self, tenant_id: str, dataset_ids: list[str]) -> list[str]:
        valid_ids = []
        for dataset_id in dataset_ids:
            try:
                UUID(dataset_id)
            except (TypeError, ValueError):
                continue
            valid_ids.append(dataset_id)
        rows = get_datasets_by_ids(tenant_id, valid_ids, session=self._session)
        existing = {str(row.id) for row in rows}
        return [dataset_id for dataset_id in dataset_ids if dataset_id not in existing]


def workflow_binding_scope(workflow: Workflow) -> WorkflowBindingScope:
    return WorkflowBindingScope(workflow.id, workflow.tenant_id, workflow.app_id, workflow.version, workflow.graph)
