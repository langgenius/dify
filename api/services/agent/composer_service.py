from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from extensions.ext_database import db
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import (
    DeclaredOutputConfig,
)
from models.agent_config_entities import (
    effective_declared_outputs as _effective_declared_outputs,
)
from models.workflow import Workflow
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import AgentNameConflictError, AgentNotFoundError, AgentVersionNotFoundError
from services.entities.agent_entities import (
    AgentSoulConfig,
    ComposerCandidatesResponse,
    ComposerSavePayload,
    ComposerSaveStrategy,
    ComposerVariant,
    WorkflowNodeJobConfig,
)

# WorkflowAgentNodeBinding.workflow_version tag for the draft workflow row.
# Mirrors Workflow.version when it is "draft" (see models/workflow.py).
_DRAFT_WORKFLOW_VERSION = "draft"


class AgentComposerService:
    @classmethod
    def load_workflow_composer(cls, *, tenant_id: str, app_id: str, node_id: str) -> dict[str, Any]:
        workflow = cls._get_draft_workflow(tenant_id=tenant_id, app_id=app_id)
        binding = cls._get_workflow_binding(tenant_id=tenant_id, workflow_id=workflow.id, node_id=node_id)
        if not binding:
            return cls._empty_workflow_state(app_id=app_id, workflow_id=workflow.id, node_id=node_id)

        agent = cls._get_agent_if_present(tenant_id=tenant_id, agent_id=binding.agent_id)
        version = cls._get_version_if_present(
            tenant_id=tenant_id,
            agent_id=agent.id if agent else None,
            version_id=binding.current_snapshot_id,
        )
        return cls._serialize_workflow_state(binding=binding, agent=agent, version=version)

    @classmethod
    def save_workflow_composer(
        cls, *, tenant_id: str, app_id: str, node_id: str, account_id: str, payload: ComposerSavePayload
    ) -> dict[str, Any]:
        if payload.variant != ComposerVariant.WORKFLOW:
            raise ValueError("Workflow composer endpoint only accepts workflow variant")

        ComposerConfigValidator.validate_save_payload(payload)
        workflow = cls._get_draft_workflow(tenant_id=tenant_id, app_id=app_id)
        binding = cls._get_workflow_binding(tenant_id=tenant_id, workflow_id=workflow.id, node_id=node_id)

        match payload.save_strategy:
            case ComposerSaveStrategy.NODE_JOB_ONLY:
                binding = cls._save_node_job_only(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    workflow_id=workflow.id,
                    node_id=node_id,
                    account_id=account_id,
                    binding=binding,
                    payload=payload,
                )
            case ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION:
                binding = cls._save_to_current_version(
                    tenant_id=tenant_id, account_id=account_id, binding=binding, payload=payload
                )
            case ComposerSaveStrategy.SAVE_AS_NEW_VERSION:
                binding = cls._save_as_new_version(
                    tenant_id=tenant_id, account_id=account_id, binding=binding, payload=payload
                )
            case ComposerSaveStrategy.SAVE_AS_NEW_AGENT:
                binding = cls._save_as_new_agent(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    workflow_id=workflow.id,
                    node_id=node_id,
                    account_id=account_id,
                    binding=binding,
                    payload=payload,
                )
            case ComposerSaveStrategy.SAVE_TO_ROSTER:
                binding = cls._save_to_roster(
                    tenant_id=tenant_id, account_id=account_id, binding=binding, payload=payload
                )

        db.session.commit()
        agent = cls._get_agent_if_present(tenant_id=tenant_id, agent_id=binding.agent_id)
        version = cls._get_version_if_present(
            tenant_id=tenant_id,
            agent_id=agent.id if agent else None,
            version_id=binding.current_snapshot_id,
        )
        return cls._serialize_workflow_state(binding=binding, agent=agent, version=version)

    @classmethod
    def load_agent_app_composer(cls, *, tenant_id: str, app_id: str) -> dict[str, Any]:
        agent = db.session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == tenant_id,
                Agent.app_id == app_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.status == AgentStatus.ACTIVE,
            )
            .order_by(Agent.created_at.desc())
            .limit(1)
        )
        if not agent:
            raise AgentNotFoundError()
        version = cls._require_version(
            tenant_id=tenant_id, agent_id=agent.id, version_id=agent.active_config_snapshot_id
        )
        return {
            "variant": ComposerVariant.AGENT_APP.value,
            "agent": cls._serialize_agent(agent),
            "active_config_snapshot": cls._serialize_version(version),
            "agent_soul": version.config_snapshot_dict,
            "save_options": [
                ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
                ComposerSaveStrategy.SAVE_AS_NEW_VERSION.value,
            ],
        }

    @classmethod
    def save_agent_app_composer(
        cls, *, tenant_id: str, app_id: str, account_id: str, payload: ComposerSavePayload
    ) -> dict[str, Any]:
        if payload.variant != ComposerVariant.AGENT_APP:
            raise ValueError("Agent App composer endpoint only accepts agent_app variant")
        ComposerConfigValidator.validate_save_payload(payload)
        if payload.agent_soul is None:
            raise ValueError("agent_soul is required")

        agent = db.session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == tenant_id,
                Agent.app_id == app_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.status == AgentStatus.ACTIVE,
            )
            .order_by(Agent.created_at.desc())
            .limit(1)
        )
        if not agent:
            agent = Agent(
                tenant_id=tenant_id,
                name=payload.new_agent_name or "Untitled Agent",
                description="",
                agent_kind=AgentKind.DIFY_AGENT,
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                app_id=app_id,
                status=AgentStatus.ACTIVE,
                created_by=account_id,
                updated_by=account_id,
            )
            db.session.add(agent)
            try:
                db.session.flush()
            except IntegrityError as exc:
                db.session.rollback()
                raise AgentNameConflictError() from exc

        if payload.save_strategy == ComposerSaveStrategy.SAVE_AS_NEW_VERSION or not agent.active_config_snapshot_id:
            version = cls._create_config_version(
                tenant_id=tenant_id,
                agent_id=agent.id,
                account_id=account_id,
                agent_soul=payload.agent_soul,
                operation=AgentConfigRevisionOperation.SAVE_NEW_VERSION,
                version_note=payload.version_note,
            )
            agent.active_config_snapshot_id = version.id
        else:
            current_snapshot = cls._require_version(
                tenant_id=tenant_id, agent_id=agent.id, version_id=agent.active_config_snapshot_id
            )
            version = cls._update_current_version(
                current_snapshot=current_snapshot,
                account_id=account_id,
                agent_soul=payload.agent_soul,
                operation=AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
                version_note=payload.version_note,
            )
            agent.active_config_snapshot_id = version.id
            agent.updated_by = account_id

        db.session.commit()
        return cls.load_agent_app_composer(tenant_id=tenant_id, app_id=app_id)

    @classmethod
    def get_workflow_candidates(cls, *, app_id: str) -> dict[str, Any]:
        response = ComposerCandidatesResponse(
            variant=ComposerVariant.WORKFLOW,
            allowed_node_job_candidates={
                "previous_node_outputs": [],
                "declare_output_types": ["string", "number", "object", "array", "boolean", "file"],
                "human_contacts": [],
            },
            allowed_soul_candidates={
                "skills_files": [],
                "dify_tools": [],
                "cli_tools": [],
                "knowledge_datasets": [],
                "human_contacts": [],
            },
        )
        return response.model_dump(mode="json")

    @classmethod
    def get_agent_app_candidates(cls, *, app_id: str) -> dict[str, Any]:
        response = ComposerCandidatesResponse(
            variant=ComposerVariant.AGENT_APP,
            allowed_node_job_candidates={},
            allowed_soul_candidates={
                "skills_files": [],
                "dify_tools": [],
                "cli_tools": [],
                "knowledge_datasets": [],
                "human_contacts": [],
            },
        )
        return response.model_dump(mode="json")

    @classmethod
    def calculate_impact(cls, *, tenant_id: str, current_snapshot_id: str) -> dict[str, Any]:
        bindings = list(
            db.session.scalars(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == tenant_id,
                    WorkflowAgentNodeBinding.current_snapshot_id == current_snapshot_id,
                )
            ).all()
        )
        return {
            "current_snapshot_id": current_snapshot_id,
            "workflow_node_count": len(bindings),
            "bindings": [
                {
                    "app_id": binding.app_id,
                    "workflow_id": binding.workflow_id,
                    "node_id": binding.node_id,
                }
                for binding in bindings
            ],
        }

    @classmethod
    def _save_node_job_only(
        cls,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
        account_id: str,
        binding: WorkflowAgentNodeBinding | None,
        payload: ComposerSavePayload,
    ) -> WorkflowAgentNodeBinding:
        node_job = payload.node_job or WorkflowNodeJobConfig()
        if binding:
            binding.node_job_config = node_job
            binding.updated_by = account_id
            return binding

        agent_soul = payload.agent_soul or AgentSoulConfig()
        agent = cls._create_workflow_only_agent(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            node_id=node_id,
            account_id=account_id,
            agent_soul=agent_soul,
        )
        binding = WorkflowAgentNodeBinding(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_version=_DRAFT_WORKFLOW_VERSION,
            node_id=node_id,
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            agent_id=agent.id,
            current_snapshot_id=agent.active_config_snapshot_id,
            node_job_config=node_job,
            created_by=account_id,
            updated_by=account_id,
        )
        db.session.add(binding)
        db.session.flush()
        return binding

    @classmethod
    def _save_to_current_version(
        cls,
        *,
        tenant_id: str,
        account_id: str,
        binding: WorkflowAgentNodeBinding | None,
        payload: ComposerSavePayload,
    ) -> WorkflowAgentNodeBinding:
        binding = cls._require_binding(binding)
        if payload.agent_soul is None:
            raise ValueError("agent_soul is required")
        current_snapshot = cls._require_version(
            tenant_id=tenant_id,
            agent_id=binding.agent_id,
            version_id=binding.current_snapshot_id,
        )
        version = cls._update_current_version(
            current_snapshot=current_snapshot,
            account_id=account_id,
            agent_soul=payload.agent_soul,
            operation=AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
            version_note=payload.version_note,
        )
        agent = cls._require_agent(tenant_id=tenant_id, agent_id=binding.agent_id)
        agent.active_config_snapshot_id = version.id
        agent.updated_by = account_id
        binding.current_snapshot_id = version.id
        if payload.node_job is not None:
            binding.node_job_config = payload.node_job
        binding.updated_by = account_id
        return binding

    @classmethod
    def _save_as_new_version(
        cls,
        *,
        tenant_id: str,
        account_id: str,
        binding: WorkflowAgentNodeBinding | None,
        payload: ComposerSavePayload,
    ) -> WorkflowAgentNodeBinding:
        binding = cls._require_binding(binding)
        if not binding.agent_id or payload.agent_soul is None:
            raise ValueError("agent_id and agent_soul are required")
        version = cls._create_config_version(
            tenant_id=tenant_id,
            agent_id=binding.agent_id,
            account_id=account_id,
            agent_soul=payload.agent_soul,
            operation=AgentConfigRevisionOperation.SAVE_NEW_VERSION,
            version_note=payload.version_note,
        )
        agent = cls._require_agent(tenant_id=tenant_id, agent_id=binding.agent_id)
        agent.active_config_snapshot_id = version.id
        agent.updated_by = account_id
        binding.current_snapshot_id = version.id
        binding.updated_by = account_id
        if payload.node_job is not None:
            binding.node_job_config = payload.node_job
        return binding

    @classmethod
    def _save_as_new_agent(
        cls,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
        account_id: str,
        binding: WorkflowAgentNodeBinding | None,
        payload: ComposerSavePayload,
    ) -> WorkflowAgentNodeBinding:
        if payload.agent_soul is None:
            raise ValueError("agent_soul is required")
        agent_name = payload.new_agent_name or "Untitled Agent"
        agent = cls._create_roster_agent_for_composer(
            tenant_id=tenant_id,
            account_id=account_id,
            name=agent_name,
            agent_soul=payload.agent_soul,
            operation=AgentConfigRevisionOperation.SAVE_NEW_AGENT,
            version_note=payload.version_note,
        )
        node_job = payload.node_job or WorkflowNodeJobConfig()
        if not binding:
            binding = WorkflowAgentNodeBinding(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                workflow_version=_DRAFT_WORKFLOW_VERSION,
                node_id=node_id,
                created_by=account_id,
            )
            db.session.add(binding)
        binding.binding_type = WorkflowAgentBindingType.ROSTER_AGENT
        binding.agent_id = agent.id
        binding.current_snapshot_id = agent.active_config_snapshot_id
        binding.node_job_config = node_job
        binding.updated_by = account_id
        db.session.flush()
        return binding

    @classmethod
    def _save_to_roster(
        cls,
        *,
        tenant_id: str,
        account_id: str,
        binding: WorkflowAgentNodeBinding | None,
        payload: ComposerSavePayload,
    ) -> WorkflowAgentNodeBinding:
        binding = cls._require_binding(binding)
        source_agent = cls._require_agent(tenant_id=tenant_id, agent_id=binding.agent_id)
        source_version = cls._require_version(
            tenant_id=tenant_id,
            agent_id=source_agent.id,
            version_id=binding.current_snapshot_id,
        )
        agent_soul = payload.agent_soul or AgentSoulConfig.model_validate(source_version.config_snapshot_dict)
        agent_name = payload.new_agent_name or source_agent.name
        roster_agent = cls._create_roster_agent_for_composer(
            tenant_id=tenant_id,
            account_id=account_id,
            name=agent_name,
            agent_soul=agent_soul,
            operation=AgentConfigRevisionOperation.SAVE_TO_ROSTER,
            version_note=payload.version_note,
        )
        binding.binding_type = WorkflowAgentBindingType.ROSTER_AGENT
        binding.agent_id = roster_agent.id
        binding.current_snapshot_id = roster_agent.active_config_snapshot_id
        binding.updated_by = account_id
        if payload.node_job is not None:
            binding.node_job_config = payload.node_job
        return binding

    @classmethod
    def _create_workflow_only_agent(
        cls,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
        account_id: str,
        agent_soul: AgentSoulConfig,
    ) -> Agent:
        agent = Agent(
            tenant_id=tenant_id,
            name=f"Workflow Agent {node_id}",
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_node_id=node_id,
            status=AgentStatus.ACTIVE,
            created_by=account_id,
            updated_by=account_id,
        )
        db.session.add(agent)
        db.session.flush()
        version = cls._create_config_version(
            tenant_id=tenant_id,
            agent_id=agent.id,
            account_id=account_id,
            agent_soul=agent_soul,
            operation=AgentConfigRevisionOperation.CREATE_VERSION,
            version_note=None,
        )
        agent.active_config_snapshot_id = version.id
        return agent

    @classmethod
    def _create_roster_agent_for_composer(
        cls,
        *,
        tenant_id: str,
        account_id: str,
        name: str,
        agent_soul: AgentSoulConfig,
        operation: AgentConfigRevisionOperation,
        version_note: str | None,
    ) -> Agent:
        agent = Agent(
            tenant_id=tenant_id,
            name=name,
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.WORKFLOW,
            status=AgentStatus.ACTIVE,
            created_by=account_id,
            updated_by=account_id,
        )
        db.session.add(agent)
        try:
            db.session.flush()
        except IntegrityError as exc:
            db.session.rollback()
            raise AgentNameConflictError() from exc
        version = cls._create_config_version(
            tenant_id=tenant_id,
            agent_id=agent.id,
            account_id=account_id,
            agent_soul=agent_soul,
            operation=operation,
            version_note=version_note,
        )
        agent.active_config_snapshot_id = version.id
        return agent

    @classmethod
    def _create_config_version(
        cls,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        agent_soul: AgentSoulConfig,
        operation: AgentConfigRevisionOperation,
        version_note: str | None,
        previous_snapshot_id: str | None = None,
    ) -> AgentConfigSnapshot:
        next_version = (
            db.session.scalar(
                select(func.max(AgentConfigSnapshot.version)).where(
                    AgentConfigSnapshot.tenant_id == tenant_id,
                    AgentConfigSnapshot.agent_id == agent_id,
                )
            )
            or 0
        ) + 1
        version = AgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent_id,
            version=next_version,
            config_snapshot=agent_soul,
            version_note=version_note,
            created_by=account_id,
        )
        db.session.add(version)
        db.session.flush()
        revision = AgentConfigRevision(
            tenant_id=tenant_id,
            agent_id=agent_id,
            previous_snapshot_id=previous_snapshot_id,
            current_snapshot_id=version.id,
            revision=cls._next_revision(tenant_id=tenant_id, agent_id=agent_id),
            operation=operation,
            version_note=version_note,
            created_by=account_id,
        )
        db.session.add(revision)
        db.session.flush()
        return version

    @classmethod
    def _update_current_version(
        cls,
        *,
        current_snapshot: AgentConfigSnapshot,
        account_id: str,
        agent_soul: AgentSoulConfig,
        operation: AgentConfigRevisionOperation,
        version_note: str | None,
    ) -> AgentConfigSnapshot:
        return cls._create_config_version(
            tenant_id=current_snapshot.tenant_id,
            agent_id=current_snapshot.agent_id,
            account_id=account_id,
            agent_soul=agent_soul,
            operation=operation,
            version_note=version_note,
            previous_snapshot_id=current_snapshot.id,
        )

    @classmethod
    def _next_revision(cls, *, tenant_id: str, agent_id: str) -> int:
        return (
            db.session.scalar(
                select(func.max(AgentConfigRevision.revision)).where(
                    AgentConfigRevision.tenant_id == tenant_id,
                    AgentConfigRevision.agent_id == agent_id,
                )
            )
            or 0
        ) + 1

    @classmethod
    def _get_draft_workflow(cls, *, tenant_id: str, app_id: str) -> Workflow:
        workflow = db.session.scalar(
            select(Workflow)
            .where(
                Workflow.tenant_id == tenant_id,
                Workflow.app_id == app_id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
            .limit(1)
        )
        if not workflow:
            raise ValueError("Draft workflow not found")
        return workflow

    @classmethod
    def _get_workflow_binding(
        cls, *, tenant_id: str, workflow_id: str, node_id: str
    ) -> WorkflowAgentNodeBinding | None:
        # Composer always operates against the draft workflow row, so this lookup
        # is scoped to ``workflow_version="draft"``. Published bindings are
        # materialized by WorkflowAgentPublishService.copy_agent_node_bindings_to_published
        # and are not edited through the Composer.
        return db.session.scalar(
            select(WorkflowAgentNodeBinding)
            .where(
                WorkflowAgentNodeBinding.tenant_id == tenant_id,
                WorkflowAgentNodeBinding.workflow_id == workflow_id,
                WorkflowAgentNodeBinding.workflow_version == _DRAFT_WORKFLOW_VERSION,
                WorkflowAgentNodeBinding.node_id == node_id,
            )
            .limit(1)
        )

    @classmethod
    def _require_binding(cls, binding: WorkflowAgentNodeBinding | None) -> WorkflowAgentNodeBinding:
        if not binding:
            raise ValueError("Workflow agent binding not found")
        return binding

    @classmethod
    def _require_agent(cls, *, tenant_id: str, agent_id: str | None) -> Agent:
        if not agent_id:
            raise AgentNotFoundError()
        agent = db.session.scalar(select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id).limit(1))
        if not agent:
            raise AgentNotFoundError()
        return agent

    @classmethod
    def _get_agent_if_present(cls, *, tenant_id: str, agent_id: str | None) -> Agent | None:
        if not agent_id:
            return None
        return db.session.scalar(select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id).limit(1))

    @classmethod
    def _require_version(cls, *, tenant_id: str, agent_id: str | None, version_id: str | None) -> AgentConfigSnapshot:
        if not agent_id or not version_id:
            raise AgentVersionNotFoundError()
        version = db.session.scalar(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == version_id,
            )
            .limit(1)
        )
        if not version:
            raise AgentVersionNotFoundError()
        return version

    @classmethod
    def _get_version_if_present(
        cls, *, tenant_id: str, agent_id: str | None, version_id: str | None
    ) -> AgentConfigSnapshot | None:
        if not agent_id or not version_id:
            return None
        return db.session.scalar(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == version_id,
            )
            .limit(1)
        )

    @staticmethod
    def _declared_outputs_from_binding(binding: WorkflowAgentNodeBinding) -> list[DeclaredOutputConfig]:
        """Re-hydrate the binding's node_job_config into typed declared outputs.

        node_job_config is stored as JSON / LongText; the typed view is needed
        so the effective_declared_outputs helper can fall back to defaults on
        an empty list without callers re-implementing the fallback.
        """
        node_job = WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict)
        return list(node_job.declared_outputs)

    @staticmethod
    def _serialize_effective_outputs(declared_outputs: list[DeclaredOutputConfig]) -> list[dict[str, Any]]:
        """JSON-serialize the effective declared outputs (PRD defaults if empty).

        Stage 4 decision D-3 keeps defaults out of the DB; this helper is the
        single place that injects them into the Composer load response so the
        wire shape stays consistent whether the user has declared anything yet.
        """
        return [output.model_dump(mode="json") for output in _effective_declared_outputs(declared_outputs)]

    @classmethod
    def _empty_workflow_state(cls, *, app_id: str, workflow_id: str, node_id: str) -> dict[str, Any]:
        return {
            "variant": ComposerVariant.WORKFLOW.value,
            "agent": None,
            "active_config_snapshot": None,
            "binding": None,
            "soul_lock": {"locked": False, "can_unlock": False, "reason": "workflow_only_empty"},
            "agent_soul": AgentSoulConfig().model_dump(mode="json"),
            "node_job": WorkflowNodeJobConfig().model_dump(mode="json"),
            # Stage 4 §4.1 / §10.1 (D-3): empty composer state still surfaces the
            # PRD defaults so the front-end has stable output names to render.
            "effective_declared_outputs": cls._serialize_effective_outputs([]),
            "save_options": [ComposerSaveStrategy.NODE_JOB_ONLY.value, ComposerSaveStrategy.SAVE_TO_ROSTER.value],
            "impact_summary": None,
            "app_id": app_id,
            "workflow_id": workflow_id,
            "node_id": node_id,
        }

    @classmethod
    def _serialize_workflow_state(
        cls,
        *,
        binding: WorkflowAgentNodeBinding,
        agent: Agent | None,
        version: AgentConfigSnapshot | None,
    ) -> dict[str, Any]:
        locked = bool(agent and agent.scope == AgentScope.ROSTER)
        save_options = [ComposerSaveStrategy.NODE_JOB_ONLY.value]
        if locked:
            save_options.extend(
                [
                    ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
                    ComposerSaveStrategy.SAVE_AS_NEW_VERSION.value,
                    ComposerSaveStrategy.SAVE_AS_NEW_AGENT.value,
                ]
            )
        else:
            save_options.append(ComposerSaveStrategy.SAVE_TO_ROSTER.value)
        return {
            "variant": ComposerVariant.WORKFLOW.value,
            "agent": cls._serialize_agent(agent) if agent else None,
            "active_config_snapshot": cls._serialize_version(version),
            "binding": {
                "id": binding.id,
                "binding_type": binding.binding_type.value,
                "agent_id": binding.agent_id,
                "current_snapshot_id": binding.current_snapshot_id,
                "workflow_id": binding.workflow_id,
                "node_id": binding.node_id,
            },
            "soul_lock": {
                "locked": locked,
                "can_unlock": locked,
                "reason": "roster_agent_shared_version" if locked else "workflow_only_agent",
            },
            "agent_soul": cls._workflow_agent_soul_config(version.config_snapshot_dict)
            if version
            else AgentSoulConfig().model_dump(mode="json"),
            "node_job": binding.node_job_config_dict,
            # Stage 4 §4.1 / §10.1 (D-3): when the saved node_job carries no
            # declared_outputs, surface the PRD defaults so the front-end can
            # render them as read-only chips. When user-defined outputs exist
            # this is the same list (so callers don't need to special-case).
            "effective_declared_outputs": cls._serialize_effective_outputs(cls._declared_outputs_from_binding(binding)),
            "save_options": save_options,
            "impact_summary": cls.calculate_impact(
                tenant_id=binding.tenant_id, current_snapshot_id=binding.current_snapshot_id
            )
            if binding.current_snapshot_id
            else None,
        }

    @classmethod
    def _serialize_agent(cls, agent: Agent) -> dict[str, Any]:
        return {
            "id": agent.id,
            "name": agent.name,
            "description": agent.description,
            "scope": agent.scope.value,
            "status": agent.status.value,
            "active_config_snapshot_id": agent.active_config_snapshot_id,
        }

    @classmethod
    def _serialize_version(cls, version: AgentConfigSnapshot | None) -> dict[str, Any] | None:
        if not version:
            return None
        return {
            "id": version.id,
            "version": version.version,
            "version_note": version.version_note,
            "created_by": version.created_by,
            "created_at": version.created_at.isoformat() if version.created_at else None,
        }

    @staticmethod
    def _workflow_agent_soul_config(config_snapshot: dict[str, Any]) -> dict[str, Any]:
        agent_soul = dict(config_snapshot)
        agent_soul["app_features"] = {}
        agent_soul["app_variables"] = []
        return agent_soul
