import json
import logging
from dataclasses import asdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.agent.publish_visibility import agent_has_workflow_callable_active_snapshot
from models import Account
from models.agent import (
    APP_BACKED_AGENT_SOURCES,
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentIconType,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import DeclaredOutputConfig
from models.agent_config_entities import (
    effective_declared_outputs as _effective_declared_outputs,
)
from models.agent_soul_state import agent_soul_has_model, backfill_cli_tool_ids
from models.workflow import Workflow
from repositories.agent.agent_app_composer_queries import composer_identity, composer_snapshot, read_composer_state
from repositories.agent.agent_drafts import (
    agent_soul_matches_active_config,
    create_composer_snapshot,
    get_or_create_agent_draft,
    next_composer_revision,
    preserve_omitted_config_files,
    rebase_workflow_only_normal_draft,
    save_agent_draft,
)
from repositories.agent.agent_roster_queries import find_agent_draft, project_agent_draft_summary
from repositories.workflow_agent_composer_queries import read_workflow_agent_impact
from services.agent.app_composer import composer_validation_findings
from services.agent.app_composer_store import AgentComposerSnapshotMissingError
from services.agent.build_session_store import AgentBuildAgentNotFoundError, AgentBuildBaseUnavailableError
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.dsl_entities import make_portable_agent_soul
from services.agent.errors import (
    AgentNameConflictError,
    AgentNotFoundError,
    AgentVersionConflictError,
    AgentVersionNotFoundError,
    InvalidComposerConfigError,
)
from services.agent.knowledge_datasets import (
    get_tenant_knowledge_dataset_rows,
    list_missing_tenant_knowledge_dataset_ids,
)
from services.agent.knowledge_spaces import sync_agent_app_knowledge_bindings, validate_agent_knowledge_spaces
from services.agent.retirement_service import WorkflowAgentRetirementService
from services.agent.roster_service import AgentRosterService
from services.agent.session_policy import (
    apply_workflow_agent_session_policy_to_node_data,
    merge_workflow_agent_session_policy,
)
from services.app_service import AppService, CreateAppParams
from services.entities.agent_entities import (
    AgentSoulConfig,
    ComposerCandidatesResponse,
    ComposerSavePayload,
    ComposerSaveStrategy,
    ComposerVariant,
    WorkflowNodeJobConfig,
)
from services.skill_management_service import SkillManagementService

# WorkflowAgentNodeBinding.workflow_version tag for the draft workflow row.
# Mirrors Workflow.version when it is "draft" (see models/workflow.py).
_DRAFT_WORKFLOW_VERSION = "draft"
_PUBLISH_SAVE_STRATEGIES = frozenset(
    {
        ComposerSaveStrategy.SAVE_AS_NEW_VERSION,
        ComposerSaveStrategy.SAVE_AS_NEW_AGENT,
        ComposerSaveStrategy.SAVE_TO_ROSTER,
    }
)

logger = logging.getLogger(__name__)


def _validate_composer_payload_for_strategy(payload: ComposerSavePayload) -> None:
    if payload.save_strategy in _PUBLISH_SAVE_STRATEGIES:
        ComposerConfigValidator.validate_publish_payload(payload)
        return
    ComposerConfigValidator.validate_draft_save_payload(payload)


class AgentComposerService:
    @classmethod
    def load_workflow_composer(
        cls,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        node_id: str,
        account_id: str | None = None,
        snapshot_id: str | None = None,
    ) -> dict[str, Any]:
        workflow = cls._get_draft_workflow(session=session, tenant_id=tenant_id, app_id=app_id)
        binding = cls._get_workflow_binding(
            session=session, tenant_id=tenant_id, workflow_id=workflow.id, node_id=node_id
        )
        if not binding:
            if snapshot_id:
                raise AgentVersionNotFoundError()
            return cls._empty_workflow_state(app_id=app_id, workflow_id=workflow.id, node_id=node_id)

        agent = cls._get_agent_if_present(session=session, tenant_id=tenant_id, agent_id=binding.agent_id)
        version = cls._workflow_composer_version(
            session=session,
            tenant_id=tenant_id,
            binding=binding,
            agent=agent,
            snapshot_id=snapshot_id,
        )
        return cls._serialize_workflow_state(
            session=session,
            binding=binding,
            agent=agent,
            version=version,
            account_id=account_id,
            include_draft_files=snapshot_id is None,
        )

    @classmethod
    def _workflow_composer_version(
        cls,
        *,
        session: Session,
        tenant_id: str,
        binding: WorkflowAgentNodeBinding,
        agent: Agent | None,
        snapshot_id: str | None,
    ) -> AgentConfigSnapshot | None:
        if snapshot_id:
            if agent is None:
                raise AgentVersionNotFoundError()
            if binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT:
                if agent.scope != AgentScope.ROSTER:
                    raise AgentVersionNotFoundError()
            elif binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT:
                if (
                    agent.scope != AgentScope.WORKFLOW_ONLY
                    or agent.app_id != binding.app_id
                    or agent.workflow_id != binding.workflow_id
                    or agent.workflow_node_id != binding.node_id
                ):
                    raise AgentVersionNotFoundError()
            else:
                raise AgentVersionNotFoundError()
            return cls._require_version(session=session, tenant_id=tenant_id, agent_id=agent.id, version_id=snapshot_id)

        version_id = (
            agent.active_config_snapshot_id
            if agent and binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
            else binding.current_snapshot_id
        )
        return cls._get_version_if_present(
            session=session,
            tenant_id=tenant_id,
            agent_id=agent.id if agent else None,
            version_id=version_id,
        )

    @classmethod
    def save_workflow_composer(
        cls,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        node_id: str,
        account_id: str,
        payload: ComposerSavePayload,
    ) -> dict[str, Any]:
        """Save one node job while serializing session-policy changes with graph saves.

        Preconditions: the caller has admitted the tenant, App and account and
        validated the Composer payload. Postconditions: all save strategies use
        the persisted session generation, rotate it only for an actual mode
        change, and atomically update the graph fields captured by future runs.
        Validation failures leave the transaction uncommitted and never retire
        running session resources.
        """
        # Read and lock the latest draft before any ORM autoflush can write a cached snapshot.
        with session.no_autoflush:
            if payload.variant != ComposerVariant.WORKFLOW:
                raise ValueError("Workflow composer endpoint only accepts workflow variant")

            backfill_cli_tool_ids(payload.agent_soul)
            _validate_composer_payload_for_strategy(payload)
            if payload.agent_soul is not None:
                validate_agent_knowledge_spaces(
                    session=session,
                    tenant_id=tenant_id,
                    account_id=account_id,
                    agent_soul=payload.agent_soul,
                )
            if payload.save_strategy in _PUBLISH_SAVE_STRATEGIES:
                cls.validate_knowledge_datasets(session=session, tenant_id=tenant_id, agent_soul=payload.agent_soul)
            workflow = cls._get_draft_workflow(session=session, tenant_id=tenant_id, app_id=app_id, for_update=True)
            binding = cls._get_workflow_binding(
                session=session, tenant_id=tenant_id, workflow_id=workflow.id, node_id=node_id, for_update=True
            )
            previous_node_job = (
                WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict) if binding is not None else None
            )
            retirement_candidates = (
                {binding.agent_id}
                if binding is not None
                and binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT
                and binding.agent_id
                and payload.save_strategy
                in {
                    ComposerSaveStrategy.SAVE_AS_NEW_AGENT,
                    ComposerSaveStrategy.SAVE_TO_ROSTER,
                }
                else set()
            )

            match payload.save_strategy:
                case ComposerSaveStrategy.NODE_JOB_ONLY:
                    binding = cls._save_node_job_only(
                        session=session,
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
                        session=session, tenant_id=tenant_id, account_id=account_id, binding=binding, payload=payload
                    )
                case ComposerSaveStrategy.SAVE_AS_NEW_VERSION:
                    binding = cls._save_as_new_version(
                        session=session, tenant_id=tenant_id, account_id=account_id, binding=binding, payload=payload
                    )
                case ComposerSaveStrategy.SAVE_AS_NEW_AGENT:
                    binding = cls._save_as_new_agent(
                        session=session,
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
                        session=session,
                        tenant_id=tenant_id,
                        account_id=account_id,
                        binding=binding,
                        payload=payload,
                    )

            binding.node_job_config = merge_workflow_agent_session_policy(
                previous=previous_node_job,
                node_job=WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict),
                requested_enabled=(
                    payload.node_job.continue_agent_session
                    if payload.node_job is not None and "continue_agent_session" in payload.node_job.model_fields_set
                    else None
                ),
            )
            cls._sync_workflow_session_policy_to_graph(workflow=workflow, binding=binding)
            session.flush()
            agent = cls._get_agent_if_present(session=session, tenant_id=tenant_id, agent_id=binding.agent_id)
            version_id = (
                agent.active_config_snapshot_id
                if agent and binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
                else binding.current_snapshot_id
            )
            version = cls._get_version_if_present(
                session=session,
                tenant_id=tenant_id,
                agent_id=agent.id if agent else None,
                version_id=version_id,
            )
            state = cls._serialize_workflow_state(
                session=session,
                binding=binding,
                agent=agent,
                version=version,
                account_id=account_id,
                include_draft_files=True,
            )
            state["validation"] = cls.collect_validation_findings(payload=payload)
            session.commit()
            WorkflowAgentRetirementService.retire_unowned(
                tenant_id=tenant_id,
                agent_ids=retirement_candidates,
                account_id=account_id,
            )
            return state

    @classmethod
    def copy_workflow_composer_from_roster(
        cls,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        node_id: str,
        account_id: str,
        source_agent_id: str,
        source_snapshot_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Copy a callable roster Agent snapshot into a workflow-owned inline Agent."""

        workflow = cls._get_draft_workflow(session=session, tenant_id=tenant_id, app_id=app_id)
        binding = cls._require_binding(
            cls._get_workflow_binding(session=session, tenant_id=tenant_id, workflow_id=workflow.id, node_id=node_id)
        )

        if binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT and idempotency_key:
            agent = cls._get_agent_if_present(session=session, tenant_id=tenant_id, agent_id=binding.agent_id)
            version = cls._get_version_if_present(
                session=session,
                tenant_id=tenant_id,
                agent_id=agent.id if agent else None,
                version_id=binding.current_snapshot_id,
            )
            return cls._serialize_workflow_state(
                session=session,
                binding=binding,
                agent=agent,
                version=version,
                account_id=account_id,
                include_draft_files=True,
            )

        if binding.binding_type != WorkflowAgentBindingType.ROSTER_AGENT:
            raise InvalidComposerConfigError("Workflow agent node must be bound to a roster agent.")
        if binding.agent_id != source_agent_id:
            raise InvalidComposerConfigError("Source agent does not match the current workflow node binding.")

        source_agent = cls._require_agent(session=session, tenant_id=tenant_id, agent_id=source_agent_id)
        if source_agent.scope != AgentScope.ROSTER or source_agent.status != AgentStatus.ACTIVE:
            raise InvalidComposerConfigError("Source agent must be an active roster agent.")
        if not agent_has_workflow_callable_active_snapshot(session=session, agent=source_agent):
            raise InvalidComposerConfigError("Source agent must have a published config snapshot.")
        source_version = cls._require_version(
            session=session,
            tenant_id=tenant_id,
            agent_id=source_agent.id,
            version_id=source_agent.active_config_snapshot_id,
        )
        if source_snapshot_id and source_snapshot_id != source_version.id:
            raise AgentVersionConflictError()

        agent_soul = AgentSoulConfig.model_validate(source_version.config_snapshot_dict)
        inline_agent = cls._create_workflow_only_agent(
            session=session,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow.id,
            node_id=node_id,
            account_id=account_id,
            agent_soul=agent_soul,
            name=source_agent.name,
            description=source_agent.description,
            role=source_agent.role,
            icon_type=source_agent.icon_type,
            icon=source_agent.icon,
            icon_background=source_agent.icon_background,
        )
        SkillManagementService(session=session).copy_agent_bindings(
            tenant_id=tenant_id,
            source_agent_id=source_agent.id,
            source_snapshot_id=source_version.id,
            target_agent_id=inline_agent.id,
            target_snapshot_id=inline_agent.active_config_snapshot_id,
            user_id=account_id,
        )
        binding.binding_type = WorkflowAgentBindingType.INLINE_AGENT
        binding.agent_id = inline_agent.id
        binding.current_snapshot_id = inline_agent.active_config_snapshot_id
        binding.updated_by = account_id
        session.flush()

        version = cls._require_version(
            session=session,
            tenant_id=tenant_id,
            agent_id=inline_agent.id,
            version_id=inline_agent.active_config_snapshot_id,
        )
        return cls._serialize_workflow_state(
            session=session,
            binding=binding,
            agent=inline_agent,
            version=version,
            account_id=account_id,
            include_draft_files=True,
        )

    @classmethod
    def load_agent_app_composer(cls, *, session: Session, tenant_id: str, app_id: str) -> dict[str, Any]:
        agent = cls._require_agent_app_agent(session=session, tenant_id=tenant_id, app_id=app_id)
        return cls._load_agent_composer_for_agent(session=session, agent=agent)

    @classmethod
    def load_agent_composer(cls, *, session: Session, tenant_id: str, agent_id: str) -> dict[str, Any]:
        agent = cls._require_agent(session=session, tenant_id=tenant_id, agent_id=agent_id)
        return cls._load_agent_composer_for_agent(session=session, agent=agent)

    @classmethod
    def load_published_agent_composer(cls, *, session: Session, tenant_id: str, agent_id: str) -> dict[str, Any]:
        """Read public Composer state after the caller admits template access."""
        agent = cls._require_agent(session=session, tenant_id=tenant_id, agent_id=agent_id)
        if not agent_has_workflow_callable_active_snapshot(session=session, agent=agent):
            raise AgentVersionNotFoundError()
        state = cls._load_agent_composer_for_agent(session=session, agent=agent, published_only=True)
        soul = make_portable_agent_soul(AgentSoulConfig.model_validate(state["agent_soul"]))
        # Export portability alone does not remove plaintext runtime values.
        soul.env = type(soul.env)()
        soul.human = type(soul.human)()
        soul.sandbox = type(soul.sandbox)()
        soul.memory = type(soul.memory)()
        for tool in soul.tools.dify_tools:
            tool.runtime_parameters = {}
        for cli_tool in soul.tools.cli_tools:
            cli_tool.env = type(cli_tool.env)()
            cli_tool.invoke_metadata = {}
        state["agent_soul"] = soul.model_dump(mode="json")
        state["chat_endpoint"] = None
        if state["active_config_snapshot"] is not None:
            state["active_config_snapshot"]["created_by"] = None
        return state

    @classmethod
    def _load_agent_composer_for_agent(
        cls, *, session: Session, agent: Agent, published_only: bool = False
    ) -> dict[str, Any]:
        """Read effective configuration without creating or rebasing persisted drafts.

        Stale workflow-only drafts read from the current snapshot. Their draft
        metadata still describes the persisted row; write paths own rebasing.
        Published-only reads never query drafts or advertise editing capabilities.
        """
        try:
            state = read_composer_state(session, agent=agent, published_only=published_only)
        except AgentComposerSnapshotMissingError as exc:
            raise AgentVersionNotFoundError() from exc
        return {
            **asdict(state),
            "variant": ComposerVariant.AGENT_APP.value,
            "save_options": [option.value for option in state.save_options],
        }

    @classmethod
    def save_agent_app_composer(
        cls,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        account_id: str,
        payload: ComposerSavePayload,
    ) -> dict[str, Any]:
        try:
            with session.no_autoflush:
                return cls._save_agent_app_composer_impl(
                    session=session,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    account_id=account_id,
                    payload=payload,
                )
        except IntegrityError as exc:
            raise AgentNameConflictError() from exc

    @classmethod
    def _save_agent_app_composer_impl(
        cls,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        account_id: str,
        payload: ComposerSavePayload,
    ) -> dict[str, Any]:
        if payload.variant != ComposerVariant.AGENT_APP:
            raise ValueError("Agent App composer endpoint only accepts agent_app variant")
        if payload.save_strategy != ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION:
            raise InvalidComposerConfigError(
                "Agent App composer only saves the normal draft. Use the publish endpoint to create a version."
            )
        if payload.agent_soul is None:
            raise ValueError("agent_soul is required")
        backfill_cli_tool_ids(payload.agent_soul)
        _validate_composer_payload_for_strategy(payload)

        validate_agent_knowledge_spaces(
            session=session,
            tenant_id=tenant_id,
            account_id=account_id,
            agent_soul=payload.agent_soul,
        )

        agent = cls._get_agent_app_agent(session=session, tenant_id=tenant_id, app_id=app_id)
        if not agent:
            agent = Agent(
                tenant_id=tenant_id,
                name=payload.new_agent_name or "Untitled Agent",
                description="",
                agent_kind=AgentKind.DIFY_AGENT,
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                app_id=app_id,
                backing_app_id=app_id,
                status=AgentStatus.ACTIVE,
                created_by=account_id,
                updated_by=account_id,
            )
            session.add(agent)
            session.flush()
            initial_version = cls._create_config_version(
                session=session,
                tenant_id=tenant_id,
                agent_id=agent.id,
                account_id=account_id,
                agent_soul=AgentSoulConfig(),
                operation=AgentConfigRevisionOperation.CREATE_VERSION,
                version_note=None,
                home_snapshot_id=None,
            )
            agent.active_config_snapshot_id = initial_version.id
            agent.active_config_has_model = False
            agent.active_config_is_published = False
        return cls._save_agent_composer_for_agent(
            session=session,
            tenant_id=tenant_id,
            agent=agent,
            account_id=account_id,
            payload=payload,
        )

    @classmethod
    def _save_agent_composer_for_agent(
        cls, *, session: Session, tenant_id: str, agent: Agent, account_id: str, payload: ComposerSavePayload
    ) -> dict[str, Any]:
        if payload.agent_soul is None:
            raise ValueError("agent_soul is required")
        draft = cls._save_agent_draft(
            session=session,
            tenant_id=tenant_id,
            agent=agent,
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
            agent_soul=payload.agent_soul,
            account_id_for_audit=account_id,
        )
        agent.updated_by = account_id
        agent.active_config_is_published = agent_soul_matches_active_config(
            session=session,
            tenant_id=tenant_id,
            agent=agent,
            agent_soul=AgentSoulConfig.model_validate(draft.config_snapshot_dict),
            home_snapshot_id=draft.home_snapshot_id,
        )

        session.flush()
        state = cls.load_agent_composer(session=session, tenant_id=tenant_id, agent_id=agent.id)
        state["validation"] = cls.collect_validation_findings(payload=payload)
        return state

    @classmethod
    def collect_validation_findings(
        cls,
        *,
        payload: ComposerSavePayload,
    ) -> dict[str, Any]:
        """Collect non-blocking composer validation findings."""
        return composer_validation_findings(payload)

    @classmethod
    def validate_knowledge_datasets(
        cls, *, session: Session, tenant_id: str, agent_soul: AgentSoulConfig | None
    ) -> None:
        """Hard-validate tenant-scoped knowledge set datasets before saving.

        DTO validators own set shape, duplicate set ids/names, and duplicate
        dataset ids within one set. This service-level check owns database
        existence and tenant ownership so invalid or cross-tenant datasets fail
        before Agent Soul snapshots are persisted.
        """
        if agent_soul is None:
            return
        missing_ids = list_missing_tenant_knowledge_dataset_ids(
            session=session, tenant_id=tenant_id, agent_soul=agent_soul
        )
        if missing_ids:
            raise InvalidComposerConfigError(
                "knowledge_dataset_not_found: knowledge sets reference missing or out-of-scope datasets: "
                + ", ".join(missing_ids)
            )

    @classmethod
    def prepare_workflow_candidates(
        cls, *, session: Session, tenant_id: str, app_id: str, node_id: str, user_id: str
    ) -> ComposerCandidatesResponse:
        """Prepare all SQL-backed slash-menu candidates before workspace tool discovery."""
        from services.agent.composer_candidates import previous_node_output_candidates, soul_candidates

        try:
            workflow = cls._get_draft_workflow(session=session, tenant_id=tenant_id, app_id=app_id)
        except ValueError:
            workflow = None

        node_job: WorkflowNodeJobConfig | None = None
        agent_soul: AgentSoulConfig | None = None
        if workflow is not None:
            binding = cls._get_workflow_binding(
                session=session, tenant_id=tenant_id, workflow_id=workflow.id, node_id=node_id
            )
            if binding is not None:
                node_job = cls._parse_node_job(binding)
                agent_soul = cls._load_binding_soul(session=session, tenant_id=tenant_id, binding=binding)

        truncated = False
        previous_outputs: list[dict[str, Any]] = []
        if workflow is not None:
            previous_outputs, outputs_truncated = previous_node_output_candidates(
                graph=workflow.graph_dict,
                node_id=node_id,
                declared_outputs_loader=lambda nid: cls._binding_declared_outputs(
                    session=session, tenant_id=tenant_id, workflow_id=workflow.id, node_id=nid
                ),
                draft_variables_loader=lambda nid: cls._draft_node_variables(
                    session=session, app_id=app_id, node_id=nid, user_id=user_id
                ),
                system_variables_loader=lambda: cls._draft_system_variables(
                    session=session, app_id=app_id, user_id=user_id
                ),
            )
            truncated = truncated or outputs_truncated

        soul_lists, soul_truncated = soul_candidates(
            agent_soul=agent_soul,
            dataset_lookup=lambda ids: get_tenant_knowledge_dataset_rows(
                session=session, tenant_id=tenant_id, dataset_ids=ids
            ),
            workspace_tools_loader=list,
        )
        truncated = truncated or soul_truncated

        return ComposerCandidatesResponse(
            variant=ComposerVariant.WORKFLOW,
            allowed_node_job_candidates={
                "previous_node_outputs": previous_outputs,
                "declare_output_types": ["string", "number", "object", "array", "boolean", "file"],
                "human_contacts": [
                    contact.model_dump(exclude_none=True) for contact in (node_job.human_contacts if node_job else [])
                ],
            },
            allowed_soul_candidates=soul_lists,
            truncated=truncated,
        )

    @staticmethod
    def attach_workflow_candidate_tools(
        response: ComposerCandidatesResponse, tools: list[dict[str, object]]
    ) -> ComposerCandidatesResponse:
        """Append the provider candidates after applying the shared per-list cap."""
        from services.agent.composer_candidates import MAX_CANDIDATES_PER_LIST

        response.allowed_soul_candidates["dify_tools"] = tools[:MAX_CANDIDATES_PER_LIST]
        response.truncated = response.truncated or len(tools) > MAX_CANDIDATES_PER_LIST
        return response

    # ── candidates IO helpers (ENG-615) ──────────────────────────────────────

    @staticmethod
    def _parse_node_job(binding: WorkflowAgentNodeBinding) -> WorkflowNodeJobConfig | None:
        try:
            return WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict)
        except Exception:
            logger.warning("candidates: malformed node_job_config for binding %s", binding.id, exc_info=True)
            return None

    @classmethod
    def _load_binding_soul(
        cls, *, session: Session, tenant_id: str, binding: WorkflowAgentNodeBinding
    ) -> AgentSoulConfig | None:
        agent = cls._get_agent_if_present(session=session, tenant_id=tenant_id, agent_id=binding.agent_id)
        version = cls._get_version_if_present(
            session=session,
            tenant_id=tenant_id,
            agent_id=agent.id if agent else None,
            version_id=binding.current_snapshot_id,
        )
        return cls._parse_soul_snapshot(version)

    @staticmethod
    def _parse_soul_snapshot(version: AgentConfigSnapshot | None) -> AgentSoulConfig | None:
        if version is None:
            return None
        try:
            return AgentSoulConfig.model_validate(version.config_snapshot_dict)
        except Exception:
            logger.warning("candidates: malformed soul snapshot %s", version.id, exc_info=True)
            return None

    @classmethod
    def _binding_declared_outputs(
        cls, *, session: Session, tenant_id: str, workflow_id: str, node_id: str
    ) -> list[DeclaredOutputConfig] | None:
        binding = cls._get_workflow_binding(
            session=session, tenant_id=tenant_id, workflow_id=workflow_id, node_id=node_id
        )
        if binding is None:
            return None
        node_job = cls._parse_node_job(binding)
        if node_job is None:
            return None
        return list(_effective_declared_outputs(node_job.declared_outputs, node_job.output_routes))

    @staticmethod
    def _draft_node_variables(*, session: Any, app_id: str, node_id: str, user_id: str) -> list[tuple[str, str | None]]:
        from services.workflow_draft_variable_service import WorkflowDraftVariableService

        variables = WorkflowDraftVariableService(session=session).list_node_variables(app_id, node_id, user_id)
        return [(variable.name, variable.value_type.value) for variable in variables.variables]

    @staticmethod
    def _draft_system_variables(*, session: Any, app_id: str, user_id: str) -> list[tuple[str, str | None]]:
        from services.workflow_draft_variable_service import WorkflowDraftVariableService

        variables = WorkflowDraftVariableService(session=session).list_system_variables(app_id, user_id)
        return [(variable.name, variable.value_type.value) for variable in variables.variables]

    @classmethod
    def _save_node_job_only(
        cls,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
        account_id: str,
        binding: WorkflowAgentNodeBinding | None,
        payload: ComposerSavePayload,
    ) -> WorkflowAgentNodeBinding:
        if binding:
            if cls._is_start_from_scratch_request(binding=binding, payload=payload):
                return cls._switch_roster_binding_to_inline_agent(
                    session=session,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    workflow_id=workflow_id,
                    node_id=node_id,
                    account_id=account_id,
                    binding=binding,
                    payload=payload,
                )
            if payload.agent_soul is not None and binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT:
                agent = cls._require_agent(session=session, tenant_id=tenant_id, agent_id=binding.agent_id)
                session.flush([agent])
                agent = cls._require_agent(
                    session=session, tenant_id=tenant_id, agent_id=binding.agent_id, for_update=True
                )
                if agent.scope != AgentScope.WORKFLOW_ONLY:
                    raise ValueError("Inline workflow agent binding must point to a workflow-only agent")
                binding = cls._require_binding(
                    cls._get_workflow_binding(
                        session=session,
                        tenant_id=tenant_id,
                        workflow_id=workflow_id,
                        node_id=node_id,
                        for_update=True,
                    )
                )
                if binding.agent_id != agent.id or binding.binding_type != WorkflowAgentBindingType.INLINE_AGENT:
                    raise AgentVersionConflictError()
                current_snapshot = cls._require_version(
                    session=session,
                    tenant_id=tenant_id,
                    agent_id=binding.agent_id,
                    version_id=binding.current_snapshot_id,
                )
                normal_draft = find_agent_draft(
                    session=session,
                    tenant_id=tenant_id,
                    agent_id=agent.id,
                    draft_type=AgentConfigDraftType.DRAFT,
                    account_id=None,
                    for_update=True,
                )
                current_soul = AgentSoulConfig.model_validate(
                    normal_draft.config_snapshot_dict
                    if normal_draft is not None and normal_draft.base_snapshot_id == current_snapshot.id
                    else current_snapshot.config_snapshot_dict
                )
                agent_soul = preserve_omitted_config_files(payload.agent_soul, current_soul)
                version = cls._update_current_version(
                    session=session,
                    current_snapshot=current_snapshot,
                    account_id=account_id,
                    agent_soul=agent_soul,
                    operation=AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
                    version_note=payload.version_note,
                )
                agent.active_config_snapshot_id = version.id
                agent.active_config_has_model = agent_soul_has_model(agent_soul)
                agent.active_config_is_published = True
                agent.updated_by = account_id
                binding.current_snapshot_id = version.id
                if normal_draft is not None and rebase_workflow_only_normal_draft(
                    agent=agent,
                    draft=normal_draft,
                    snapshot=version,
                    updated_by=account_id,
                ):
                    session.flush()
            if payload.node_job is not None:
                binding.node_job_config = payload.node_job
            binding.updated_by = account_id
            return binding

        agent_soul = payload.agent_soul or AgentSoulConfig()
        agent = cls._create_workflow_only_agent(
            session=session,
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
            node_job_config=payload.node_job or WorkflowNodeJobConfig(),
            created_by=account_id,
            updated_by=account_id,
        )
        session.add(binding)
        session.flush()
        return binding

    @classmethod
    def _is_start_from_scratch_request(cls, *, binding: WorkflowAgentNodeBinding, payload: ComposerSavePayload) -> bool:
        return (
            binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
            and payload.binding is not None
            and payload.binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT.value
        )

    @classmethod
    def _switch_roster_binding_to_inline_agent(
        cls,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
        account_id: str,
        binding: WorkflowAgentNodeBinding,
        payload: ComposerSavePayload,
    ) -> WorkflowAgentNodeBinding:
        if payload.binding and (payload.binding.agent_id or payload.binding.current_snapshot_id):
            raise ValueError("Start from Scratch must not provide an existing inline agent binding.")

        agent_soul = payload.agent_soul or AgentSoulConfig()
        agent = cls._create_workflow_only_agent(
            session=session,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            node_id=node_id,
            account_id=account_id,
            agent_soul=agent_soul,
        )
        binding.binding_type = WorkflowAgentBindingType.INLINE_AGENT
        binding.agent_id = agent.id
        binding.current_snapshot_id = agent.active_config_snapshot_id
        binding.node_job_config = payload.node_job or binding.node_job_config
        binding.updated_by = account_id
        session.flush()
        return binding

    @classmethod
    def _save_to_current_version(
        cls,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        binding: WorkflowAgentNodeBinding | None,
        payload: ComposerSavePayload,
    ) -> WorkflowAgentNodeBinding:
        binding = cls._require_binding(binding)
        if payload.agent_soul is None:
            raise ValueError("agent_soul is required")
        current_snapshot = cls._require_version(
            session=session,
            tenant_id=tenant_id,
            agent_id=binding.agent_id,
            version_id=binding.current_snapshot_id,
        )
        version = cls._update_current_version(
            session=session,
            current_snapshot=current_snapshot,
            account_id=account_id,
            agent_soul=payload.agent_soul,
            operation=AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
            version_note=payload.version_note,
        )
        agent = cls._require_agent(session=session, tenant_id=tenant_id, agent_id=binding.agent_id)
        agent.active_config_snapshot_id = version.id
        agent.active_config_has_model = agent_soul_has_model(payload.agent_soul)
        agent.active_config_is_published = True
        agent.updated_by = account_id
        if agent.scope == AgentScope.ROSTER and agent.app_id:
            sync_agent_app_knowledge_bindings(
                session=session,
                tenant_id=tenant_id,
                account_id=account_id,
                agent=agent,
                agent_soul=payload.agent_soul,
            )
        SkillManagementService(session=session).publish_agent_bindings(
            tenant_id=tenant_id,
            agent_id=agent.id,
            snapshot_id=version.id,
            user_id=account_id,
        )
        binding.current_snapshot_id = version.id
        if payload.node_job is not None:
            binding.node_job_config = payload.node_job
        binding.updated_by = account_id
        return binding

    @classmethod
    def _save_as_new_version(
        cls,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        binding: WorkflowAgentNodeBinding | None,
        payload: ComposerSavePayload,
    ) -> WorkflowAgentNodeBinding:
        binding = cls._require_binding(binding)
        if not binding.agent_id or payload.agent_soul is None:
            raise ValueError("agent_id and agent_soul are required")
        current_snapshot = cls._require_version(
            session=session,
            tenant_id=tenant_id,
            agent_id=binding.agent_id,
            version_id=binding.current_snapshot_id,
        )
        version = cls._create_config_version(
            session=session,
            tenant_id=tenant_id,
            agent_id=binding.agent_id,
            account_id=account_id,
            agent_soul=payload.agent_soul,
            operation=AgentConfigRevisionOperation.SAVE_NEW_VERSION,
            version_note=payload.version_note,
            home_snapshot_id=current_snapshot.home_snapshot_id,
        )
        agent = cls._require_agent(session=session, tenant_id=tenant_id, agent_id=binding.agent_id)
        agent.active_config_snapshot_id = version.id
        agent.active_config_has_model = agent_soul_has_model(payload.agent_soul)
        agent.active_config_is_published = True
        agent.updated_by = account_id
        if agent.scope == AgentScope.ROSTER and agent.app_id:
            sync_agent_app_knowledge_bindings(
                session=session,
                tenant_id=tenant_id,
                account_id=account_id,
                agent=agent,
                agent_soul=payload.agent_soul,
            )
        SkillManagementService(session=session).publish_agent_bindings(
            tenant_id=tenant_id,
            agent_id=agent.id,
            snapshot_id=version.id,
            user_id=account_id,
        )
        binding.current_snapshot_id = version.id
        binding.updated_by = account_id
        if payload.node_job is not None:
            binding.node_job_config = payload.node_job
        return binding

    @classmethod
    def _save_as_new_agent(
        cls,
        *,
        session: Session,
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
            session=session,
            tenant_id=tenant_id,
            account_id=account_id,
            name=agent_name,
            description=payload.description or "",
            role=payload.role or "",
            icon_type=payload.icon_type,
            icon=payload.icon,
            icon_background=payload.icon_background,
            agent_soul=payload.agent_soul,
            operation=AgentConfigRevisionOperation.SAVE_NEW_AGENT,
            version_note=payload.version_note,
        )
        source_agent_id = binding.agent_id if binding else None
        source_snapshot_id = binding.current_snapshot_id if binding else None
        if source_agent_id and source_snapshot_id and agent.active_config_snapshot_id:
            SkillManagementService(session=session).copy_agent_bindings(
                tenant_id=tenant_id,
                source_agent_id=source_agent_id,
                source_snapshot_id=source_snapshot_id,
                target_agent_id=agent.id,
                target_snapshot_id=agent.active_config_snapshot_id,
                user_id=account_id,
            )
        if not binding:
            binding = WorkflowAgentNodeBinding(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                workflow_version=_DRAFT_WORKFLOW_VERSION,
                node_id=node_id,
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                node_job_config=WorkflowNodeJobConfig(),
                created_by=account_id,
            )
            session.add(binding)
        binding.binding_type = WorkflowAgentBindingType.ROSTER_AGENT
        binding.agent_id = agent.id
        binding.current_snapshot_id = agent.active_config_snapshot_id
        if payload.node_job is not None:
            binding.node_job_config = payload.node_job
        binding.updated_by = account_id
        session.flush()
        return binding

    @classmethod
    def _save_to_roster(
        cls,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        binding: WorkflowAgentNodeBinding | None,
        payload: ComposerSavePayload,
    ) -> WorkflowAgentNodeBinding:
        binding = cls._require_binding(binding)
        source_agent = cls._require_agent(session=session, tenant_id=tenant_id, agent_id=binding.agent_id)
        source_version = cls._require_version(
            session=session,
            tenant_id=tenant_id,
            agent_id=source_agent.id,
            version_id=binding.current_snapshot_id,
        )
        agent_soul = payload.agent_soul or AgentSoulConfig.model_validate(source_version.config_snapshot_dict)
        agent_name = payload.new_agent_name or source_agent.name
        roster_agent = cls._create_roster_agent_for_composer(
            session=session,
            tenant_id=tenant_id,
            account_id=account_id,
            name=agent_name,
            description=payload.description if payload.description is not None else source_agent.description,
            role=payload.role if payload.role is not None else source_agent.role,
            icon_type=payload.icon_type if payload.icon_type is not None else source_agent.icon_type,
            icon=payload.icon if payload.icon is not None else source_agent.icon,
            icon_background=payload.icon_background
            if payload.icon_background is not None
            else source_agent.icon_background,
            agent_soul=agent_soul,
            operation=AgentConfigRevisionOperation.SAVE_TO_ROSTER,
            version_note=payload.version_note,
        )
        if source_agent.active_config_snapshot_id and roster_agent.active_config_snapshot_id:
            SkillManagementService(session=session).copy_agent_bindings(
                tenant_id=tenant_id,
                source_agent_id=source_agent.id,
                source_snapshot_id=source_version.id,
                target_agent_id=roster_agent.id,
                target_snapshot_id=roster_agent.active_config_snapshot_id,
                user_id=account_id,
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
        session: Session,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
        account_id: str,
        agent_soul: AgentSoulConfig,
        name: str | None = None,
        description: str = "",
        role: str = "",
        icon_type: Any | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> Agent:
        backing_app = AgentRosterService(session).create_hidden_backing_app_for_workflow_agent(
            tenant_id=tenant_id,
            account_id=account_id,
            name=name or f"Workflow Agent {node_id}",
            description=description,
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
        )
        agent = Agent(
            tenant_id=tenant_id,
            name=name or f"Workflow Agent {node_id}",
            description=description,
            role=role,
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            app_id=app_id,
            backing_app_id=backing_app.id,
            workflow_id=workflow_id,
            workflow_node_id=node_id,
            status=AgentStatus.ACTIVE,
            created_by=account_id,
            updated_by=account_id,
        )
        session.add(agent)
        session.flush()
        version = cls._create_config_version(
            session=session,
            tenant_id=tenant_id,
            agent_id=agent.id,
            account_id=account_id,
            agent_soul=agent_soul,
            operation=AgentConfigRevisionOperation.CREATE_VERSION,
            version_note=None,
            home_snapshot_id=None,
        )
        agent.active_config_snapshot_id = version.id
        agent.active_config_has_model = agent_soul_has_model(agent_soul)
        agent.active_config_is_published = True
        return agent

    @classmethod
    def _create_roster_agent_for_composer(
        cls,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        name: str,
        agent_soul: AgentSoulConfig,
        operation: AgentConfigRevisionOperation,
        version_note: str | None,
        description: str = "",
        role: str = "",
        icon_type: AgentIconType | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> Agent:
        account = cls._require_account(session=session, account_id=account_id)
        try:
            app = AppService().create_app(
                tenant_id,
                CreateAppParams(
                    name=name,
                    description=description,
                    mode="agent",
                    agent_role=role,
                    icon_type=icon_type.value if isinstance(icon_type, AgentIconType) else icon_type,
                    icon=icon,
                    icon_background=icon_background,
                ),
                account,
                session=session,
            )
        except IntegrityError as exc:
            raise AgentNameConflictError() from exc

        agent = AgentRosterService(session).get_app_backing_agent(tenant_id=tenant_id, app_id=app.id)
        if agent is None:
            raise AgentNotFoundError()

        current_snapshot = cls._require_version(
            session=session,
            tenant_id=tenant_id,
            agent_id=agent.id,
            version_id=agent.active_config_snapshot_id,
        )
        version = cls._update_current_version(
            session=session,
            current_snapshot=current_snapshot,
            account_id=account_id,
            agent_soul=agent_soul,
            operation=operation,
            version_note=version_note,
        )
        agent.active_config_snapshot_id = version.id
        agent.active_config_has_model = agent_soul_has_model(agent_soul)
        agent.active_config_is_published = True
        agent.updated_by = account_id
        sync_agent_app_knowledge_bindings(
            session=session,
            tenant_id=tenant_id,
            account_id=account_id,
            agent=agent,
            agent_soul=agent_soul,
        )
        return agent

    _create_config_version = staticmethod(create_composer_snapshot)

    @classmethod
    def _update_current_version(
        cls,
        *,
        session: Session,
        current_snapshot: AgentConfigSnapshot,
        account_id: str,
        agent_soul: AgentSoulConfig,
        operation: AgentConfigRevisionOperation,
        version_note: str | None,
    ) -> AgentConfigSnapshot:
        return cls._create_config_version(
            session=session,
            tenant_id=current_snapshot.tenant_id,
            agent_id=current_snapshot.agent_id,
            account_id=account_id,
            agent_soul=agent_soul,
            operation=operation,
            version_note=version_note,
            previous_snapshot_id=current_snapshot.id,
            home_snapshot_id=current_snapshot.home_snapshot_id,
        )

    _next_revision = staticmethod(next_composer_revision)

    @classmethod
    def _get_agent_app_agent(cls, *, session: Session, tenant_id: str, app_id: str) -> Agent | None:
        return session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == tenant_id,
                Agent.app_id == app_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                Agent.status == AgentStatus.ACTIVE,
            )
            .order_by(Agent.created_at.desc())
            .limit(1)
        )

    @classmethod
    def _require_agent_app_agent(cls, *, session: Session, tenant_id: str, app_id: str) -> Agent:
        agent = cls._get_agent_app_agent(session=session, tenant_id=tenant_id, app_id=app_id)
        if agent is None:
            raise AgentNotFoundError()
        return agent

    @classmethod
    def get_or_create_normal_agent_draft(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent: Agent,
        created_by: str | None,
    ) -> AgentConfigDraft:
        """Resolve the normal Draft, rebasing only stale WORKFLOW_ONLY DRAFT rows whose account_id is None.

        Roster and DEBUG_BUILD Drafts are never rebased.
        """
        return cls._get_or_create_agent_draft(
            session=session,
            tenant_id=tenant_id,
            agent=agent,
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
            created_by=created_by,
        )

    @classmethod
    def _get_or_create_agent_draft(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent: Agent,
        draft_type: AgentConfigDraftType,
        account_id: str | None,
        created_by: str | None,
    ) -> AgentConfigDraft:
        """Resolve the draft in the legacy caller's transaction and preserve its error types."""
        try:
            return get_or_create_agent_draft(
                session=session,
                tenant_id=tenant_id,
                agent=agent,
                draft_type=draft_type,
                account_id=account_id,
                created_by=created_by,
            )
        except AgentBuildAgentNotFoundError as exc:
            raise AgentNotFoundError() from exc
        except AgentBuildBaseUnavailableError as exc:
            raise AgentVersionNotFoundError() from exc

    @classmethod
    def _save_agent_draft(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent: Agent,
        draft_type: AgentConfigDraftType,
        account_id: str | None,
        agent_soul: AgentSoulConfig,
        account_id_for_audit: str,
    ) -> AgentConfigDraft:
        """Stage a shared or personal draft update in the legacy caller's transaction."""
        try:
            return save_agent_draft(
                session=session,
                tenant_id=tenant_id,
                agent=agent,
                draft_type=draft_type,
                account_id=account_id,
                agent_soul=agent_soul,
                account_id_for_audit=account_id_for_audit,
            )
        except AgentBuildAgentNotFoundError as exc:
            raise AgentNotFoundError() from exc
        except AgentBuildBaseUnavailableError as exc:
            raise AgentVersionNotFoundError() from exc

    @classmethod
    def _serialize_draft(cls, draft: AgentConfigDraft | None) -> dict[str, Any] | None:
        """Return the shared draft metadata in the legacy response shape, or None if no draft was loaded."""
        return asdict(project_agent_draft_summary(draft)) if draft is not None else None

    @classmethod
    def _serialize_build_draft_state(cls, draft: AgentConfigDraft) -> dict[str, Any]:
        return {
            "variant": ComposerVariant.AGENT_APP.value,
            "draft": cls._serialize_draft(draft),
            "agent_soul": draft.config_snapshot_dict,
        }

    @classmethod
    def _get_draft_workflow(
        cls, *, session: Session, tenant_id: str, app_id: str, for_update: bool = False
    ) -> Workflow:
        """Load the owned draft, optionally serializing an admitted write.

        Preconditions: tenant and App identify the same admitted owner chain.
        Postconditions: reads return the draft or raise ValueError; writes lock
        and refresh it before policy and graph mutation, matching graph-save
        locking. The caller retains commit or rollback ownership.
        """
        stmt = (
            select(Workflow)
            .where(
                Workflow.tenant_id == tenant_id,
                Workflow.app_id == app_id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
            .limit(1)
        )
        if for_update:
            stmt = stmt.with_for_update().execution_options(populate_existing=True, autoflush=False)
        workflow = session.scalar(stmt)
        if not workflow:
            raise ValueError("Draft workflow not found")
        return workflow

    @staticmethod
    def _sync_workflow_session_policy_to_graph(*, workflow: Workflow, binding: WorkflowAgentNodeBinding) -> None:
        """Write a saved node's session policy into the same locked draft graph.

        Preconditions: workflow and binding share the admitted owner and the
        owning draft is locked. Postconditions: matching node session fields
        equal the trusted job; other graph data and session resources remain
        unchanged. Missing graph nodes do not create new nodes.
        """
        node_job = WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict)
        graph = workflow.graph_dict
        for node in graph.get("nodes", []):
            if isinstance(node, dict) and node.get("id") == binding.node_id and isinstance(node.get("data"), dict):
                apply_workflow_agent_session_policy_to_node_data(node_data=node["data"], node_job=node_job)
        workflow.graph = json.dumps(graph)

    @classmethod
    def _get_workflow_binding(
        cls, *, session: Session, tenant_id: str, workflow_id: str, node_id: str, for_update: bool = False
    ) -> WorkflowAgentNodeBinding | None:
        # Composer always operates against the draft workflow row, so this lookup
        # is scoped to ``workflow_version="draft"``. Published bindings are
        # materialized by WorkflowAgentPublishService.copy_agent_node_bindings_to_published
        # and are not edited through the Composer.
        stmt = select(WorkflowAgentNodeBinding).where(
            WorkflowAgentNodeBinding.tenant_id == tenant_id,
            WorkflowAgentNodeBinding.workflow_id == workflow_id,
            WorkflowAgentNodeBinding.workflow_version == _DRAFT_WORKFLOW_VERSION,
            WorkflowAgentNodeBinding.node_id == node_id,
        )
        if for_update:
            stmt = stmt.with_for_update().execution_options(populate_existing=True, autoflush=False)
        return session.scalar(stmt.limit(1))

    @classmethod
    def _require_binding(cls, binding: WorkflowAgentNodeBinding | None) -> WorkflowAgentNodeBinding:
        if not binding:
            raise ValueError("Workflow agent binding not found")
        return binding

    @classmethod
    def _require_agent(
        cls, *, session: Session, tenant_id: str, agent_id: str | None, for_update: bool = False
    ) -> Agent:
        if not agent_id:
            raise AgentNotFoundError()
        stmt = select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id)
        if for_update:
            stmt = stmt.with_for_update().execution_options(populate_existing=True, autoflush=False)
        agent = session.scalar(stmt.limit(1))
        if not agent:
            raise AgentNotFoundError()
        return agent

    @classmethod
    def _require_account(cls, *, session: Session, account_id: str) -> Account:
        account = session.get(Account, account_id)
        if not account:
            raise ValueError("Account not found")
        return account

    @classmethod
    def _get_agent_if_present(cls, *, session: Session, tenant_id: str, agent_id: str | None) -> Agent | None:
        if not agent_id:
            return None
        return session.scalar(select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id).limit(1))

    @classmethod
    def _require_version(
        cls, *, session: Session, tenant_id: str, agent_id: str | None, version_id: str | None
    ) -> AgentConfigSnapshot:
        if not agent_id or not version_id:
            raise AgentVersionNotFoundError()
        version = session.scalar(
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
        cls, *, session: Session, tenant_id: str, agent_id: str | None, version_id: str | None
    ) -> AgentConfigSnapshot | None:
        if not agent_id or not version_id:
            return None
        return session.scalar(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == version_id,
            )
            .limit(1)
        )

    @staticmethod
    def _serialize_effective_outputs(node_job: WorkflowNodeJobConfig) -> list[dict[str, Any]]:
        """Serialize custom declarations and the system outputs enabled for this job."""
        return [
            output.model_dump(mode="json")
            for output in _effective_declared_outputs(node_job.declared_outputs, node_job.output_routes)
        ]

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
            # ``text`` is derived for the editor and is not stored in node_job.
            "effective_declared_outputs": cls._serialize_effective_outputs(WorkflowNodeJobConfig()),
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
        session: Session,
        binding: WorkflowAgentNodeBinding,
        agent: Agent | None,
        version: AgentConfigSnapshot | None,
        account_id: str | None = None,
        include_draft_files: bool,
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
        debug_conversation_id = cls._workflow_inline_debug_conversation_id(
            session=session,
            tenant_id=binding.tenant_id,
            binding=binding,
            agent=agent,
            account_id=account_id,
        )
        debug_conversation_message_count = (
            AgentRosterService(session).count_agent_app_debug_conversation_messages(
                conversation_id=debug_conversation_id
            )
            if debug_conversation_id
            else 0
        )
        return {
            "variant": ComposerVariant.WORKFLOW.value,
            "agent": cls._serialize_agent(agent) if agent else None,
            "active_config_snapshot": cls._serialize_version(version),
            "binding": {
                "id": binding.id,
                "binding_type": binding.binding_type.value,
                "agent_id": binding.agent_id,
                "current_snapshot_id": version.id if version else binding.current_snapshot_id,
                "workflow_id": binding.workflow_id,
                "node_id": binding.node_id,
            },
            "soul_lock": {
                "locked": locked,
                "can_unlock": locked,
                "reason": "roster_agent_shared_version" if locked else "workflow_only_agent",
            },
            "agent_soul": cls._workflow_agent_soul_state(
                session=session, agent=agent, version=version, include_draft_files=include_draft_files
            ),
            "node_job": binding.node_job_config_dict,
            "effective_declared_outputs": cls._serialize_effective_outputs(
                WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict)
            ),
            "save_options": save_options,
            "impact_summary": read_workflow_agent_impact(
                session, tenant_id=binding.tenant_id, current_snapshot_id=version.id
            )
            if version
            else None,
            "app_id": binding.app_id,
            "backing_app_id": agent.backing_app_id if agent else None,
            "hidden_app_backed": bool(agent and agent.scope == AgentScope.WORKFLOW_ONLY and agent.backing_app_id),
            "chat_endpoint": f"/console/api/agent/{agent.id}/chat-messages" if agent else None,
            "debug_conversation_id": debug_conversation_id,
            "debug_conversation_has_messages": debug_conversation_message_count > 0,
            "debug_conversation_message_count": debug_conversation_message_count,
            "workflow_id": binding.workflow_id,
            "node_id": binding.node_id,
        }

    @staticmethod
    def _workflow_inline_debug_conversation_id(
        *,
        session: Session,
        tenant_id: str,
        binding: WorkflowAgentNodeBinding,
        agent: Agent | None,
        account_id: str | None,
    ) -> str | None:
        """Return the editor's inline debug conversation within the caller-owned transaction."""
        if (
            not account_id
            or not agent
            or binding.binding_type != WorkflowAgentBindingType.INLINE_AGENT
            or agent.scope != AgentScope.WORKFLOW_ONLY
        ):
            return None

        from services.agent.roster_service import AgentRosterService

        return AgentRosterService(session).get_or_create_build_conversation(
            tenant_id=tenant_id,
            agent_id=agent.id,
            account_id=account_id,
            commit=False,
        )

    @classmethod
    def _serialize_agent(cls, agent: Agent) -> dict[str, Any]:
        """Render detached Composer identity for legacy callers."""
        return asdict(composer_identity(agent))

    @classmethod
    def _serialize_version(cls, version: AgentConfigSnapshot | None) -> dict[str, Any] | None:
        """Render detached Composer snapshot metadata for legacy callers."""
        snapshot = composer_snapshot(version)
        return asdict(snapshot) if snapshot is not None else None

    @classmethod
    def _workflow_agent_soul_state(
        cls,
        *,
        session: Session,
        agent: Agent | None,
        version: AgentConfigSnapshot | None,
        include_draft_files: bool,
    ) -> dict[str, Any]:
        """Return the node's Agent Soul with the file list its next node save would persist.

        Inline file uploads and deletes write the workflow-only Agent's normal Draft. While that Draft is
        based on the bound snapshot, its ``config_files`` are the current list for the node. An explicitly
        requested snapshot (``include_draft_files`` false) keeps its own files.
        """
        if version is None:
            return AgentSoulConfig().model_dump(mode="json")
        agent_soul = cls._workflow_agent_soul_config(version.config_snapshot_dict)
        if not include_draft_files or agent is None or agent.scope != AgentScope.WORKFLOW_ONLY:
            return agent_soul
        normal_draft = find_agent_draft(
            session=session,
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
        )
        if normal_draft is not None and normal_draft.base_snapshot_id == version.id:
            agent_soul["config_files"] = normal_draft.config_snapshot_dict.get("config_files", [])
        return agent_soul

    @staticmethod
    def _workflow_agent_soul_config(config_snapshot: dict[str, Any]) -> dict[str, Any]:
        agent_soul = dict(config_snapshot)
        agent_soul["app_features"] = {}
        agent_soul["app_variables"] = []
        return agent_soul
