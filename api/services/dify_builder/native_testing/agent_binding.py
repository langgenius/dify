"""Native Agent admission in the existing caller-owned draft transaction.

Call prepare_node for every selected node before installing its graph data, then
sync_prepared_bindings in the SAME transaction. The authoritative roster row is
locked until graph and native bindings commit/roll back together. No method here
commits, dispatches a capability, or materializes runtime credentials.
"""

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass

from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.agent.publish_visibility import workflow_callable_active_snapshot_filter
from core.dify_builder.models import Actor
from core.workflow.graph_topology import WorkflowGraphTopology
from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidator
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentScope,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import WorkflowNodeJobConfig
from models.workflow import Workflow
from services.agent import access_service
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.workflow_publish_service import WorkflowAgentPublishService
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, Digest
from services.dify_builder.native_testing.agent_catalog import project_published_agent
from services.dify_builder.native_testing.contracts import ID, FrozenDTO


class AgentSnapshotChanged(ValueError):  # noqa: N818 - frozen A1 domain contract
    def __init__(self, *, effective_snapshot_id: str):
        self.effective_snapshot_id = effective_snapshot_id
        super().__init__("Published Agent snapshot changed; reconfirm the selection.")


def require_selected_snapshot(*, selected_snapshot_id: str, effective_snapshot_id: str) -> None:
    if selected_snapshot_id != effective_snapshot_id:
        raise AgentSnapshotChanged(effective_snapshot_id=effective_snapshot_id)


class AgentBindingSelection(FrozenDTO):
    agent_id: ID
    snapshot_id: ID
    capability_digest: Digest

    @classmethod
    def from_resource_id(cls, resource_id: str) -> "AgentBindingSelection":
        prefix, agent_id, snapshot_id, digest = resource_id.split(":")
        if prefix != "agent":
            raise ValueError("Invalid Agent selection")
        return cls(agent_id=agent_id, snapshot_id=snapshot_id, capability_digest=digest)


def native_node_data(*, agent_id: str, snapshot_id: str, node_job: WorkflowNodeJobConfig) -> dict[str, JsonValue]:
    """Render only native graph fields consumed by the publication owner."""
    return {
        "type": "agent",
        "version": "2",
        "agent_node_kind": "dify_agent",
        "title": "Workspace Agent",
        "agent_binding": {"binding_type": "roster_agent", "agent_id": agent_id, "current_snapshot_id": snapshot_id},
        "agent_task": node_job.workflow_prompt,
        "agent_declared_outputs": [item.model_dump(mode="json") for item in node_job.declared_outputs],
        "agent_output_routes": node_job.output_routes.model_dump(mode="json"),
    }


def has_native_roster_binding(data: Mapping) -> bool:
    binding = data.get("agent_binding")
    return (
        data.get("type") == "agent"
        and data.get("version") == "2"
        and data.get("agent_node_kind") == "dify_agent"
        and isinstance(binding, Mapping)
        and binding.get("binding_type") == "roster_agent"
        and isinstance(binding.get("agent_id"), str)
        and bool(binding["agent_id"])
        and isinstance(binding.get("current_snapshot_id"), str)
        and bool(binding["current_snapshot_id"])
    )


@dataclass(frozen=True)
class AgentBindingAuthorization:
    """Ephemeral current permission result; never a persisted/public authority."""

    actor_id: str
    tenant_id: str
    app_id: str
    agent_ids: frozenset[str]


@dataclass(frozen=True)
class ConfirmedAgentNodeSelection:
    agent_id: str
    snapshot_id: str
    authorization: AgentBindingAuthorization


def authorize_graph_agent_selection(*, actor: Actor, app_id: str, node_data: Mapping) -> ConfirmedAgentNodeSelection:
    """Authorize the exact native graph selection before opening resolver SQL.

    This is only a current permission check. The binding resolver must still
    verify the complete owner chain and selected generation at execution.
    """
    if not has_native_roster_binding(node_data):
        raise BuilderExecutionPolicyError("agent_binding_not_prepared")
    binding = node_data["agent_binding"]
    agent_id, snapshot_id = binding["agent_id"], binding["current_snapshot_id"]
    authorization = AgentBindingService.authorize(actor=actor, app_id=app_id, agent_ids=frozenset({agent_id}))
    return ConfirmedAgentNodeSelection(agent_id, snapshot_id, authorization)


class AgentBindingService:
    def __init__(self, session: Session, *, authorization: AgentBindingAuthorization | None = None):
        self.session = session
        self.authorization = authorization
        self._preparation_transaction = None
        self._prepared: dict[
            tuple[str, str], tuple[AgentBindingSelection, dict[str, JsonValue], WorkflowNodeJobConfig]
        ] = {}

    @staticmethod
    def authorize(*, actor: Actor, app_id: str, agent_ids: frozenset[str]) -> AgentBindingAuthorization:
        """Call immediately BEFORE opening the bounded draft transaction.

        RBAC RPC runs outside DB transactions/row locks. Local membership and
        publication are checked again in prepare_node under caller ownership.
        """
        from configs import dify_config
        from core.rbac import RBACPermission, RBACResourceScope
        from services.enterprise.rbac_service import RBACService

        if dify_config.RBAC_ENABLED:
            if not RBACService.CheckAccess.check(
                actor.tenant_id,
                actor.account_id,
                scene=RBACPermission.APP_EDIT,
                resource_type=RBACResourceScope.APP,
                resource_id=app_id,
            ):
                raise BuilderExecutionPolicyError("agent_access_denied")
            access = access_service.resolve_current_agent_access_filter(
                tenant_id=actor.tenant_id, actor_id=actor.account_id
            )
            for agent_id in agent_ids:
                if (
                    access.accessible_agent_ids is not None and agent_id not in access.accessible_agent_ids
                ) or not RBACService.CheckAccess.check(
                    actor.tenant_id,
                    actor.account_id,
                    scene=RBACPermission.AGENT_PREVIEW,
                    resource_type=RBACResourceScope.AGENT,
                    resource_id=agent_id,
                ):
                    raise BuilderExecutionPolicyError("agent_access_denied")
        return AgentBindingAuthorization(actor.account_id, actor.tenant_id, app_id, agent_ids)

    def recheck_access(self, *, actor: Actor, app_id: str, agent_id: str) -> None:
        """Check the pre-transaction RBAC result plus current local identity."""
        from configs import dify_config

        grant = self.authorization
        if dify_config.RBAC_ENABLED and (
            grant is None
            or grant.actor_id != actor.account_id
            or grant.tenant_id != actor.tenant_id
            or grant.app_id != app_id
            or agent_id not in grant.agent_ids
        ):
            raise BuilderExecutionPolicyError("agent_access_denied")
        access_service.require_builder_agent_access(
            session=self.session, tenant_id=actor.tenant_id, actor_id=actor.account_id, app_id=app_id
        )

    def prepare_node(
        self,
        *,
        actor: Actor,
        workflow: Workflow,
        node_id: str,
        selection: AgentBindingSelection,
        node_job: WorkflowNodeJobConfig,
    ) -> dict[str, JsonValue]:
        if not self.session.in_transaction():
            raise ValueError("Agent preparation requires the caller's draft transaction")
        if self._prepared and self._preparation_transaction is not self.session.get_transaction():
            raise BuilderExecutionPolicyError("agent_binding_not_prepared")
        self._preparation_transaction = self.session.get_transaction()
        if workflow.tenant_id != actor.tenant_id or workflow.version != Workflow.VERSION_DRAFT or not node_id:
            raise BuilderExecutionPolicyError("agent_binding_owner_mismatch")
        owned_workflow = self.session.scalar(
            select(Workflow).where(
                Workflow.id == workflow.id,
                Workflow.tenant_id == actor.tenant_id,
                Workflow.app_id == workflow.app_id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
        )
        if owned_workflow is None:
            raise BuilderExecutionPolicyError("agent_binding_owner_mismatch")
        self.recheck_access(actor=actor, app_id=workflow.app_id, agent_id=selection.agent_id)
        # Refresh the identity map after acquiring the publication pointer lock.
        agent = self.session.scalar(
            select(Agent)
            .where(
                Agent.id == selection.agent_id,
                Agent.tenant_id == actor.tenant_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.status == AgentStatus.ACTIVE,
                Agent.active_config_has_model.is_(True),
                workflow_callable_active_snapshot_filter(),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if agent is None or agent.active_config_snapshot_id is None:
            raise BuilderExecutionPolicyError("agent_not_available")
        access_service.require_builder_agent_access(
            session=self.session, tenant_id=actor.tenant_id, actor_id=actor.account_id, app_id=workflow.app_id
        )
        require_selected_snapshot(
            selected_snapshot_id=selection.snapshot_id, effective_snapshot_id=agent.active_config_snapshot_id
        )
        snapshot = self.session.scalar(
            select(AgentConfigSnapshot).where(
                AgentConfigSnapshot.id == selection.snapshot_id,
                AgentConfigSnapshot.tenant_id == actor.tenant_id,
                AgentConfigSnapshot.agent_id == agent.id,
            )
        )
        if snapshot is None:
            raise BuilderExecutionPolicyError("agent_not_available")
        if project_published_agent(agent=agent, snapshot=snapshot).capability_digest != selection.capability_digest:
            raise BuilderExecutionPolicyError("agent_capability_changed")
        node_job = WorkflowNodeJobConfig.model_validate(node_job.model_dump(mode="json"))
        ComposerConfigValidator.validate_node_job(node_job)
        # The native graph owner derives input refs from task markers on sync.
        derived = WorkflowAgentPublishService._previous_node_output_refs_from_prompt(node_job.workflow_prompt)
        if node_job.previous_node_output_refs and node_job.previous_node_output_refs != derived:
            raise ValueError("Node-job input selectors must match native task references")
        node_job.previous_node_output_refs = derived
        data = native_node_data(agent_id=agent.id, snapshot_id=snapshot.id, node_job=node_job)
        DifyAgentNodeData.model_validate(data)
        binding = WorkflowAgentNodeBinding(
            tenant_id=actor.tenant_id,
            app_id=workflow.app_id,
            workflow_id=workflow.id,
            workflow_version=workflow.version,
            node_id=node_id,
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id=agent.id,
            current_snapshot_id=snapshot.id,
            node_job_config=node_job,
        )
        graph = deepcopy(workflow.graph_dict)
        nodes = graph.setdefault("nodes", [])
        nodes[:] = [item for item in nodes if item.get("id") != node_id]
        nodes.append({"id": node_id, "data": data})
        WorkflowAgentNodeValidator.validate_node_job(
            session=self.session, binding=binding, node_job=node_job, topology=WorkflowGraphTopology.from_graph(graph)
        )
        self._prepared[(workflow.id, node_id)] = (selection, deepcopy(data), node_job.model_copy(deep=True))
        return data

    def sync_prepared_bindings(
        self, *, actor: Actor, workflow: Workflow, selections: Mapping[str, AgentBindingSelection]
    ) -> set[str]:
        """Require preparation for the complete graph before whole-graph native sync.

        Every native graph Agent must have a confirmed prepared roster selection.
        Existing bindings omitted from the graph are protected from implicit
        deletion. Inline/unprepared nodes and removals require their own admitted
        owner path rather than piggybacking on this roster binding operation.
        """
        if not self.session.in_transaction():
            raise ValueError("Agent sync requires the caller's draft transaction")
        if self.session.get_transaction() is not self._preparation_transaction:
            raise BuilderExecutionPolicyError("agent_binding_not_prepared")
        nodes = dict(WorkflowAgentNodeValidator.iter_agent_v2_nodes(workflow.graph_dict))
        existing_node_ids = set(
            self.session.scalars(
                select(WorkflowAgentNodeBinding.node_id).where(
                    WorkflowAgentNodeBinding.tenant_id == actor.tenant_id,
                    WorkflowAgentNodeBinding.app_id == workflow.app_id,
                    WorkflowAgentNodeBinding.workflow_id == workflow.id,
                    WorkflowAgentNodeBinding.workflow_version == workflow.version,
                )
            ).all()
        )
        prepared_node_ids = {node_id for workflow_id, node_id in self._prepared if workflow_id == workflow.id}
        if (
            not selections
            or set(selections) != set(nodes)
            or prepared_node_ids != set(nodes)
            or not existing_node_ids.issubset(nodes)
        ):
            raise BuilderExecutionPolicyError("agent_binding_not_prepared")
        for node_id, selection in selections.items():
            prepared = self._prepared.get((workflow.id, node_id))
            if prepared is None or prepared[0] != selection or nodes.get(node_id) != prepared[1]:
                raise BuilderExecutionPolicyError("agent_binding_not_prepared")
            self.recheck_access(actor=actor, app_id=workflow.app_id, agent_id=selection.agent_id)
        retirements = WorkflowAgentPublishService.sync_agent_bindings_for_draft(
            session=self.session, draft_workflow=workflow, account_id=actor.account_id
        )
        for node_id, selection in selections.items():
            binding = self.session.scalar(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == actor.tenant_id,
                    WorkflowAgentNodeBinding.app_id == workflow.app_id,
                    WorkflowAgentNodeBinding.workflow_id == workflow.id,
                    WorkflowAgentNodeBinding.workflow_version == workflow.version,
                    WorkflowAgentNodeBinding.node_id == node_id,
                    WorkflowAgentNodeBinding.agent_id == selection.agent_id,
                )
            )
            if binding is None or binding.current_snapshot_id is None:
                raise BuilderExecutionPolicyError("agent_binding_owner_mismatch")
            require_selected_snapshot(
                selected_snapshot_id=selection.snapshot_id, effective_snapshot_id=binding.current_snapshot_id
            )
            # Preserve the complete validated native job (mode, contacts and
            # metadata included) in its existing binding owner, in this same
            # transaction. The graph's task/output projection is not a second
            # persistence format for these fields.
            binding.node_job_config = self._prepared[(workflow.id, node_id)][2].model_copy(deep=True)
        return retirements
