import logging
from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.exc import IntegrityError

from constants.model_template import default_app_templates
from libs.datetime_utils import naive_utc_now
from models.agent import (
    APP_BACKED_AGENT_SOURCES,
    WORKFLOW_ONLY_AGENT_SOURCES,
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentDebugConversation,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    AgentWorkspaceOwnerType,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus, ConversationFromSource, ConversationStatus, InvokeFrom
from models.model import App, AppMode, AppModelConfig, Conversation, IconType, Message
from repositories.agent_roster_repository import (
    build_roster_agents_stmt,
    load_active_config_is_published_by_agent_id,
    load_published_references_by_agent_id,
    load_reference_counts_by_agent_id,
    load_versions_by_id,
    serialize_agent,
    serialize_version,
)
from repositories.agent_version_queries import visible_version_ids, visible_version_operations
from repositories.app.agent_app_queries import get_app_backing_agent, get_roster_agent_app
from services.agent.agent_soul_state import agent_soul_has_model
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import (
    AgentArchivedError,
    AgentBuildSandboxNotFoundError,
    AgentNameConflictError,
    AgentNotFoundError,
    AgentVersionNotFoundError,
)
from services.agent.knowledge_spaces import validate_agent_knowledge_spaces
from services.agent.workspace_service import AgentWorkspaceNotFoundError, AgentWorkspaceService, WorkspaceOwnerScope
from services.app.agent_app_contracts import AgentReferencingWorkflow
from services.app_service import AppService, CreateAppParams
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.agent_entities import RosterAgentCreatePayload, RosterAgentUpdatePayload
from services.rbac_agent_access_service import initialize_agent_rbac_access
from services.system_feature_service import SystemFeatureService
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection

logger = logging.getLogger(__name__)


class AgentRosterService:
    _APP_MODEL_CONFIG_COPY_FIELDS = (
        "opening_statement",
        "suggested_questions",
        "suggested_questions_after_answer",
        "speech_to_text",
        "text_to_speech",
        "more_like_this",
        "model",
        "user_input_form",
        "dataset_query_variable",
        "pre_prompt",
        "agent_mode",
        "sensitive_word_avoidance",
        "retriever_resource",
        "prompt_type",
        "chat_prompt_config",
        "completion_prompt_config",
        "dataset_configs",
        "external_data_tools",
        "file_upload",
    )

    def __init__(self, session: Any):
        self._session = session

    @staticmethod
    def serialize_agent(
        agent: Agent,
        active_version: AgentConfigSnapshot | None = None,
        published_references: list[AgentReferencingWorkflow] | None = None,
        active_config_is_published: bool | None = None,
        reference_count: int | None = None,
    ) -> dict[str, Any]:
        """Project a loaded Agent and optional related records for legacy callers."""
        return serialize_agent(agent, active_version, published_references, active_config_is_published, reference_count)

    @staticmethod
    def serialize_version(version: AgentConfigSnapshot | None) -> dict[str, Any] | None:
        """Project a loaded snapshot, or return None for an absent snapshot."""
        return serialize_version(version)

    @staticmethod
    def _build_roster_agents_stmt(*, tenant_id: str, keyword: str | None = None) -> Select[tuple[Agent]]:
        """Build the active tenant roster query with its optional name filter."""
        return build_roster_agents_stmt(tenant_id=tenant_id, keyword=keyword)

    def list_roster_agents(
        self, *, tenant_id: str, page: int = 1, limit: int = 20, keyword: str | None = None
    ) -> dict[str, Any]:
        stmt = self._build_roster_agents_stmt(tenant_id=tenant_id, keyword=keyword)

        total = self._session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        agents = list(self._session.scalars(stmt.offset((page - 1) * limit).limit(limit)).all())
        versions_by_id = self._load_versions_by_id(
            [agent.active_config_snapshot_id for agent in agents if agent.active_config_snapshot_id]
        )
        published_references_by_agent_id = self._load_published_references_by_agent_id(
            tenant_id=tenant_id,
            agent_ids=[agent.id for agent in agents],
        )
        reference_counts_by_agent_id = self._load_reference_counts_by_agent_id(
            tenant_id=tenant_id,
            agent_ids=[agent.id for agent in agents],
        )
        active_config_is_published_by_agent_id = self.load_active_config_is_published_by_agent_id(
            tenant_id=tenant_id,
            agents=agents,
        )

        data = []
        for agent in agents:
            active_version = (
                versions_by_id.get(agent.active_config_snapshot_id) if agent.active_config_snapshot_id else None
            )
            data.append(
                self.serialize_agent(
                    agent,
                    active_version,
                    published_references_by_agent_id.get(agent.id, []),
                    active_config_is_published_by_agent_id.get(agent.id, False),
                    reference_counts_by_agent_id.get(agent.id, 0),
                )
            )

        return {
            "data": data,
            "page": page,
            "limit": limit,
            "total": total,
            "has_more": page * limit < total,
        }

    def create_roster_agent(
        self,
        *,
        tenant_id: str,
        account_id: str,
        payload: RosterAgentCreatePayload,
        source: AgentSource = AgentSource.ROSTER,
    ) -> Agent:
        try:
            agent = self._create_roster_agent_in_transaction(
                tenant_id=tenant_id,
                account_id=account_id,
                payload=payload,
                source=source,
            )
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise AgentNameConflictError() from exc

        initialize_agent_rbac_access(tenant_id=tenant_id, agent_id=agent.id, creator_account_id=account_id)
        return agent

    def _create_roster_agent_in_transaction(
        self,
        *,
        tenant_id: str,
        account_id: str,
        payload: RosterAgentCreatePayload,
        source: AgentSource,
    ) -> Agent:
        ComposerConfigValidator.validate_agent_soul(payload.agent_soul)
        validate_agent_knowledge_spaces(
            session=self._session, tenant_id=tenant_id, account_id=account_id, agent_soul=payload.agent_soul
        )

        agent = Agent(
            tenant_id=tenant_id,
            name=payload.name,
            description=payload.description,
            role=payload.role,
            icon_type=payload.icon_type,
            icon=payload.icon,
            icon_background=payload.icon_background,
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=source,
            status=AgentStatus.ACTIVE,
            created_by=account_id,
            updated_by=account_id,
        )
        self._session.add(agent)
        self._session.flush()

        version = AgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent.id,
            version=1,
            config_snapshot=payload.agent_soul,
            home_snapshot_id=None,
            version_note=payload.version_note,
            created_by=account_id,
        )
        self._session.add(version)
        self._session.flush()

        revision = AgentConfigRevision(
            tenant_id=tenant_id,
            agent_id=agent.id,
            current_snapshot_id=version.id,
            revision=1,
            operation=AgentConfigRevisionOperation.CREATE_VERSION,
            version_note=payload.version_note,
            created_by=account_id,
        )
        self._session.add(revision)
        agent.active_config_snapshot_id = version.id
        agent.active_config_has_model = agent_soul_has_model(payload.agent_soul)
        agent.active_config_is_published = True

        return agent

    def create_backing_agent_for_app(
        self,
        *,
        tenant_id: str,
        account_id: str,
        app_id: str,
        name: str,
        description: str = "",
        role: str = "",
        icon_type: Any = None,
        icon: str | None = None,
        icon_background: str | None = None,
        source: AgentSource = AgentSource.AGENT_APP,
        initial_soul: AgentSoulConfig | None = None,
        revision_operation: AgentConfigRevisionOperation = AgentConfigRevisionOperation.CREATE_VERSION,
    ) -> Agent:
        """Create the roster Agent that backs an Agent App, linked via ``app_id``.

        Unlike :meth:`create_roster_agent`, this does not commit: the caller
        (``AppService.create_app``) owns the surrounding transaction so the App
        row and its backing Agent are persisted atomically. The caller supplies
        the initial Agent Soul, or an empty one is seeded. Importers may provide
        a portable Soul and provenance while retaining the same transaction boundary.
        """
        soul = initial_soul or AgentSoulConfig()
        agent = Agent(
            tenant_id=tenant_id,
            name=name,
            description=description,
            role=role,
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=source,
            status=AgentStatus.ACTIVE,
            app_id=app_id,
            backing_app_id=app_id,
            created_by=account_id,
            updated_by=account_id,
        )
        self._session.add(agent)
        self._session.flush()

        version = AgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent.id,
            version=1,
            config_snapshot=soul,
            home_snapshot_id=None,
            created_by=account_id,
        )
        self._session.add(version)
        self._session.flush()

        revision = AgentConfigRevision(
            tenant_id=tenant_id,
            agent_id=agent.id,
            current_snapshot_id=version.id,
            revision=1,
            operation=revision_operation,
            created_by=account_id,
        )
        self._session.add(revision)
        agent.active_config_snapshot_id = version.id
        agent.active_config_has_model = agent_soul_has_model(soul)
        agent.active_config_is_published = False
        self._session.flush()
        self._get_or_create_agent_app_debug_conversation(
            agent=agent,
            account_id=account_id,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
        )
        return agent

    def create_hidden_backing_app_for_workflow_agent(
        self,
        *,
        tenant_id: str,
        account_id: str | None,
        name: str,
        description: str = "",
        icon_type: Any = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> App:
        """Create an internal Agent App used only to back a workflow-only Agent.

        This deliberately bypasses AppService.create_app because that public
        creation path also creates a roster Agent. Inline Agents need App runtime
        infrastructure for chat/logs/monitoring, but must stay hidden from the
        workspace Agent Roster until explicitly saved to roster.
        """

        app_template = dict(default_app_templates[AppMode.AGENT]["app"])
        app = App(**app_template)
        app.name = name
        app.description = description or ""
        app.mode = AppMode.AGENT
        normalized_icon_type = self._normalize_app_icon_type(icon_type)
        app.icon_type = IconType(normalized_icon_type) if normalized_icon_type else IconType.EMOJI
        app.icon = icon
        app.icon_background = icon_background
        app.tenant_id = tenant_id
        app.enable_site = False
        app.enable_api = False
        app.api_rph = 0
        app.api_rpm = 0
        app.max_active_requests = None
        app.created_by = account_id
        app.maintainer = account_id
        app.updated_by = account_id
        self._session.add(app)
        self._session.flush()

        app_model_config = AppModelConfig(app_id=app.id, created_by=account_id, updated_by=account_id)
        self._session.add(app_model_config)
        self._session.flush()
        app.app_model_config_id = app_model_config.id
        self._session.flush()
        return app

    def _create_agent_app_debug_conversation(self, *, app_id: str, account_id: str) -> str:
        """Create one console debug conversation for an Agent App editor."""

        conversation = Conversation(
            app_id=app_id,
            app_model_config_id=None,
            model_provider=None,
            model_id="",
            override_model_configs=None,
            mode=AppMode.AGENT,
            name="Agent Debugging Conversation",
            _inputs={},
            introduction="",
            system_instruction="",
            system_instruction_tokens=0,
            status=ConversationStatus.NORMAL,
            invoke_from=InvokeFrom.DEBUGGER,
            from_source=ConversationFromSource.CONSOLE,
            from_end_user_id=None,
            from_account_id=account_id,
        )
        self._session.add(conversation)
        self._session.flush()
        return conversation.id

    @staticmethod
    def runtime_backing_app_id(agent: Agent) -> str | None:
        """Return the App id that backs Agent runtime chat/log/monitoring."""

        return agent.backing_app_id or agent.app_id

    def _ensure_workflow_agent_backing_app(self, *, agent: Agent, account_id: str | None) -> str | None:
        if agent.scope != AgentScope.WORKFLOW_ONLY or agent.backing_app_id:
            return self.runtime_backing_app_id(agent)
        backing_app = self.create_hidden_backing_app_for_workflow_agent(
            tenant_id=agent.tenant_id,
            account_id=account_id or agent.updated_by or agent.created_by,
            name=agent.name,
            description=agent.description,
            icon_type=agent.icon_type,
            icon=agent.icon,
            icon_background=agent.icon_background,
        )
        agent.backing_app_id = backing_app.id
        self._session.flush()
        return backing_app.id

    def _get_or_create_agent_app_debug_conversation(
        self, *, agent: Agent, account_id: str, draft_type: AgentConfigDraftType
    ) -> str:
        """Return the editor's conversation for one Agent draft surface."""

        backing_app_id = self._ensure_workflow_agent_backing_app(agent=agent, account_id=account_id)
        if not backing_app_id:
            raise AgentNotFoundError()

        mapping = self._session.scalar(
            select(AgentDebugConversation).where(
                AgentDebugConversation.tenant_id == agent.tenant_id,
                AgentDebugConversation.agent_id == agent.id,
                AgentDebugConversation.account_id == account_id,
                AgentDebugConversation.draft_type == draft_type,
            )
        )
        if mapping is not None:
            conversation_id = self._session.scalar(
                select(Conversation.id).where(
                    Conversation.id == mapping.conversation_id,
                    Conversation.app_id == backing_app_id,
                    Conversation.from_source == ConversationFromSource.CONSOLE,
                    Conversation.from_account_id == account_id,
                    Conversation.is_deleted.is_(False),
                )
            )
            if conversation_id:
                return conversation_id

            mapping.conversation_id = self._create_agent_app_debug_conversation(
                app_id=backing_app_id,
                account_id=account_id,
            )
            mapping.app_id = backing_app_id
            self._session.flush()
            return mapping.conversation_id

        conversation_id = self._create_agent_app_debug_conversation(
            app_id=backing_app_id,
            account_id=account_id,
        )
        self._session.add(
            AgentDebugConversation(
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                app_id=backing_app_id,
                account_id=account_id,
                draft_type=draft_type,
                conversation_id=conversation_id,
            )
        )
        self._session.flush()
        return conversation_id

    def get_or_create_build_conversation(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        commit: bool = True,
    ) -> str:
        """Return the current editor's stable Build conversation."""

        agent = self._session.scalar(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.id == agent_id,
                Agent.status == AgentStatus.ACTIVE,
            )
        )
        if agent is None:
            raise AgentNotFoundError()

        conversation_id = self._get_or_create_agent_app_debug_conversation(
            agent=agent,
            account_id=account_id,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
        )
        if commit:
            self._session.commit()
        return conversation_id

    def get_current_preview_conversation(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
    ) -> str | None:
        """Return the editor's current Preview conversation without creating one."""

        return self._session.scalar(
            select(Conversation.id)
            .join(AgentDebugConversation, AgentDebugConversation.conversation_id == Conversation.id)
            .where(
                AgentDebugConversation.tenant_id == tenant_id,
                AgentDebugConversation.agent_id == agent_id,
                AgentDebugConversation.account_id == account_id,
                AgentDebugConversation.draft_type == AgentConfigDraftType.DRAFT,
                AgentDebugConversation.app_id == Conversation.app_id,
                Conversation.from_source == ConversationFromSource.CONSOLE,
                Conversation.from_account_id == account_id,
                Conversation.is_deleted.is_(False),
            )
        )

    def count_agent_app_debug_conversation_messages(self, *, conversation_id: str) -> int:
        """Return the number of visible messages in an Agent App debug conversation."""

        return (
            self._session.scalar(
                select(func.count(Message.id)).where(
                    Message.conversation_id == conversation_id,
                )
            )
            or 0
        )

    def rotate_preview_conversation(self, *, tenant_id: str, agent_id: str, account_id: str) -> str:
        """Rotate Preview and retire its exact Conversation-owned Binding.

        The mapping update and exact CONVERSATION Binding retirement commit in
        one transaction. Validation failures fail fast; collection is enqueued
        only after commit.
        """

        agent = self._session.scalar(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.id == agent_id,
                Agent.status == AgentStatus.ACTIVE,
            )
        )
        if agent is None:
            raise AgentNotFoundError()
        backing_app_id = self._ensure_workflow_agent_backing_app(
            agent=agent,
            account_id=agent.updated_by or agent.created_by,
        )
        if not backing_app_id:
            raise AgentNotFoundError()

        retired_binding_id: str | None = None
        try:
            conversation_id = self._create_agent_app_debug_conversation(
                app_id=backing_app_id,
                account_id=account_id,
            )
            mapping = self._session.scalar(
                select(AgentDebugConversation).where(
                    AgentDebugConversation.tenant_id == tenant_id,
                    AgentDebugConversation.agent_id == agent_id,
                    AgentDebugConversation.account_id == account_id,
                    AgentDebugConversation.draft_type == AgentConfigDraftType.DRAFT,
                )
            )
            if mapping is None:
                self._session.add(
                    AgentDebugConversation(
                        tenant_id=tenant_id,
                        agent_id=agent_id,
                        app_id=backing_app_id,
                        account_id=account_id,
                        draft_type=AgentConfigDraftType.DRAFT,
                        conversation_id=conversation_id,
                    )
                )
            else:
                previous_app_id = mapping.app_id or backing_app_id
                previous_conversation_id = mapping.conversation_id
                if previous_conversation_id:
                    previous_conversation = self._session.scalar(
                        select(Conversation).where(
                            Conversation.id == previous_conversation_id,
                            Conversation.app_id == previous_app_id,
                            Conversation.from_source == ConversationFromSource.CONSOLE,
                            Conversation.from_account_id == account_id,
                            Conversation.is_deleted.is_(False),
                        )
                    )
                    if (
                        previous_conversation is not None
                        and previous_conversation.agent_workspace_binding_id is not None
                    ):
                        binding_id = previous_conversation.agent_workspace_binding_id
                        binding = AgentWorkspaceService.get_active_binding(
                            session=self._session,
                            tenant_id=tenant_id,
                            binding_id=binding_id,
                            expected_owner_scope=WorkspaceOwnerScope(
                                tenant_id=tenant_id,
                                app_id=previous_app_id,
                                owner_type=AgentWorkspaceOwnerType.CONVERSATION,
                                owner_id=previous_conversation.id,
                            ),
                        )
                        if binding is None or binding.agent_id != agent_id:
                            raise AgentWorkspaceNotFoundError(
                                "Agent debug Conversation participant Binding is unavailable"
                            )
                        retired_binding_id = AgentWorkspaceService.retire_binding(
                            session=self._session,
                            tenant_id=tenant_id,
                            binding_id=binding_id,
                        )
                        if retired_binding_id is None:
                            raise AgentWorkspaceNotFoundError(
                                "Agent debug Conversation participant Binding is unavailable"
                            )
                mapping.app_id = backing_app_id
                mapping.conversation_id = conversation_id
            self._session.flush()
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise
        if retired_binding_id is not None:
            enqueue_agent_resource_collection(
                tenant_id=tenant_id,
                binding_ids=(retired_binding_id,),
            )
        return conversation_id

    def reset_build_conversation(self, *, tenant_id: str, agent_id: str, account_id: str) -> str:
        """Reset Build and retire its exact DEBUG_BUILD Draft-owned Binding.

        The mapping update, exact BUILD_DRAFT Binding retirement, and Draft
        pointer clear commit in one transaction. Validation failures fail fast;
        collection is enqueued only after commit.
        """

        agent = self._session.scalar(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.id == agent_id,
                Agent.status == AgentStatus.ACTIVE,
            )
        )
        if agent is None:
            raise AgentNotFoundError()
        backing_app_id = self._ensure_workflow_agent_backing_app(
            agent=agent,
            account_id=agent.updated_by or agent.created_by,
        )
        if not backing_app_id:
            raise AgentNotFoundError()

        retired_binding_id: str | None = None
        try:
            conversation_id = self._create_agent_app_debug_conversation(
                app_id=backing_app_id,
                account_id=account_id,
            )
            mapping = self._session.scalar(
                select(AgentDebugConversation).where(
                    AgentDebugConversation.tenant_id == tenant_id,
                    AgentDebugConversation.agent_id == agent_id,
                    AgentDebugConversation.account_id == account_id,
                    AgentDebugConversation.draft_type == AgentConfigDraftType.DEBUG_BUILD,
                )
            )
            build_draft = self._session.scalar(
                select(AgentConfigDraft)
                .where(
                    AgentConfigDraft.tenant_id == tenant_id,
                    AgentConfigDraft.agent_id == agent_id,
                    AgentConfigDraft.draft_type == AgentConfigDraftType.DEBUG_BUILD,
                    AgentConfigDraft.account_id == account_id,
                )
                .order_by(AgentConfigDraft.updated_at.desc())
                .limit(1)
            )
            if build_draft is not None and build_draft.agent_workspace_binding_id is not None:
                binding_id = build_draft.agent_workspace_binding_id
                binding = AgentWorkspaceService.get_active_binding(
                    session=self._session,
                    tenant_id=tenant_id,
                    binding_id=binding_id,
                    expected_owner_scope=WorkspaceOwnerScope(
                        tenant_id=tenant_id,
                        app_id=backing_app_id,
                        owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
                        owner_id=build_draft.id,
                    ),
                )
                if binding is None or binding.agent_id != agent_id:
                    raise AgentBuildSandboxNotFoundError()
                retired_binding_id = AgentWorkspaceService.retire_binding(
                    session=self._session,
                    tenant_id=tenant_id,
                    binding_id=binding_id,
                )
                if retired_binding_id is None:
                    raise AgentBuildSandboxNotFoundError()
                build_draft.agent_workspace_binding_id = None

            if mapping is None:
                self._session.add(
                    AgentDebugConversation(
                        tenant_id=tenant_id,
                        agent_id=agent_id,
                        app_id=backing_app_id,
                        account_id=account_id,
                        draft_type=AgentConfigDraftType.DEBUG_BUILD,
                        conversation_id=conversation_id,
                    )
                )
            else:
                mapping.app_id = backing_app_id
                mapping.conversation_id = conversation_id
            self._session.flush()
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise
        if retired_binding_id is not None:
            enqueue_agent_resource_collection(
                tenant_id=tenant_id,
                binding_ids=(retired_binding_id,),
            )
        return conversation_id

    def load_or_create_build_conversation_ids_by_agent_id(
        self,
        *,
        tenant_id: str,
        agents: list[Agent],
        account_id: str,
    ) -> dict[str, str]:
        """Return per-account Build conversations for a page of Agent Apps."""

        conversation_ids_by_agent_id: dict[str, str] = {}
        changed = False
        for agent in agents:
            if agent.tenant_id != tenant_id or agent.status != AgentStatus.ACTIVE:
                continue
            conversation_ids_by_agent_id[agent.id] = self._get_or_create_agent_app_debug_conversation(
                agent=agent,
                account_id=account_id,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
            )
            changed = True
        if changed:
            self._session.commit()
        return conversation_ids_by_agent_id

    def load_app_backing_agents_by_app_id(self, *, tenant_id: str, app_ids: list[str]) -> dict[str, Agent]:
        """Return active app-backed Agents keyed by Agent App id."""
        if not app_ids:
            return {}
        agents = self._session.scalars(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.app_id.in_(app_ids),
                Agent.scope == AgentScope.ROSTER,
                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                Agent.status == AgentStatus.ACTIVE,
            )
        ).all()
        return {agent.app_id: agent for agent in agents if agent.app_id and agent.id}

    def load_app_ids_for_agents(self, *, tenant_id: str, agent_ids: Sequence[str]) -> list[str]:
        """Return active Agent App ids for the requested roster Agents."""
        if not agent_ids:
            return []
        app_ids = self._session.scalars(
            select(Agent.app_id).where(
                Agent.tenant_id == tenant_id,
                Agent.id.in_(agent_ids),
                Agent.app_id.is_not(None),
                Agent.scope == AgentScope.ROSTER,
                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                Agent.status == AgentStatus.ACTIVE,
            )
        ).all()
        return sorted({str(app_id) for app_id in app_ids if app_id})

    def get_app_backing_agent(self, *, tenant_id: str, app_id: str) -> Agent | None:
        """Return the roster Agent that backs the given Agent App, if any."""
        return get_app_backing_agent(self._session, tenant_id=tenant_id, app_id=app_id)

    def get_published_agent_soul_for_app(self, *, tenant_id: str, app_id: str) -> AgentSoulConfig | None:
        """Return the active Agent Soul used by a published Agent App runtime."""
        agent = self.get_app_backing_agent(tenant_id=tenant_id, app_id=app_id)
        if agent is None:
            return None
        version = self._get_version(
            tenant_id=tenant_id,
            agent_id=agent.id,
            version_id=agent.active_config_snapshot_id,
        )
        return AgentSoulConfig.model_validate(version.config_snapshot_dict)

    def get_agent_app_model(self, *, tenant_id: str, agent_id: str) -> App:
        """Resolve the Agent App hidden behind an app-backed Agent id.

        The public /agent route uses Agent ids, while the runtime and legacy app
        APIs still operate on App ids internally. Only app-backed roster Agents
        are accepted here; workflow-only Agents and historical standalone roster
        Agents are not Agent App resources.
        """
        app = get_roster_agent_app(self._session, tenant_id=tenant_id, agent_id=agent_id)
        if app is None:
            raise AgentNotFoundError()
        return app

    def _get_runtime_resolvable_agent(self, *, tenant_id: str, agent_id: str) -> Agent | None:
        """Load an Agent that is eligible to resolve to a runtime backing App.

        Shared by the runtime resolvers and the read-only authorization resolver
        so both agree on what counts as a resolvable Agent.
        """

        return self._session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == tenant_id,
                Agent.id == agent_id,
                Agent.status == AgentStatus.ACTIVE,
                or_(
                    and_(Agent.scope == AgentScope.ROSTER, Agent.source.in_(APP_BACKED_AGENT_SOURCES)),
                    and_(
                        Agent.scope == AgentScope.WORKFLOW_ONLY,
                        Agent.source.in_(WORKFLOW_ONLY_AGENT_SOURCES),
                        Agent.workflow_id.is_not(None),
                        Agent.workflow_node_id.is_not(None),
                    ),
                ),
            )
            .limit(1)
        )

    def peek_authz_app_id(self, *, tenant_id: str, agent_id: str) -> str | None:
        """Resolve the App id whose access policy governs an Agent.

        Roster Agents are governed by their own Agent App, while workflow-only
        Agents are governed by their parent workflow App: the hidden runtime
        backing App never receives a resource access policy, so it must not be
        used for authorization. Stays read-only — unlike
        :meth:`get_agent_runtime_app_model`, this never materializes the hidden
        backing App. Returns ``None`` when the Agent does not resolve, leaving
        the caller to decide how to treat it.
        """

        agent = self._get_runtime_resolvable_agent(tenant_id=tenant_id, agent_id=agent_id)
        if agent is None:
            return None
        return agent.app_id

    def get_existing_agent_runtime_app_model(self, *, tenant_id: str, agent_id: str) -> App:
        """Resolve an existing runtime App without creating or committing state.

        Workflow-only Agents must already have a hidden backing App. Their
        parent workflow App must never stand in for a missing runtime App.
        """
        agent = self._get_runtime_resolvable_agent(tenant_id=tenant_id, agent_id=agent_id)
        if agent is None:
            raise AgentNotFoundError()
        app_id = agent.backing_app_id if agent.scope == AgentScope.WORKFLOW_ONLY else self.runtime_backing_app_id(agent)
        if not app_id:
            raise AgentNotFoundError()
        return self._get_runtime_app_model_by_id(tenant_id=tenant_id, app_id=app_id)

    def get_agent_runtime_app_model(self, *, tenant_id: str, agent_id: str) -> App:
        """Resolve the App that backs an Agent runtime surface.

        Roster Agents use their public Agent App. Workflow-only Agents use a
        hidden Agent App stored in ``backing_app_id`` so console chat/logs can
        reuse the app runtime without exposing the resource in workspace app
        lists.
        """

        agent = self._get_runtime_resolvable_agent(tenant_id=tenant_id, agent_id=agent_id)
        if agent is None:
            raise AgentNotFoundError()
        should_commit_backing_app = agent.scope == AgentScope.WORKFLOW_ONLY and not agent.backing_app_id
        backing_app_id = self._ensure_workflow_agent_backing_app(
            agent=agent,
            account_id=agent.updated_by or agent.created_by,
        )
        if not backing_app_id:
            raise AgentNotFoundError()
        if should_commit_backing_app:
            self._session.commit()

        return self._get_runtime_app_model_by_id(tenant_id=tenant_id, app_id=backing_app_id)

    def _get_runtime_app_model_by_id(self, *, tenant_id: str, app_id: str) -> App:
        app = self._session.scalar(
            select(App)
            .where(
                App.tenant_id == tenant_id,
                App.id == app_id,
                App.mode == AppMode.AGENT,
                App.status == AppStatus.NORMAL,
            )
            .limit(1)
        )
        if app is None:
            raise AgentNotFoundError()
        return app

    def duplicate_agent_app(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account: Any,
        name: str | None = None,
        description: str | None = None,
        role: str | None = None,
        icon_type: Any = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> App:
        source_app = self.get_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        source_agent = self.get_app_backing_agent(tenant_id=tenant_id, app_id=source_app.id)
        if source_agent is None:
            raise AgentNotFoundError()

        copied_name = name or self._next_duplicate_agent_name(tenant_id=tenant_id, base_name=source_app.name)
        copied_description = description if description is not None else source_app.description
        copied_role = role if role is not None else source_agent.role or ""
        copied_icon_type = icon_type if icon_type is not None else source_app.icon_type
        copied_icon = icon if icon is not None else source_app.icon
        copied_icon_background = icon_background if icon_background is not None else source_app.icon_background

        target_app = AppService().create_app(
            tenant_id,
            CreateAppParams(
                name=copied_name,
                description=copied_description,
                mode="agent",
                agent_role=copied_role,
                icon_type=self._normalize_app_icon_type(copied_icon_type),
                icon=copied_icon,
                icon_background=copied_icon_background,
                api_rph=source_app.api_rph or 0,
                api_rpm=source_app.api_rpm or 0,
                max_active_requests=source_app.max_active_requests,
            ),
            account,
            session=self._session,
        )

        # A copy owns a new publication history. It remains private until its
        # first successful publish even when the source Agent is public.
        target_app.enable_site = False
        target_app.enable_api = False
        target_app.use_icon_as_answer_icon = source_app.use_icon_as_answer_icon
        target_app.tracing = source_app.tracing

        self._copy_app_model_config(source_app=source_app, target_app=target_app, account_id=account.id)
        self._copy_agent_active_snapshot(
            tenant_id=tenant_id,
            source_agent=source_agent,
            target_app_id=target_app.id,
            account_id=account.id,
        )
        from services.skill_management_service import SkillManagementService

        target_agent = self.get_app_backing_agent(tenant_id=tenant_id, app_id=target_app.id)
        if target_agent is None:
            raise AgentNotFoundError()
        SkillManagementService(session=self._session).copy_agent_bindings(
            tenant_id=tenant_id,
            source_agent_id=source_agent.id,
            source_snapshot_id=source_agent.active_config_snapshot_id or "",
            target_agent_id=target_agent.id,
            user_id=account.id,
            source_include_draft=not source_agent.active_config_is_published,
        )
        self._session.commit()
        if SystemFeatureService.is_webapp_auth_enabled():
            try:
                original_settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(source_app.id)
                access_mode = original_settings.access_mode
            except Exception:
                access_mode = "public"
            EnterpriseService.WebAppAuth.update_app_access_mode(target_app.id, access_mode)

        return target_app

    @staticmethod
    def _normalize_app_icon_type(icon_type: Any | None) -> str | None:
        if icon_type is None:
            return None
        if isinstance(icon_type, IconType) or hasattr(icon_type, "value"):
            return icon_type.value
        return icon_type

    def _copy_app_model_config(self, *, source_app: App, target_app: App, account_id: str) -> None:
        source_config = source_app.app_model_config_with_session(session=self._session)
        target_config = target_app.app_model_config_with_session(session=self._session)
        if source_config is None or target_config is None:
            return

        for field_name in self._APP_MODEL_CONFIG_COPY_FIELDS:
            setattr(target_config, field_name, getattr(source_config, field_name))
        target_config.updated_by = account_id

    def _copy_agent_active_snapshot(
        self,
        *,
        tenant_id: str,
        source_agent: Agent,
        target_app_id: str,
        account_id: str,
    ) -> None:
        target_agent = self.get_app_backing_agent(tenant_id=tenant_id, app_id=target_app_id)
        if target_agent is None:
            raise AgentNotFoundError()

        source_version = self._get_version(
            tenant_id=tenant_id,
            agent_id=source_agent.id,
            version_id=source_agent.active_config_snapshot_id,
        )
        target_version = self._get_version(
            tenant_id=tenant_id,
            agent_id=target_agent.id,
            version_id=target_agent.active_config_snapshot_id,
        )

        target_version.config_snapshot = AgentSoulConfig.model_validate(source_version.config_snapshot_dict)
        target_version.summary = source_version.summary
        target_version.version_note = source_version.version_note
        target_version.created_by = account_id
        target_agent.active_config_has_model = agent_soul_has_model(target_version.config_snapshot)
        target_agent.active_config_is_published = False
        target_agent.updated_by = account_id

    def _next_duplicate_agent_name(self, *, tenant_id: str, base_name: str) -> str:
        suffix = " copy"
        max_base_len = 255 - len(suffix)
        first_candidate = f"{base_name[:max_base_len]}{suffix}"
        candidates = [first_candidate]
        for index in range(2, 100):
            numbered_suffix = f" copy {index}"
            candidates.append(f"{base_name[: 255 - len(numbered_suffix)]}{numbered_suffix}")

        existing_names = set(
            self._session.scalars(
                select(Agent.name).where(
                    Agent.tenant_id == tenant_id,
                    Agent.scope == AgentScope.ROSTER,
                    Agent.status == AgentStatus.ACTIVE,
                    Agent.name.in_(candidates),
                )
            ).all()
        )
        for candidate in candidates:
            if candidate not in existing_names:
                return candidate
        return f"{base_name[:245]} copy {int(naive_utc_now().timestamp())}"

    def list_workflows_referencing_app_agent(self, *, tenant_id: str, app_id: str) -> list[AgentReferencingWorkflow]:
        """List the workflow apps that reference this Agent App's bound Agent.

        Read-only "Workflow access" surface: an Agent App is backed by a roster
        Agent, and workflow Agent nodes may bind that same roster Agent. This
        returns the distinct workflow apps (with the referencing node ids) so the
        console can show "used by" without exposing the workflow internals.
        """
        agent = self.get_app_backing_agent(tenant_id=tenant_id, app_id=app_id)
        if agent is None:
            return []

        return self._load_published_references_by_agent_id(tenant_id=tenant_id, agent_ids=[agent.id]).get(agent.id, [])

    def load_published_references_by_agent_id(
        self, *, tenant_id: str, agent_ids: list[str]
    ) -> dict[str, list[AgentReferencingWorkflow]]:
        """Return published workflow references grouped by roster Agent id."""
        return self._load_published_references_by_agent_id(tenant_id=tenant_id, agent_ids=agent_ids)

    def load_reference_counts_by_agent_id(self, *, tenant_id: str, agent_ids: list[str]) -> dict[str, int]:
        """Return current draft or published workflow app references by roster Agent id."""
        return self._load_reference_counts_by_agent_id(tenant_id=tenant_id, agent_ids=agent_ids)

    def get_roster_agent_detail(self, *, tenant_id: str, agent_id: str) -> dict[str, Any]:
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        active_version = self._get_version(
            tenant_id=tenant_id, agent_id=agent.id, version_id=agent.active_config_snapshot_id
        )
        published_references_by_agent_id = self._load_published_references_by_agent_id(
            tenant_id=tenant_id,
            agent_ids=[agent.id],
        )
        reference_counts_by_agent_id = self._load_reference_counts_by_agent_id(
            tenant_id=tenant_id,
            agent_ids=[agent.id],
        )
        active_config_is_published_by_agent_id = self.load_active_config_is_published_by_agent_id(
            tenant_id=tenant_id,
            agents=[agent],
        )
        return self.serialize_agent(
            agent,
            active_version,
            published_references_by_agent_id.get(agent.id, []),
            active_config_is_published_by_agent_id.get(agent.id, False),
            reference_counts_by_agent_id.get(agent.id, 0),
        )

    def update_roster_agent(
        self, *, tenant_id: str, agent_id: str, account_id: str, payload: RosterAgentUpdatePayload
    ) -> dict[str, Any]:
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        if agent.status == AgentStatus.ARCHIVED:
            raise AgentArchivedError()

        update_data = payload.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(agent, key, value)
        agent.updated_by = account_id

        try:
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise AgentNameConflictError() from exc
        return self.get_roster_agent_detail(tenant_id=tenant_id, agent_id=agent_id)

    def active_config_is_published(self, *, tenant_id: str, agent: Agent) -> bool:
        """Return whether the normal shared draft has been published into the active snapshot."""
        return self.load_active_config_is_published_by_agent_id(tenant_id=tenant_id, agents=[agent]).get(
            agent.id,
            False,
        )

    def load_active_config_is_published_by_agent_id(self, *, tenant_id: str, agents: list[Agent]) -> dict[str, bool]:
        """Return the normal draft's existing publication flags for the supplied Agents."""
        return load_active_config_is_published_by_agent_id(tenant_id=tenant_id, agents=agents)

    def get_visible_agent_version_snapshot(
        self, *, tenant_id: str, agent_id: str, version_id: UUID
    ) -> AgentConfigSnapshot:
        """Resolve a version exposed in the roster history within its complete owner scope."""
        agent = self._get_agent(tenant_id=tenant_id, agent_id=agent_id, roster_only=True)
        visible_ids = visible_version_ids(tenant_id=tenant_id, agent_id=agent_id, agent=agent)
        snapshot = self._session.scalar(
            select(AgentConfigSnapshot).where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == str(version_id),
                AgentConfigSnapshot.id.in_(select(visible_ids.c.current_snapshot_id)),
            )
        )
        if snapshot is None:
            raise AgentVersionNotFoundError()
        return snapshot

    def _get_agent(self, *, tenant_id: str, agent_id: str, roster_only: bool = False) -> Agent:
        stmt = select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id)
        if roster_only:
            stmt = stmt.where(Agent.scope == AgentScope.ROSTER)
        agent = self._session.scalar(stmt.limit(1))
        if not agent:
            raise AgentNotFoundError()
        return agent

    def _get_version(self, *, tenant_id: str, agent_id: str, version_id: str | None) -> AgentConfigSnapshot:
        if not version_id:
            raise AgentVersionNotFoundError()
        version = self._session.scalar(
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

    def _next_revision(self, *, tenant_id: str, agent_id: str) -> int:
        return (
            self._session.scalar(
                select(func.max(AgentConfigRevision.revision)).where(
                    AgentConfigRevision.tenant_id == tenant_id,
                    AgentConfigRevision.agent_id == agent_id,
                )
            )
            or 0
        ) + 1

    def _load_published_active_snapshot_agent_ids(self, *, tenant_id: str, agents: list[Agent]) -> set[str]:
        predicates = [
            and_(
                AgentConfigRevision.agent_id == agent.id,
                AgentConfigRevision.current_snapshot_id == agent.active_config_snapshot_id,
                AgentConfigRevision.operation.in_(visible_version_operations(agent)),
            )
            for agent in agents
            if agent.active_config_snapshot_id
        ]
        if not predicates:
            return set()

        agent_ids = self._session.scalars(
            select(AgentConfigRevision.agent_id)
            .where(
                AgentConfigRevision.tenant_id == tenant_id,
                or_(*predicates),
            )
            .distinct()
        ).all()
        return set(agent_ids)

    def _load_published_references_by_agent_id(
        self, *, tenant_id: str, agent_ids: list[str]
    ) -> dict[str, list[AgentReferencingWorkflow]]:
        """Load the tenant's current published references in this service's session."""
        return load_published_references_by_agent_id(self._session, tenant_id=tenant_id, agent_ids=agent_ids)

    def _load_reference_counts_by_agent_id(self, *, tenant_id: str, agent_ids: list[str]) -> dict[str, int]:
        """Count the tenant's current workflow references in this service's session."""
        return load_reference_counts_by_agent_id(self._session, tenant_id=tenant_id, agent_ids=agent_ids)

    def _load_versions_by_id(self, version_ids: list[str]) -> dict[str, AgentConfigSnapshot]:
        """Load the requested snapshots in this service's session."""
        return load_versions_by_id(self._session, version_ids)
