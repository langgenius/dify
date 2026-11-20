from __future__ import annotations

import copy
from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from enums.agent import WorkflowAgentBindingType
from models.agent import AgentScope, AgentStatus
from models.agent_config_entities import (
    AgentSoulConfig,
    WorkflowNodeJobConfig,
    WorkflowOutputRoutes,
    WorkflowPreviousNodeOutputRef,
)
from models.agent_runtime_contracts import AgentRecord, WorkflowBindingRecord
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.prompt_mentions import (
    extract_workflow_node_output_selectors,
    workflow_previous_node_output_refs_from_selectors,
)
from services.agent.publication_contracts import AgentPublicationBinding, AgentPublicationState
from services.agent.workflow_contracts import AgentSkillReader, WorkflowAgentBindingStore
from services.agent.workflow_validator import WorkflowAgentNodeValidationError, WorkflowAgentNodeValidator
from services.entities.agent_entities import (
    ComposerSavePayload,
    ComposerSaveStrategy,
    ComposerSoulLockPayload,
    ComposerVariant,
)
from services.errors.app import WorkflowHashNotEqualError
from services.workflow.contracts import WorkflowBindingScope


class _InlineAgentUnavailableError(ValueError):
    pass


class _InlineAgentOwnershipError(ValueError):
    pass


class _InlineAgentSnapshotError(ValueError):
    pass


class WorkflowAgentPublishService:
    """Validate and freeze Workflow Agent v2 bindings during workflow publish."""

    def __init__(
        self,
        *,
        repository: WorkflowAgentBindingStore,
    ) -> None:
        self._repository = repository
        self._validator = WorkflowAgentNodeValidator(repository=repository)

    def synchronize_draft(self, *, draft_workflow: WorkflowBindingScope, account_id: str) -> set[str]:
        retired = self._synchronize_bindings(draft_workflow=draft_workflow, account_id=account_id)
        self.validate_agent_nodes_for_draft_sync(draft_workflow=draft_workflow)
        return retired

    _DRAFT_WORKFLOW_VERSION = "draft"
    _AGENT_BINDING_KEY = "agent_binding"
    _AGENT_TASK_KEY = "agent_task"
    _AGENT_DECLARED_OUTPUTS_KEY = "agent_declared_outputs"
    _AGENT_OUTPUT_ROUTES_KEY = "agent_output_routes"

    def project_draft_bindings_to_graph(self, *, draft_workflow: WorkflowBindingScope) -> dict[str, Any]:
        """Return draft graph with persisted Agent binding fields projected into node data.

        Workflow draft graph is the front-end's editing source of truth, while
        runtime/publish reads WorkflowBindingRecord. This
        response-only projection keeps reads aligned without writing binding
        details back into the stored graph JSON.
        """
        graph = copy.deepcopy(draft_workflow.graph_dict)
        agent_nodes = dict(WorkflowAgentNodeValidator.iter_agent_v2_nodes(graph))
        if not agent_nodes:
            return graph

        bindings = self._repository.list_bindings(draft_workflow, node_ids=set(agent_nodes))
        for binding in bindings:
            node_data = agent_nodes.get(binding.node_id)
            if not isinstance(node_data, dict):
                continue
            graph_binding = node_data.get(self._AGENT_BINDING_KEY)
            is_pending_inline_graph_binding = (
                isinstance(graph_binding, Mapping)
                and graph_binding.get("binding_type") == WorkflowAgentBindingType.INLINE_AGENT.value
                and (not graph_binding.get("agent_id") or not graph_binding.get("current_snapshot_id"))
            )
            if not is_pending_inline_graph_binding or binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT:
                node_data[self._AGENT_BINDING_KEY] = {
                    "binding_type": binding.binding_type.value,
                    "agent_id": binding.agent_id,
                    "current_snapshot_id": binding.current_snapshot_id,
                }
            node_job = WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict)
            if node_job.workflow_prompt is not None:
                node_data[self._AGENT_TASK_KEY] = node_job.workflow_prompt
            node_data[self._AGENT_OUTPUT_ROUTES_KEY] = node_job.output_routes.model_dump(mode="json")
            node_data[self._AGENT_DECLARED_OUTPUTS_KEY] = [
                output.model_dump(mode="json") for output in node_job.declared_outputs
            ]
        return graph

    def validate_agent_nodes_for_draft_sync(self, *, draft_workflow: WorkflowBindingScope) -> None:
        self._validator.validate_draft_workflow(workflow=draft_workflow)

    def publication_state(self, *, draft_workflow: WorkflowBindingScope) -> AgentPublicationState:
        """Collect detached dependencies for external validation before acquiring write locks."""
        node_ids = {node_id for node_id, _ in WorkflowAgentNodeValidator.iter_agent_v2_nodes(draft_workflow.graph_dict)}
        if not node_ids:
            return ()
        state = []
        for binding in sorted(
            self._repository.list_bindings(draft_workflow, node_ids=node_ids), key=lambda b: b.node_id
        ):
            agent = self._repository.get_agent(binding.tenant_id, binding.agent_id) if binding.agent_id else None
            snapshot_id = (
                agent.active_config_snapshot_id
                if agent and binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
                else binding.current_snapshot_id
            )
            snapshot = (
                self._repository.get_snapshot(binding.tenant_id, agent.id, snapshot_id)
                if agent and snapshot_id
                else None
            )
            state.append(
                AgentPublicationBinding(
                    tenant_id=binding.tenant_id,
                    node_id=binding.node_id,
                    binding_type=binding.binding_type.value,
                    agent_id=binding.agent_id,
                    bound_snapshot_id=binding.current_snapshot_id,
                    snapshot_id=snapshot_id,
                    node_job_config=binding.node_job_config.model_dump(mode="json"),
                    soul_config=snapshot.config.model_dump(mode="json") if snapshot else None,
                )
            )
        return tuple(state)

    def validate_prepared_publication(
        self, *, draft_workflow: WorkflowBindingScope, prepared: AgentPublicationState
    ) -> None:
        # Bindings and roster snapshots can change independently of the workflow graph.
        if self.publication_state(draft_workflow=draft_workflow) != prepared:
            raise WorkflowHashNotEqualError()
        self._validator.validate_published_workflow(workflow=draft_workflow)

    @staticmethod
    def validate_publication_state(state: AgentPublicationState, *, skills: AgentSkillReader) -> None:
        """Validate collected config with external resources, after the read session closes."""
        for item in state:
            if item.soul_config is not None:
                WorkflowAgentPublishService._validate_binding_composer_config_for_publish(item, skills=skills)

    @staticmethod
    def _validate_binding_composer_config_for_publish(
        item: AgentPublicationBinding, *, skills: AgentSkillReader
    ) -> None:
        assert item.soul_config is not None
        agent_soul = AgentSoulConfig.model_validate(item.soul_config)
        node_job = WorkflowNodeJobConfig.model_validate(item.node_job_config)
        payload = ComposerSavePayload.model_construct(
            variant=ComposerVariant.WORKFLOW,
            save_strategy=ComposerSaveStrategy.NODE_JOB_ONLY,
            soul_lock=ComposerSoulLockPayload(locked=False),
            agent_soul=agent_soul,
            node_job=node_job,
        )
        ComposerConfigValidator.validate_publish_payload(payload)
        WorkflowAgentPublishService._require_config_asset_refs_resolved_for_publish(
            binding=item,
            agent_soul=agent_soul,
            skills=skills,
        )

    @staticmethod
    def _require_config_asset_refs_resolved_for_publish(
        *,
        binding: AgentPublicationBinding,
        agent_soul: AgentSoulConfig,
        skills: AgentSkillReader,
    ) -> None:
        from services.agent.prompt_mentions import MentionKind, parse_prompt_mentions

        mentions = parse_prompt_mentions(agent_soul.prompt.system_prompt)
        configured_skill_names = {item.name for item in agent_soul.config_skills if not item.is_missing}
        has_unresolved_skill_ref = any(
            mention.kind == MentionKind.SKILL and mention.ref_id not in configured_skill_names for mention in mentions
        )
        if has_unresolved_skill_ref and binding.agent_id is not None and binding.snapshot_id is not None:
            configured_skill_names.update(skills.names(binding.tenant_id, binding.agent_id, binding.snapshot_id))
        configured_file_names = {item.name for item in agent_soul.config_files if not item.is_missing}
        missing_refs: list[str] = []
        for mention in mentions:
            if mention.kind not in {MentionKind.SKILL, MentionKind.FILE}:
                continue
            ref_name = mention.ref_id
            if mention.kind == MentionKind.SKILL and ref_name not in configured_skill_names:
                missing_refs.append(f"skill_ref_dangling: skill '{mention.label or ref_name}' is not configured.")
            if mention.kind == MentionKind.FILE and ref_name not in configured_file_names:
                missing_refs.append(f"file_ref_dangling: file '{mention.label or ref_name}' is not configured.")
        if missing_refs:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} has invalid Agent Soul config refs: {'; '.join(missing_refs)}"
            )

    def _synchronize_bindings(
        self,
        *,
        draft_workflow: WorkflowBindingScope,
        account_id: str,
    ) -> set[str]:
        agent_nodes = dict(WorkflowAgentNodeValidator.iter_agent_v2_nodes(draft_workflow.graph_dict))
        existing_bindings = self._repository.list_bindings(draft_workflow)
        existing_by_node_id = {binding.node_id: binding for binding in existing_bindings}
        retirement_candidates: set[str] = set()

        for binding in existing_bindings:
            if binding.node_id not in agent_nodes:
                if binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT and binding.agent_id:
                    retirement_candidates.add(binding.agent_id)
                self._repository.delete_binding(binding)

        for node_id, node_data in agent_nodes.items():
            binding_payload = node_data.get(self._AGENT_BINDING_KEY)
            if binding_payload is None:
                continue
            if not isinstance(binding_payload, Mapping):
                raise ValueError(f"Workflow Agent node {node_id} has invalid agent_binding.")
            if binding_payload.get("binding_type") == WorkflowAgentBindingType.INLINE_AGENT.value and (
                not binding_payload.get("agent_id") or not binding_payload.get("current_snapshot_id")
            ):
                continue
            existing_binding = existing_by_node_id.get(node_id)
            replaced_inline_agent_id = (
                existing_binding.agent_id
                if existing_binding is not None
                and existing_binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT
                and existing_binding.agent_id
                else None
            )
            updated_binding = self._sync_agent_binding_for_node(
                draft_workflow=draft_workflow,
                node_id=node_id,
                node_data=node_data,
                node_binding=binding_payload,
                existing_binding=existing_binding,
                account_id=account_id,
            )
            if (
                replaced_inline_agent_id
                and existing_binding is not None
                and (
                    updated_binding.binding_type != WorkflowAgentBindingType.INLINE_AGENT
                    or updated_binding.agent_id != replaced_inline_agent_id
                )
            ):
                retirement_candidates.add(replaced_inline_agent_id)
        return retirement_candidates

    def _sync_agent_binding_for_node(
        self,
        *,
        draft_workflow: WorkflowBindingScope,
        node_id: str,
        node_data: Mapping[str, Any],
        node_binding: Mapping[str, Any],
        existing_binding: WorkflowBindingRecord | None,
        account_id: str,
    ) -> WorkflowBindingRecord:
        binding_type = node_binding.get("binding_type")
        agent_id = node_binding.get("agent_id")
        if not isinstance(agent_id, str) or not agent_id:
            raise ValueError(f"Workflow Agent node {node_id} agent binding requires agent_id.")

        node_job_config = self._node_job_config_from_node_data(
            existing_binding=existing_binding,
            node_data=node_data,
        )

        if binding_type == WorkflowAgentBindingType.ROSTER_AGENT.value:
            agent, current_snapshot_id = self._resolve_roster_agent_graph_binding(
                draft_workflow=draft_workflow,
                node_id=node_id,
                agent_id=agent_id,
            )
            resolved_binding_type = WorkflowAgentBindingType.ROSTER_AGENT
        elif binding_type == WorkflowAgentBindingType.INLINE_AGENT.value:
            raw_current_snapshot_id = node_binding.get("current_snapshot_id")
            if not isinstance(raw_current_snapshot_id, str) or not raw_current_snapshot_id:
                raise ValueError(f"Workflow Agent node {node_id} inline_agent binding requires current_snapshot_id.")
            current_snapshot_id = raw_current_snapshot_id
            try:
                agent = self._resolve_inline_agent_graph_binding(
                    draft_workflow=draft_workflow,
                    node_id=node_id,
                    agent_id=agent_id,
                    current_snapshot_id=current_snapshot_id,
                )
            except (_InlineAgentUnavailableError, _InlineAgentOwnershipError):
                existing_agent = self._resolve_existing_inline_binding_agent(
                    draft_workflow=draft_workflow,
                    node_id=node_id,
                    existing_binding=existing_binding,
                )
                if existing_agent is not None and existing_binding is not None:
                    agent = existing_agent
                    current_snapshot_id = existing_binding.current_snapshot_id or current_snapshot_id
                else:
                    agent, current_snapshot_id = self._clone_inline_graph_binding_for_node(
                        draft_workflow=draft_workflow,
                        node_id=node_id,
                        source_agent_id=agent_id,
                        source_snapshot_id=current_snapshot_id,
                        account_id=account_id,
                    )
            resolved_binding_type = WorkflowAgentBindingType.INLINE_AGENT
        else:
            raise ValueError(f"Workflow Agent node {node_id} has unsupported agent_binding type.")

        binding = WorkflowBindingRecord(
            tenant_id=draft_workflow.tenant_id,
            app_id=draft_workflow.app_id,
            workflow_id=draft_workflow.id,
            workflow_version=self._DRAFT_WORKFLOW_VERSION,
            node_id=node_id,
            binding_type=resolved_binding_type,
            agent_id=agent.id,
            current_snapshot_id=current_snapshot_id,
            node_job_config=node_job_config,
            created_by=existing_binding.created_by if existing_binding is not None else account_id,
            updated_by=account_id,
        )
        self._repository.save_binding(binding)
        return binding

    def _resolve_existing_inline_binding_agent(
        self,
        *,
        draft_workflow: WorkflowBindingScope,
        node_id: str,
        existing_binding: WorkflowBindingRecord | None,
    ) -> AgentRecord | None:
        if (
            existing_binding is None
            or existing_binding.binding_type != WorkflowAgentBindingType.INLINE_AGENT
            or not existing_binding.agent_id
            or not existing_binding.current_snapshot_id
        ):
            return None
        try:
            return self._resolve_inline_agent_graph_binding(
                draft_workflow=draft_workflow,
                node_id=node_id,
                agent_id=existing_binding.agent_id,
                current_snapshot_id=existing_binding.current_snapshot_id,
            )
        except ValueError:
            return None

    def _clone_inline_graph_binding_for_node(
        self,
        *,
        draft_workflow: WorkflowBindingScope,
        node_id: str,
        source_agent_id: str,
        source_snapshot_id: str,
        account_id: str,
    ) -> tuple[AgentRecord, str]:
        source_agent = self._repository.get_agent(draft_workflow.tenant_id, source_agent_id)
        if (
            source_agent is None
            or source_agent.scope != AgentScope.WORKFLOW_ONLY
            or source_agent.status != AgentStatus.ACTIVE
        ):
            raise ValueError(f"Workflow Agent node {node_id} references an unavailable inline agent.")
        source_snapshot = self._repository.get_snapshot(draft_workflow.tenant_id, source_agent.id, source_snapshot_id)
        if source_snapshot is None:
            raise ValueError(f"Workflow Agent node {node_id} references a missing inline agent config snapshot.")

        return self._repository.clone(
            workflow=draft_workflow,
            node_id=node_id,
            source_agent=source_agent,
            source_snapshot=source_snapshot,
            account_id=account_id,
        )

    def _resolve_roster_agent_graph_binding(
        self,
        *,
        draft_workflow: WorkflowBindingScope,
        node_id: str,
        agent_id: str,
    ) -> tuple[AgentRecord, str]:
        """Resolve an active roster Agent whose published snapshot is callable."""

        agent = self._repository.get_agent(draft_workflow.tenant_id, agent_id, callable_roster=True)
        if agent is None or agent.status != AgentStatus.ACTIVE:
            raise ValueError(f"Workflow Agent node {node_id} references an unavailable or unpublished roster agent.")
        if agent.scope != AgentScope.ROSTER:
            raise ValueError(f"Workflow Agent node {node_id} roster_agent binding must reference a roster agent.")
        if not agent.active_config_snapshot_id:
            raise ValueError(f"Workflow Agent node {node_id} roster agent has no active config snapshot.")
        return agent, agent.active_config_snapshot_id

    def _resolve_inline_agent_graph_binding(
        self,
        *,
        draft_workflow: WorkflowBindingScope,
        node_id: str,
        agent_id: str,
        current_snapshot_id: str,
    ) -> AgentRecord:
        agent = self._repository.get_agent(draft_workflow.tenant_id, agent_id)
        if agent is None or agent.status != AgentStatus.ACTIVE:
            raise _InlineAgentUnavailableError(f"Workflow Agent node {node_id} references an unavailable inline agent.")
        if (
            agent.scope != AgentScope.WORKFLOW_ONLY
            or agent.app_id != draft_workflow.app_id
            or agent.workflow_id != draft_workflow.id
            or agent.workflow_node_id != node_id
        ):
            raise _InlineAgentOwnershipError(
                f"Workflow Agent node {node_id} inline_agent binding does not belong to this node."
            )

        snapshot = self._repository.get_snapshot(draft_workflow.tenant_id, agent.id, current_snapshot_id)
        if snapshot is None or snapshot.agent_id != agent.id:
            raise _InlineAgentSnapshotError(
                f"Workflow Agent node {node_id} references a missing inline agent config snapshot."
            )
        return agent

    @classmethod
    def _node_job_config_from_node_data(
        cls,
        *,
        existing_binding: WorkflowBindingRecord | None,
        node_data: Mapping[str, Any],
    ) -> WorkflowNodeJobConfig:
        if existing_binding and existing_binding.node_job_config:
            node_job = WorkflowNodeJobConfig.model_validate(existing_binding.node_job_config_dict)
        else:
            node_job = WorkflowNodeJobConfig()

        agent_task = node_data.get(cls._AGENT_TASK_KEY)
        if isinstance(agent_task, str):
            node_job.workflow_prompt = agent_task
            node_job.previous_node_output_refs = cls._previous_node_output_refs_from_prompt(agent_task)

        declared_outputs_payload = node_data.get(cls._AGENT_DECLARED_OUTPUTS_KEY)
        if declared_outputs_payload is not None:
            if not isinstance(declared_outputs_payload, list):
                raise ValueError("Workflow Agent node agent_declared_outputs must be a list.")
            try:
                node_job = WorkflowNodeJobConfig.model_validate(
                    {
                        **node_job.model_dump(mode="python"),
                        "declared_outputs": declared_outputs_payload,
                    }
                )
            except ValidationError as exc:
                raise ValueError("Workflow Agent node has invalid agent_declared_outputs.") from exc

        node_job.output_routes = WorkflowOutputRoutes.model_validate(node_data.get(cls._AGENT_OUTPUT_ROUTES_KEY, {}))
        return node_job

    @classmethod
    def _previous_node_output_refs_from_prompt(cls, prompt: str) -> list[WorkflowPreviousNodeOutputRef]:
        """Derive persisted refs from the current frontend workflow markers only."""
        return workflow_previous_node_output_refs_from_selectors(extract_workflow_node_output_selectors(prompt))

    def copy_agent_node_bindings_to_published(
        self,
        *,
        draft_workflow: WorkflowBindingScope,
        published_workflow: WorkflowBindingScope,
    ) -> None:
        """Copy all draft Roster and inline bindings to a published version.

        Only copied inline bindings add owners for workflow-only Agents.
        Publishing does not release existing draft or historical inline owners,
        produces no retirement candidates.
        """
        node_ids = {
            node_id for node_id, _node_data in WorkflowAgentNodeValidator.iter_agent_v2_nodes(draft_workflow.graph_dict)
        }
        if not node_ids:
            return

        bindings = self._repository.list_bindings(draft_workflow, node_ids=node_ids)
        if not bindings:
            return

        for binding in bindings:
            current_snapshot_id = binding.current_snapshot_id
            if binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT and binding.agent_id:
                _, current_snapshot_id = self._resolve_roster_agent_graph_binding(
                    draft_workflow=draft_workflow,
                    node_id=binding.node_id,
                    agent_id=binding.agent_id,
                )
            copied = WorkflowBindingRecord(
                tenant_id=binding.tenant_id,
                app_id=binding.app_id,
                workflow_id=published_workflow.id,
                workflow_version=published_workflow.version,
                node_id=binding.node_id,
                binding_type=binding.binding_type,
                agent_id=binding.agent_id,
                current_snapshot_id=current_snapshot_id,
                node_job_config=WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict),
                created_by=binding.created_by,
                updated_by=binding.updated_by,
            )
            self._repository.save_binding(copied)

    def restore_agent_node_bindings_to_draft(
        self,
        *,
        source_workflow: WorkflowBindingScope,
        draft_workflow: WorkflowBindingScope,
        account_id: str,
    ) -> set[str]:
        """Replace draft bindings with the frozen bindings of a published workflow."""

        existing = self._repository.list_bindings(draft_workflow)
        retirement_candidates = {
            binding.agent_id
            for binding in existing
            if binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT and binding.agent_id
        }
        source_bindings = self._repository.list_bindings(source_workflow)
        for source in source_bindings:
            if source.binding_type == WorkflowAgentBindingType.ROSTER_AGENT and source.agent_id:
                self._resolve_roster_agent_graph_binding(
                    draft_workflow=draft_workflow,
                    node_id=source.node_id,
                    agent_id=source.agent_id,
                )

        for binding in existing:
            self._repository.delete_binding(binding)

        for source in source_bindings:
            agent_id = source.agent_id
            snapshot_id = source.current_snapshot_id
            if source.binding_type == WorkflowAgentBindingType.INLINE_AGENT and agent_id and snapshot_id:
                try:
                    self._resolve_inline_agent_graph_binding(
                        draft_workflow=draft_workflow,
                        node_id=source.node_id,
                        agent_id=agent_id,
                        current_snapshot_id=snapshot_id,
                    )
                except ValueError:
                    agent, snapshot_id = self._clone_inline_graph_binding_for_node(
                        draft_workflow=draft_workflow,
                        node_id=source.node_id,
                        source_agent_id=agent_id,
                        source_snapshot_id=snapshot_id,
                        account_id=account_id,
                    )
                    agent_id = agent.id
            self._repository.save_binding(
                WorkflowBindingRecord(
                    tenant_id=draft_workflow.tenant_id,
                    app_id=draft_workflow.app_id,
                    workflow_id=draft_workflow.id,
                    workflow_version=self._DRAFT_WORKFLOW_VERSION,
                    node_id=source.node_id,
                    binding_type=source.binding_type,
                    agent_id=agent_id,
                    current_snapshot_id=snapshot_id,
                    node_job_config=WorkflowNodeJobConfig.model_validate(source.node_job_config_dict),
                    created_by=account_id,
                    updated_by=account_id,
                )
            )
        return retirement_candidates
