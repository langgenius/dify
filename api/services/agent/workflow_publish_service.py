from __future__ import annotations

import copy
from collections.abc import Mapping
from typing import Any, cast

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidationError, WorkflowAgentNodeValidator
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentDriveFile,
    AgentScope,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import (
    AgentSoulConfig,
    DeclaredOutputConfig,
    WorkflowNodeJobConfig,
    WorkflowPreviousNodeOutputRef,
)
from models.workflow import Workflow
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.prompt_mentions import (
    extract_workflow_node_output_selectors,
    workflow_previous_node_output_refs_from_selectors,
)
from services.entities.agent_entities import (
    ComposerSavePayload,
    ComposerSaveStrategy,
    ComposerSoulLockPayload,
    ComposerVariant,
)


class WorkflowAgentPublishService:
    """Validate and freeze Workflow Agent v2 bindings during workflow publish."""

    _DRAFT_WORKFLOW_VERSION = Workflow.VERSION_DRAFT
    _AGENT_BINDING_KEY = "agent_binding"
    _AGENT_TASK_KEY = "agent_task"
    _AGENT_DECLARED_OUTPUTS_KEY = "agent_declared_outputs"

    @classmethod
    def project_draft_bindings_to_graph(cls, *, session: Session, draft_workflow: Workflow) -> dict[str, Any]:
        """Return draft graph with persisted Agent binding fields projected into node data.

        Workflow draft graph is the front-end's editing source of truth, while
        runtime/publish reads WorkflowAgentNodeBinding. This
        response-only projection keeps reads aligned without writing binding
        details back into the stored graph JSON.
        """
        graph = cast(dict[str, Any], copy.deepcopy(draft_workflow.graph_dict))
        agent_nodes = dict(WorkflowAgentNodeValidator.iter_agent_v2_nodes(graph))
        if not agent_nodes:
            return graph

        bindings = session.scalars(
            select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.tenant_id == draft_workflow.tenant_id,
                WorkflowAgentNodeBinding.app_id == draft_workflow.app_id,
                WorkflowAgentNodeBinding.workflow_id == draft_workflow.id,
                WorkflowAgentNodeBinding.workflow_version == cls._DRAFT_WORKFLOW_VERSION,
                WorkflowAgentNodeBinding.node_id.in_(list(agent_nodes.keys())),
            )
        ).all()
        for binding in bindings:
            node_data = agent_nodes.get(binding.node_id)
            if not isinstance(node_data, dict):
                continue
            graph_binding = node_data.get(cls._AGENT_BINDING_KEY)
            is_pending_inline_graph_binding = (
                isinstance(graph_binding, Mapping)
                and graph_binding.get("binding_type") == WorkflowAgentBindingType.INLINE_AGENT.value
                and (not graph_binding.get("agent_id") or not graph_binding.get("current_snapshot_id"))
            )
            if not is_pending_inline_graph_binding or binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT:
                node_data[cls._AGENT_BINDING_KEY] = {
                    "binding_type": binding.binding_type.value,
                    "agent_id": binding.agent_id,
                    "current_snapshot_id": binding.current_snapshot_id,
                }
            node_job = WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict)
            if node_job.workflow_prompt is not None:
                node_data[cls._AGENT_TASK_KEY] = node_job.workflow_prompt
            node_data[cls._AGENT_DECLARED_OUTPUTS_KEY] = [
                output.model_dump(mode="json") for output in node_job.declared_outputs
            ]
        return graph

    @classmethod
    def validate_agent_nodes_for_publish(cls, *, session: Session, draft_workflow: Workflow) -> None:
        WorkflowAgentNodeValidator.validate_published_workflow(session=session, workflow=draft_workflow)
        cls._validate_composer_configs_for_publish(session=session, draft_workflow=draft_workflow)

    @classmethod
    def validate_agent_nodes_for_draft_sync(cls, *, session: Session, draft_workflow: Workflow) -> None:
        WorkflowAgentNodeValidator.validate_draft_workflow(session=session, workflow=draft_workflow)

    @classmethod
    def _validate_composer_configs_for_publish(cls, *, session: Session, draft_workflow: Workflow) -> None:
        node_ids = {
            node_id for node_id, _node_data in WorkflowAgentNodeValidator.iter_agent_v2_nodes(draft_workflow.graph_dict)
        }
        if not node_ids:
            return

        bindings = session.scalars(
            select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.tenant_id == draft_workflow.tenant_id,
                WorkflowAgentNodeBinding.app_id == draft_workflow.app_id,
                WorkflowAgentNodeBinding.workflow_id == draft_workflow.id,
                WorkflowAgentNodeBinding.workflow_version == draft_workflow.version,
                WorkflowAgentNodeBinding.node_id.in_(node_ids),
            )
        ).all()
        for binding in bindings:
            cls._validate_binding_composer_config_for_publish(session=session, binding=binding)

    @classmethod
    def _validate_binding_composer_config_for_publish(
        cls,
        *,
        session: Session,
        binding: WorkflowAgentNodeBinding,
    ) -> None:
        if not binding.agent_id:
            return

        agent = session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == binding.tenant_id,
                Agent.id == binding.agent_id,
            )
            .limit(1)
        )
        if agent is None:
            return

        snapshot_id = (
            agent.active_config_snapshot_id
            if binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
            else binding.current_snapshot_id
        )
        if snapshot_id is None:
            return

        snapshot = session.scalar(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.tenant_id == binding.tenant_id,
                AgentConfigSnapshot.agent_id == agent.id,
                AgentConfigSnapshot.id == snapshot_id,
            )
            .limit(1)
        )
        if snapshot is None:
            return

        agent_soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
        node_job = WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict)
        payload = ComposerSavePayload.model_construct(
            variant=ComposerVariant.WORKFLOW,
            save_strategy=ComposerSaveStrategy.NODE_JOB_ONLY,
            soul_lock=ComposerSoulLockPayload(locked=False),
            agent_soul=agent_soul,
            node_job=node_job,
        )
        ComposerConfigValidator.validate_publish_payload(payload)
        # ENG-623 §4.4: drive-backed refs must point at real drive rows before
        # publishing. This stays out of composer save so autosave/save-draft can
        # persist incomplete refs and surface them as non-blocking findings.
        cls._require_drive_refs_resolved_for_publish(session=session, binding=binding, agent_soul=agent_soul)

    @classmethod
    def _require_drive_refs_resolved_for_publish(
        cls,
        *,
        session: Session,
        binding: WorkflowAgentNodeBinding,
        agent_soul: AgentSoulConfig,
    ) -> None:
        from services.agent.prompt_mentions import MentionKind, parse_prompt_mentions
        from services.agent_drive_service import decode_drive_mention_ref

        wanted_keys: dict[str, tuple[str, str]] = {}
        for mention in parse_prompt_mentions(agent_soul.prompt.system_prompt):
            if mention.kind not in {MentionKind.SKILL, MentionKind.FILE}:
                continue
            drive_key = decode_drive_mention_ref(mention.ref_id)
            if not drive_key:
                continue
            code = "skill_ref_dangling" if mention.kind == MentionKind.SKILL else "file_ref_dangling"
            wanted_keys[drive_key] = (code, mention.label or drive_key)
        if not wanted_keys or not binding.agent_id:
            return

        existing_keys = set(
            session.scalars(
                select(AgentDriveFile.key).where(
                    AgentDriveFile.tenant_id == binding.tenant_id,
                    AgentDriveFile.agent_id == binding.agent_id,
                    AgentDriveFile.key.in_(sorted(wanted_keys)),
                )
            ).all()
        )
        messages: list[str] = []
        for key, (code, display) in wanted_keys.items():
            if key in existing_keys:
                continue
            kind = "skill" if code == "skill_ref_dangling" else "file"
            messages.append(f"{code}: {kind} '{display}' has no drive entry for key '{key}'.")
        if messages:
            raise WorkflowAgentNodeValidationError(
                f"Workflow Agent node {binding.node_id} has invalid Agent Soul drive refs: {'; '.join(messages)}"
            )

    @classmethod
    def sync_agent_bindings_for_draft(
        cls,
        *,
        session: Session,
        draft_workflow: Workflow,
        account_id: str,
    ) -> None:
        agent_nodes = dict(WorkflowAgentNodeValidator.iter_agent_v2_nodes(draft_workflow.graph_dict))
        existing_bindings = list(
            session.scalars(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == draft_workflow.tenant_id,
                    WorkflowAgentNodeBinding.app_id == draft_workflow.app_id,
                    WorkflowAgentNodeBinding.workflow_id == draft_workflow.id,
                    WorkflowAgentNodeBinding.workflow_version == cls._DRAFT_WORKFLOW_VERSION,
                )
            ).all()
        )
        existing_by_node_id = {binding.node_id: binding for binding in existing_bindings}

        for binding in existing_bindings:
            if binding.node_id not in agent_nodes:
                session.delete(binding)

        for node_id, node_data in agent_nodes.items():
            binding_payload = node_data.get(cls._AGENT_BINDING_KEY)
            if binding_payload is None:
                continue
            if not isinstance(binding_payload, Mapping):
                raise ValueError(f"Workflow Agent node {node_id} has invalid agent_binding.")
            if binding_payload.get("binding_type") == WorkflowAgentBindingType.INLINE_AGENT.value and (
                not binding_payload.get("agent_id") or not binding_payload.get("current_snapshot_id")
            ):
                continue
            cls._sync_agent_binding_for_node(
                session=session,
                draft_workflow=draft_workflow,
                node_id=node_id,
                node_data=node_data,
                node_binding=binding_payload,
                existing_binding=existing_by_node_id.get(node_id),
                account_id=account_id,
            )
        session.flush()

    @classmethod
    def sync_roster_agent_bindings_for_draft(
        cls,
        *,
        session: Session,
        draft_workflow: Workflow,
        account_id: str,
    ) -> None:
        cls.sync_agent_bindings_for_draft(
            session=session,
            draft_workflow=draft_workflow,
            account_id=account_id,
        )

    @classmethod
    def _sync_agent_binding_for_node(
        cls,
        *,
        session: Session,
        draft_workflow: Workflow,
        node_id: str,
        node_data: Mapping[str, Any],
        node_binding: Mapping[str, Any],
        existing_binding: WorkflowAgentNodeBinding | None,
        account_id: str,
    ) -> None:
        binding_type = node_binding.get("binding_type")
        agent_id = node_binding.get("agent_id")
        if not isinstance(agent_id, str) or not agent_id:
            raise ValueError(f"Workflow Agent node {node_id} agent binding requires agent_id.")

        if binding_type == WorkflowAgentBindingType.ROSTER_AGENT.value:
            agent, current_snapshot_id = cls._resolve_roster_agent_graph_binding(
                session=session,
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
            agent = cls._resolve_inline_agent_graph_binding(
                session=session,
                draft_workflow=draft_workflow,
                node_id=node_id,
                agent_id=agent_id,
                current_snapshot_id=current_snapshot_id,
            )
            resolved_binding_type = WorkflowAgentBindingType.INLINE_AGENT
        else:
            raise ValueError(f"Workflow Agent node {node_id} has unsupported agent_binding type.")

        binding = existing_binding
        node_job_config = cls._node_job_config_from_node_data(
            existing_binding=existing_binding,
            node_data=node_data,
        )
        if binding is None:
            binding = WorkflowAgentNodeBinding(
                tenant_id=draft_workflow.tenant_id,
                app_id=draft_workflow.app_id,
                workflow_id=draft_workflow.id,
                workflow_version=cls._DRAFT_WORKFLOW_VERSION,
                node_id=node_id,
                node_job_config=node_job_config,
                created_by=account_id,
            )
            session.add(binding)
        else:
            binding.node_job_config = node_job_config

        binding.binding_type = resolved_binding_type
        binding.agent_id = agent.id
        binding.current_snapshot_id = current_snapshot_id
        binding.updated_by = account_id

    @classmethod
    def _resolve_roster_agent_graph_binding(
        cls,
        *,
        session: Session,
        draft_workflow: Workflow,
        node_id: str,
        agent_id: str,
    ) -> tuple[Agent, str]:
        agent = session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == draft_workflow.tenant_id,
                Agent.id == agent_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.status == AgentStatus.ACTIVE,
            )
            .limit(1)
        )
        if agent is None:
            raise ValueError(f"Workflow Agent node {node_id} references an unavailable roster agent.")
        if agent.scope != AgentScope.ROSTER:
            raise ValueError(f"Workflow Agent node {node_id} roster_agent binding must reference a roster agent.")
        if not agent.active_config_snapshot_id:
            raise ValueError(f"Workflow Agent node {node_id} roster agent has no active config snapshot.")
        return agent, agent.active_config_snapshot_id

    @classmethod
    def _resolve_inline_agent_graph_binding(
        cls,
        *,
        session: Session,
        draft_workflow: Workflow,
        node_id: str,
        agent_id: str,
        current_snapshot_id: str,
    ) -> Agent:
        agent = session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == draft_workflow.tenant_id,
                Agent.id == agent_id,
                Agent.scope == AgentScope.WORKFLOW_ONLY,
                Agent.app_id == draft_workflow.app_id,
                Agent.workflow_id == draft_workflow.id,
                Agent.workflow_node_id == node_id,
                Agent.status == AgentStatus.ACTIVE,
            )
            .limit(1)
        )
        if agent is None:
            raise ValueError(f"Workflow Agent node {node_id} references an unavailable inline agent.")
        if (
            agent.scope != AgentScope.WORKFLOW_ONLY
            or agent.app_id != draft_workflow.app_id
            or agent.workflow_id != draft_workflow.id
            or agent.workflow_node_id != node_id
        ):
            raise ValueError(f"Workflow Agent node {node_id} inline_agent binding does not belong to this node.")

        snapshot = session.scalar(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.tenant_id == draft_workflow.tenant_id,
                AgentConfigSnapshot.agent_id == agent.id,
                AgentConfigSnapshot.id == current_snapshot_id,
            )
            .limit(1)
        )
        if snapshot is None or snapshot.agent_id != agent.id:
            raise ValueError(f"Workflow Agent node {node_id} references a missing inline agent config snapshot.")
        return agent

    @classmethod
    def _node_job_config_from_node_data(
        cls,
        *,
        existing_binding: WorkflowAgentNodeBinding | None,
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
                node_job.declared_outputs = [
                    DeclaredOutputConfig.model_validate(output) for output in declared_outputs_payload
                ]
            except ValidationError as exc:
                raise ValueError("Workflow Agent node has invalid agent_declared_outputs.") from exc

        return node_job

    @classmethod
    def _previous_node_output_refs_from_prompt(cls, prompt: str) -> list[WorkflowPreviousNodeOutputRef]:
        """Derive persisted refs from the current frontend workflow markers only."""
        return workflow_previous_node_output_refs_from_selectors(
            extract_workflow_node_output_selectors(prompt)
        )

    @classmethod
    def copy_agent_node_bindings_to_published(
        cls,
        *,
        session: Session,
        draft_workflow: Workflow,
        published_workflow: Workflow,
    ) -> None:
        node_ids = {
            node_id for node_id, _node_data in WorkflowAgentNodeValidator.iter_agent_v2_nodes(draft_workflow.graph_dict)
        }
        if not node_ids:
            return

        bindings = session.scalars(
            select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.tenant_id == draft_workflow.tenant_id,
                WorkflowAgentNodeBinding.app_id == draft_workflow.app_id,
                WorkflowAgentNodeBinding.workflow_id == draft_workflow.id,
                WorkflowAgentNodeBinding.workflow_version == draft_workflow.version,
                WorkflowAgentNodeBinding.node_id.in_(node_ids),
            )
        ).all()
        if not bindings:
            return

        agents_by_id = {
            agent.id: agent
            for agent in session.scalars(
                select(Agent).where(
                    Agent.tenant_id == draft_workflow.tenant_id,
                    Agent.id.in_({binding.agent_id for binding in bindings if binding.agent_id}),
                )
            ).all()
        }

        for binding in bindings:
            agent = agents_by_id.get(binding.agent_id) if binding.agent_id else None
            current_snapshot_id = (
                agent.active_config_snapshot_id
                if agent is not None and binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
                else binding.current_snapshot_id
            )
            copied = WorkflowAgentNodeBinding(
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
            session.add(copied)
