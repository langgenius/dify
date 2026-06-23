import logging
import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from extensions.ext_database import db
from libs.helper import to_timestamp
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentDriveFile,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import (
    AgentFileRefConfig,
    DeclaredOutputConfig,
)
from models.agent_config_entities import (
    effective_declared_outputs as _effective_declared_outputs,
)
from models.workflow import Workflow
from services.agent.agent_soul_state import agent_soul_has_model
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import (
    AgentNameConflictError,
    AgentNotFoundError,
    AgentVersionNotFoundError,
    InvalidComposerConfigError,
)
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

logger = logging.getLogger(__name__)


def _backfill_cli_tool_ids(agent_soul: AgentSoulConfig | None) -> None:
    """Mint stable ids for CLI tools that predate the id field (ENG-616).

    `[§cli_tool:<id>§]` mentions resolve by id so renames never break references;
    the frontend mints ids for new entries, and save backfills legacy ones. Runs
    before validation so duplicate-id checks see the final state. Save-only — the
    validate endpoint must not mutate the payload.
    """
    if agent_soul is None:
        return
    seen_ids = {cli_tool.id for cli_tool in agent_soul.tools.cli_tools if cli_tool.id}
    for cli_tool in agent_soul.tools.cli_tools:
        if cli_tool.id:
            continue
        minted = uuid.uuid4().hex[:12]
        while minted in seen_ids:
            minted = uuid.uuid4().hex[:12]
        cli_tool.id = minted
        seen_ids.add(minted)


class AgentComposerService:
    @classmethod
    def load_workflow_composer(cls, *, tenant_id: str, app_id: str, node_id: str) -> dict[str, Any]:
        workflow = cls._get_draft_workflow(tenant_id=tenant_id, app_id=app_id)
        binding = cls._get_workflow_binding(tenant_id=tenant_id, workflow_id=workflow.id, node_id=node_id)
        if not binding:
            return cls._empty_workflow_state(app_id=app_id, workflow_id=workflow.id, node_id=node_id)

        agent = cls._get_agent_if_present(tenant_id=tenant_id, agent_id=binding.agent_id)
        version_id = (
            agent.active_config_snapshot_id
            if agent and binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
            else binding.current_snapshot_id
        )
        version = cls._get_version_if_present(
            tenant_id=tenant_id,
            agent_id=agent.id if agent else None,
            version_id=version_id,
        )
        return cls._serialize_workflow_state(binding=binding, agent=agent, version=version)

    @classmethod
    def save_workflow_composer(
        cls, *, tenant_id: str, app_id: str, node_id: str, account_id: str, payload: ComposerSavePayload
    ) -> dict[str, Any]:
        if payload.variant != ComposerVariant.WORKFLOW:
            raise ValueError("Workflow composer endpoint only accepts workflow variant")

        _backfill_cli_tool_ids(payload.agent_soul)
        ComposerConfigValidator.validate_save_payload(payload)
        workflow = cls._get_draft_workflow(tenant_id=tenant_id, app_id=app_id)
        binding = cls._get_workflow_binding(tenant_id=tenant_id, workflow_id=workflow.id, node_id=node_id)

        # ENG-623 §4.4: drive-backed refs must point at real drive rows before the
        # soul is persisted. Only strategies that write the soul onto an *existing*
        # agent are checked — new-agent strategies create a fresh (empty) drive, so
        # any carried drive key would be flagged on the next save instead.
        if (
            payload.agent_soul is not None
            and binding is not None
            and binding.agent_id
            and payload.save_strategy
            in (
                ComposerSaveStrategy.NODE_JOB_ONLY,
                ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION,
                ComposerSaveStrategy.SAVE_AS_NEW_VERSION,
            )
            and (
                payload.save_strategy != ComposerSaveStrategy.NODE_JOB_ONLY
                or binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT
            )
        ):
            cls._require_drive_refs_resolved(
                tenant_id=tenant_id, agent_id=binding.agent_id, agent_soul=payload.agent_soul
            )

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
        version_id = (
            agent.active_config_snapshot_id
            if agent and binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
            else binding.current_snapshot_id
        )
        version = cls._get_version_if_present(
            tenant_id=tenant_id,
            agent_id=agent.id if agent else None,
            version_id=version_id,
        )
        state = cls._serialize_workflow_state(binding=binding, agent=agent, version=version)
        state["validation"] = cls.collect_validation_findings(tenant_id=tenant_id, payload=payload)
        return state

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
        _backfill_cli_tool_ids(payload.agent_soul)
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

        # ENG-623 §4.4: dangling drive-backed refs are rejected before persisting.
        cls._require_drive_refs_resolved(tenant_id=tenant_id, agent_id=agent.id, agent_soul=payload.agent_soul)

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
            agent.active_config_has_model = agent_soul_has_model(payload.agent_soul)
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
            agent.active_config_has_model = agent_soul_has_model(payload.agent_soul)
            agent.updated_by = account_id

        db.session.commit()
        state = cls.load_agent_app_composer(tenant_id=tenant_id, app_id=app_id)
        state["validation"] = cls.collect_validation_findings(tenant_id=tenant_id, payload=payload)
        return state

    @classmethod
    def collect_validation_findings(
        cls,
        *,
        tenant_id: str,
        payload: ComposerSavePayload,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        """ENG-617 soft findings, with DB-backed dataset existence for placeholders.

        With ``agent_id`` the drive-backed skill/file refs are also checked against
        the agent drive (ENG-623 §4.4) and dangling ones surface as warnings.
        """
        from services.agent.prompt_mentions import MentionKind, parse_prompt_mentions

        mentioned_ids: set[str] = set()
        if payload.agent_soul is not None:
            mentioned_ids |= {
                mention.ref_id
                for mention in parse_prompt_mentions(payload.agent_soul.prompt.system_prompt)
                if mention.kind == MentionKind.KNOWLEDGE
            }
        existing_dataset_ids: set[str] | None = None
        if mentioned_ids:
            existing_dataset_ids = set(cls._dataset_rows(tenant_id=tenant_id, dataset_ids=sorted(mentioned_ids)))
        findings = ComposerConfigValidator.collect_soft_findings(payload, existing_dataset_ids=existing_dataset_ids)
        if agent_id and payload.agent_soul is not None:
            findings["warnings"].extend(
                cls._drive_ref_findings(tenant_id=tenant_id, agent_id=agent_id, agent_soul=payload.agent_soul)
            )
        return findings

    @classmethod
    def remove_drive_refs(
        cls,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        skill_slug: str | None = None,
        file_key: str | None = None,
        app_id: str | None = None,
        node_id: str | None = None,
    ) -> str | None:
        """Drop the soul refs backed by a drive skill/file before the drive rows go.

        Soul-first ordering (ENG-625 D5): a mid-failure leaves harmless orphan KV
        rows that an idempotent DELETE retry cleans, instead of a soul ref that
        keeps failing dangling-ref validation. Returns the new config version id,
        or ``None`` when the soul held no matching ref (idempotent re-delete).
        """
        if (skill_slug is None) == (file_key is None):
            raise ValueError("remove_drive_refs requires exactly one of skill_slug or file_key")
        agent = db.session.scalar(select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id).limit(1))
        if agent is None or not agent.active_config_snapshot_id:
            return None
        current_snapshot = cls._require_version(
            tenant_id=tenant_id, agent_id=agent.id, version_id=agent.active_config_snapshot_id
        )
        agent_soul = AgentSoulConfig.model_validate(current_snapshot.config_snapshot_dict)

        removed_display: str | None = None
        if skill_slug is not None:
            kept_skills = []
            for skill in agent_soul.skills_files.skills:
                slug = (skill.skill_md_key or "").split("/", 1)[0] or (skill.path or "").strip("/")
                if slug == skill_slug:
                    removed_display = skill.name or skill.id or skill_slug
                    continue
                kept_skills.append(skill)
            if removed_display is None:
                return None
            agent_soul.skills_files.skills = kept_skills
            note = f"Removed skill '{removed_display}' from the drive."
        else:
            kept_files = []
            for file in agent_soul.skills_files.files:
                if file.drive_key == file_key:
                    removed_display = file.name or file.drive_key
                    continue
                kept_files.append(file)
            if removed_display is None:
                return None
            agent_soul.skills_files.files = kept_files
            note = f"Removed file '{removed_display}' from the drive."

        version = cls._update_current_version(
            current_snapshot=current_snapshot,
            account_id=account_id,
            agent_soul=agent_soul,
            operation=AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
            version_note=note,
        )
        agent.active_config_snapshot_id = version.id
        agent.updated_by = account_id
        cls._sync_draft_binding_snapshot(
            tenant_id=tenant_id,
            app_id=app_id,
            node_id=node_id,
            agent_id=agent_id,
            snapshot_id=version.id,
            account_id=account_id,
        )
        db.session.commit()
        return version.id

    @classmethod
    def add_drive_file_ref(
        cls,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        file_ref: AgentFileRefConfig,
        app_id: str | None = None,
        node_id: str | None = None,
    ) -> str | None:
        """Add or replace one drive-backed file ref in the active Agent Soul.

        ``POST /agent/files`` is an ADD FILE user action, not just a low-level
        drive commit. The committed file must be present in ``skills_files.files``
        because runtime ``dify.drive`` is built from the active Agent Soul.
        """
        if not file_ref.drive_key:
            raise ValueError("file_ref.drive_key is required")
        agent = db.session.scalar(select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id).limit(1))
        if agent is None or not agent.active_config_snapshot_id:
            return None
        current_snapshot = cls._require_version(
            tenant_id=tenant_id, agent_id=agent.id, version_id=agent.active_config_snapshot_id
        )
        agent_soul = AgentSoulConfig.model_validate(current_snapshot.config_snapshot_dict)
        kept_files = [item for item in agent_soul.skills_files.files if item.drive_key != file_ref.drive_key]
        kept_files.append(file_ref)
        agent_soul.skills_files.files = kept_files

        display = file_ref.name or file_ref.drive_key
        version = cls._update_current_version(
            current_snapshot=current_snapshot,
            account_id=account_id,
            agent_soul=agent_soul,
            operation=AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
            version_note=f"Added file '{display}' to the drive.",
        )
        agent.active_config_snapshot_id = version.id
        agent.active_config_has_model = agent_soul_has_model(agent_soul)
        agent.updated_by = account_id
        cls._sync_draft_binding_snapshot(
            tenant_id=tenant_id,
            app_id=app_id,
            node_id=node_id,
            agent_id=agent_id,
            snapshot_id=version.id,
            account_id=account_id,
        )
        db.session.commit()
        return version.id

    @classmethod
    def resolve_bound_agent_id(cls, *, tenant_id: str, app_id: str) -> str | None:
        """The Agent App's bound roster agent id, if any (validate-endpoint context)."""
        return db.session.scalar(
            select(Agent.id)
            .where(
                Agent.tenant_id == tenant_id,
                Agent.app_id == app_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.status == AgentStatus.ACTIVE,
            )
            .order_by(Agent.created_at.desc())
            .limit(1)
        )

    @classmethod
    def resolve_workflow_node_agent_id(cls, *, tenant_id: str, app_id: str, node_id: str) -> str | None:
        """The draft workflow node binding's agent id, if any (validate-endpoint context)."""
        try:
            workflow = cls._get_draft_workflow(tenant_id=tenant_id, app_id=app_id)
        except ValueError:
            return None
        binding = cls._get_workflow_binding(tenant_id=tenant_id, workflow_id=workflow.id, node_id=node_id)
        return binding.agent_id if binding else None

    @classmethod
    def _sync_draft_binding_snapshot(
        cls,
        *,
        tenant_id: str,
        app_id: str | None,
        node_id: str | None,
        agent_id: str,
        snapshot_id: str,
        account_id: str,
    ) -> None:
        """Keep workflow node bindings on the new active snapshot after direct drive edits."""
        if not app_id or not node_id:
            return
        try:
            workflow = cls._get_draft_workflow(tenant_id=tenant_id, app_id=app_id)
        except ValueError:
            return
        binding = cls._get_workflow_binding(tenant_id=tenant_id, workflow_id=workflow.id, node_id=node_id)
        if binding is None or binding.agent_id != agent_id:
            return
        binding.current_snapshot_id = snapshot_id
        binding.updated_by = account_id

    @classmethod
    def _drive_ref_findings(
        cls,
        *,
        tenant_id: str,
        agent_id: str,
        agent_soul: AgentSoulConfig,
    ) -> list[dict[str, str | None]]:
        """Drive-backed refs whose keys have no row in the agent drive (ENG-623 §4.4).

        Each finding message starts with its stable code token
        (``skill_ref_dangling`` / ``file_ref_dangling``) in the ENG-616/617 style.
        """
        wanted_keys: dict[str, tuple[str, str]] = {}
        for skill in agent_soul.skills_files.skills:
            if skill.skill_md_key:
                wanted_keys[skill.skill_md_key] = ("skill_ref_dangling", skill.name or skill.id or "unknown")
        for file in agent_soul.skills_files.files:
            if file.drive_key:
                wanted_keys[file.drive_key] = ("file_ref_dangling", file.name or file.id or "unknown")
        if not wanted_keys:
            return []

        existing_keys = set(
            db.session.scalars(
                select(AgentDriveFile.key).where(
                    AgentDriveFile.tenant_id == tenant_id,
                    AgentDriveFile.agent_id == agent_id,
                    AgentDriveFile.key.in_(sorted(wanted_keys)),
                )
            )
        )
        findings: list[dict[str, str | None]] = []
        for key, (code, display) in wanted_keys.items():
            if key in existing_keys:
                continue
            kind = "skill" if code == "skill_ref_dangling" else "file"
            findings.append(
                {
                    "code": code,
                    "surface": "agent_soul",
                    "kind": kind,
                    "id": key,
                    "message": f"{code}: {kind} '{display}' has no drive entry for key '{key}'.",
                }
            )
        return findings

    @classmethod
    def _require_drive_refs_resolved(cls, *, tenant_id: str, agent_id: str, agent_soul: AgentSoulConfig) -> None:
        """Hard save-time guard: dangling drive-backed refs are rejected (400)."""
        findings = cls._drive_ref_findings(tenant_id=tenant_id, agent_id=agent_id, agent_soul=agent_soul)
        if findings:
            raise InvalidComposerConfigError("; ".join(str(finding["message"]) for finding in findings))

    @classmethod
    def get_workflow_candidates(cls, *, tenant_id: str, app_id: str, node_id: str, user_id: str) -> dict[str, Any]:
        """Slash-menu data source for the workflow Agent node composer (ENG-615)."""
        from services.agent.composer_candidates import previous_node_output_candidates, soul_candidates

        try:
            workflow = cls._get_draft_workflow(tenant_id=tenant_id, app_id=app_id)
        except ValueError:
            workflow = None

        node_job: WorkflowNodeJobConfig | None = None
        agent_soul: AgentSoulConfig | None = None
        if workflow is not None:
            binding = cls._get_workflow_binding(tenant_id=tenant_id, workflow_id=workflow.id, node_id=node_id)
            if binding is not None:
                node_job = cls._parse_node_job(binding)
                agent_soul = cls._load_binding_soul(tenant_id=tenant_id, binding=binding)

        truncated = False
        previous_outputs: list[dict[str, Any]] = []
        if workflow is not None:
            draft_variable_session = cls._draft_variable_session()
            try:
                previous_outputs, outputs_truncated = previous_node_output_candidates(
                    graph=workflow.graph_dict,
                    node_id=node_id,
                    declared_outputs_loader=lambda nid: cls._binding_declared_outputs(
                        tenant_id=tenant_id, workflow_id=workflow.id, node_id=nid
                    ),
                    draft_variables_loader=lambda nid: cls._draft_node_variables(
                        session=draft_variable_session, app_id=app_id, node_id=nid, user_id=user_id
                    ),
                    system_variables_loader=lambda: cls._draft_system_variables(
                        session=draft_variable_session, app_id=app_id, user_id=user_id
                    ),
                )
            finally:
                draft_variable_session.close()
            truncated = truncated or outputs_truncated

        soul_lists, soul_truncated = soul_candidates(
            agent_soul=agent_soul,
            dataset_lookup=lambda ids: cls._dataset_rows(tenant_id=tenant_id, dataset_ids=ids),
            workspace_tools_loader=lambda: cls._workspace_dify_tools(tenant_id=tenant_id, user_id=user_id),
        )
        truncated = truncated or soul_truncated

        response = ComposerCandidatesResponse(
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
        return response.model_dump(mode="json")

    @classmethod
    def get_agent_app_candidates(cls, *, tenant_id: str, app_id: str, user_id: str) -> dict[str, Any]:
        """Slash-menu data source for the Agent App (Console) composer (ENG-615)."""
        from services.agent.composer_candidates import soul_candidates

        agent_soul = cls._load_agent_app_soul(tenant_id=tenant_id, app_id=app_id)
        soul_lists, truncated = soul_candidates(
            agent_soul=agent_soul,
            dataset_lookup=lambda ids: cls._dataset_rows(tenant_id=tenant_id, dataset_ids=ids),
            workspace_tools_loader=lambda: cls._workspace_dify_tools(tenant_id=tenant_id, user_id=user_id),
        )
        response = ComposerCandidatesResponse(
            variant=ComposerVariant.AGENT_APP,
            allowed_node_job_candidates={},
            allowed_soul_candidates=soul_lists,
            truncated=truncated,
        )
        return response.model_dump(mode="json")

    # ── candidates IO helpers (ENG-615) ──────────────────────────────────────

    @staticmethod
    def _parse_node_job(binding: WorkflowAgentNodeBinding) -> WorkflowNodeJobConfig | None:
        try:
            return WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict)
        except Exception:
            logger.warning("candidates: malformed node_job_config for binding %s", binding.id, exc_info=True)
            return None

    @classmethod
    def _load_binding_soul(cls, *, tenant_id: str, binding: WorkflowAgentNodeBinding) -> AgentSoulConfig | None:
        agent = cls._get_agent_if_present(tenant_id=tenant_id, agent_id=binding.agent_id)
        version = cls._get_version_if_present(
            tenant_id=tenant_id,
            agent_id=agent.id if agent else None,
            version_id=binding.current_snapshot_id,
        )
        return cls._parse_soul_snapshot(version)

    @classmethod
    def _load_agent_app_soul(cls, *, tenant_id: str, app_id: str) -> AgentSoulConfig | None:
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
        if agent is None:
            return None
        version = cls._get_version_if_present(
            tenant_id=tenant_id, agent_id=agent.id, version_id=agent.active_config_snapshot_id
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
        cls, *, tenant_id: str, workflow_id: str, node_id: str
    ) -> list[DeclaredOutputConfig] | None:
        binding = cls._get_workflow_binding(tenant_id=tenant_id, workflow_id=workflow_id, node_id=node_id)
        if binding is None:
            return None
        node_job = cls._parse_node_job(binding)
        if node_job is None:
            return None
        return list(_effective_declared_outputs(node_job.declared_outputs))

    @staticmethod
    def _draft_variable_session():
        from sqlalchemy.orm import sessionmaker

        return sessionmaker(bind=db.engine, expire_on_commit=False)()

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

    @staticmethod
    def _dataset_rows(*, tenant_id: str, dataset_ids: list[str]) -> dict[str, Any]:
        """Tenant-scoped dataset lookup tolerating malformed ids.

        Mention ids come from user-editable prompt text; a non-UUID id can never
        match a dataset row, so it is simply absent from the result (-> missing/
        placeholder semantics) instead of breaking the UUID-typed query.
        """
        from uuid import UUID

        from services.dataset_service import DatasetService

        valid_ids: list[str] = []
        for dataset_id in dataset_ids:
            try:
                UUID(dataset_id)
            except (ValueError, TypeError):
                continue
            valid_ids.append(dataset_id)
        if not valid_ids:
            return {}
        rows, _ = DatasetService.get_datasets_by_ids(valid_ids, tenant_id)
        return {str(row.id): row for row in rows}

    @staticmethod
    def _workspace_dify_tools(*, tenant_id: str, user_id: str) -> list[dict[str, Any]]:
        """Workspace Dify Plugin tools, same source as the tool selector.

        A plugin-daemon outage must degrade the slash menu to an empty tools
        tab, not break the whole candidates endpoint.
        """
        from services.tools.builtin_tools_manage_service import BuiltinToolManageService

        try:
            providers = BuiltinToolManageService.list_builtin_tools(user_id, tenant_id)
        except Exception:
            logger.warning("candidates: failed to list workspace tools for tenant %s", tenant_id, exc_info=True)
            return []
        tools: list[dict[str, Any]] = []
        for provider in providers:
            provider_tools = provider.tools or []
            # Provider-level entry first: selecting it means "all tools of this
            # provider" (a provider hosts many tools, like an MCP server). Its
            # ``id`` is also the mention id (``[§tool:<provider>/*§]``); the
            # write-back is one ``tools.dify_tools`` entry with ``tool_name``
            # omitted.
            tools.append(
                {
                    "id": f"{provider.name}/*",
                    "granularity": "provider",
                    "name": provider.label.en_US if provider.label else provider.name,
                    "description": provider.description.en_US if provider.description else None,
                    "provider": provider.name,
                    "plugin_id": provider.plugin_id or None,
                    "tools_count": len(provider_tools),
                }
            )
            for tool in provider_tools:
                tools.append(
                    {
                        "id": f"{provider.name}/{tool.name}",
                        "granularity": "tool",
                        "name": tool.name,
                        "description": tool.label.en_US if tool.label else tool.name,
                        "provider": provider.name,
                        "plugin_id": provider.plugin_id or None,
                    }
                )
        return tools

    @classmethod
    def calculate_impact(cls, *, tenant_id: str, current_snapshot_id: str) -> dict[str, Any]:
        snapshot = db.session.scalar(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.id == current_snapshot_id,
            )
            .limit(1)
        )
        agent_id = snapshot.agent_id if snapshot else None
        predicates = [WorkflowAgentNodeBinding.current_snapshot_id == current_snapshot_id]
        if agent_id:
            predicates.append(
                (WorkflowAgentNodeBinding.agent_id == agent_id)
                & (WorkflowAgentNodeBinding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT)
            )
        bindings = list(
            db.session.scalars(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == tenant_id,
                    or_(*predicates),
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
            if cls._is_start_from_scratch_request(binding=binding, payload=payload):
                return cls._switch_roster_binding_to_inline_agent(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    workflow_id=workflow_id,
                    node_id=node_id,
                    account_id=account_id,
                    binding=binding,
                    payload=payload,
                )
            binding.node_job_config = node_job
            if payload.agent_soul is not None and binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT:
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
                if agent.scope != AgentScope.WORKFLOW_ONLY:
                    raise ValueError("Inline workflow agent binding must point to a workflow-only agent")
                agent.active_config_snapshot_id = version.id
                agent.active_config_has_model = agent_soul_has_model(payload.agent_soul)
                agent.updated_by = account_id
                binding.current_snapshot_id = version.id
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
        agent.active_config_has_model = agent_soul_has_model(payload.agent_soul)
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
        agent.active_config_has_model = agent_soul_has_model(payload.agent_soul)
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
        agent.active_config_has_model = agent_soul_has_model(agent_soul)
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
        agent.active_config_has_model = agent_soul_has_model(agent_soul)
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
                "current_snapshot_id": version.id if version else binding.current_snapshot_id,
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
            "impact_summary": cls.calculate_impact(tenant_id=binding.tenant_id, current_snapshot_id=version.id)
            if version
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
            "created_at": to_timestamp(version.created_at),
        }

    @staticmethod
    def _workflow_agent_soul_config(config_snapshot: dict[str, Any]) -> dict[str, Any]:
        agent_soul = dict(config_snapshot)
        agent_soul["app_features"] = {}
        agent_soul["app_variables"] = []
        return agent_soul
